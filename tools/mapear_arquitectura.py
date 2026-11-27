"""
SINAPSIS — Mapeador de Arquitectura Completa (sin contenido de archivos)
Ubicación sugerida: SINAPSIS/mapear_arquitectura.py

Uso desde la raíz del proyecto:
    python mapear_arquitectura.py
    python mapear_arquitectura.py --con-bd   # Incluye tablas e índices reales de PostgreSQL
"""

import os
import argparse
from pathlib import Path
from collections import defaultdict
from datetime import datetime

# Carpetas que SÍ se muestran en el árbol, pero colapsadas (no se listan sus miles de archivos internos)
CARPETAS_COLAPSADAS = {
    "venv", ".venv", "env", "virtualenv",
    "node_modules", ".next", ".vercel", ".git",
    "__pycache__", ".pytest_cache", ".mypy_cache", ".vscode", ".idea",
}


def formatear_tamano(bytes_size: int) -> str:
    for unidad in ["B", "KB", "MB", "GB"]:
        if bytes_size < 1024.0:
            return f"{bytes_size:.1f} {unidad}" if unidad != "B" else f"{bytes_size} B"
        bytes_size /= 1024.0
    return f"{bytes_size:.1f} TB"


def contar_elementos_rapido(carpeta: Path) -> int:
    try:
        return sum(1 for _ in carpeta.iterdir())
    except OSError:
        return 0


def construir_arbol(raiz: Path):
    lineas = [f"{raiz.name}/"]
    stats_ext = defaultdict(lambda: [0, 0])  # ext -> [cantidad, bytes]
    total_archivos = 0
    total_carpetas = 0
    total_bytes = 0
    carpetas_vacias = []

    def recorrer(directorio: Path, prefijo: str = ""):
        nonlocal total_archivos, total_carpetas, total_bytes

        try:
            entradas = list(directorio.iterdir())
        except OSError as e:
            lineas.append(f"{prefijo}└── [Error de lectura: {e}]")
            return

        # Carpetas primero, luego archivos, orden alfabético insensible a mayúsculas
        entradas.sort(key=lambda p: (not p.is_dir(), p.name.lower()))

        for idx, entrada in enumerate(entradas):
            es_ultimo = idx == len(entradas) - 1
            conector = "└── " if es_ultimo else "├── "
            siguiente_prefijo = prefijo + ("    " if es_ultimo else "│   ")

            if entrada.is_dir():
                total_carpetas += 1
                nombre_lower = entrada.name.lower()

                if entrada.name in CARPETAS_COLAPSADAS or nombre_lower in CARPETAS_COLAPSADAS:
                    n_items = contar_elementos_rapido(entrada)
                    lineas.append(f"{prefijo}{conector}{entrada.name}/  [colapsada · {n_items} entradas en nivel 1]")
                    continue

                # Revisar si está vacía
                try:
                    hijos = list(entrada.iterdir())
                except OSError:
                    hijos = []

                if not hijos:
                    rel = entrada.relative_to(raiz).as_posix()
                    carpetas_vacias.append(rel)
                    lineas.append(f"{prefijo}{conector}{entrada.name}/  [vacía]")
                else:
                    lineas.append(f"{prefijo}{conector}{entrada.name}/")
                    recorrer(entrada, siguiente_prefijo)
            else:
                total_archivos += 1
                try:
                    tam = entrada.stat().st_size
                except OSError:
                    tam = 0
                total_bytes += tam

                ext = entrada.suffix.lower() or "(sin extensión)"
                stats_ext[ext][0] += 1
                stats_ext[ext][1] += tam

                nota = ""
                if entrada.name.lower().startswith(".env"):
                    nota = "  [sensible · no exportar contenido]"
                elif tam == 0:
                    nota = "  [0 B · vacío]"

                lineas.append(f"{prefijo}{conector}{entrada.name} ({formatear_tamano(tam)}){nota}")

    recorrer(raiz)
    return {
        "lineas": lineas,
        "stats_ext": stats_ext,
        "total_archivos": total_archivos,
        "total_carpetas": total_carpetas,
        "total_bytes": total_bytes,
        "carpetas_vacias": carpetas_vacias,
    }


