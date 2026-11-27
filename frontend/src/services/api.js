const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

async function parseError(res, fallback) {
  try {
    const data = await res.json();
    if (typeof data.detail === "string") return data.detail;
    if (Array.isArray(data.detail)) {
      return data.detail.map((e) => e.msg || JSON.stringify(e)).join("; ");
    }
  } catch {
    const txt = await res.text().catch(() => "");
    if (txt) return txt;
  }
  return fallback || `Error HTTP ${res.status}`;
}

async function fetchJSON(path, params = {}) {
  const url = new URL(path, API_URL);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, value);
    }
  });

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(await parseError(res, `API ${res.status}: ${res.statusText}`));
  }
  return res.json();
}

async function sendJSON(path, method, body) {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    throw new Error(await parseError(res));
  }
  return res.json();
}

// ── Generales / Explorador / Pipeline ────────────────────────────────────────
export function fetchStats() {
  return fetchJSON("/api/stats");
}

export function fetchPeruanismos({ tipo, pos, q, page = 1, size = 20 } = {}) {
  return fetchJSON("/api/peruanismos", { tipo, pos, q, page, size });
}

export function fetchPeruanismo(id) {
  return fetchJSON(`/api/peruanismos/${id}`);
}

export function searchPeruanismos(q) {
  return fetchJSON("/api/search", { q });
}

export function fetchEmbudo() {
  return fetchJSON("/api/embudo");
}

export function fetchPipelineStatus() {
  return fetchJSON("/api/pipeline/status");
}

export function fetchIncidencias({ fase, tipo, revision, page = 1, size = 20 } = {}) {
  return fetchJSON("/api/incidencias", { fase, tipo, revision, page, size });
}

export function fetchAuditoria({ origen, fase, q, revision, page = 1, size = 20 } = {}) {
  return fetchJSON("/api/auditoria", { origen, fase, q, revision, page, size });
}

export function getAuditoriaExportUrl({ origen, fase, q, revision } = {}) {
  const url = new URL("/api/auditoria/exportar", API_URL);
  Object.entries({ origen, fase, q, revision }).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
  });
  return url.toString();
}

// ── Métricas Pre-Test vs. Post-Test (Fase 5) ─────────────────────────────────
export function fetchMetricasPostTest() {
  return fetchJSON("/api/metricas/post-test");
}

export function getExportCpwUrl() {
  return new URL("/api/metricas/exportar/cpw", API_URL).toString();
}

export function getExportPrsUrl() {
  return new URL("/api/metricas/exportar/prs", API_URL).toString();
}

export function getExportReporteUrl() {
  return new URL("/api/metricas/exportar/reporte", API_URL).toString();
}

// ── Ingeniero de Datos ───────────────────────────────────────────────────────
export function fetchIngenieroConfig() {
  return fetchJSON("/api/ingeniero/config");
}

export function updateIngenieroConfig(url_origen) {
  return sendJSON("/api/ingeniero/config", "PUT", { url_origen });
}

export function fetchIngenieroPendientes(params = {}) {
  const { page = 1, size = 20, letra, id_exacto, id_desde, id_hasta, orden } = params;
  return fetchJSON("/api/ingeniero/pendientes", {
    page, size, letra, id_exacto, id_desde, id_hasta, orden,
  });
}

export function fetchIngenieroExtraidos(params = {}) {
  const {
    page = 1, size = 20, letra, id_exacto, id_desde, id_hasta,
    acepciones_min, acepciones_max, orden,
  } = params;
  return fetchJSON("/api/ingeniero/extraidos", {
    page, size, letra, id_exacto, id_desde, id_hasta,
    acepciones_min, acepciones_max, orden,
  });
}

export function extraerDiPeru(id_entrada, lema) {
  return sendJSON("/api/ingeniero/extraer", "POST", { id_entrada, lema });
}

export function fetchHtmlCrudo(id_entrada) {
  return fetchJSON(`/api/ingeniero/html/${id_entrada}`);
}

export function iniciarExtraccionMasiva(rangos) {
  return sendJSON("/api/ingeniero/extraccion-masiva", "POST", { rangos });
}

export function fetchProgresoExtraccion() {
  return fetchJSON("/api/ingeniero/progreso-extraccion");
}

export function limpiarRlc(id_rlc, rlc_json, motivo) {
  return sendJSON(`/api/ingeniero/rlc/${id_rlc}/limpiar`, "PATCH", { rlc_json, motivo });
}

// ── Analista Semántico ───────────────────────────────────────────────────────
export function fetchAnalistaPendientes(params = {}) {
  const {
    page = 1, size = 20, lema, acepciones,
    estado_procesamiento = "pendiente", fecha_desde, fecha_hasta,
  } = params;
  return fetchJSON("/api/analista/pendientes", {
    page, size, lema, acepciones, estado_procesamiento, fecha_desde, fecha_hasta,
  });
}

export function fetchAnalistaProcesados(params = {}) {
  const { page = 1, size = 20, lema, pos_mcr, tipo_peruanismo } = params;
  return fetchJSON("/api/analista/procesados", { page, size, lema, pos_mcr, tipo_peruanismo });
}

export function procesarPipeline(id_rlc) {
  return sendJSON(`/api/analista/procesar/${id_rlc}`, "POST");
}

export function procesarLoteAnalista({ ids_rlc, limite = 25 } = {}) {
  const payload = ids_rlc && ids_rlc.length > 0 ? { ids_rlc } : { limite };
  return sendJSON("/api/analista/procesar-lote", "POST", payload);
}

export function resolverRemisionesPendientes() {
  return sendJSON("/api/analista/resolver-remisiones", "POST");
}

export function engancharPendientes({ limite = 50, forzar = false } = {}) {
  return sendJSON("/api/analista/enganchar-pendientes", "POST", { limite, forzar });
}

export function fetchProgresoProcesamiento() {
  return fetchJSON("/api/analista/progreso-procesamiento");
}

export function descartarMasivo(ids_uce) {
  return sendJSON("/api/analista/descartar-masivo", "POST", { ids_uce });
}

// ── Lexicógrafo ──────────────────────────────────────────────────────────────
export function fetchLexicografoPropuestas(arg1, estado = "pendiente", page = 1, size = 20) {
  if (arg1 && typeof arg1 === "object") {
    const {
      tipo,
      estado: est = "pendiente",
      q,
      incluir_ya_presente,
      page: p = 1,
      size: s = 20,
    } = arg1;
    return fetchJSON("/api/lexicografo/propuestas", {
      tipo, estado: est, q, incluir_ya_presente, page: p, size: s,
    });
  }
  return fetchJSON("/api/lexicografo/propuestas", { tipo: arg1, estado, page, size });
}

export function fetchPropuestaDetalle(id_uce) {
  return fetchJSON(`/api/lexicografo/propuesta/${id_uce}`);
}

export function buscarSynsetsMCR(q, pos) {
  return fetchJSON("/api/lexicografo/buscar-synsets", { q, pos });
}

export function revisarPropuesta(
  id_uce,
  decision,
  notas = "",
  nuevo_offset = null,
  tipo_relacion = null
) {
  return sendJSON(`/api/lexicografo/revisar/${id_uce}`, "POST", {
    decision,
    notas,
    nuevo_offset,
    tipo_relacion,
  });
}