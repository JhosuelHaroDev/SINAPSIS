"""
====================================================================
SINAPSIS — Fase 3: Combinación (Enganche Semántico y Relaciones)
Ubicación: backend/app/services/combinacion.py
====================================================================
Genera propuestas reales de integración en WordNet/MCR para cada UCE:
  - Extrae género próximo de la glosa (o reutiliza el de Capa 3 LLM).
  - Combina búsqueda vectorial HNSW (halfvec 3072) en referencia_mcr
    con candidatos léxicos en forma_mcr.
  - Decide la relación propuesta:
        coseno >= 0.65 -> near_synonym  (agregar variante al synset)
        coseno <  0.65 -> has_hyperonym (crear synset bajo hiperónimo)
  - Guarda Top-5 candidatos, evidencia de criba y aristas del grafo
    en `uce.relaciones` (JSONB), y actualiza `uce.offset_mcr` al
    synset objetivo propuesto.
====================================================================
"""

import re
import unicodedata
from typing import Any, Dict, List, Optional

import numpy as np
from sqlalchemy import text, func
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.models import (
    UnidadConocimientoExplicito,
    ReferenciaMCR,
    FormaMCR,
    RegistroLexicoCrudo,
)
from app.nlp.combinar_clasificar_tipo import _vec, _coseno

UMBRAL_SINONIMO = 0.65
BONUS_GENERO_PROXIMO = 0.08
TOP_VECTOR = 15
TOP_FINAL = 5

# Fórmulas lexicográficas de apertura (Planta DiPerú §6.1.2)
_PREFIJOS_FORMULA = [
    r"^(?:dicho\s+de\s+(?:una?\s+)?(?:persona|cosa|animal|planta|lugar|algo|alguien)\s*[:,]?\s*)",
    r"^(?:se\s+dice\s+de\s+(?:una?\s+)?(?:persona|cosa|algo|alguien)\s*[:,]?\s*)",
    r"^(?:perteneciente\s+o\s+relativo\s+a\s+)",
    r"^(?:relativo\s+o\s+perteneciente\s+a\s+)",
    r"^(?:natural\s+de\s+)",
    r"^(?:persona\s+que\s+)",
    r"^(?:individuo\s+que\s+)",
    r"^(?:acción\s+y\s+efecto\s+de\s+)",
    r"^(?:efecto\s+de\s+)",
    r"^(?:acción\s+de\s+)",
    r"^(?:conjunto\s+de\s+)",
    r"^(?:especie\s+de\s+)",
    r"^(?:variedad\s+de\s+)",
    r"^(?:tipo\s+de\s+)",
    r"^(?:clase\s+de\s+)",
    r"^(?:que\s+tiene\s+)",
    r"^(?:que\s+se\s+)",
    r"^(?:que\s+)",
]

_STOPWORDS_INICIO = {
    "el", "la", "los", "las", "un", "una", "unos", "unas",
    "de", "del", "al", "a", "en", "con", "por", "para", "sin",
    "muy", "poco", "más", "menos", "algo", "alguien", "se", "lo",
}


def _normalizar_token(texto: str) -> str:
    return (texto or "").strip().lower()


def _sin_tildes(texto: str) -> str:
    nfkd = unicodedata.normalize("NFKD", texto or "")
    return "".join(c for c in nfkd if not unicodedata.combining(c)).lower()


