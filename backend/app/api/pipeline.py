"""
====================================================================
SINAPSIS — API del pipeline SECI y auditoría (solo lectura)
Ubicación: backend/app/api/pipeline.py
====================================================================
Endpoints complementarios a peruanismos.py. Sirven al frontend las
métricas del embudo de destilación, el estado del pipeline de
extracción, y el registro de incidencias para auditoría.

Todos son de solo lectura: no modifican datos.

Endpoints (bajo el prefijo /api):
  GET /api/embudo              -> métricas completas del embudo SECI
  GET /api/pipeline/status     -> estado de la máquina de extracción
  GET /api/incidencias         -> registro de auditoría paginado
====================================================================
"""

import csv
import io
from typing import Optional

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import func

from app.core.database import SessionLocal
from app.models import (
    ControlExtraccionLema, RegistroLexicoCrudo, Incidencia,
    UnidadConocimientoExplicito, ReferenciaMCR, AuditoriaValidacion,
    ESTADO_PENDIENTE, ESTADO_COMPLETA, ESTADO_ERROR,
)

from app.services.metricas import (
    calcular_metricas_post_test,
    generar_csv_ficha_cpw,
    generar_csv_ficha_prs,
    generar_reporte_markdown_post_test,
)

router = APIRouter(prefix="/api", tags=["pipeline"])

U = UnidadConocimientoExplicito
CEL = ControlExtraccionLema
RLC = RegistroLexicoCrudo


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ── Embudo SECI (dashboard del administrador) ───────────────────────

@router.get("/embudo")
def embudo(db=Depends(get_db)):
    """
    Métricas del embudo de destilación completo.
    Desde los lemas indexados hasta la clasificación final.
    """
    lemas_indexados = db.query(func.count(CEL.id_lema)).scalar() or 0
    rlc_extraidos = db.query(func.count(RLC.id_rlc)).scalar() or 0

    # Acepciones brutas: suma de num_acepciones de todos los RLC
    acepciones_brutas = (
        db.query(func.coalesce(func.sum(RLC.num_acepciones), 0)).scalar()
    )

    # UCE integrables (los que llegaron a la tabla UCE)
    uce_total = db.query(func.count(U.id_uce)).scalar() or 0

    # Clasificación por tipo de peruanismo
    clasificacion = dict(
        db.query(U.tipo_peruanismo, func.count())
        .group_by(U.tipo_peruanismo).all()
    )

    # Reparto POS
    por_pos = dict(
        db.query(U.pos_mcr, func.count())
        .group_by(U.pos_mcr).all()
    )

    # Criba simbólica (forma presente/ausente en MCR)
    forma = dict(
        db.query(U.forma_en_mcr, func.count())
        .group_by(U.forma_en_mcr).all()
    )

    # Referencia MCR
    ref_total = db.query(func.count(ReferenciaMCR.offset)).scalar() or 0
    ref_con_glosa_es = (
        db.query(func.count(ReferenciaMCR.offset))
        .filter(ReferenciaMCR.glosa_es.isnot(None))
        .scalar() or 0
    )

    # Internalización: UCEs validadas y aceptadas por el Lexicógrafo
    uces_aceptadas = (
        db.query(func.count(U.id_uce))
        .filter(U.estado_revision == "aceptado")
        .scalar() or 0
    )
    por_revision = dict(
        db.query(U.estado_revision, func.count())
        .group_by(U.estado_revision)
        .all()
    )
    uces_enganchadas = (
        db.query(func.count(U.id_uce))
        .filter(U.relaciones.isnot(None), U.relaciones != {})
        .scalar() or 0
    )

    return {
        "lemas_indexados": lemas_indexados,
        "rlc_extraidos": rlc_extraidos,
        "acepciones_brutas": acepciones_brutas,
        "uce_integrables": uce_total,
        "uces_aceptadas": uces_aceptadas,
        "clasificacion": clasificacion,
        "por_pos": por_pos,
        "forma_en_mcr": {
            "presente": forma.get(True, 0),
            "ausente": forma.get(False, 0),
        },
        "referencia_mcr": {
            "total_synsets": ref_total,
            "con_glosa_es": ref_con_glosa_es,
        },
        "uces_enganchadas": uces_enganchadas,
        "por_revision": {
            "pendiente": por_revision.get("pendiente", 0),
            "observado": por_revision.get("observado", 0),
            "aceptado": por_revision.get("aceptado", 0),
            "rechazado": por_revision.get("rechazado", 0),
        },
    }


# ── Estado del pipeline de extracción ────────────────────────────────

