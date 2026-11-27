from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks
from sqlalchemy.orm import Session
from sqlalchemy import text, func
from typing import Any, Optional
from datetime import datetime
from uuid import UUID
import uuid

from app.core.database import get_db
from app.models import RegistroLexicoCrudo, UnidadConocimientoExplicito, JobPipeline
from app.services.procesamiento import ProcesadorIndividual

router = APIRouter()

@router.get("/pendientes")
def get_pendientes(
    db: Session = Depends(get_db),
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    lema: Optional[str] = None,
    acepciones: Optional[int] = None,
    estado_procesamiento: str = Query("pendiente"),
    fecha_desde: Optional[datetime] = None,
    fecha_hasta: Optional[datetime] = None,
) -> Any:
    query = db.query(RegistroLexicoCrudo)

    if estado_procesamiento and estado_procesamiento != "todos":
        query = query.filter(RegistroLexicoCrudo.estado_procesamiento == estado_procesamiento)
    else:
        query = query.filter(RegistroLexicoCrudo.estado_procesamiento != "procesado")

    if lema:
        query = query.filter(RegistroLexicoCrudo.lema.ilike(f"%{lema}%"))
    if acepciones is not None:
        query = query.filter(RegistroLexicoCrudo.num_acepciones == acepciones)
    if fecha_desde:
        query = query.filter(RegistroLexicoCrudo.fecha_extraccion >= fecha_desde)
    if fecha_hasta:
        query = query.filter(RegistroLexicoCrudo.fecha_extraccion <= fecha_hasta)

    total = query.count()
    items = (
        query.order_by(RegistroLexicoCrudo.fecha_extraccion.desc())
        .offset((page - 1) * size)
        .limit(size)
        .all()
    )

    conteos = dict(
        db.query(RegistroLexicoCrudo.estado_procesamiento, func.count())
        .group_by(RegistroLexicoCrudo.estado_procesamiento)
        .all()
    )

    return {
        "total": total,
        "page": page,
        "size": size,
        "resumen_cola": {
            "pendiente": conteos.get("pendiente", 0),
            "remision_pendiente": conteos.get("remision_pendiente", 0),
            "sin_uce": conteos.get("sin_uce", 0),
            "procesado": conteos.get("procesado", 0),
        },
        "items": [
            {
                "id_rlc": str(i.id_rlc),
                "id_entrada": i.id_entrada,
                "lema": i.lema,
                "num_acepciones": i.num_acepciones,
                "estado_procesamiento": i.estado_procesamiento or "pendiente",
                "fecha_extraccion": i.fecha_extraccion,
                "rlc_json": i.rlc_json,
            }
            for i in items
        ],
    }

@router.get("/procesados")
def get_procesados(
    db: Session = Depends(get_db),
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    lema: Optional[str] = None,
    pos_mcr: Optional[str] = None,
    tipo_peruanismo: Optional[str] = None
) -> Any:
    """Lista las UCEs generadas por el pipeline (Bandeja de Salida).

    Devuelve las Unidades de Conocimiento Explícito que ya han pasado por
    las fases de procesamiento y están listas para revisión. Excluye aquellas
    que han sido rechazadas previamente.

    Args:
        db (Session): Sesión de base de datos.
        page (int, optional): Número de página (offset = (page-1) * size).
        size (int, optional): Límite de resultados por página.
        lema (str, optional): Búsqueda parcial por lema.
        pos_mcr (str, optional): Filtro por categoría gramatical (n, v, a, r).
        tipo_peruanismo (str, optional): Filtro por clasificación de peruanismo.

    Returns:
        dict: Estructura paginada que incluye un desglose completo de la UCE
        bajo el atributo `uce_completo`.
    """
    query = db.query(UnidadConocimientoExplicito)
    
    if lema:
        query = query.filter(UnidadConocimientoExplicito.lema.ilike(f"%{lema}%"))
    if pos_mcr:
        query = query.filter(UnidadConocimientoExplicito.pos_mcr == pos_mcr)
    if tipo_peruanismo:
        query = query.filter(UnidadConocimientoExplicito.tipo_peruanismo == tipo_peruanismo)
        
    query = query.filter(UnidadConocimientoExplicito.estado_revision != "rechazado")
        
    total = query.count()
    items = query.order_by(UnidadConocimientoExplicito.lema.asc(), UnidadConocimientoExplicito.numero_acepcion.asc()).offset((page - 1) * size).limit(size).all()
    
    return {
        "total": total,
        "page": page,
        "size": size,
        "items": [
            {
                "id_uce": str(i.id_uce),
                "id_rlc": str(i.id_rlc),
                "lema": i.lema,
                "numero_acepcion": i.numero_acepcion,
                "pos_mcr": i.pos_mcr,
                "tipo_peruanismo": i.tipo_peruanismo,
                "base_gloss": i.base_gloss,
                "uce_completo": {
                    "lema": i.lema,
                    "pos_mcr": i.pos_mcr,
                    "numero_acepcion": i.numero_acepcion,
                    "base_gloss": i.base_gloss,
                    "embedding_input_gloss": i.embedding_input_gloss,
                    "glosa_origen": i.glosa_origen,
                    "marcas": i.marcas,
                    "ejemplo": i.ejemplo,
                    "forma_en_mcr": i.forma_en_mcr,
                    "tipo_peruanismo": i.tipo_peruanismo,
                    "estado_revision": i.estado_revision,
                    "relaciones": i.relaciones
                }
            } for i in items
        ]
    }