def extraer_genero_proximo(glosa: Optional[str], pos_mcr: str) -> Optional[str]:
    """Extrae el término núcleo (género próximo) que abre la definición."""
    if not glosa:
        return None

    t = glosa.strip()
    t = re.sub(r"^\([^)]*\)\s*", "", t)
    t = re.sub(r"^<[^>]*>\s*", "", t)
    t = re.sub(r"^[\s.,;:¡!¿?\"'«»\-–—]+", "", t)

    # Para sustantivos/adjetivos, si empieza con "Persona que...", "Acción de..." conservar
    # el sustantivo núcleo si corresponde, o limpiar fórmulas genéricas.
    t_lower = t.lower()
    if t_lower.startswith("persona que "):
        return "persona"
    if t_lower.startswith("acción y efecto de ") or t_lower.startswith("acción de "):
        return "acción"
    if t_lower.startswith("conjunto de "):
        return "conjunto"

    for pat in _PREFIJOS_FORMULA:
        nuevo = re.sub(pat, "", t, flags=re.IGNORECASE).strip()
        if nuevo and nuevo != t:
            t = nuevo
            break

    # Primeros tokens alfabéticos
    tokens = re.findall(r"[A-Za-záéíóúüñÁÉÍÓÚÜÑ]+", t)
    for tok in tokens[:4]:
        low = tok.lower()
        if low in _STOPWORDS_INICIO or len(low) < 3:
            continue
        return low

    return None


def _buscar_genero_en_rlc(db: Session, uce: UnidadConocimientoExplicito) -> Optional[str]:
    """Recupera genero_proximo inferido por Capa 3 si existe en el RLC origen."""
    row = (
        db.query(RegistroLexicoCrudo.rlc_json)
        .filter(RegistroLexicoCrudo.id_rlc == uce.id_rlc)
        .first()
    )
    if not row or not row[0]:
        return None
    for ac in row[0].get("acepciones", []) or []:
        if ac.get("numero") == uce.numero_acepcion:
            inf = ac.get("inferencia_llm") or {}
            gp = inf.get("genero_proximo")
            if gp and isinstance(gp, str):
                toks = re.findall(r"[A-Za-záéíóúüñÁÉÍÓÚÜÑ]+", gp)
                if toks:
                    return toks[0].lower()
    return None


def _vector_a_literal(vec: np.ndarray) -> str:
    return "[" + ",".join(f"{float(x):.6f}" for x in vec) + "]"


def _contiene_termino(sinonimos_str: str, termino: str) -> bool:
    if not sinonimos_str or not termino:
        return False
    t_norm = _sin_tildes(termino)
    for s in sinonimos_str.split(","):
        if _sin_tildes(s.strip()) == t_norm:
            return True
    return False