@router.get("/pipeline/status")
def pipeline_status(db=Depends(get_db)):
    """
    Estado de la máquina de extracción (control_extraccion_lemas).
    Para la vista Pipeline del Ingeniero de Datos y del Administrador.
    """
    total = db.query(func.count(CEL.id_lema)).scalar() or 0

    por_estado = dict(
        db.query(CEL.estado_seci, func.count())
        .group_by(CEL.estado_seci).all()
    )

    completados = por_estado.get(ESTADO_COMPLETA, 0)
    errores = por_estado.get(ESTADO_ERROR, 0)
    pendientes = por_estado.get(ESTADO_PENDIENTE, 0)

    tasa_extraccion = round(completados / total, 4) if total > 0 else 0

    # Últimos 10 errores (si hay) para diagnóstico
    ultimos_errores = []
    if errores > 0:
        errores_q = (
            db.query(CEL.lema, CEL.url_origen, CEL.reintentos_fallidos,
                     CEL.ultima_actualizacion)
            .filter(CEL.estado_seci == ESTADO_ERROR)
            .order_by(CEL.ultima_actualizacion.desc())
            .limit(10)
            .all()
        )
        ultimos_errores = [
            {
                "lema": e.lema,
                "url": e.url_origen,
                "reintentos": e.reintentos_fallidos,
                "ultima_actualizacion": e.ultima_actualizacion.isoformat() if e.ultima_actualizacion else None,
            }
            for e in errores_q
        ]

    return {
        "total_lemas": total,
        "por_estado": {
            "completados": completados,
            "pendientes": pendientes,
            "errores": errores,
        },
        "tasa_extraccion": tasa_extraccion,
        "ultimos_errores": ultimos_errores,
    }


# ── Incidencias (auditoría) ──────────────────────────────────────────

@router.get("/incidencias")
def incidencias(
    fase: str | None = None,
    tipo: str | None = None,
    revision: bool | None = None,
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    db=Depends(get_db),
):
    """
    Registro de auditoría del pipeline. Cada fila es una decisión
    no trivial (inferencia LLM, reparación, caso a revisión).
    Para la vista Auditoría del Administrador.
    """
    query = db.query(Incidencia)

    if fase:
        query = query.filter(Incidencia.fase == fase)
    if tipo:
        query = query.filter(Incidencia.tipo == tipo)
    if revision is not None:
        query = query.filter(Incidencia.requiere_revision == revision)

    total = query.count()

    items = (
        query.order_by(Incidencia.creado_en.desc())
        .offset((page - 1) * size)
        .limit(size)
        .all()
    )

    # Resumen de fases y tipos para los filtros del frontend
    fases_disponibles = [
        r[0] for r in db.query(Incidencia.fase).distinct().all() if r[0]
    ]
    tipos_disponibles = [
        r[0] for r in db.query(Incidencia.tipo).distinct().all() if r[0]
    ]

    return {
        "total": total,
        "page": page,
        "size": size,
        "filtros": {
            "fases": fases_disponibles,
            "tipos": tipos_disponibles,
        },
        "items": [
            {
                "id": i.id,
                "fase": i.fase,
                "tipo": i.tipo,
                "lema": i.lema,
                "numero_acepcion": i.numero_acepcion,
                "glosa": i.glosa,
                "resultado": i.resultado,
                "pos_mcr": i.pos_mcr,
                "genero_proximo": i.genero_proximo,
                "justificacion": i.justificacion,
                "confianza": i.confianza,
                "requiere_revision": i.requiere_revision,
                "creado_en": i.creado_en.isoformat() if i.creado_en else None,
            }
            for i in items
        ],
    }


# ── Auditoría unificada (incidencias_procesamiento + auditoria_validacion) ──

def _obtener_registros_auditoria(
    db,
    origen: Optional[str] = None,
    fase: Optional[str] = None,
    q: Optional[str] = None,
    revision: Optional[bool] = None,
):
    """Combina incidencias del pipeline y decisiones del lexicógrafo en una línea de tiempo."""
    registros = []

    if origen in (None, "", "pipeline"):
        q_inc = db.query(Incidencia)
        if fase:
            q_inc = q_inc.filter(Incidencia.fase == fase)
        if q:
            q_inc = q_inc.filter(Incidencia.lema.ilike(f"%{q.strip()}%"))
        if revision is not None:
            q_inc = q_inc.filter(Incidencia.requiere_revision == revision)

        for i in q_inc.all():
            registros.append({
                "uid": f"inc-{i.id}",
                "id": i.id,
                "origen": "pipeline",
                "fase": i.fase,
                "tipo": i.tipo,
                "lema": i.lema,
                "numero_acepcion": i.numero_acepcion,
                "resultado": i.resultado,
                "pos_mcr": i.pos_mcr,
                "confianza": i.confianza,
                "requiere_revision": bool(i.requiere_revision),
                "glosa": i.glosa,
                "justificacion": i.justificacion,
                "offset_sugerido": None,
                "offset_final": None,
                "tipo_relacion": None,
                "actor": "Sistema / Ingeniero",
                "creado_en": i.creado_en.isoformat() if i.creado_en else None,
                "_sort": i.creado_en.timestamp() if i.creado_en else 0.0,
            })

    if origen in (None, "", "curaduria"):
        if not fase or fase == "internalizacion_curaduria":
            q_aud = (
                db.query(AuditoriaValidacion, U)
                .outerjoin(U, AuditoriaValidacion.id_uce == U.id_uce)
            )
            if q:
                q_aud = q_aud.filter(U.lema.ilike(f"%{q.strip()}%"))
            if revision is True:
                q_aud = q_aud.filter(AuditoriaValidacion.decision == "observar")

            for a, u in q_aud.all():
                registros.append({
                    "uid": f"aud-{a.id}",
                    "id": a.id,
                    "origen": "curaduria",
                    "fase": "internalizacion_curaduria",
                    "tipo": f"decision_{a.decision}",
                    "lema": u.lema if u else str(a.id_uce)[:8],
                    "numero_acepcion": u.numero_acepcion if u else None,
                    "resultado": a.decision,
                    "pos_mcr": u.pos_mcr if u else None,
                    "confianza": None,
                    "requiere_revision": a.decision == "observar",
                    "glosa": (u.base_gloss or u.embedding_input_gloss) if u else None,
                    "justificacion": a.notas,
                    "offset_sugerido": a.offset_sugerido,
                    "offset_final": a.offset_final,
                    "tipo_relacion": a.tipo_relacion,
                    "actor": a.lexicografo_id or "Lexicógrafo",
                    "creado_en": a.creado_en.isoformat() if a.creado_en else None,
                    "_sort": a.creado_en.timestamp() if a.creado_en else 0.0,
                })

    registros.sort(key=lambda r: r["_sort"], reverse=True)
    return registros


