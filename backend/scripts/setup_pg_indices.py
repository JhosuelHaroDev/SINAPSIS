"""
SINAPSIS — Sincronización de forma_mcr e índices en PostgreSQL (Local y Railway)
Ubicación: backend/scripts/setup_pg_indices.py

Uso (desde la carpeta backend/):
    # 1. Contra PostgreSQL local (lee backend/.env):
    ..\venv\Scripts\python.exe -m scripts.setup_pg_indices

    # 2. Contra Railway (sin editar .env):
    $env:DATABASE_URL="tu_DATABASE_PUBLIC_URL_de_railway"
    ..\venv\Scripts\python.exe -m scripts.setup_pg_indices
    Remove-Item Env:DATABASE_URL

    # 3. Opcional — crear índice vectorial HNSW sobre halfvec(3072) (necesario para Fase 3):
    ..\venv\Scripts\python.exe -m scripts.setup_pg_indices --crear-hnsw
"""

import argparse
import time
from sqlalchemy import text

from app.core.database import engine
from app.models import Base


def main():
    parser = argparse.ArgumentParser(description="Crea forma_mcr e índices clave en PostgreSQL.")
    parser.add_argument(
        "--crear-hnsw",
        action="store_true",
        help="Crea también el índice HNSW (halfvec 3072) en referencia_mcr (tarda ~1-3 min y usa ~1.5 GB RAM).",
    )
    args = parser.parse_args()

    # 1. Asegura tablas del ORM (forma_mcr, jobs_pipeline, etc.)
    Base.metadata.create_all(bind=engine)

    with engine.begin() as conn:
        # 2. Poblar forma_mcr si está vacía, directamente desde referencia_mcr.sinonimos
        count_formas = conn.execute(text("SELECT COUNT(*) FROM forma_mcr")).scalar()
        if count_formas == 0:
            t0 = time.time()
            print(" Poblando forma_mcr desde referencia_mcr.sinonimos...")
            conn.execute(text("""
                INSERT INTO forma_mcr (word, pos, "offset")
                SELECT DISTINCT
                    lower(trim(w)) AS word,
                    pos,
                    "offset"
                FROM referencia_mcr,
                     LATERAL regexp_split_to_table(sinonimos, ',') AS w
                WHERE trim(w) <> ''
                  AND trim(w) <> "offset"
                ON CONFLICT (word, pos, "offset") DO NOTHING;
            """))
            count_formas = conn.execute(text("SELECT COUNT(*) FROM forma_mcr")).scalar()
            print(f" ✅ forma_mcr poblada: {count_formas:,} filas en {time.time() - t0:.1f}s")
        else:
            print(f" ℹ️  forma_mcr ya contiene {count_formas:,} filas (sin cambios).")

        # 2.5 Asegurar columna estado_procesamiento en RLC y clasificar histórico
        conn.execute(text("""
            ALTER TABLE auditoria_validacion
            ADD COLUMN IF NOT EXISTS offset_sugerido VARCHAR(20),
            ADD COLUMN IF NOT EXISTS tipo_relacion VARCHAR(30);
        """))
        conn.execute(text("""
            ALTER TABLE registro_lexico_crudo
            ADD COLUMN IF NOT EXISTS estado_procesamiento VARCHAR(25) DEFAULT 'pendiente';
        """))
        conn.execute(text("""
            UPDATE registro_lexico_crudo
            SET estado_procesamiento = CASE
                WHEN EXISTS (
                    SELECT 1
                    FROM jsonb_array_elements(COALESCE(rlc_json->'acepciones', '[]'::jsonb)) AS ac
                    WHERE ac->>'remision_estado' = 'destino_ausente'
                ) THEN 'remision_pendiente'
                WHEN id_rlc IN (SELECT DISTINCT id_rlc FROM unidad_conocimiento_explicito)
                    THEN 'procesado'
                WHEN (rlc_json->'conteo' ? 'acepciones_aptas')
                    THEN 'sin_uce'
                ELSE 'pendiente'
            END
            WHERE estado_procesamiento IS NULL OR estado_procesamiento = 'pendiente';
        """))
        conn.execute(text("""
            ALTER TABLE referencia_mcr
            ADD COLUMN IF NOT EXISTS num_relaciones INTEGER DEFAULT 0;
        """))
        

        # 3. Índices operacionales ligeros (idempotentes)
        indices = [
            (
                "ix_forma_mcr_lower_word_pos",
                "CREATE INDEX IF NOT EXISTS ix_forma_mcr_lower_word_pos ON forma_mcr (lower(word), pos);",
            ),
            (
                "ix_referencia_mcr_pos",
                "CREATE INDEX IF NOT EXISTS ix_referencia_mcr_pos ON referencia_mcr (pos);",
            ),
            (
                "ix_rlc_id_entrada",
                "CREATE INDEX IF NOT EXISTS ix_rlc_id_entrada ON registro_lexico_crudo (id_entrada);",
            ),
            (
                "ix_uce_estado_revision",
                "CREATE INDEX IF NOT EXISTS ix_uce_estado_revision ON unidad_conocimiento_explicito (estado_revision);",
            ),
            (
                "ix_uce_tipo_peruanismo",
                "CREATE INDEX IF NOT EXISTS ix_uce_tipo_peruanismo ON unidad_conocimiento_explicito (tipo_peruanismo);",
            ),
            (
                "ix_auditoria_id_uce",
                "CREATE INDEX IF NOT EXISTS ix_auditoria_id_uce ON auditoria_validacion (id_uce);",
            ),
            (
                "ix_rlc_estado_procesamiento",
                "CREATE INDEX IF NOT EXISTS ix_rlc_estado_procesamiento ON registro_lexico_crudo (estado_procesamiento);",
            ),
        ]

        print(" Creando/verificando índices B-tree...")
        for nombre, sql in indices:
            conn.execute(text(sql))
            print(f"   ✓ {nombre}")

        # 4. Limpiar posible typo histórico en configuracion_extraccion
        conn.execute(text("""
            UPDATE configuracion_extraccion
            SET url_origen = 'https://diperu.apl.org.pe/buscar?entrada='
            WHERE url_origen LIKE '%apll.org.pe%';
        """))

    # 5. Índice vectorial HNSW opcional (en transacción aparte por consumo de memoria)
    if args.crear_hnsw:
        t0 = time.time()
        print("\n Creando índice vectorial HNSW sobre referencia_mcr (halfvec 3072)...")
        print(" (Esto puede tomar 1-3 minutos dependiendo del servidor)")
        with engine.begin() as conn:
            conn.execute(text("""
                CREATE INDEX IF NOT EXISTS ix_referencia_mcr_vec_hnsw
                ON referencia_mcr
                USING hnsw ((vector::halfvec(3072)) halfvec_cosine_ops)
                WHERE vector IS NOT NULL;
            """))
        print(f" ✅ Índice HNSW listo en {time.time() - t0:.1f}s")

    print("\n ✅ Sincronización de base de datos completada.")


if __name__ == "__main__":
    main()