def inspeccionar_postgres(raiz: Path) -> list[str]:
    """Inspecciona tablas, columnas, índices y conteos reales de PostgreSQL sin mostrar credenciales."""
    salida = ["=" * 80, "RADIOGRAFÍA DE BASE DE DATOS POSTGRESQL (esquema + índices reales)", "=" * 80]
    try:
        from dotenv import load_dotenv
        import psycopg2
    except ImportError:
        salida.append("  [Omitido: ejecuta con el venv activo donde están python-dotenv y psycopg2]")
        return salida

    env_path = raiz / "backend" / ".env"
    if env_path.exists():
        load_dotenv(env_path)
    else:
        load_dotenv()

    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        user = os.getenv("DB_USER")
        pwd = os.getenv("DB_PASSWORD")
        host = os.getenv("DB_HOST", "localhost")
        port = os.getenv("DB_PORT", "5432")
        name = os.getenv("DB_NAME", "sinapsis_db")
        if not user:
            salida.append("  [Omitido: no se encontraron variables DATABASE_URL / DB_USER en backend/.env]")
            return salida
        db_url = f"postgresql://{user}:{pwd}@{host}:{port}/{name}"
        if os.getenv("DB_SSLMODE"):
            db_url += f"?sslmode={os.getenv('DB_SSLMODE')}"

    try:
        conn = psycopg2.connect(db_url, connect_timeout=6)
        cur = conn.cursor()

        # Extensiones
        cur.execute("SELECT extname, extversion FROM pg_extension ORDER BY extname;")
        exts = ", ".join(f"{n} ({v})" for n, v in cur.fetchall())
        salida.append(f"Extensiones instaladas: {exts}\n")

        # Tablas del esquema public
        cur.execute("""
            SELECT tablename
            FROM pg_tables
            WHERE schemaname = 'public'
            ORDER BY tablename;
        """)
        tablas = [r[0] for r in cur.fetchall()]
        salida.append(f"Tablas en public ({len(tablas)}):")

        for tabla in tablas:
            cur.execute(f'SELECT COUNT(*) FROM "{tabla}";')
            filas = cur.fetchone()[0]

            cur.execute("""
                SELECT column_name, data_type, udt_name, is_nullable
                FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = %s
                ORDER BY ordinal_position;
            """, (tabla,))
            cols = cur.fetchall()

            cur.execute("""
                SELECT indexname, indexdef
                FROM pg_indexes
                WHERE schemaname = 'public' AND tablename = %s
                ORDER BY indexname;
            """, (tabla,))
            indices = cur.fetchall()

            salida.append(f"\n  [TABLA] {tabla}  ({filas:,} filas)")
            salida.append("    Columnas:")
            for cname, dtype, udt, nullab in cols:
                tipo_str = udt if dtype == "USER-DEFINED" else dtype
                salida.append(f"      - {cname}: {tipo_str} (null={nullab})")
            salida.append("    Índices:")
            if indices:
                for iname, idef in indices:
                    salida.append(f"      * {iname}: {idef}")
            else:
                salida.append("      * (ninguno)")

        cur.close()
        conn.close()
    except Exception as e:
        salida.append(f"  [No se pudo conectar a PostgreSQL: {e}]")

    return salida


def main():
    parser = argparse.ArgumentParser(description="Genera el mapa completo de arquitectura de SINAPSIS.")
    parser.add_argument("-r", "--ruta", default=".", help="Ruta raíz del proyecto (por defecto '.')")
    parser.add_argument("-o", "--output", default="arquitectura_sinapsis.txt", help="Archivo de salida")
    parser.add_argument("--con-bd", action="store_true", help="Incluye tablas, columnas e índices reales de PostgreSQL")
    args = parser.parse_args()

    raiz = Path(args.ruta).resolve()
    res = construir_arbol(raiz)
    ruta_salida = raiz / args.output

    with open(ruta_salida, "w", encoding="utf-8") as f:
        f.write("=" * 80 + "\n")
        f.write(f"ARQUITECTURA COMPLETA DEL PROYECTO: {raiz.name}\n")
        f.write(f"FECHA: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
        f.write(f"CARPETAS: {res['total_carpetas']} | ARCHIVOS (fuera de colapsadas): {res['total_archivos']} ({formatear_tamano(res['total_bytes'])})\n")
        f.write("=" * 80 + "\n\n")

        f.write("\n".join(res["lineas"]) + "\n\n")

        if res["carpetas_vacias"]:
            f.write("-" * 80 + "\n")
            f.write(f"CARPETAS VACÍAS ({len(res['carpetas_vacias'])}):\n")
            for c in res["carpetas_vacias"]:
                f.write(f"  - {c}/\n")
            f.write("\n")

        f.write("-" * 80 + "\n")
        f.write("RESUMEN POR EXTENSIÓN (ordenado por peso total):\n")
        for ext, (cant, tam) in sorted(res["stats_ext"].items(), key=lambda x: x[1][1], reverse=True):
            f.write(f"  {ext:18s} : {cant:4d} archivo(s) | {formatear_tamano(tam)}\n")
        f.write("-" * 80 + "\n")

        if args.con_bd:
            f.write("\n" + "\n".join(inspeccionar_postgres(raiz)) + "\n")

    print(f"Generado: {ruta_salida.name} ({res['total_archivos']} archivos mapeados, {res['total_carpetas']} carpetas).")


if __name__ == "__main__":
    main()