@router.post("/procesar/{id_rlc}")
def procesar_rlc(id_rlc: str) -> Any:
    """Procesa un RLC específico a través del pipeline SECI.

    Invoca el `ProcesadorIndividual` para tomar un RLC crudo, pasarlo por 
    la limpieza, inferencia y estructuración, y generar sus respectivas UCEs.

    Args:
        id_rlc (str): UUID del Registro Léxico Crudo a procesar.

    Returns:
        dict: Diccionario de resultados devuelto por el pipeline.

    Raises:
        HTTPException (500): Si falla cualquier paso del procesamiento.
    """
    try:
        resultado = ProcesadorIndividual.procesar_pipeline(id_rlc)
        return resultado
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

from pydantic import BaseModel
from typing import List

class DescarteMasivoRequest(BaseModel):
    ids_uce: List[str]

@router.post("/descartar-masivo")
def descartar_masivo(req: DescarteMasivoRequest, db: Session = Depends(get_db)):
    """Marca masivamente un conjunto de UCEs como 'rechazado'.

    Permite al analista hacer una criba rápida y descartar propuestas
    que la IA generó erróneamente sin necesidad de entrar una por una.

    Args:
        req (DescarteMasivoRequest): Payload conteniendo la lista de `ids_uce`.
        db (Session): Sesión transaccional de base de datos.

    Returns:
        dict: Estado de éxito y mensaje confirmando la cantidad descartada.

    Raises:
        HTTPException (500): Si hay error de conversión UUID o fallo SQL.
    """
    try:
        from uuid import UUID
        ids_uuid = [UUID(uid) for uid in req.ids_uce]
        
        db.query(UnidadConocimientoExplicito).filter(
            UnidadConocimientoExplicito.id_uce.in_(ids_uuid)
        ).update({"estado_revision": "rechazado"}, synchronize_session=False)
        db.commit()
        
        return {"status": "ok", "message": f"{len(ids_uuid)} UCEs descartadas exitosamente."}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

class ProcesarLoteRequest(BaseModel):
    ids_rlc: Optional[List[UUID]] = None
    limite: int = 25

    model_config = {
        "json_schema_extra": {
            "example": {"limite": 10}
        }
    }