@router.get("/auditoria")
def auditoria_unificada(
    origen: Optional[str] = None,
    fase: Optional[str] = None,
    q: Optional[str] = None,
    revision: Optional[bool] = None,
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    db=Depends(get_db),
):
    registros = _obtener_registros_auditoria(db, origen=origen, fase=fase, q=q, revision=revision)
    total = len(registros)
    inicio = (page - 1) * size
    pagina = [{k: v for k, v in r.items() if k != "_sort"} for r in registros[inicio : inicio + size]]

    total_pipeline = db.query(func.count(Incidencia.id)).scalar() or 0
    total_curaduria = db.query(func.count(AuditoriaValidacion.id)).scalar() or 0
    total_rev_inc = (
        db.query(func.count(Incidencia.id))
        .filter(Incidencia.requiere_revision.is_(True))
        .scalar() or 0
    )
    total_rev_aud = (
        db.query(func.count(AuditoriaValidacion.id))
        .filter(AuditoriaValidacion.decision == "observar")
        .scalar() or 0
    )

    fases_inc = [r[0] for r in db.query(Incidencia.fase).distinct().all() if r[0]]
    fases = sorted(set(fases_inc + ["internalizacion_curaduria"]))

    return {
        "total": total,
        "page": page,
        "size": size,
        "resumen": {
            "total_pipeline": total_pipeline,
            "total_curaduria": total_curaduria,
            "requieren_revision": total_rev_inc + total_rev_aud,
        },
        "filtros": {"fases": fases},
        "items": pagina,
    }


@router.get("/auditoria/exportar")
def exportar_auditoria_csv(
    origen: Optional[str] = None,
    fase: Optional[str] = None,
    q: Optional[str] = None,
    revision: Optional[bool] = None,
    db=Depends(get_db),
):
    registros = _obtener_registros_auditoria(db, origen=origen, fase=fase, q=q, revision=revision)
    buffer = io.StringIO()
    campos = [
        "uid", "origen", "fase", "tipo", "lema", "numero_acepcion", "pos_mcr",
        "resultado", "confianza", "requiere_revision", "offset_sugerido",
        "offset_final", "tipo_relacion", "actor", "justificacion", "creado_en",
    ]
    writer = csv.DictWriter(buffer, fieldnames=campos, extrasaction="ignore")
    writer.writeheader()
    writer.writerows(registros)
    buffer.seek(0)

    return StreamingResponse(
        iter([buffer.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=auditoria_sinapsis.csv"},
    )

# ── Métricas Pre-Test vs. Post-Test (Fase 5) ─────────────────────────

@router.get("/metricas/post-test")
def metricas_post_test(db=Depends(get_db)):
    """Devuelve el comparativo en tiempo real Pre-Test vs. Post-Test (CPW y PRS)."""
    return calcular_metricas_post_test(db)


@router.get("/metricas/exportar/cpw")
def exportar_ficha_cpw(db=Depends(get_db)):
    """Descarga la Ficha de Registro N.º 1 (CPW Pre y Post-Test) en CSV."""
    contenido = generar_csv_ficha_cpw(db)
    return StreamingResponse(
        iter([contenido]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=ficha_1_cpw_post_test.csv"},
    )


@router.get("/metricas/exportar/prs")
def exportar_ficha_prs(db=Depends(get_db)):
    """Descarga la Ficha de Registro N.º 2 (PRS Pre y Post-Test) en CSV."""
    contenido = generar_csv_ficha_prs(db)
    return StreamingResponse(
        iter([contenido]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=ficha_2_prs_post_test.csv"},
    )


@router.get("/metricas/exportar/reporte")
def exportar_reporte_post_test(db=Depends(get_db)):
    """Descarga el reporte consolidado Pre vs. Post en Markdown."""
    contenido = generar_reporte_markdown_post_test(db)
    return StreamingResponse(
        iter([contenido]),
        media_type="text/markdown; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=reporte_post_test_sinapsis.md"},
    )
