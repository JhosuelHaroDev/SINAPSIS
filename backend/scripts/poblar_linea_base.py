"""
SINAPSIS — Carga de Línea Base Pre-Test y grados relacionales del MCR
Ubicación: backend/scripts/poblar_linea_base.py

Puebla en PostgreSQL (local o Railway):
  1. Tabla `linea_base_mcr` (7,954 filas desde baseline_mcr_*.csv)
  2. Columna `referencia_mcr.num_relaciones` (desde wei_spa-30_relation.tsv)

Uso desde la carpeta backend/:
  # Local:
  ..\venv\Scripts\python.exe -m scripts.poblar_linea_base

  # Railway:
  $env:DATABASE_URL="tu_DATABASE_PUBLIC_URL"
  ..\venv\Scripts\python.exe -m scripts.poblar_linea_base
  Remove-Item Env:DATABASE_URL
"""

import csv
import time
from collections import Counter
from pathlib import Path

from psycopg2.extras import execute_values
from sqlalchemy import text

from app.core.database import engine
from app.models import Base

BACKEND_DIR = Path(__file__).resolve().parent.parent
PROYECTO_DIR = BACKEND_DIR.parent

RUTAS_BASELINE = [
    BACKEND_DIR / "artifacts" / "baseline" / "baseline_mcr_20260617_2205.csv",
    BACKEND_DIR / "artifacts" / "baseline" / "baseline_mcr_prs.csv",
    BACKEND_DIR / "baseline_mcr_20260617_2205.csv",
    BACKEND_DIR / "baseline_mcr_prs.csv",
]

RUTA_RELACIONES_TSV = PROYECTO_DIR / "database" / "mcr" / "spaWN" / "wei_spa-30_relation.tsv"


def poblar_linea_base():
    ruta_csv = next((r for r in RUTAS_BASELINE if r.exists()), None)
    if not ruta_csv:
        raise FileNotFoundError(
            "No se encontró baseline_mcr_*.csv en backend/artifacts/baseline/ ni en backend/."
        )

    filas = []
    with open(ruta_csv, encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for idx, row in enumerate(reader, 1):
            filas.append((
                f"DP-{idx:04d}",
                row["lema"].strip(),
                int(row["en_mcr"]),
                int(row["synsets"]),
                int(row["relaciones"]),
            ))

    t0 = time.time()
    raw_conn = engine.raw_connection()
    try:
        cur = raw_conn.cursor()
        execute_values(
            cur,
            """
            INSERT INTO linea_base_mcr (id_peruanismo, lema, en_mcr_pre, synsets_pre, relaciones_pre)
            VALUES %s
            ON CONFLICT (id_peruanismo) DO UPDATE SET
                lema = EXCLUDED.lema,
                en_mcr_pre = EXCLUDED.en_mcr_pre,
                synsets_pre = EXCLUDED.synsets_pre,
                relaciones_pre = EXCLUDED.relaciones_pre;
            """,
            filas,
            page_size=2000,
        )
        raw_conn.commit()
    finally:
        raw_conn.close()

    presentes = sum(r[2] for r in filas)
    suma_rel = sum(r[4] for r in filas)
    print(
        f" ✅ linea_base_mcr cargada desde {ruta_csv.name}: "
        f"{len(filas):,} filas | presentes={presentes:,} ({presentes/len(filas)*100:.2f}%) "
        f"| rel_pre={suma_rel:,} en {time.time() - t0:.1f}s"
    )


def poblar_num_relaciones_mcr():
    if not RUTA_RELACIONES_TSV.exists():
        print(f" ⚠️  No se encontró {RUTA_RELACIONES_TSV}. Se omite num_relaciones.")
        return

    t0 = time.time()
    print(f" Leyendo grados relacionales desde {RUTA_RELACIONES_TSV.name}...")
    conteo = Counter()
    with open(RUTA_RELACIONES_TSV, encoding="utf-8", errors="replace") as f:
        for line in f:
            partes = line.rstrip("\n").split("\t")
            if len(partes) < 5:
                continue
            src = partes[1].strip()
            tgt = partes[3].strip()
            if src:
                conteo[src] += 1
            if tgt and tgt != src:
                conteo[tgt] += 1

    datos = list(conteo.items())
    print(f" Actualizando num_relaciones para {len(datos):,} synsets en referencia_mcr...")

    raw_conn = engine.raw_connection()
    try:
        cur = raw_conn.cursor()
        execute_values(
            cur,
            """
            UPDATE referencia_mcr AS r
            SET num_relaciones = v.cnt
            FROM (VALUES %s) AS v(off_id, cnt)
            WHERE r."offset" = v.off_id;
            """,
            datos,
            page_size=5000,
        )
        raw_conn.commit()
    finally:
        raw_conn.close()

    print(f" ✅ referencia_mcr.num_relaciones actualizado en {time.time() - t0:.1f}s")


def main():
    Base.metadata.create_all(bind=engine)
    with engine.begin() as conn:
        conn.execute(text("""
            ALTER TABLE referencia_mcr
            ADD COLUMN IF NOT EXISTS num_relaciones INTEGER DEFAULT 0;
        """))

    poblar_linea_base()
    poblar_num_relaciones_mcr()
    print("\n ✅ Fase 5 — Datos de línea base y grados MCR sincronizados.")


if __name__ == "__main__":
    main()