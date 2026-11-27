"""
====================================================================
SINAPSIS — Servicio de Métricas Pre-Test / Post-Test (Fase 5)
Ubicación: backend/app/services/metricas.py
====================================================================
Calcula los indicadores CPW y PRS comparando `linea_base_mcr` (Pre-Test)
contra las UCEs aceptadas por el Lexicógrafo (Post-Test), y exporta
las Fichas de Registro N.º 1 y N.º 2 en CSV + Reporte Markdown.
====================================================================
"""

import csv
import io
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any, Dict, List, Tuple

from sqlalchemy.orm import Session

from app.models import (
    LineaBaseMCR,
    UnidadConocimientoExplicito,
    ReferenciaMCR,
)

PRS_REFERENCIA_ESPANOL = 17.11  # Medición basal en MCR 3.0 (reporte_baseline.md)


def _contar_marcas_semanticas(marcas: Any) -> int:
    """Cuenta marcas de dominio, diatópicas y registro (relaciones domain/region/usage en MCR)."""
    if not isinstance(marcas, dict):
        return 0
    total = 0
    for clave in ("dominio", "diatopica", "registro"):
        vals = marcas.get(clave)
        if isinstance(vals, list):
            total += len(vals)
    return total


def _relaciones_aportadas_uce(uce: UnidadConocimientoExplicito, grados_mcr: Dict[str, int]) -> int:
    """
    Calcula las relaciones semánticas aportadas por una UCE aceptada:
      - near_synonym (variante en synset existente): hereda el grado relacional del synset MCR.
      - has_hyperonym (nuevo synset): 2 enlaces estructurales (has_hyperonym + has_hyponym)
        + 1 relación region_term (Perú) + marcas de dominio/registro/diatópica.
      - variante_existente: 0 (ya estaba contabilizada en el Pre-Test).
    """
    rel = uce.relaciones if isinstance(uce.relaciones, dict) else {}
    tipo_rel = rel.get("relacion_propuesta")

    if tipo_rel == "variante_existente" or uce.tipo_peruanismo == "ya_presente":
        return 0

    if tipo_rel == "near_synonym":
        grado = grados_mcr.get(uce.offset_mcr or "", 0)
        return max(grado, 2)

    # Por defecto: has_hyperonym (nuevo synset bajo hiperónimo en MCR)
    # 2 (hiperonimia bidireccional) + 1 (región Perú) + marcas clasificadas
    return 3 + _contar_marcas_semanticas(uce.marcas)


