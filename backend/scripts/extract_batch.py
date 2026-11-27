"""
SINAPSIS — Extracción masiva por lotes con 1 sola sesión Chromium
Ubicación: backend/scripts/extract_batch.py

Invocado por el endpoint POST /api/ingeniero/extraccion-masiva:
    python scripts/extract_batch.py <id_job_uuid>
"""

import os
import sys
import uuid
import time

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, backend_dir)
os.chdir(backend_dir)

from sqlalchemy.orm.attributes import flag_modified
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeout

from app.core.database import SessionLocal, ahora_utc
from app.models import (
    ControlExtraccionLema,
    RegistroLexicoCrudo,
    JobPipeline,
    ESTADO_COMPLETA,
    ESTADO_ERROR,
)
from app.nlp.scraper import parsear_entrada, extraer_texto_auditable

SELECTOR_LEMA = "div#ListaEntradaIndex h4.text-red b"
SELECTOR_FIN = "div#ListaEntradaIndex a h5.text-red"
PAUSA_SEG = 1.0


def _esperar_contenido(page, url: str) -> bool:
    page.goto(url, wait_until="commit", timeout=30000)
    try:
        page.wait_for_selector(SELECTOR_LEMA, state="attached", timeout=15000)
    except PlaywrightTimeout:
        page.reload(wait_until="commit", timeout=30000)
        try:
            page.wait_for_selector(SELECTOR_LEMA, state="attached", timeout=15000)
        except PlaywrightTimeout:
            return False
    try:
        page.wait_for_selector(SELECTOR_FIN, state="attached", timeout=4000)
    except PlaywrightTimeout:
        pass
    page.wait_for_timeout(250)
    return True


def run_batch(job_id_str: str):
    job_uuid = uuid.UUID(job_id_str)

    with SessionLocal() as db:
        job = db.query(JobPipeline).filter_by(id_job=job_uuid).first()
        if not job:
            print(f"Job {job_id_str} no encontrado.", file=sys.stderr)
            sys.exit(1)

        ids = (job.detalle or {}).get("ids", [])
        job.estado = "procesando"
        job.total = len(ids)
        job.actual = 0
        job.exitosos = 0
        job.fallidos = 0
        job.mensaje = "Abriendo navegador y estableciendo sesión con DiPerú..."
        job.actualizado_en = ahora_utc()
        db.commit()

    errores = []
    exitosos = 0
    fallidos = 0

    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(
                headless=True,
                args=["--disable-blink-features=AutomationControlled"],
            )
            context = browser.new_context(
                user_agent=(
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/120.0.0.0 Safari/537.36"
                ),
                locale="es-PE",
                viewport={"width": 1280, "height": 800},
            )
            page = context.new_page()

            # Sesión inicial única para resolver el WAF
            try:
                page.goto("https://diperu.apl.org.pe", wait_until="networkidle", timeout=30000)
                time.sleep(2.5)
            except Exception:
                pass

            with SessionLocal() as db:
                job = db.query(JobPipeline).filter_by(id_job=job_uuid).first()

                for idx, id_entrada in enumerate(ids, 1):
                    url = f"https://diperu.apl.org.pe/buscar?entrada={id_entrada}"
                    control = (
                        db.query(ControlExtraccionLema)
                        .filter_by(url_origen=url)
                        .first()
                    )
                    lema = control.lema if control else f"entrada_{id_entrada}"

                    job.actual = idx
                    job.item_actual = f"{lema} (#{id_entrada})"
                    job.mensaje = f"[{idx}/{len(ids)}] Extrayendo {lema} (ID {id_entrada})..."
                    job.actualizado_en = ahora_utc()
                    db.commit()

                    try:
                        if not _esperar_contenido(page, url):
                            raise RuntimeError("Selector de lema ausente (posible bloqueo WAF o entrada vacía)")

                        html = page.content()
                        rlc = parsear_entrada(html, id_entrada, lema)
                        texto = extraer_texto_auditable(html)

                        if not rlc or (not rlc.get("acepciones") and not rlc.get("sublemas")):
                            raise RuntimeError("No se encontraron acepciones parseables en el HTML")

                        if not control:
                            control = ControlExtraccionLema(
                                id_lema=uuid.uuid4(),
                                lema=rlc.get("lema") or lema,
                                url_origen=url,
                            )
                            db.add(control)
                            db.flush()

                        rlc_db = (
                            db.query(RegistroLexicoCrudo)
                            .filter_by(id_lema=control.id_lema)
                            .first()
                        )
                        if not rlc_db:
                            rlc_db = RegistroLexicoCrudo(
                                id_rlc=uuid.uuid4(),
                                id_lema=control.id_lema,
                                id_entrada=id_entrada,
                                lema=control.lema,
                                estado_limpieza="crudo",
                                estado_procesamiento="pendiente",
                            )
                            db.add(rlc_db)
                        else:
                            rlc_db.estado_procesamiento = "pendiente"

                        rlc_db.id_entrada = id_entrada
                        rlc_db.lema = control.lema
                        rlc_db.num_acepciones = rlc["conteo"]["acepciones_lema"]
                        rlc_db.rlc_json = rlc
                        rlc_db.texto_plano = texto
                        rlc_db.fecha_extraccion = ahora_utc()
                        flag_modified(rlc_db, "rlc_json")

                        control.estado_seci = ESTADO_COMPLETA
                        control.ultima_actualizacion = ahora_utc()

                        exitosos += 1
                        job.exitosos = exitosos
                        job.mensaje = f"[{idx}/{len(ids)}] {control.lema} extraído ({rlc_db.num_acepciones} acep.)."
                        job.actualizado_en = ahora_utc()
                        db.commit()

                    except Exception as e:
                        db.rollback()
                        fallidos += 1
                        err_msg = f"ID {id_entrada} ({lema}): {str(e)}"
                        errores.append(err_msg)

                        # Re-obtener objetos tras rollback
                        job = db.query(JobPipeline).filter_by(id_job=job_uuid).first()
                        control = db.query(ControlExtraccionLema).filter_by(url_origen=url).first()
                        if control:
                            control.reintentos_fallidos = (control.reintentos_fallidos or 0) + 1
                            if control.reintentos_fallidos >= 3:
                                control.estado_seci = ESTADO_ERROR
                            control.ultima_actualizacion = ahora_utc()

                        job.actual = idx
                        job.fallidos = fallidos
                        job.mensaje = f"[{idx}/{len(ids)}] Error en {lema}: {str(e)[:120]}"
                        detalle = dict(job.detalle or {})
                        detalle["errores"] = errores[-50:]
                        job.detalle = detalle
                        flag_modified(job, "detalle")
                        job.actualizado_en = ahora_utc()
                        db.commit()

                    time.sleep(PAUSA_SEG)

                job.estado = "completado"
                job.mensaje = f"Extracción finalizada: {exitosos} exitosos, {fallidos} fallidos."
                job.actualizado_en = ahora_utc()
                db.commit()

            browser.close()

    except Exception as fatal:
        with SessionLocal() as db:
            job = db.query(JobPipeline).filter_by(id_job=job_uuid).first()
            if job:
                job.estado = "error"
                job.mensaje = f"Error fatal en extracción masiva: {str(fatal)}"
                job.actualizado_en = ahora_utc()
                db.commit()
        sys.exit(1)


if __name__ == "__main__":
    run_batch(sys.argv[1])