@router.post("/procesar-lote")
def procesar_lote(
    req: ProcesarLoteRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """Procesa en segundo plano un lote de RLCs pendientes."""
    en_curso = (
        db.query(JobPipeline)
        .filter(
            JobPipeline.tipo.in_(["procesamiento_masivo", "resolver_remisiones"]),
            JobPipeline.estado == "procesando",
        )
        .first()
    )
    if en_curso:
        raise HTTPException(status_code=400, detail="Ya hay un lote de procesamiento en curso.")

    if req.ids_rlc:
        ids_a_procesar = [str(uid) for uid in req.ids_rlc]
    else:
        limite = max(1, min(req.limite, 500))
        filas = (
            db.query(RegistroLexicoCrudo.id_rlc)
            .filter(RegistroLexicoCrudo.estado_procesamiento == "pendiente")
            .order_by(RegistroLexicoCrudo.fecha_extraccion.asc())
            .limit(limite)
            .all()
        )
        ids_a_procesar = [str(r[0]) for r in filas]

    if not ids_a_procesar:
        raise HTTPException(status_code=400, detail="No hay RLCs pendientes para procesar.")

    job = JobPipeline(
        id_job=uuid.uuid4(),
        tipo="procesamiento_masivo",
        estado="procesando",
        total=len(ids_a_procesar),
        actual=0,
        mensaje=f"Encolando {len(ids_a_procesar)} RLCs...",
        detalle={"total_uces": 0, "errores": []},
    )
    db.add(job)
    db.commit()

    background_tasks.add_task(
        ProcesadorIndividual.ejecutar_lote_analista,
        str(job.id_job),
        ids_a_procesar,
    )
    return {"status": "Iniciado", "id_job": str(job.id_job), "total": len(ids_a_procesar)}


@router.post("/resolver-remisiones")
def resolver_remisiones_pendientes(
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """Re-procesa RLCs en estado 'remision_pendiente' cuyo destino ya fue extraído."""
    en_curso = (
        db.query(JobPipeline)
        .filter(
            JobPipeline.tipo.in_(["procesamiento_masivo", "resolver_remisiones"]),
            JobPipeline.estado == "procesando",
        )
        .first()
    )
    if en_curso:
        raise HTTPException(status_code=400, detail="Ya hay un lote de procesamiento en curso.")

    pendientes_rem = (
        db.query(RegistroLexicoCrudo)
        .filter(RegistroLexicoCrudo.estado_procesamiento == "remision_pendiente")
        .all()
    )
    if not pendientes_rem:
        return {"status": "Sin pendientes", "total": 0, "mensaje": "No hay remisiones pendientes."}

    existentes = {
        r[0] for r in db.query(RegistroLexicoCrudo.id_entrada).all()
    }
    ids_listos = []
    for rlc in pendientes_rem:
        aceps = (rlc.rlc_json or {}).get("acepciones", []) or []
        for ac in aceps:
            if ac.get("remision_estado") == "destino_ausente":
                dest_id = (ac.get("remision") or {}).get("destino_id")
                if dest_id in existentes:
                    ids_listos.append(str(rlc.id_rlc))
                    break

    if not ids_listos:
        return {
            "status": "Esperando destinos",
            "total": 0,
            "remisiones_pendientes": len(pendientes_rem),
            "mensaje": "Ninguno de los destinos faltantes ha sido extraído todavía.",
        }

    job = JobPipeline(
        id_job=uuid.uuid4(),
        tipo="resolver_remisiones",
        estado="procesando",
        total=len(ids_listos),
        actual=0,
        mensaje=f"Re-resolviendo {len(ids_listos)} RLC(s) con destinos ya disponibles...",
        detalle={"total_uces": 0, "errores": []},
    )
    db.add(job)
    db.commit()

    background_tasks.add_task(
        ProcesadorIndividual.ejecutar_lote_analista,
        str(job.id_job),
        ids_listos,
    )
    return {"status": "Iniciado", "id_job": str(job.id_job), "total": len(ids_listos)}


@router.get("/progreso-procesamiento")
def get_progreso_procesamiento(db: Session = Depends(get_db)):
    """Consulta el avance del último lote del Analista (procesamiento o remisiones)."""
    job = (
        db.query(JobPipeline)
        .filter(JobPipeline.tipo.in_(["procesamiento_masivo", "resolver_remisiones", "enganche_masivo"]))
        .order_by(JobPipeline.creado_en.desc())
        .first()
    )
    if not job:
        return {"estado": "inactivo", "total": 0, "actual": 0, "mensaje": ""}
    return {
        "id_job": str(job.id_job),
        "tipo": job.tipo,
        "estado": job.estado,
        "total": job.total,
        "actual": job.actual,
        "exitosos": job.exitosos,
        "fallidos": job.fallidos,
        "item_actual": job.item_actual,
        "total_uces": (job.detalle or {}).get("total_uces", 0),
        "errores": (job.detalle or {}).get("errores", []),
        "mensaje": job.mensaje,
    }

class EngancheLoteRequest(BaseModel):
    limite: int = 50
    forzar: bool = False

    model_config = {
        "json_schema_extra": {
            "example": {"limite": 50, "forzar": False}
        }
    }


@router.post("/enganchar-pendientes")
def enganchar_pendientes(
    req: EngancheLoteRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """Genera propuestas de enganche y grafo (Fase 3) para UCEs que aún tienen relaciones vacías."""
    en_curso = (
        db.query(JobPipeline)
        .filter(
            JobPipeline.tipo.in_(["procesamiento_masivo", "resolver_remisiones", "enganche_masivo"]),
            JobPipeline.estado == "procesando",
        )
        .first()
    )
    if en_curso:
        raise HTTPException(status_code=400, detail="Ya hay un lote de procesamiento en curso.")

    query = db.query(UnidadConocimientoExplicito.id_uce).filter(
        UnidadConocimientoExplicito.vector.isnot(None),
        UnidadConocimientoExplicito.tipo_peruanismo != "sin_clasificar",
    )
    if not req.forzar:
        query = query.filter(
            (UnidadConocimientoExplicito.relaciones.is_(None))
            | (UnidadConocimientoExplicito.relaciones == {})
        )

    limite = max(1, min(req.limite, 1000))
    ids_uce = [str(r[0]) for r in query.limit(limite).all()]

    if not ids_uce:
        return {"status": "Sin pendientes", "total": 0, "mensaje": "Todas las UCEs con vector ya tienen enganche."}

    job = JobPipeline(
        id_job=uuid.uuid4(),
        tipo="enganche_masivo",
        estado="procesando",
        total=len(ids_uce),
        actual=0,
        mensaje=f"Encolando enganche semántico de {len(ids_uce)} UCEs...",
        detalle={"errores": []},
    )
    db.add(job)
    db.commit()

    background_tasks.add_task(
        ProcesadorIndividual.ejecutar_lote_enganche,
        str(job.id_job),
        ids_uce,
    )
    return {"status": "Iniciado", "id_job": str(job.id_job), "total": len(ids_uce)}
