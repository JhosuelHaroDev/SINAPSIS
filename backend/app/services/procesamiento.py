"""
====================================================================
SINAPSIS — Orquestador de procesamiento en vivo (Pipeline SECI)
Ubicación: backend/app/services/procesamiento.py
====================================================================
Replica fielmente la lógica del pipeline batch (Socialización →
Externalización → Combinación) para ejecutarlo sobre un RLC individual
o por lotes directamente desde la web, 100% sobre PostgreSQL (sin MySQL).
====================================================================
"""

import os
import sys
import uuid
import logging
import subprocess
from typing import Dict, Any, List, Optional, Tuple

from dotenv import load_dotenv
from sqlalchemy import func
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified
from app.services.combinacion import enganchar_uce

from app.core.database import SessionLocal
from app.models import (
    RegistroLexicoCrudo,
    UnidadConocimientoExplicito,
    ReferenciaMCR,
    FormaMCR,
    Incidencia,
)

# Funciones puras del pipeline NLP
from app.nlp.resolver_remisiones import _sanear_rlc, _estado_uce, _GLOSA_BASURA, MAX_SALTOS
from app.nlp.resolver_categorias import _clasificar_acepcion
from app.nlp.inferir_categorias_llm import _inferir as _inferir_cat_llm, _mapear as _mapear_cat_llm
from app.nlp.ensamblar_embedding_input import ensamblar
from app.nlp.combinar_clasificar_tipo import CORTE_ALTO, CORTE_BAJO, _vec, _coseno

load_dotenv()
logger = logging.getLogger(__name__)

EMBEDDING_MODEL = "text-embedding-3-large"
EMBEDDING_DIM = 3072


def _resolver_remision_pg(
    db: Session,
    destino_id: Optional[int],
    destino_acepcion: Optional[int],
    origen_id: int,
) -> Tuple[Optional[str], str]:
    """Sigue una cadena de remisiones consultando registro_lexico_crudo en PostgreSQL."""
    visitados = {origen_id}
    did, dac = destino_id, destino_acepcion

    for _ in range(MAX_SALTOS):
        if did is None:
            return None, "destino_ausente"
        if did in visitados:
            return None, "ciclo"
        visitados.add(did)

        row = (
            db.query(RegistroLexicoCrudo.rlc_json)
            .filter(RegistroLexicoCrudo.id_entrada == did)
            .first()
        )
        if not row or not row[0]:
            return None, "destino_ausente"

        aceps = row[0].get("acepciones", []) or []
        if dac is not None:
            ac_dest = next((a for a in aceps if a.get("numero") == dac), None)
        else:
            ac_dest = aceps[0] if aceps else None

        if ac_dest is None:
            return None, "acepcion_ausente"

        g_dest = ac_dest.get("glosa")
        if g_dest and not (isinstance(g_dest, str) and _GLOSA_BASURA.match(g_dest)):
            return g_dest, "ok"

        rem = ac_dest.get("remision")
        if rem:
            did, dac = rem.get("destino_id"), rem.get("destino_acepcion")
            continue

        return None, "sin_glosa"

    return None, "cadena_larga"


def _aplicar_capa3_llm(
    db: Session,
    rlc_db: RegistroLexicoCrudo,
    ac: dict,
    client_anthropic,
) -> bool:
    """Infiere categoría gramatical con Claude Haiku para una acepción huérfana apta."""
    lema = rlc_db.lema
    num = ac.get("numero")
    glosa = ac.get("glosa") or ac.get("glosa_referida") or ""

    if not glosa or client_anthropic is None:
        return False

    crudo = None
    try:
        datos, crudo = _inferir_cat_llm(client_anthropic, lema, glosa)
        categoria = (datos.get("categoria") or "").strip().lower()
        genero = datos.get("genero_proximo")
        justif = datos.get("justificacion")
        confianza = (datos.get("confianza") or "").strip().lower()
        pos_mcr, estado_pos = _mapear_cat_llm(categoria)
        revision = confianza == "baja" or estado_pos == "incierto_llm"
        resultado = categoria or "incierto"
        detalle = {"respuesta": datos}
    except Exception as e:
        categoria = genero = justif = confianza = None
        pos_mcr, estado_pos = None, "incierto_llm"
        revision, resultado = True, "error"
        detalle = {"error": str(e), "crudo": crudo}

    if resultado != "error":
        ac["categoria_gramatical"] = categoria
        ac["categoria_origen"] = "inferida_llm"
        ac["pos_mcr"] = pos_mcr
        ac["pos_mcr_estado"] = estado_pos
        ac["inferencia_llm"] = {
            "genero_proximo": genero,
            "justificacion": justif,
            "confianza": confianza,
        }

    db.add(
        Incidencia(
            fase="capa3_categoria",
            tipo="inferencia_categoria",
            id_entrada=rlc_db.id_entrada,
            lema=lema,
            numero_acepcion=num,
            glosa=glosa,
            resultado=resultado,
            pos_mcr="+".join(pos_mcr) if isinstance(pos_mcr, list) else pos_mcr,
            genero_proximo=genero,
            justificacion=justif,
            confianza=confianza,
            requiere_revision=revision,
            detalle=detalle,
        )
    )
    return resultado != "error"


