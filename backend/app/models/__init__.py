"""
====================================================================
SINAPSIS — Modelos ORM del dominio léxico
Ubicación: backend/app/models/__init__.py
====================================================================
FUENTE ÚNICA DE LA VERDAD del esquema. Tanto los scripts (indexer,
scraper, mantenimiento) como la futura API importan las tablas desde
aquí; ningún otro módulo redefine estos modelos. Así se evita la
divergencia de esquema entre archivos.

Importar este paquete crea las tablas que aún no existan (idempotente).

Requiere: pip install pgvector   (tipo vector para los embeddings)
La extensión debe estar habilitada en la base: CREATE EXTENSION vector;
====================================================================
"""

import uuid

from sqlalchemy import (
    Column, String, DateTime, Integer, Text, ForeignKey,
    Boolean, UniqueConstraint, Float, Index, text,
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
from pgvector.sqlalchemy import Vector

from app.core.database import Base, engine, SessionLocal, ahora_utc

# Estados de la máquina SECI (nombres canónicos del pipeline).
ESTADO_PENDIENTE = "PENDIENTE_EXTRACCION"
ESTADO_COMPLETA  = "EXTRACCION_COMPLETA"
ESTADO_ERROR     = "ERROR_EXTRACCION"


class ControlExtraccionLema(Base):
    """Población indexada en Fase 0 y máquina de estados del pipeline.

    Esta tabla es el activo de la Fase 0: sus filas (los lemas válidos)
    NO deben borrarse en un reset; lo que se reinicia es su estado_seci.
    
    Attributes:
        id_lema (UUID): Identificador único del lema.
        lema (str): Texto del lema extraído.
        url_origen (str): URL de donde se extrajo (única).
        estado_seci (str): Estado actual en el pipeline (e.g. PENDIENTE_EXTRACCION).
        fecha_indexacion (datetime): Fecha en que se descubrió el lema.
        ultima_actualizacion (datetime): Fecha del último cambio de estado.
        reintentos_fallidos (int): Contador de intentos fallidos de scraping.
    """
    __tablename__ = "control_extraccion_lemas"
    id_lema              = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    lema                 = Column(String,   nullable=False)
    url_origen           = Column(String,   nullable=False, unique=True)
    estado_seci          = Column(String,   default=ESTADO_PENDIENTE)
    fecha_indexacion     = Column(DateTime, default=ahora_utc)
    ultima_actualizacion = Column(DateTime, default=ahora_utc, onupdate=ahora_utc)
    reintentos_fallidos  = Column(Integer,  default=0)


class ConfiguracionExtraccion(Base):
    """
    Configuración de la fuente de datos para la extracción (HU01).
    """
    __tablename__ = "configuracion_extraccion"
    id = Column(Integer, primary_key=True, autoincrement=True)
    url_origen = Column(String, nullable=False)
    estado_conexion = Column(String, default="Pendiente")
    actualizado_en = Column(DateTime(timezone=True), default=ahora_utc, onupdate=ahora_utc)


class RegistroLexicoCrudo(Base):
    """Artefacto de la fase de Socialización: 1 RLC por entrada del DiPerú.

    Es una tabla derivada: sus filas SÍ pueden vaciarse en un reset, porque
    se regeneran ejecutando de nuevo el scraper.

    Attributes:
        id_rlc (UUID): Identificador único del registro.
        id_lema (UUID): Referencia a control_extraccion_lemas (relación 1:1).
        id_entrada (int): ID interno de DiPerú extraído de la URL.
        lema (str): Texto del lema.
        num_acepciones (int): Número de acepciones del lema principal que generarán UCEs.
        rlc_json (dict): Captura estructurada (lema, acepciones, sublemas) en formato JSONB.
        texto_plano (str): Texto íntegro de la entrada web como respaldo auditable.
        estado_limpieza (str): Estado de la limpieza de datos ('crudo' o 'limpio').
        fecha_extraccion (datetime): Fecha y hora en que se descargó la entrada.
    """
    __tablename__ = "registro_lexico_crudo"
    id_rlc           = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    id_lema          = Column(UUID(as_uuid=True),
                              ForeignKey("control_extraccion_lemas.id_lema"),
                              nullable=False, unique=True)
    id_entrada       = Column(Integer, nullable=False)
    lema             = Column(String,  nullable=False)
    num_acepciones   = Column(Integer, default=0)
    rlc_json         = Column(JSONB,   nullable=False)
    texto_plano      = Column(Text)
    estado_limpieza  = Column(String(20), default="crudo")
    estado_limpieza      = Column(String(20), default="crudo")
    estado_procesamiento = Column(String(25), default="pendiente")  # pendiente | procesado | remision_pendiente | sin_uce
    fecha_extraccion     = Column(DateTime(timezone=True), default=ahora_utc)


class Incidencia(Base):
    """
    Registro auditable de decisiones no triviales del pipeline (inferencias
    del LLM, reparaciones, casos marcados para revisión). Una fila por
    decisión. Tabla derivada: puede vaciarse y regenerarse reprocesando.
    """
    __tablename__ = "incidencias_procesamiento"
    id                = Column(Integer, primary_key=True, autoincrement=True)
    fase              = Column(String(40), nullable=False)   # p. ej. "capa3_categoria"
    tipo              = Column(String(60))                    # p. ej. "inferencia_categoria"
    id_entrada        = Column(Integer)
    lema              = Column(String(160))
    numero_acepcion   = Column(Integer)
    glosa             = Column(Text)
    resultado         = Column(String(60))
    pos_mcr           = Column(String(20))
    genero_proximo    = Column(Text)
    justificacion     = Column(Text)
    confianza         = Column(String(12))
    requiere_revision = Column(Boolean, default=False)
    detalle           = Column(JSONB)
    creado_en         = Column(DateTime(timezone=True), default=ahora_utc)


class UnidadConocimientoExplicito(Base):
    """
    Artefacto de la Externalización: 1 UCE por acepción apta e integrable al MCR
    (una por cada acepción con pos_mcr_estado == 'mapeada'). Es el "pre-synset":
    trae todo lo que un synset del MCR necesita MENOS las relaciones, que la
    Combinación determinará.

    Es AUTOCONTENIDO: duplica a propósito lema, glosa y ejemplo del RLC para no
    depender de un join en cada operación de la Externalización y la Combinación.
    El RLC queda como evidencia intacta; el UCE es el producto destilado.

    El vector nace vacío (se llena al vectorizar) y el andamiaje del bloque 3
    nace en blanco (lo llena la Combinación).
    """
    __tablename__ = "unidad_conocimiento_explicito"

    # -- Bloque 1: identidad y sustancia del sentido --------------------------
    id_uce                = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    id_rlc                = Column(UUID(as_uuid=True),
                                   ForeignKey("registro_lexico_crudo.id_rlc"),
                                   nullable=False)
    numero_acepcion       = Column(Integer, nullable=False)
    lema                  = Column(String,  nullable=False)
    pos_mcr               = Column(String,  nullable=False)   # n | v | a | r | combinada "a+n"
    base_gloss            = Column(Text)                       # glosa fiel (trazabilidad)
    embedding_input_gloss = Column(Text)                       # texto que se vectoriza
    vector                = Column(Vector(3072))               # embedding (vacío hasta vectorizar)

    # -- Bloque 2: metadatos de DiPerú (con valor, fuera del vector) ----------
    glosa_origen          = Column(String)   # glosa_propia | glosa_referida
    marcas                = Column(JSONB)     # marcas_clasificadas (dominio/diatópica/registro...)
    ejemplo               = Column(Text)      # cita de uso cruda
    forma_en_mcr          = Column(Boolean)   # criba simbólica: ¿la forma existe en el MCR?
    candidatos_mcr        = Column(JSONB)     # offsets de los synsets de esa forma (mismo POS)

    # -- Bloque 3: andamiaje del pre-synset (en blanco para la Combinación) ---
    offset_mcr            = Column(String)                            # synset de enganche
    tipo_peruanismo       = Column(String, default="sin_clasificar")  # tipo_1_semantico | tipo_2_lexico | indeterminado
    relaciones            = Column(JSONB, default=dict)               # relaciones semánticas (forma diferida)
    sim_mcr               = Column(Float)                             # coseno máximo contra sus candidatos (evidencia)
    
    # -- Bloque 4: revisión humana (Lexicógrafo) ------------------------------
    estado_revision       = Column(String, default="pendiente")       # pendiente | aceptado | rechazado | observado
    notas_revision        = Column(Text)                              # comentarios del lexicógrafo

    creado_en             = Column(DateTime(timezone=True), default=ahora_utc)

    __table_args__ = (
        UniqueConstraint("id_rlc", "numero_acepcion", name="uq_uce_rlc_acepcion"),
    )

class ReferenciaMCR(Base):
    """
    Espejo vectorizado del MCR para la Combinación: 1 fila por synset (119.096).
    El texto de referencia es el CONJUNTO DE SINÓNIMOS del synset (la fuente que el
    experimento eligió como mejor), vectorizado con el mismo modelo que los UCE para
    que el coseno sea válido.

    Las glosas se conservan para la INTERNALIZACIÓN (lectura humana), no para el
    match. glosa_en es la definición inglesa de Princeton (fuente de una futura
    traducción y lectura en inglés). glosa_es es la definición española para leer,
    que nace con la glosa nativa donde existe (17%) y queda en blanco en el resto,
    a la espera de traducir el inglés; glosa_es_origen registra su procedencia.
    """
    __tablename__ = "referencia_mcr"
    offset          = Column(String(20), primary_key=True)
    pos             = Column(String(1), nullable=False)
    sinonimos       = Column(Text, nullable=False)   # texto de referencia (limpio)
    vector          = Column(Vector(3072))            # vector de referencia (vacío hasta vectorizar)
    glosa_en        = Column(Text)                     # definición inglesa (Princeton)
    glosa_es        = Column(Text)                     # definición española para lectura
    glosa_es_origen = Column(String(12))               # 'nativa' | 'traducida'
    num_relaciones  = Column(Integer, default=0)       # grado relacional del synset en MCR 3.0
    creado_en       = Column(DateTime(timezone=True), default=ahora_utc)

class FormaMCR(Base):
    """
    Índice simbólico de formas del MCR en PostgreSQL (144,728 filas).
    Espejo de wei_spa-30_variant (word, pos, offset) para ejecutar la criba
    simbólica de Fase 3 en milisegundos sin depender de MySQL en producción.
    """
    __tablename__ = "forma_mcr"
    id     = Column(Integer, primary_key=True, autoincrement=True)
    word   = Column(String, nullable=False, index=True)
    pos    = Column(String, nullable=False)
    offset = Column(String, nullable=False)

    __table_args__ = (
        UniqueConstraint("word", "pos", "offset", name="uq_forma_mcr"),
        Index("ix_forma_mcr_word_pos", "word", "pos"),
    )

class AuditoriaValidacion(Base):
    """
    Registro transaccional de todas las decisiones del Lexicógrafo (aceptar,
    observar y rechazar), incluyendo correcciones de offset y tipo de relación.
    """
    __tablename__ = "auditoria_validacion"
    id              = Column(Integer, primary_key=True, autoincrement=True)
    id_uce          = Column(UUID(as_uuid=True), nullable=False)
    lexicografo_id  = Column(String(50), default="lexicografo_demo")
    decision        = Column(String(20), nullable=False)
    offset_sugerido = Column(String(20))
    offset_final    = Column(String(20))
    tipo_relacion   = Column(String(30))  # near_synonym | has_hyperonym | variante_existente
    notas           = Column(Text)
    creado_en       = Column(DateTime(timezone=True), default=ahora_utc)


class JobPipeline(Base):
    """
    Seguimiento persistente de tareas en segundo plano (extracción masiva,
    procesamiento por lotes de UCEs y re-resolución de remisiones).
    Reemplaza el estado en memoria para sobrevivir reinicios en Railway.
    """
    __tablename__ = "jobs_pipeline"
    id_job         = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tipo           = Column(String(40), nullable=False)  # extraccion_masiva | procesamiento_masivo | resolver_remisiones
    estado         = Column(String(20), nullable=False, default="pendiente")  # pendiente | procesando | completado | error
    total          = Column(Integer, default=0)
    actual         = Column(Integer, default=0)
    exitosos       = Column(Integer, default=0)
    fallidos       = Column(Integer, default=0)
    item_actual    = Column(String(160))
    mensaje        = Column(Text, default="")
    detalle        = Column(JSONB, default=dict)
    creado_en      = Column(DateTime(timezone=True), default=ahora_utc)
    actualizado_en = Column(DateTime(timezone=True), default=ahora_utc, onupdate=ahora_utc)


# Habilita la extensión pgvector automáticamente si no existe (requiere permisos en PostgreSQL, los cuales Railway otorga por defecto)
from sqlalchemy import text
with engine.connect() as conn:
    conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
    conn.commit()

class LineaBaseMCR(Base):
    """
    Snapshot Pre-Test de los 7,954 peruanismos evaluados contra MCR 3.0 (2016).
    Fuente inmutable de referencia para calcular CPW_pre/post, PRS_pre/post y
    exportar las Fichas de Registro N.º 1 y N.º 2.
    """
    __tablename__ = "linea_base_mcr"
    id_peruanismo  = Column(String(12), primary_key=True)   # DP-0001 .. DP-7954
    lema           = Column(String(160), nullable=False, index=True)
    en_mcr_pre     = Column(Integer, nullable=False, default=0)  # 0 | 1
    synsets_pre    = Column(Integer, nullable=False, default=0)
    relaciones_pre = Column(Integer, nullable=False, default=0)

# Crea las tablas que aún no existan (idempotente; no altera las existentes).
Base.metadata.create_all(bind=engine)

__all__ = [
    "Base", "engine", "SessionLocal", "ahora_utc",
    "ControlExtraccionLema", "ConfiguracionExtraccion", "RegistroLexicoCrudo",
    "Incidencia", "UnidadConocimientoExplicito", "ReferenciaMCR",
    "FormaMCR", "AuditoriaValidacion",
    "ESTADO_PENDIENTE", "ESTADO_COMPLETA", "ESTADO_ERROR", "LineaBaseMCR", "JobPipeline",
]