def _evaluar_censo(db: Session) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    """Cruza los 7,954 lemas de línea base con las UCEs aceptadas y pendientes."""
    base_rows = (
        db.query(LineaBaseMCR)
        .order_by(LineaBaseMCR.id_peruanismo.asc())
        .all()
    )

    if not base_rows:
        return [], {
            "linea_base_cargada": False,
            "mensaje": "Ejecuta scripts.poblar_linea_base para cargar el snapshot Pre-Test.",
        }

    # Cargar UCEs aceptadas (Post-Test oficial)
    uces_aceptadas = (
        db.query(UnidadConocimientoExplicito)
        .filter(UnidadConocimientoExplicito.estado_revision == "aceptado")
        .all()
    )

    # Cargar grados relacionales de los offsets referenciados
    offsets_usados = {u.offset_mcr for u in uces_aceptadas if u.offset_mcr}
    grados_mcr = {}
    if offsets_usados:
        for off, nrel in (
            db.query(ReferenciaMCR.offset, ReferenciaMCR.num_relaciones)
            .filter(ReferenciaMCR.offset.in_(list(offsets_usados)))
            .all()
        ):
            grados_mcr[off] = nrel or 0

    # Agrupar UCEs aceptadas por lema normalizado
    aceptadas_por_lema = defaultdict(list)
    desglose_aceptadas = {
        "total": len(uces_aceptadas),
        "por_tipo": defaultdict(int),
        "por_relacion": defaultdict(int),
    }

    for u in uces_aceptadas:
        clave = (u.lema or "").strip().lower()
        rel_tipo = (u.relaciones or {}).get("relacion_propuesta") or "has_hyperonym"
        if u.tipo_peruanismo == "ya_presente" or rel_tipo == "variante_existente":
            continue
        aporte = _relaciones_aportadas_uce(u, grados_mcr)
        aceptadas_por_lema[clave].append({
            "id_uce": str(u.id_uce),
            "tipo": u.tipo_peruanismo,
            "relacion": rel_tipo,
            "offset": u.offset_mcr,
            "relaciones_aportadas": aporte,
        })
        desglose_aceptadas["por_tipo"][u.tipo_peruanismo] += 1
        desglose_aceptadas["por_relacion"][rel_tipo] += 1

    # Lemas potencialmente integrables (aceptados + pendientes enganchados)
    lemas_potenciales = set(aceptadas_por_lema.keys())
    for (lema_p,) in (
        db.query(UnidadConocimientoExplicito.lema)
        .filter(
            UnidadConocimientoExplicito.estado_revision.in_(["pendiente", "observado"]),
            UnidadConocimientoExplicito.tipo_peruanismo != "ya_presente",
            UnidadConocimientoExplicito.offset_mcr.isnot(None),
        )
        .distinct()
        .all()
    ):
        if lema_p:
            lemas_potenciales.add(lema_p.strip().lower())

    # Evaluar fila por fila del censo (7,954 entradas)
    # Nota: si un lema tiene homónimos en DiPerú, el aporte se aplica una sola vez por lema
    # para evitar inflar artificialmente el conteo de relaciones en homógrafos.
    lemas_aplicados = set()
    detalle = []

    n_total = len(base_rows)
    pre_presentes = 0
    post_presentes = 0
    potencial_presentes = 0
    nuevos_integrados = 0
    enriquecidos_t1 = 0

    suma_rel_pre = 0
    suma_rel_post = 0
    suma_rel_nuevos = 0

    for row in base_rows:
        lema_norm = row.lema.strip().lower()
        pre_flag = 1 if row.en_mcr_pre else 0
        pre_presentes += pre_flag
        suma_rel_pre += row.relaciones_pre

        aportes = aceptadas_por_lema.get(lema_norm, [])
        primera_vez_lema = lema_norm not in lemas_aplicados
        if aportes and primera_vez_lema:
            lemas_aplicados.add(lema_norm)
            rel_nuevas = sum(a["relaciones_aportadas"] for a in aportes)
            n_uces_acep = len(aportes)
        else:
            rel_nuevas = 0
            n_uces_acep = 0

        tiene_integracion = len(aportes) > 0
        post_flag = 1 if (pre_flag == 1 or tiene_integracion) else 0
        post_presentes += post_flag

        if pre_flag == 1 or lema_norm in lemas_potenciales:
            potencial_presentes += 1

        if pre_flag == 0 and tiene_integracion:
            estado_cpw = "Integrado (Nuevo)"
            estado_prs = "Integrado"
            nuevos_integrados += 1
        elif pre_flag == 1 and tiene_integracion:
            estado_cpw = "Enriquecido"
            estado_prs = "Enriquecido"
            enriquecidos_t1 += 1
        elif pre_flag == 1:
            estado_cpw = "Presente"
            estado_prs = "Presente"
        else:
            estado_cpw = "Ausente"
            estado_prs = "Ausente"

        rel_post = row.relaciones_pre + rel_nuevas
        suma_rel_post += rel_post
        if pre_flag == 0 and rel_nuevas > 0:
            suma_rel_nuevos += rel_nuevas

        detalle.append({
            "id_peruanismo": row.id_peruanismo,
            "lema": row.lema,
            "en_mcr_pre": pre_flag,
            "en_mcr_post": post_flag,
            "estado_cpw": estado_cpw,
            "rel_pre": row.relaciones_pre,
            "rel_post": rel_post,
            "variacion_rel": rel_nuevas,
            "estado_prs": estado_prs,
            "uces_aceptadas": n_uces_acep,
        })

    # Cálculo de indicadores
    cpw_pre = round((pre_presentes / n_total) * 100, 2) if n_total else 0.0
    cpw_post = round((post_presentes / n_total) * 100, 2) if n_total else 0.0
    cpw_potencial = round((potencial_presentes / n_total) * 100, 2) if n_total else 0.0

    prs_pre_pres = round(suma_rel_pre / pre_presentes, 2) if pre_presentes else 0.0
    prs_post_pres = round(suma_rel_post / post_presentes, 2) if post_presentes else 0.0
    prs_pre_censal = round(suma_rel_pre / n_total, 2) if n_total else 0.0
    prs_post_censal = round(suma_rel_post / n_total, 2) if n_total else 0.0
    prs_nuevos = round(suma_rel_nuevos / nuevos_integrados, 2) if nuevos_integrados else 0.0

    resumen = {
        "linea_base_cargada": True,
        "fecha_calculo": datetime.now(timezone.utc).isoformat(),
        "universo_censal": n_total,
        "cpw": {
            "pre_presentes": pre_presentes,
            "pre_ausentes": n_total - pre_presentes,
            "post_presentes": post_presentes,
            "post_ausentes": n_total - post_presentes,
            "nuevos_integrados": nuevos_integrados,
            "enriquecidos_t1": enriquecidos_t1,
            "cpw_pre": cpw_pre,
            "cpw_post": cpw_post,
            "delta_cpw_pp": round(cpw_post - cpw_pre, 2),
            "cpw_potencial": cpw_potencial,
            "potencial_presentes": potencial_presentes,
        },
        "prs": {
            "suma_relaciones_pre": suma_rel_pre,
            "suma_relaciones_post": suma_rel_post,
            "delta_relaciones": suma_rel_post - suma_rel_pre,
            "prs_pre_presentes": prs_pre_pres,
            "prs_post_presentes": prs_post_pres,
            "delta_prs_presentes": round(prs_post_pres - prs_pre_pres, 2),
            "prs_pre_censal": prs_pre_censal,
            "prs_post_censal": prs_post_censal,
            "delta_prs_censal": round(prs_post_censal - prs_pre_censal, 2),
            "prs_nuevos_integrados": prs_nuevos,
            "prs_referencia_espanol": PRS_REFERENCIA_ESPANOL,
        },
        "aceptadas": {
            "total": desglose_aceptadas["total"],
            "por_tipo": dict(desglose_aceptadas["por_tipo"]),
            "por_relacion": dict(desglose_aceptadas["por_relacion"]),
        },
    }
    return detalle, resumen