def _buscar_candidatos_forma(db: Session, lema: str, pos_mcr: str) -> List[str]:
    """Criba simbólica en PostgreSQL (tabla forma_mcr) filtrando por POS."""
    codigos = [c for c in (pos_mcr or "").split("+") if c]
    if not lema or not codigos:
        return []

    rows = (
        db.query(FormaMCR.offset)
        .filter(
            func.lower(FormaMCR.word) == lema.strip().lower(),
            FormaMCR.pos.in_(codigos),
        )
        .distinct()
        .all()
    )
    return [r[0] for r in rows]


class ProcesadorIndividual:
    """Orquestador para extraer y procesar entradas individualmente o en lote."""

    @staticmethod
    def extraer_diperu(id_entrada: int, lema: str) -> Dict[str, Any]:
        """Paso 1 (Socialización): Extrae una entrada de DiPerú con Playwright y guarda el RLC."""
        script_path = os.path.join(
            os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
            "scripts",
            "extract_single.py",
        )

        try:
            result = subprocess.run(
                [sys.executable, script_path, str(id_entrada), lema],
                capture_output=True,
                text=True,
                check=True,
            )
            if "SUCCESS" not in result.stdout:
                raise RuntimeError(
                    f"Playwright falló: {result.stdout.strip()} {result.stderr.strip()}"
                )
        except subprocess.CalledProcessError as e:
            raise RuntimeError(f"Fallo al invocar Playwright: {e.stderr or e.stdout}")

        with SessionLocal() as db:
            rlc_db = db.query(RegistroLexicoCrudo).filter_by(id_entrada=id_entrada).first()
            if not rlc_db:
                raise RuntimeError("El RLC no se guardó en la base de datos tras la extracción.")

            return {
                "id_rlc": str(rlc_db.id_rlc),
                "lema": rlc_db.lema,
                "id_entrada": rlc_db.id_entrada,
                "rlc_json": rlc_db.rlc_json,
                "texto_plano": (rlc_db.texto_plano[:200] + "...") if rlc_db.texto_plano else "",
            }

    @staticmethod
    def procesar_pipeline(
        id_rlc: str,
        client_openai=None,
        client_anthropic=None,
    ) -> Dict[str, Any]:
        """Ejecuta el pipeline SECI completo (Externalización + Clasificación) sobre un RLC."""
        import openai

        if client_openai is None:
            api_key = os.getenv("OPENAI_API_KEY")
            if not api_key:
                raise RuntimeError("Falta OPENAI_API_KEY en el entorno.")
            client_openai = openai.OpenAI(api_key=api_key)

        if client_anthropic is None and os.getenv("ANTHROPIC_API_KEY"):
            import anthropic
            client_anthropic = anthropic.Anthropic()

        with SessionLocal() as db:
            db.expire_on_commit = False
            rlc_db = db.query(RegistroLexicoCrudo).filter_by(id_rlc=id_rlc).first()
            if not rlc_db:
                raise ValueError(f"No se encontró RLC con id {id_rlc}")

            rlc = rlc_db.rlc_json
            lema = rlc_db.lema
            aceps = sorted(
                rlc.get("acepciones", []) or [],
                key=lambda a: (a.get("numero") or 0),
            )

            # 1) Saneado de glosas-placeholder (lista válida, no dict)
            saneadas = []
            _sanear_rlc(rlc, saneadas)

            # 2) Remisiones (lema + sublemas) y aptitud UCE
            aptas = 0
            for ac in aceps:
                rem = ac.get("remision")
                if rem and not ac.get("glosa"):
                    glosa_ref, rem_estado = _resolver_remision_pg(
                        db,
                        rem.get("destino_id"),
                        rem.get("destino_acepcion"),
                        rlc_db.id_entrada,
                    )
                    ac["glosa_referida"] = glosa_ref
                    ac["remision_estado"] = rem_estado
                ac["estado_uce"] = _estado_uce(ac)
                if ac["estado_uce"].startswith("apta"):
                    aptas += 1

            for sub in rlc.get("sublemas", []) or []:
                for ac_sub in sub.get("acepciones", []) or []:
                    rem = ac_sub.get("remision")
                    if rem and not ac_sub.get("glosa"):
                        g_ref, r_est = _resolver_remision_pg(
                            db,
                            rem.get("destino_id"),
                            rem.get("destino_acepcion"),
                            rlc_db.id_entrada,
                        )
                        ac_sub["glosa_referida"] = g_ref
                        ac_sub["remision_estado"] = r_est

            rlc.setdefault("conteo", {})["acepciones_aptas"] = aptas

            # 3) Categorías Capa 1 (separación + arrastre + mapeo POS MCR)
            last_pos = None
            for ac in aceps:
                # Respetar inferencia LLM previa si ya existía
                if ac.get("categoria_origen") == "inferida_llm" and ac.get("pos_mcr_estado") in ("mapeada", "sin_equivalente_mcr"):
                    continue
                campos, last_pos = _clasificar_acepcion(ac, last_pos)
                for k, v in campos.items():
                    ac[k] = v

            # 4) Categorías Capa 3 (Claude Haiku para huérfanas aptas)
            inferidas_llm = 0
            for ac in aceps:
                if (
                    ac.get("pos_mcr_estado") == "huerfana"
                    and ac.get("estado_uce") in ("apta_propia", "apta_referida")
                ):
                    if _aplicar_capa3_llm(db, rlc_db, ac, client_anthropic):
                        inferidas_llm += 1

            # 5) Ensamblado fiel del texto a vectorizar
            for ac in aceps:
                if (
                    ac.get("pos_mcr_estado") == "mapeada"
                    and ac.get("estado_uce") in ("apta_propia", "apta_referida")
                ):
                    if ac.get("glosa"):
                        fuente, origen = ac["glosa"], "glosa_propia"
                    else:
                        fuente, origen = ac.get("glosa_referida"), "glosa_referida"
                    ac["embedding_input_gloss"] = ensamblar(fuente)
                    ac["embedding_input_origen"] = origen

            # Persistir mutaciones JSONB en RLC
            flag_modified(rlc_db, "rlc_json")
            db.commit()

            # 6) Poblar UCEs (idempotente)
            uces_rlc: List[UnidadConocimientoExplicito] = []
            for ac in aceps:
                if (
                    ac.get("pos_mcr_estado") != "mapeada"
                    or ac.get("estado_uce") not in ("apta_propia", "apta_referida")
                ):
                    continue

                num = ac.get("numero")
                base = ac.get("glosa") or ac.get("glosa_referida")
                texto = ac.get("embedding_input_gloss")
                pos_raw = ac.get("pos_mcr")
                pos = "+".join(pos_raw) if isinstance(pos_raw, list) else pos_raw

                uce_db = (
                    db.query(UnidadConocimientoExplicito)
                    .filter_by(id_rlc=rlc_db.id_rlc, numero_acepcion=num)
                    .first()
                )
                if not uce_db:
                    uce_db = UnidadConocimientoExplicito(
                        id_uce=uuid.uuid4(),
                        id_rlc=rlc_db.id_rlc,
                        numero_acepcion=num,
                        lema=lema,
                        pos_mcr=pos,
                        base_gloss=base,
                        embedding_input_gloss=texto,
                        vector=None,
                        glosa_origen=ac.get("embedding_input_origen"),
                        marcas=ac.get("marcas_clasificadas"),
                        ejemplo=ac.get("ejemplo"),
                        offset_mcr=None,
                        tipo_peruanismo="sin_clasificar",
                        relaciones={},
                        estado_revision="pendiente",
                    )
                    db.add(uce_db)
                else:
                    # Actualizar texto/metadatos si cambiaron (ej. tras limpieza manual)
                    if uce_db.embedding_input_gloss != texto:
                        uce_db.embedding_input_gloss = texto
                        uce_db.vector = None
                    uce_db.base_gloss = base
                    uce_db.pos_mcr = pos
                    uce_db.glosa_origen = ac.get("embedding_input_origen")
                    uce_db.marcas = ac.get("marcas_clasificadas")
                    uce_db.ejemplo = ac.get("ejemplo")

                uces_rlc.append(uce_db)

            # Determinar estado de procesamiento del RLC y motivos si no generó UCEs
            tiene_remision_pendiente = any(
                ac.get("remision_estado") == "destino_ausente" for ac in aceps
            )
            motivos_descarte = {
                "remision_pendiente": sum(1 for ac in aceps if ac.get("remision_estado") == "destino_ausente"),
                "sin_equivalente_mcr": sum(1 for ac in aceps if ac.get("pos_mcr_estado") == "sin_equivalente_mcr"),
                "vacias_o_hueco": sum(1 for ac in aceps if ac.get("estado_uce") == "vacia"),
                "incierto_llm": sum(1 for ac in aceps if ac.get("pos_mcr_estado") == "incierto_llm"),
            }

            if tiene_remision_pendiente:
                rlc_db.estado_procesamiento = "remision_pendiente"
            elif uces_rlc:
                rlc_db.estado_procesamiento = "procesado"
            else:
                rlc_db.estado_procesamiento = "sin_uce"

            flag_modified(rlc_db, "rlc_json")
            db.commit()

            if not uces_rlc:
                return {
                    "lema": lema,
                    "estado_procesamiento": rlc_db.estado_procesamiento,
                    "motivos_descarte": {k: v for k, v in motivos_descarte.items() if v > 0},
                    "pasos_completados": ["remisiones", "categorias", "ensamblado"],
                    "inferidas_llm": inferidas_llm,
                    "uces_creados": [],
                }

            # 7) Vectorizar solo los UCEs sin vector (idempotente)
            sin_vector = [u for u in uces_rlc if u.vector is None and u.embedding_input_gloss]
            if sin_vector:
                res = client_openai.embeddings.create(
                    model=EMBEDDING_MODEL,
                    input=[u.embedding_input_gloss for u in sin_vector],
                    dimensions=EMBEDDING_DIM,
                )
                for d in res.data:
                    sin_vector[d.index].vector = d.embedding
                db.commit()

            # 8) Combinación Paso 1 (criba simbólica en forma_mcr) y Paso 2 (coseno + umbral doble)
            todos_cands = set()
            cands_por_uce: Dict[Any, List[str]] = {}
            for uce in uces_rlc:
                cands = _buscar_candidatos_forma(db, uce.lema, uce.pos_mcr)
                uce.forma_en_mcr = bool(cands)
                uce.candidatos_mcr = cands
                cands_por_uce[uce.id_uce] = cands
                todos_cands.update(cands)

            # Cargar en bloque los vectores de los synsets candidatos
            ref_vecs = {}
            if todos_cands:
                for off, vec in (
                    db.query(ReferenciaMCR.offset, ReferenciaMCR.vector)
                    .filter(ReferenciaMCR.offset.in_(list(todos_cands)))
                    .all()
                ):
                    ref_vecs[off] = _vec(vec)

            for uce in uces_rlc:
                cands = cands_por_uce[uce.id_uce]
                if not cands:
                    # Rama Ausente: Tipo 2 léxico por definición
                    uce.tipo_peruanismo = "tipo_2_lexico"
                    uce.offset_mcr = None
                    uce.sim_mcr = None
                    continue

                # Rama Presente: coseno máximo contra los sentidos de esa forma
                vp = _vec(uce.vector)
                mejor_sim, mejor_off = -1.0, None
                if vp is not None:
                    for off in cands:
                        rv = ref_vecs.get(off)
                        if rv is None:
                            continue
                        s = _coseno(vp, rv)
                        if s > mejor_sim:
                            mejor_sim, mejor_off = s, off

                if mejor_off is None:
                    uce.tipo_peruanismo = "indeterminado"
                    uce.offset_mcr = None
                    uce.sim_mcr = None
                elif mejor_sim >= CORTE_ALTO:
                    uce.tipo_peruanismo = "ya_presente"
                    uce.offset_mcr = mejor_off
                    uce.sim_mcr = round(mejor_sim, 4)
                elif mejor_sim < CORTE_BAJO:
                    uce.tipo_peruanismo = "tipo_1_semantico"
                    uce.offset_mcr = mejor_off
                    uce.sim_mcr = round(mejor_sim, 4)
                else:
                    uce.tipo_peruanismo = "indeterminado"
                    uce.offset_mcr = mejor_off
                    uce.sim_mcr = round(mejor_sim, 4)

            db.commit()

            # 9) Combinación Paso 3: Enganche semántico (Sinónimo / Hiperónimo + grafo)
            for uce in uces_rlc:
                enganchar_uce(db, uce, commit=False)
            db.commit()

            uces_serializadas = [
                {
                    "id_uce": str(u.id_uce),
                    "numero_acepcion": u.numero_acepcion,
                    "pos_mcr": u.pos_mcr,
                    "glosa": u.base_gloss,
                    "tipo_peruanismo": u.tipo_peruanismo,
                    "forma_en_mcr": u.forma_en_mcr,
                    "sim_mcr": u.sim_mcr,
                    "offset_mcr": u.offset_mcr,
                    "relacion_propuesta": (u.relaciones or {}).get("relacion_propuesta"),
                }
                for u in uces_rlc
            ]

            return {
                "lema": lema,
                "pasos_completados": [
                    "remisiones",
                    "categorias",
                    "ensamblado",
                    "uce",
                    "vectorizado",
                    "forma",
                    "clasificado",
                ],
                "inferidas_llm": inferidas_llm,
                "uces_creados": uces_serializadas,
                "estado_procesamiento": rlc_db.estado_procesamiento,
                "motivos_descarte": {k: v for k, v in motivos_descarte.items() if v > 0},
            }


    @staticmethod
    def ejecutar_lote_analista(job_id: str, ids_rlc: List[str]):
        """Procesa una lista de RLCs en segundo plano actualizando JobPipeline."""
        import openai
        from app.core.database import ahora_utc
        from app.models import JobPipeline

        job_uuid = uuid.UUID(job_id)
        api_key = os.getenv("OPENAI_API_KEY")
        client_openai = openai.OpenAI(api_key=api_key) if api_key else None
        client_anthropic = None
        if os.getenv("ANTHROPIC_API_KEY"):
            import anthropic
            client_anthropic = anthropic.Anthropic()

        errores = []
        exitosos = 0
        fallidos = 0
        total_uces = 0

        try:
            with SessionLocal() as db:
                job = db.query(JobPipeline).filter_by(id_job=job_uuid).first()
                if not job:
                    return
                job.estado = "procesando"
                job.total = len(ids_rlc)
                job.actual = 0
                job.mensaje = f"Iniciando procesamiento de {len(ids_rlc)} RLCs..."
                job.actualizado_en = ahora_utc()
                db.commit()

            for idx, id_rlc in enumerate(ids_rlc, 1):
                try:
                    res = ProcesadorIndividual.procesar_pipeline(
                        id_rlc,
                        client_openai=client_openai,
                        client_anthropic=client_anthropic,
                    )
                    exitosos += 1
                    n_uces = len(res.get("uces_creados", []))
                    total_uces += n_uces
                    msg = f"[{idx}/{len(ids_rlc)}] {res['lema']} → {n_uces} UCE(s) ({res.get('estado_procesamiento')})"
                    item_txt = res["lema"]
                except Exception as e:
                    fallidos += 1
                    errores.append(f"{id_rlc}: {str(e)}")
                    msg = f"[{idx}/{len(ids_rlc)}] Error: {str(e)[:120]}"
                    item_txt = id_rlc

                with SessionLocal() as db:
                    job = db.query(JobPipeline).filter_by(id_job=job_uuid).first()
                    if job:
                        job.actual = idx
                        job.exitosos = exitosos
                        job.fallidos = fallidos
                        job.item_actual = item_txt
                        job.mensaje = msg
                        detalle = dict(job.detalle or {})
                        detalle["total_uces"] = total_uces
                        detalle["errores"] = errores[-50:]
                        job.detalle = detalle
                        flag_modified(job, "detalle")
                        job.actualizado_en = ahora_utc()
                        db.commit()

            with SessionLocal() as db:
                job = db.query(JobPipeline).filter_by(id_job=job_uuid).first()
                if job:
                    job.estado = "completado"
                    job.mensaje = (
                        f"Lote completado: {exitosos} RLCs procesados "
                        f"({total_uces} UCEs generados), {fallidos} fallidos."
                    )
                    job.actualizado_en = ahora_utc()
                    db.commit()
        except Exception as fatal:
            with SessionLocal() as db:
                job = db.query(JobPipeline).filter_by(id_job=job_uuid).first()
                if job:
                    job.estado = "error"
                    job.mensaje = f"Error fatal en lote: {str(fatal)}"
                    job.actualizado_en = ahora_utc()
                    db.commit()

    @staticmethod
    def ejecutar_lote_enganche(job_id: str, ids_uce: List[str]):
        """Genera relaciones de enganche (Fase 3) para UCEs existentes en segundo plano."""
        from app.core.database import ahora_utc
        from app.models import JobPipeline

        job_uuid = uuid.UUID(job_id)
        exitosos = 0
        fallidos = 0
        errores = []

        try:
            with SessionLocal() as db:
                job = db.query(JobPipeline).filter_by(id_job=job_uuid).first()
                if not job:
                    return
                job.estado = "procesando"
                job.total = len(ids_uce)
                job.actual = 0
                job.mensaje = f"Iniciando enganche semántico de {len(ids_uce)} UCEs..."
                job.actualizado_en = ahora_utc()
                db.commit()

            for idx, uid_str in enumerate(ids_uce, 1):
                with SessionLocal() as db:
                    try:
                        uce = (
                            db.query(UnidadConocimientoExplicito)
                            .filter_by(id_uce=uuid.UUID(uid_str))
                            .first()
                        )
                        if not uce:
                            raise ValueError("UCE no encontrado")
                        rel = enganchar_uce(db, uce, commit=True)
                        exitosos += 1
                        item_txt = uce.lema
                        msg = f"[{idx}/{len(ids_uce)}] {uce.lema} → {rel.get('relacion_propuesta', 'ok')}"
                    except Exception as e:
                        db.rollback()
                        fallidos += 1
                        errores.append(f"{uid_str}: {str(e)}")
                        item_txt = uid_str
                        msg = f"[{idx}/{len(ids_uce)}] Error: {str(e)[:120]}"

                    # Actualizar progreso cada 5 items o al final para no saturar commits
                    if idx % 5 == 0 or idx == len(ids_uce):
                        job = db.query(JobPipeline).filter_by(id_job=job_uuid).first()
                        if job:
                            job.actual = idx
                            job.exitosos = exitosos
                            job.fallidos = fallidos
                            job.item_actual = item_txt
                            job.mensaje = msg
                            detalle = dict(job.detalle or {})
                            detalle["errores"] = errores[-50:]
                            job.detalle = detalle
                            flag_modified(job, "detalle")
                            job.actualizado_en = ahora_utc()
                            db.commit()

            with SessionLocal() as db:
                job = db.query(JobPipeline).filter_by(id_job=job_uuid).first()
                if job:
                    job.estado = "completado"
                    job.mensaje = f"Enganche completado: {exitosos} UCEs enlazadas, {fallidos} fallidas."
                    job.actualizado_en = ahora_utc()
                    db.commit()
        except Exception as fatal:
            with SessionLocal() as db:
                job = db.query(JobPipeline).filter_by(id_job=job_uuid).first()
                if job:
                    job.estado = "error"
                    job.mensaje = f"Error fatal en enganche: {str(fatal)}"
                    job.actualizado_en = ahora_utc()
                    db.commit()