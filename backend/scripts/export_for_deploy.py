"""
====================================================================
SINAPSIS — Script de exportación para despliegue
Ubicación: backend/scripts/export_for_deploy.py
====================================================================
Exporta las tablas necesarias para la API de producción SIN los
vectores (columna `vector` de UCE y referencia_mcr). Los vectores
pesan ~1.5 GB y no se usan en la API (los resultados de la
clasificación ya están en columnas regulares).

Uso:
  cd backend
  python -m scripts.export_for_deploy

Genera archivos SQL en scripts/export/ listos para importar en
la base de datos de producción.
====================================================================
"""

import os
import sys

# Añadir el directorio padre al path para imports de app.*
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.database import SessionLocal, engine
from sqlalchemy import text


OUTPUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "export")
os.makedirs(OUTPUT_DIR, exist_ok=True)


def export_table_to_csv(table_name, columns, filename):
    """Exporta columnas seleccionadas de una tabla a CSV."""
    cols = ", ".join(columns)
    query = f"COPY (SELECT {cols} FROM {table_name}) TO STDOUT WITH CSV HEADER"

    output_path = os.path.join(OUTPUT_DIR, filename)

    # Usar conexión raw para COPY
    raw_conn = engine.raw_connection()
    try:
        cursor = raw_conn.cursor()
        with open(output_path, "w", encoding="utf-8") as f:
            cursor.copy_expert(query, f)
        raw_conn.commit()
        print(f"  ✓ {filename} exportado ({os.path.getsize(output_path):,} bytes)")
    finally:
        raw_conn.close()

    return output_path


def main():
    print("=" * 60)
    print("SINAPSIS — Exportación de datos para respaldo / despliegue")
    print("=" * 60)

    tablas = [
        ("control_extraccion_lemas", [
            "id_lema", "lema", "url_origen", "estado_seci",
            "fecha_indexacion", "ultima_actualizacion", "reintentos_fallidos",
        ], "control_extraccion_lemas.csv"),
        ("configuracion_extraccion", [
            "id", "url_origen", "estado_conexion", "actualizado_en",
        ], "configuracion_extraccion.csv"),
        ("registro_lexico_crudo", [
            "id_rlc", "id_lema", "id_entrada", "lema", "num_acepciones",
            "rlc_json", "texto_plano", "estado_limpieza",
            "estado_procesamiento", "fecha_extraccion",
        ], "registro_lexico_crudo.csv"),
        ("unidad_conocimiento_explicito", [
            "id_uce", "id_rlc", "numero_acepcion", "lema", "pos_mcr",
            "base_gloss", "embedding_input_gloss", "glosa_origen", "marcas",
            "ejemplo", "forma_en_mcr", "candidatos_mcr", "offset_mcr",
            "tipo_peruanismo", "relaciones", "sim_mcr",
            "estado_revision", "notas_revision", "creado_en",
        ], "uce.csv"),
        ("referencia_mcr", [
            "offset", "pos", "sinonimos", "glosa_en", "glosa_es",
            "glosa_es_origen", "num_relaciones", "creado_en",
        ], "referencia_mcr.csv"),
        ("forma_mcr", ["id", "word", "pos", "offset"], "forma_mcr.csv"),
        ("linea_base_mcr", [
            "id_peruanismo", "lema", "en_mcr_pre", "synsets_pre", "relaciones_pre",
        ], "linea_base_mcr.csv"),
        ("incidencias_procesamiento", [
            "id", "fase", "tipo", "id_entrada", "lema", "numero_acepcion",
            "glosa", "resultado", "pos_mcr", "genero_proximo", "justificacion",
            "confianza", "requiere_revision", "detalle", "creado_en",
        ], "incidencias.csv"),
        ("auditoria_validacion", [
            "id", "id_uce", "lexicografo_id", "decision",
            "offset_sugerido", "offset_final", "tipo_relacion", "notas", "creado_en",
        ], "auditoria_validacion.csv"),
    ]

    for idx, (tabla, cols, archivo) in enumerate(tablas, 1):
        print(f"[{idx}/{len(tablas)}] Exportando {tabla}...")
        export_table_to_csv(tabla, cols, archivo)

    print(f"\n✅ Exportación completa en: {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