def calcular_metricas_post_test(db: Session) -> Dict[str, Any]:
    _, resumen = _evaluar_censo(db)
    return resumen


def generar_csv_ficha_cpw(db: Session) -> str:
    """Genera Ficha de Registro N.º 1 (CPW Pre-Test vs Post-Test)."""
    detalle, res = _evaluar_censo(db)
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["ID_PERUANISMO", "LEMA", "CONTEO_PRE_TEST", "CONTEO_POST_TEST", "ESTADO_NODO"])

    for d in detalle:
        writer.writerow([
            d["id_peruanismo"],
            d["lema"],
            d["en_mcr_pre"],
            d["en_mcr_post"],
            d["estado_cpw"],
        ])

    if res.get("linea_base_cargada"):
        cpw = res["cpw"]
        writer.writerow([])
        writer.writerow([
            "TOTALES",
            f"Muestra censal: {res['universo_censal']}",
            f"Sigma_pre={cpw['pre_presentes']}",
            f"Sigma_post={cpw['post_presentes']}",
            f"Nuevos={cpw['nuevos_integrados']} | Enriquecidos={cpw['enriquecidos_t1']}",
        ])
        writer.writerow([
            "METRICA",
            "CPW = (Sigma / N) * 100",
            f"CPW_pre={cpw['cpw_pre']}%",
            f"CPW_post={cpw['cpw_post']}%",
            f"Delta=+{cpw['delta_cpw_pp']} pp",
        ])

    return buf.getvalue()


