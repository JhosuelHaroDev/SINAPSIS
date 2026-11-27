"""
SINAPSIS — Reset operativo limpio (Conserva MCR + Vectores + Semillero + Línea Base)
Ubicación: backend/app/maintenance/reset_operacion_limpia.py

Vacía únicamente las tablas operativas del ciclo SECI para comenzar un
procesamiento limpio desde la web (ideal para dejar listo Railway):
  - VACÍA: auditoria_validacion, unidad_conocimiento_explicito,
           registro_lexico_crudo, incidencias_procesamiento, jobs_pipeline
  - REINICIA estado: control_extraccion_lemas -> PENDIENTE_EXTRACCION (0 reintentos)
  - PRESERVA INTACTO: control_extraccion_lemas (filas), referencia_mcr (+ vectores),
                      forma_mcr, linea_base_mcr, configuracion_extraccion.

Uso (desde la carpeta backend/):
  # Local:
  ..\venv\Scripts\python.exe -m app.maintenance.reset_operacion_limpia

  # Railway:
  $env:DATABASE_URL="tu_DATABASE_PUBLIC_URL"
  ..\venv\Scripts\python.exe -m app.maintenance.reset_operacion_limpia
  Remove-Item Env:DATABASE_URL
"""

from sqlalchemy import update

from app.core.database import SessionLocal, ahora_utc, DATABASE_URL
from app.models import (
    ControlExtraccionLema,
    RegistroLexicoCrudo,
    UnidadConocimientoExplicito,
    Incidencia,
    AuditoriaValidacion,
    JobPipeline,
    ReferenciaMCR,
    FormaMCR,
    LineaBaseMCR,
    ESTADO_PENDIENTE,
)


def main():
    destino = "RAILWAY / REMOTO" if ("rlwy.net" in DATABASE_URL or "railway" in DATABASE_URL) else "LOCAL"

    with SessionLocal() as db:
        n_cel = db.query(ControlExtraccionLema).count()
        n_ref = db.query(ReferenciaMCR).count()
        n_forma = db.query(FormaMCR).count()
        n_base = db.query(LineaBaseMCR).count()

        n_rlc = db.query(RegistroLexicoCrudo).count()
        n_uce = db.query(UnidadConocimientoExplicito).count()
        n_inc = db.query(Incidencia).count()
        n_aud = db.query(AuditoriaValidacion).count()
        n_jobs = db.query(JobPipeline).count()

        print("=" * 64)
        print(f" RESET OPERATIVO LIMPIO — ENTORNO: {destino}")
        print("=" * 64)
        print(" [SE PRESERVA INTACTO]")
        print(f"   control_extraccion_lemas (filas) : {n_cel:>8,}")
        print(f"   referencia_mcr (+ vectores)      : {n_ref:>8,}")
        print(f"   forma_mcr                        : {n_forma:>8,}")
        print(f"   linea_base_mcr (Pre-Test)        : {n_base:>8,}")
        print(" [SE VACÍA PARA INICIAR LIMPIO]")
        print(f"   auditoria_validacion             : {n_aud:>8,}")
        print(f"   unidad_conocimiento_explicito    : {n_uce:>8,}")
        print(f"   registro_lexico_crudo            : {n_rlc:>8,}")
        print(f"   incidencias_procesamiento        : {n_inc:>8,}")
        print(f"   jobs_pipeline                    : {n_jobs:>8,}")
        print("   control_extraccion_lemas.estado  -> PENDIENTE_EXTRACCION")
        print("=" * 64)

        if input(" Escribe 'RESET LIMPIO' para confirmar: ").strip() != "RESET LIMPIO":
            print(" Cancelado. No se modificó ningún dato.")
            return

        try:
            db.query(AuditoriaValidacion).delete()
            db.query(UnidadConocimientoExplicito).delete()
            db.query(RegistroLexicoCrudo).delete()
            db.query(Incidencia).delete()
            db.query(JobPipeline).delete()
            db.execute(
                update(ControlExtraccionLema).values(
                    estado_seci=ESTADO_PENDIENTE,
                    reintentos_fallidos=0,
                    ultima_actualizacion=ahora_utc(),
                )
            )
            db.commit()
            print(" ✅ Reset operativo completado. MCR, vectores y semillero intactos.")
        except Exception as e:
            db.rollback()
            print(f" 🚨 Error, transacción revertida: {e}")


if __name__ == "__main__":
    main()