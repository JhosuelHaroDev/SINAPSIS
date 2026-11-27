import uuid as _uuid
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.core.database import get_db
from app.models import UnidadConocimientoExplicito, ReferenciaMCR, AuditoriaValidacion

router = APIRouter()

TIPOS_LEGIBLES = {
    "tipo_2_lexico": "Léxico nuevo — forma ausente en WordNet",
    "tipo_1_semantico": "Sentido nuevo — forma existe en WordNet con otro sentido",
    "ya_presente": "Sentido ya cubierto por WordNet",
    "indeterminado": "Zona gris (requiere revisión detallada)",
    "sin_clasificar": "Sin clasificar",
}

DECISION_A_ESTADO = {
    "aceptar": "aceptado",
    "rechazar": "rechazado",
    "observar": "observado",
}

RELACIONES_VALIDAS = {"near_synonym", "has_hyperonym", "variante_existente"}


def _parse_uuid(id_uce: str) -> _uuid.UUID:
    try:
        return _uuid.UUID(id_uce)
    except ValueError:
        raise HTTPException(status_code=400, detail="ID de UCE inválido.")


@router.get("/propuestas")
def get_propuestas(
    db: Session = Depends(get_db),
    tipo: Optional[str] = Query(None),
    estado: str = Query("pendiente"),
    q: Optional[str] = Query(None),
    incluir_ya_presente: bool = Query(False),
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
) -> Any:
    """Lista las UCEs clasificadas con contadores por estado de revisión."""
    U = UnidadConocimientoExplicito

    # Contadores por estado para las pestañas del lexicógrafo
    base_conteo = db.query(U.estado_revision, func.count())
    if not incluir_ya_presente:
        base_conteo = base_conteo.filter(U.tipo_peruanismo != "ya_presente")
    conteos_raw = dict(base_conteo.group_by(U.estado_revision).all())

    query = db.query(U)
    if estado and estado != "todos":
        query = query.filter(U.estado_revision == estado)

    if tipo:
        query = query.filter(U.tipo_peruanismo == tipo)
    elif not incluir_ya_presente and estado == "pendiente":
        query = query.filter(U.tipo_peruanismo != "ya_presente")

    if q:
        query = query.filter(U.lema.ilike(f"%{q.strip()}%"))

    total = query.count()
    items = (
        query.order_by(U.creado_en.desc())
        .offset((page - 1) * size)
        .limit(size)
        .all()
    )

    return {
        "total": total,
        "page": page,
        "size": size,
        "conteos_estado": {
            "pendiente": conteos_raw.get("pendiente", 0),
            "observado": conteos_raw.get("observado", 0),
            "aceptado": conteos_raw.get("aceptado", 0),
            "rechazado": conteos_raw.get("rechazado", 0),
        },
        "items": [
            {
                "id_uce": str(i.id_uce),
                "lema": i.lema,
                "numero_acepcion": i.numero_acepcion,
                "pos_mcr": i.pos_mcr,
                "glosa": i.base_gloss or i.embedding_input_gloss,
                "tipo_peruanismo": i.tipo_peruanismo,
                "relacion_propuesta": (i.relaciones or {}).get("relacion_propuesta"),
                "offset_mcr": i.offset_mcr,
                "sim_mcr": i.sim_mcr,
                "estado_revision": i.estado_revision,
                "notas_revision": i.notas_revision,
            }
            for i in items
        ],
    }


@router.get("/propuesta/{id_uce}")
def get_propuesta_detalle(id_uce: str, db: Session = Depends(get_db)) -> Any:
    """Genera la ficha completa de curaduría con grafo, candidatos y auditoría previa."""
    uid = _parse_uuid(id_uce)
    uce = db.query(UnidadConocimientoExplicito).filter_by(id_uce=uid).first()
    if not uce:
        raise HTTPException(status_code=404, detail="UCE no encontrado")

    synset = None
    if uce.offset_mcr:
        ref = db.query(ReferenciaMCR).filter_by(offset=uce.offset_mcr).first()
        if ref:
            rel_obj = (uce.relaciones or {}).get("synset_objetivo") or {}
            synset = {
                "offset": ref.offset,
                "pos": ref.pos,
                "sinonimos": ref.sinonimos,
                "glosa_en": ref.glosa_en,
                "glosa_es": ref.glosa_es,
                "similitud": rel_obj.get("score_coseno") if rel_obj.get("offset") == ref.offset else uce.sim_mcr,
            }

    historial = (
        db.query(AuditoriaValidacion)
        .filter(AuditoriaValidacion.id_uce == uid)
        .order_by(AuditoriaValidacion.creado_en.desc())
        .all()
    )

    return {
        "id_uce": str(uce.id_uce),
        "peruanismo": {
            "lema": uce.lema,
            "numero_acepcion": uce.numero_acepcion,
            "glosa": uce.base_gloss or uce.embedding_input_gloss,
            "glosa_origen": uce.glosa_origen,
            "ejemplo": uce.ejemplo,
            "pos": uce.pos_mcr,
            "marcas": uce.marcas,
            "forma_en_mcr": uce.forma_en_mcr,
            "sim_mcr": uce.sim_mcr,
        },
        "clasificacion": {
            "tipo": uce.tipo_peruanismo,
            "tipo_legible": TIPOS_LEGIBLES.get(uce.tipo_peruanismo, "Desconocido"),
        },
        "synset_mas_cercano": synset,
        "relaciones": uce.relaciones or {},
        "propuesta": {
            "estado_revision": uce.estado_revision,
            "notas_revision": uce.notas_revision,
        },
        "historial_auditoria": [
            {
                "id": h.id,
                "decision": h.decision,
                "offset_sugerido": h.offset_sugerido,
                "offset_final": h.offset_final,
                "tipo_relacion": h.tipo_relacion,
                "notas": h.notas,
                "lexicografo_id": h.lexicografo_id,
                "creado_en": h.creado_en.isoformat() if h.creado_en else None,
            }
            for h in historial
        ],
    }