def generar_csv_ficha_prs(db: Session) -> str:
    """Genera Ficha de Registro N.º 2 (PRS Pre-Test vs Post-Test)."""
    detalle, res = _evaluar_censo(db)
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow([
        "ID_PERUANISMO", "LEMA", "CONTEO_PRE_TEST",
        "CONTEO_POST_TEST", "VARIACION", "ESTADO_NODO",
    ])

    for d in detalle:
        var_str = f"+{d['variacion_rel']}" if d["variacion_rel"] > 0 else "0"
        writer.writerow([
            d["id_peruanismo"],
            d["lema"],
            d["rel_pre"],
            d["rel_post"],
            var_str,
            d["estado_prs"],
        ])

    if res.get("linea_base_cargada"):
        prs = res["prs"]
        cpw = res["cpw"]
        writer.writerow([])
        writer.writerow([
            "TOTALES",
            f"Presentes Pre={cpw['pre_presentes']} | Post={cpw['post_presentes']}",
            f"Sigma_pre={prs['suma_relaciones_pre']}",
            f"Sigma_post={prs['suma_relaciones_post']}",
            f"Delta=+{prs['delta_relaciones']}",
            "",
        ])
        writer.writerow([
            "METRICA_PRESENTES",
            "PRS = Sigma_relaciones / N_presentes",
            f"PRS_pre={prs['prs_pre_presentes']}",
            f"PRS_post={prs['prs_post_presentes']}",
            f"Delta={prs['delta_prs_presentes']:+.2f}",
            f"PRS_nuevos={prs['prs_nuevos_integrados']}",
        ])
        writer.writerow([
            "METRICA_CENSAL",
            f"PRS_censal = Sigma_relaciones / {res['universo_censal']}",
            f"PRS_censal_pre={prs['prs_pre_censal']}",
            f"PRS_censal_post={prs['prs_post_censal']}",
            f"Delta={prs['delta_prs_censal']:+.2f}",
            "",
        ])

    return buf.getvalue()


def generar_reporte_markdown_post_test(db: Session) -> str:
    """Genera el reporte consolidado Pre-Test vs Post-Test en Markdown para anexo de tesis."""
    _, res = _evaluar_censo(db)
    if not res.get("linea_base_cargada"):
        return "# Reporte Post-Test — SINAPSIS\n\nLínea base no cargada.\n"

    cpw = res["cpw"]
    prs = res["prs"]
    acep = res["aceptadas"]

    return f"""# Reporte Comparativo Pre-Test vs. Post-Test — SINAPSIS

**Fecha de generación:** {res['fecha_calculo']}
**Universo censal evaluado:** {res['universo_censal']:,} entradas (DiPerú)
**Fuente de referencia:** MCR 3.0 release 2016 (WordNet español)

## 1. Cobertura de Peruanismos en WordNet (CPW)

| Métrica | Pre-Test | Post-Test (Validado) | Variación (Δ) |
|---|---:|---:|---:|
| Peruanismos cubiertos en WordNet | {cpw['pre_presentes']:,} | {cpw['post_presentes']:,} | +{cpw['nuevos_integrados']:,} |
| Peruanismos ausentes (brecha) | {cpw['pre_ausentes']:,} | {cpw['post_ausentes']:,} | -{cpw['nuevos_integrados']:,} |
| **CPW (%)** | **{cpw['cpw_pre']:.2f}%** | **{cpw['cpw_post']:.2f}%** | **+{cpw['delta_cpw_pp']:.2f} pp** |
| Lemas existentes enriquecidos (Tipo 1) | — | {cpw['enriquecidos_t1']:,} | +{cpw['enriquecidos_t1']:,} |
| CPW Potencial (incl. enganchados pendientes) | — | {cpw['cpw_potencial']:.2f}% | +{cpw['cpw_potencial'] - cpw['cpw_pre']:.2f} pp |

## 2. Densidad Relacional Semántica (PRS)

| Indicador | Pre-Test | Post-Test (Validado) | Variación (Δ) |
|---|---:|---:|---:|
| Total de relaciones semánticas (Σ) | {prs['suma_relaciones_pre']:,} | {prs['suma_relaciones_post']:,} | +{prs['delta_relaciones']:,} |
| PRS censal (Σ / {res['universo_censal']:,}) | {prs['prs_pre_censal']:.2f} | {prs['prs_post_censal']:.2f} | {prs['delta_prs_censal']:+.2f} |
| PRS sobre nodos presentes | {prs['prs_pre_presentes']:.2f} | {prs['prs_post_presentes']:.2f} | {prs['delta_prs_presentes']:+.2f} |
| PRS de peruanismos recién integrados | 0.00 | {prs['prs_nuevos_integrados']:.2f} | +{prs['prs_nuevos_integrados']:.2f} |
| PRS español estándar (referencia MCR) | {prs['prs_referencia_espanol']:.2f} | {prs['prs_referencia_espanol']:.2f} | — |

## 3. Desglose de Curaduría Lexicográfica (UCEs Aceptadas)

- **Total de acepciones aceptadas:** {acep['total']:,}
- **Por tipo de peruanismo:** {acep['por_tipo']}
- **Por mecanismo de integración:** {acep['por_relacion']}
"""