def enganchar_uce(
    db: Session,
    uce: UnidadConocimientoExplicito,
    commit: bool = False,
) -> Dict[str, Any]:
    """
    Ejecuta el enganche semántico (Fase 3) sobre una UCE individual.
    Actualiza `uce.relaciones` y, para peruanismos integrables, `uce.offset_mcr`.
    """
    codigos_pos = [c for c in (uce.pos_mcr or "n").split("+") if c]
    if not codigos_pos:
        codigos_pos = ["n"]

    rel_prev = uce.relaciones if isinstance(uce.relaciones, dict) else {}
    ev_prev = rel_prev.get("evidencia_criba") if isinstance(rel_prev.get("evidencia_criba"), dict) else {}

    # 1) Conservar evidencia original de criba (homógrafo en MCR) sin perderla en re-ejecuciones
    offset_homografo = ev_prev.get("offset_homografo")
    sim_homografo = ev_prev.get("sim_homografo")
    if offset_homografo is None and uce.forma_en_mcr and uce.offset_mcr:
        offset_homografo = uce.offset_mcr
        sim_homografo = uce.sim_mcr

    evidencia_criba = None
    if uce.forma_en_mcr and offset_homografo:
        ref_hom = db.query(ReferenciaMCR).filter_by(offset=offset_homografo).first()
        evidencia_criba = {
            "offset_homografo": offset_homografo,
            "sim_homografo": round(float(sim_homografo), 4) if sim_homografo is not None else None,
            "sinonimos_homografo": ref_hom.sinonimos if ref_hom else None,
            "glosa_es_homografo": (ref_hom.glosa_es or ref_hom.glosa_en) if ref_hom else None,
        }

    # 2) Caso especial: ya_presente (sentido ya cubierto en MCR)
    if uce.tipo_peruanismo == "ya_presente":
        off_obj = offset_homografo or uce.offset_mcr
        ref_obj = db.query(ReferenciaMCR).filter_by(offset=off_obj).first() if off_obj else None
        score_val = round(float(sim_homografo or uce.sim_mcr or 0.0), 4)

        objetivo = None
        grafo = []
        if ref_obj:
            objetivo = {
                "offset": ref_obj.offset,
                "pos": ref_obj.pos,
                "sinonimos": ref_obj.sinonimos,
                "glosa_es": ref_obj.glosa_es,
                "glosa_en": ref_obj.glosa_en,
                "score_coseno": score_val,
                "score_final": score_val,
                "origen": "criba_simbolica",
            }
            grafo.append({
                "tipo": "variante_existente",
                "etiqueta": "ya en WordNet",
                "target_offset": ref_obj.offset,
                "target_sinonimos": ref_obj.sinonimos,
                "target_glosa": ref_obj.glosa_es or ref_obj.glosa_en,
                "score": score_val,
                "principal": True,
            })

        relaciones = {
            "version": "v1",
            "estrategia": "criba_ya_presente",
            "genero_proximo": None,
            "evidencia_criba": evidencia_criba,
            "relacion_propuesta": "variante_existente",
            "accion_wordnet": "sin_cambio",
            "synset_objetivo": objetivo,
            "candidatos": [objetivo] if objetivo else [],
            "relaciones_grafo": grafo,
        }
        uce.relaciones = relaciones
        flag_modified(uce, "relaciones")
        if commit:
            db.commit()
        return relaciones

    # 3) Peruanismos integrables (tipo_2_lexico, tipo_1_semantico, indeterminado)
    vp = _vec(uce.vector)
    if vp is None:
        return {}

    genero = _buscar_genero_en_rlc(db, uce) or extraer_genero_proximo(
        uce.base_gloss or uce.embedding_input_gloss, uce.pos_mcr
    )

    # 3a) Búsqueda vectorial global en referencia_mcr (aprovecha índice HNSW halfvec si existe)
    vec_lit = _vector_a_literal(vp)
    vec_rows = db.execute(
        text("""
            SELECT
                "offset",
                pos,
                sinonimos,
                glosa_es,
                glosa_en,
                1 - ((vector::halfvec(3072)) <=> CAST(:v AS halfvec(3072))) AS sim
            FROM referencia_mcr
            WHERE pos = ANY(:pos_list)
              AND vector IS NOT NULL
            ORDER BY (vector::halfvec(3072)) <=> CAST(:v AS halfvec(3072))
            LIMIT :lim
        """),
        {"v": vec_lit, "pos_list": codigos_pos, "lim": TOP_VECTOR},
    ).fetchall()

    pool: Dict[str, Dict[str, Any]] = {}
    for r in vec_rows:
        pool[r.offset] = {
            "offset": r.offset,
            "pos": r.pos,
            "sinonimos": r.sinonimos,
            "glosa_es": r.glosa_es,
            "glosa_en": r.glosa_en,
            "score_coseno": float(r.sim),
            "origen": "vector",
        }

    # 3b) Candidatos léxicos por género próximo vía forma_mcr
    if genero:
        offs_gp = [
            r[0]
            for r in db.query(FormaMCR.offset)
            .filter(
                func.lower(FormaMCR.word) == _normalizar_token(genero),
                FormaMCR.pos.in_(codigos_pos),
            )
            .distinct()
            .limit(20)
            .all()
        ]
        faltantes = [o for o in offs_gp if o not in pool]
        if faltantes:
            for ref in (
                db.query(ReferenciaMCR)
                .filter(ReferenciaMCR.offset.in_(faltantes))
                .all()
            ):
                rv = _vec(ref.vector)
                if rv is None:
                    continue
                pool[ref.offset] = {
                    "offset": ref.offset,
                    "pos": ref.pos,
                    "sinonimos": ref.sinonimos,
                    "glosa_es": ref.glosa_es,
                    "glosa_en": ref.glosa_en,
                    "score_coseno": _coseno(vp, rv),
                    "origen": "genero_proximo",
                }

    # 3c) Excluir homógrafos propios en tipo_1_semantico (ya sabemos que es otro sentido)
    offsets_excluir = set()
    if uce.tipo_peruanismo == "tipo_1_semantico":
        for o in (uce.candidatos_mcr or []):
            offsets_excluir.add(o)
        if offset_homografo:
            offsets_excluir.add(offset_homografo)

    # 3d) Re-ranking híbrido
    candidatos: List[Dict[str, Any]] = []
    for off, item in pool.items():
        if off in offsets_excluir:
            continue
        match_gp = bool(genero and _contiene_termino(item["sinonimos"], genero))
        bonus = BONUS_GENERO_PROXIMO if match_gp else 0.0
        score_cos = round(item["score_coseno"], 4)
        score_fin = round(min(1.0, item["score_coseno"] + bonus), 4)
        origen = item["origen"]
        if match_gp and origen == "vector":
            origen = "vector+genero_proximo"

        candidatos.append({
            "offset": item["offset"],
            "pos": item["pos"],
            "sinonimos": item["sinonimos"],
            "glosa_es": item["glosa_es"],
            "glosa_en": item["glosa_en"],
            "score_coseno": score_cos,
            "score_final": score_fin,
            "origen": origen,
        })

    candidatos.sort(key=lambda x: (x["score_final"], x["score_coseno"]), reverse=True)
    top_cands = candidatos[:TOP_FINAL]

    if not top_cands:
        return {}

    objetivo = top_cands[0]

    # 4) Decisión de relación semántica (Sinónimo vs Hiperónimo)
    if objetivo["score_coseno"] >= UMBRAL_SINONIMO:
        relacion_propuesta = "near_synonym"
        accion_wordnet = "agregar_variante"
        etiqueta_principal = "sinónimo (near_synonym)"
    else:
        relacion_propuesta = "has_hyperonym"
        accion_wordnet = "crear_synset"
        etiqueta_principal = "es un / hiperónimo (has_hyperonym)"

    # 5) Aristas del grafo para NetworkViewer
    grafo = [
        {
            "tipo": relacion_propuesta,
            "etiqueta": etiqueta_principal,
            "target_offset": objetivo["offset"],
            "target_sinonimos": objetivo["sinonimos"],
            "target_glosa": objetivo["glosa_es"] or objetivo["glosa_en"],
            "score": objetivo["score_coseno"],
            "principal": True,
        }
    ]

    for alt in top_cands[1:4]:
        grafo.append({
            "tipo": "candidato_alternativo",
            "etiqueta": f"candidato ({alt['score_coseno']:.2f})",
            "target_offset": alt["offset"],
            "target_sinonimos": alt["sinonimos"],
            "target_glosa": alt["glosa_es"] or alt["glosa_en"],
            "score": alt["score_coseno"],
            "principal": False,
        })

    if uce.tipo_peruanismo == "tipo_1_semantico" and evidencia_criba and evidencia_criba.get("offset_homografo"):
        grafo.append({
            "tipo": "homografo_descartado",
            "etiqueta": f"homógrafo MCR ({evidencia_criba.get('sim_homografo', 0):.2f})",
            "target_offset": evidencia_criba["offset_homografo"],
            "target_sinonimos": evidencia_criba.get("sinonimos_homografo") or uce.lema,
            "target_glosa": evidencia_criba.get("glosa_es_homografo"),
            "score": evidencia_criba.get("sim_homografo"),
            "principal": False,
        })

    relaciones = {
        "version": "v1",
        "estrategia": "hibrida_vector_genero",
        "genero_proximo": genero,
        "evidencia_criba": evidencia_criba,
        "relacion_propuesta": relacion_propuesta,
        "accion_wordnet": accion_wordnet,
        "synset_objetivo": objetivo,
        "candidatos": top_cands,
        "relaciones_grafo": grafo,
    }

    # Actualizar UCE: offset_mcr ahora apunta al synset de enganche propuesto
    uce.offset_mcr = objetivo["offset"]
    if not uce.forma_en_mcr:
        uce.sim_mcr = objetivo["score_coseno"]
    uce.relaciones = relaciones
    flag_modified(uce, "relaciones")

    if commit:
        db.commit()

    return relaciones