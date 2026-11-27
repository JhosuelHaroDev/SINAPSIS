"""
SINAPSIS — Exportador de Código Fuente a .txt (a medida)
Ubicación sugerida: SINAPSIS/exportar_sinapsis.py

Exporta únicamente código fuente, SQL y configuración (excluye datasets CSV/TSV,
JSONs de experimentos, reportes generados, binarios y secretos).

Uso desde la raíz del proyecto:
    python exportar_sinapsis.py
"""

import os
import argparse
from pathlib import Path
from datetime import datetime

CARPETAS_IGNORADAS = {
    "venv", ".venv", "env", "node_modules", ".next", ".vercel",
    ".git", "__pycache__", ".pytest_cache", ".vscode", ".idea",
    "artifacts", "export", "dist", "build", "out",
}

ARCHIVOS_IGNORADOS = {
    "readme.md", "package-lock.json",
    ".env", ".env.local", ".env.production",
    "exportar_proyecto.py", "exportar_sinapsis.py", "mapear_arquitectura.py",
    "arquitectura_sinapsis.txt", "arquitectura_local.txt", "arquitectura_railway.txt",
    # Artefactos de datos y experimentos del proyecto
    "experimento_referencias.json",
    "experimento_referencias_acotado.json",
    "experimento_resultados.json",
    "reporte_indexacion.md",
    "reporte_extraccion.md",
    "reporte_baseline.md",
    "install.txt",
}

EXTENSIONES_PERMITIDAS = {
    ".py", ".js", ".jsx", ".ts", ".tsx",
    ".css", ".sql", ".yml", ".yaml", ".json", ".txt",
}

NOMBRES_SIN_EXT_PERMITIDOS = {
    "dockerfile", ".gitignore", ".dockerignore",
}

MAX_TAMANO_ARCHIVO_KB = 150
MAX_TAMANO_PARTE_KB = 180


def formatear_tamano(b: int) -> str:
    for u in ["B", "KB", "MB", "GB"]:
        if b < 1024.0:
            return f"{b:.1f} {u}" if u != "B" else f"{b} B"
        b /= 1024.0
    return f"{b:.1f} TB"


def es_salida_previa(nombre_lower: str, base_lower: str, ext_lower: str) -> bool:
    if nombre_lower == f"{base_lower}{ext_lower}":
        return True
    return nombre_lower.startswith(f"{base_lower}_parte_") and nombre_lower.endswith(ext_lower)


def exportar(ruta_raiz: str = ".", salida: str = "sinapsis_codigo.txt", max_parte_kb: int = MAX_TAMANO_PARTE_KB):
    raiz = Path(ruta_raiz).resolve()
    base = Path(salida).stem
    ext = Path(salida).suffix or ".txt"

    # Limpiar volcados anteriores
    for f in raiz.iterdir():
        if f.is_file() and es_salida_previa(f.name.lower(), base.lower(), ext.lower()):
            f.unlink(missing_ok=True)

    validos, omitidos = [], []
    limite_archivo = MAX_TAMANO_ARCHIVO_KB * 1024

    for dirpath, dirnames, filenames in os.walk(raiz):
        dirnames[:] = sorted(
            d for d in dirnames
            if d not in CARPETAS_IGNORADAS and d.lower() not in CARPETAS_IGNORADAS
        )
        ruta_actual = Path(dirpath)

        for nombre in sorted(filenames):
            nlow = nombre.lower()
            ruta_comp = ruta_actual / nombre
            rel = ruta_comp.relative_to(raiz).as_posix()

            if es_salida_previa(nlow, base.lower(), ext.lower()):
                continue
            if nlow in ARCHIVOS_IGNORADOS or nlow.startswith(".env"):
                omitidos.append((rel, "ignorado"))
                continue

            sufijo = ruta_comp.suffix.lower()
            if sufijo not in EXTENSIONES_PERMITIDAS and nlow not in NOMBRES_SIN_EXT_PERMITIDOS:
                omitidos.append((rel, f"extensión fuera de alcance ({sufijo or 'sin ext'})"))
                continue

            tam = ruta_comp.stat().st_size
            if tam > limite_archivo:
                omitidos.append((rel, f"excede límite ({formatear_tamano(tam)})"))
                continue

            contenido = ruta_comp.read_text(encoding="utf-8", errors="replace")
            validos.append({
                "rel": rel,
                "nombre": nombre,
                "tam": tam,
                "peso": len(contenido.encode("utf-8")) + 260,
                "contenido": contenido,
            })

    # Dividir en partes sin truncar archivos
    limite_parte = max_parte_kb * 1024
    partes, actual, peso = [], [], 0
    for idx, item in enumerate(validos, 1):
        item["idx"] = idx
        if actual and peso + item["peso"] > limite_parte:
            partes.append(actual)
            actual, peso = [item], item["peso"]
        else:
            actual.append(item)
            peso += item["peso"]
    if actual:
        partes.append(actual)

    total = len(validos)
    total_bytes = sum(x["tam"] for x in validos)
    fecha = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    # Índice maestro
    indice = ["ÍNDICE DE CÓDIGO FUENTE — SINAPSIS", "-" * 72]
    for np, lista in enumerate(partes, 1):
        indice.append(f"  [PARTE {np}/{len(partes)}] ({len(lista)} archivos | {formatear_tamano(sum(x['tam'] for x in lista))})")
        for x in lista:
            indice.append(f"    * [{x['idx']}/{total}] {x['rel']} ({formatear_tamano(x['tam'])})")
    indice.append("-" * 72)
    indice_str = "\n".join(indice)

    for np, lista in enumerate(partes, 1):
        nombre_out = f"{base}{ext}" if len(partes) == 1 else f"{base}_parte_{np}{ext}"
        with open(raiz / nombre_out, "w", encoding="utf-8") as out:
            out.write("=" * 72 + "\n")
            out.write(f"SINAPSIS | PARTE {np}/{len(partes)} | {total} archivos ({formatear_tamano(total_bytes)}) | {fecha}\n")
            out.write("=" * 72 + "\n\n")
            if np == 1:
                out.write(indice_str + "\n\n")
            for x in lista:
                out.write("=" * 72 + "\n")
                out.write(f"[{x['idx']}/{total}] {x['rel']} ({formatear_tamano(x['tam'])})\n")
                out.write("=" * 72 + "\n")
                out.write(x["contenido"])
                if not x["contenido"].endswith("\n"):
                    out.write("\n")
                out.write("\n")

    print(f"Listo: {total} archivos de código ({formatear_tamano(total_bytes)}) en {len(partes)} parte(s). Omitidos: {len(omitidos)}.")


if __name__ == "__main__":
    p = argparse.ArgumentParser(description="Exporta solo el código fuente relevante de SINAPSIS.")
    p.add_argument("-o", "--output", default="sinapsis_codigo.txt")
    p.add_argument("-p", "--max-parte-kb", type=int, default=MAX_TAMANO_PARTE_KB)
    a = p.parse_args()
    exportar(salida=a.output, max_parte_kb=a.max_parte_kb)