@router.get("/buscar-synsets")
def buscar_synsets(
    q: str = Query(..., min_length=2),
    pos: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    """Autocomplete sobre referencia_mcr (sinónimos y glosa española)."""
    query_str = f"%{q.strip()}%"
    query = db.query(ReferenciaMCR).filter(
        ReferenciaMCR.sinonimos.ilike(query_str)
        | ReferenciaMCR.glosa_es.ilike(query_str)
    )
    if pos:
        codigos = [c for c in pos.split("+") if c]
        if codigos:
            query = query.filter(ReferenciaMCR.pos.in_(codigos))

    resultados = query.limit(15).all()
    return [
        {
            "offset": r.offset,
            "sinonimos": r.sinonimos,
            "pos": r.pos,
            "glosa_es": r.glosa_es,
            "glosa_en": r.glosa_en,
        }
        for r in resultados
    ]


class RevisarRequest(BaseModel):
    decision: str
    notas: str = ""
    nuevo_offset: Optional[str] = None
    tipo_relacion: Optional[str] = None


@router.post("/revisar/{id_uce}")
def revisar_propuesta(id_uce: str, req: RevisarRequest, db: Session = Depends(get_db)) -> Any:
    """Guarda la decisión del lexicógrafo y registra auditoría para todas las decisiones."""
    if req.decision not in DECISION_A_ESTADO:
        raise HTTPException(status_code=400, detail="Decisión inválida. Usa aceptar, observar o rechazar.")

    if req.decision in ("rechazar", "observar") and not req.notas.strip():
        raise HTTPException(
            status_code=400,
            detail="Debe escribir un motivo en las notas al observar o rechazar la propuesta.",
        )

    if req.tipo_relacion and req.tipo_relacion not in RELACIONES_VALIDAS:
        raise HTTPException(status_code=400, detail="Tipo de relación semántica inválido.")

    uid = _parse_uuid(id_uce)
    uce = db.query(UnidadConocimientoExplicito).filter_by(id_uce=uid).first()
    if not uce:
        raise HTTPException(status_code=404, detail="UCE no encontrado")

    try:
        offset_sugerido = uce.offset_mcr
        estado = DECISION_A_ESTADO[req.decision]
        uce.estado_revision = estado
        uce.notas_revision = req.notas.strip()

        rel = dict(uce.relaciones or {})
        relacion_final = req.tipo_relacion or rel.get("relacion_propuesta")

        # Si el lexicógrafo modificó offset o relación, sincronizamos uce.offset_mcr y uce.relaciones
        if req.nuevo_offset or req.tipo_relacion:
            offset_destino = req.nuevo_offset or uce.offset_mcr
            ref_nuevo = (
                db.query(ReferenciaMCR).filter_by(offset=offset_destino).first()
                if offset_destino
                else None
            )
            if req.nuevo_offset and not ref_nuevo:
                raise HTTPException(status_code=404, detail="El synset seleccionado no existe en el MCR.")

            if ref_nuevo:
                uce.offset_mcr = ref_nuevo.offset
                rel["synset_objetivo"] = {
                    "offset": ref_nuevo.offset,
                    "pos": ref_nuevo.pos,
                    "sinonimos": ref_nuevo.sinonimos,
                    "glosa_es": ref_nuevo.glosa_es,
                    "glosa_en": ref_nuevo.glosa_en,
                    "score_coseno": (rel.get("synset_objetivo") or {}).get("score_coseno"),
                    "origen": "curaduria_manual",
                }

            if relacion_final:
                rel["relacion_propuesta"] = relacion_final
                rel["accion_wordnet"] = (
                    "agregar_variante"
                    if relacion_final == "near_synonym"
                    else "sin_cambio"
                    if relacion_final == "variante_existente"
                    else "crear_synset"
                )

            # Actualizar arista principal del grafo para mantener coherencia visual
            if ref_nuevo:
                aristas = [
                    a for a in (rel.get("relaciones_grafo") or [])
                    if not a.get("principal")
                ]
                etiqueta_map = {
                    "near_synonym": "sinónimo (curado)",
                    "has_hyperonym": "hiperónimo (curado)",
                    "variante_existente": "ya en WordNet",
                }
                aristas.insert(
                    0,
                    {
                        "tipo": relacion_final or "has_hyperonym",
                        "etiqueta": etiqueta_map.get(relacion_final, "hiperónimo (curado)"),
                        "target_offset": ref_nuevo.offset,
                        "target_sinonimos": ref_nuevo.sinonimos,
                        "target_glosa": ref_nuevo.glosa_es or ref_nuevo.glosa_en,
                        "score": (rel.get("synset_objetivo") or {}).get("score_coseno"),
                        "principal": True,
                    },
                )
                rel["relaciones_grafo"] = aristas

            rel["curado_manual"] = True
            uce.relaciones = rel
            flag_modified(uce, "relaciones")

        # Auditoría transaccional para TODAS las decisiones (aceptar, observar y rechazar)
        auditoria = AuditoriaValidacion(
            id_uce=uid,
            decision=req.decision,
            offset_sugerido=offset_sugerido,
            offset_final=uce.offset_mcr,
            tipo_relacion=relacion_final,
            notas=req.notas.strip(),
        )
        db.add(auditoria)
        db.commit()

    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

    return {
        "status": "ok",
        "id_uce": id_uce,
        "estado": estado,
        "offset_final": uce.offset_mcr,
        "tipo_relacion": relacion_final,
    }