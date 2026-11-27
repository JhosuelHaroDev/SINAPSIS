"use client";

import { useState, useEffect, useCallback } from "react";
import {
  RefreshCw,
  SlidersHorizontal,
  Download,
  Code,
  FileJson,
  Play,
  Settings,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Edit3,
  CheckCircle2,
  AlertCircle,
  Loader2,
} from "lucide-react";
import {
  fetchIngenieroConfig,
  updateIngenieroConfig,
  fetchIngenieroPendientes,
  fetchIngenieroExtraidos,
  extraerDiPeru,
  fetchHtmlCrudo,
  iniciarExtraccionMasiva,
  fetchProgresoExtraccion,
  limpiarRlc,
} from "@/services/api";
import { Toast } from "@/components/ui/Toast";
import { Modal } from "@/components/ui/Modal";
import { Pagination } from "@/components/ui/Pagination";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";

const PAGE_SIZE = 20;

const ESTADO_PROC_BADGE = {
  pendiente: {
    label: "En cola Analista",
    cls: "bg-sky-500/10 text-sky-300 border-sky-500/25",
  },
  procesado: {
    label: "Procesado",
    cls: "bg-emerald-500/10 text-emerald-300 border-emerald-500/25",
  },
  remision_pendiente: {
    label: "Remisión pend.",
    cls: "bg-amber-500/10 text-amber-300 border-amber-500/25",
  },
  sin_uce: {
    label: "Sin UCE",
    cls: "bg-niebla/10 text-niebla/55 border-niebla/20",
  },
};

export default function IngenieroPage() {
  const [activeTab, setActiveTab] = useState("pendientes");
  const [toast, setToast] = useState({ message: "", type: "info" });

  // ── Pendientes ────────────────────────────────────────────────────────────
  const [pendientes, setPendientes] = useState([]);
  const [totalPendientes, setTotalPendientes] = useState(0);
  const [loadingP, setLoadingP] = useState(true);
  const [extractingId, setExtractingId] = useState(null);
  const [showFiltersP, setShowFiltersP] = useState(true);

  const [letraP, setLetraP] = useState("");
  const [idExactoP, setIdExactoP] = useState("");
  const [idDesdeP, setIdDesdeP] = useState("");
  const [idHastaP, setIdHastaP] = useState("");
  const [ordenP, setOrdenP] = useState("asc");
  const [pageP, setPageP] = useState(1);

  // Extracción masiva
  const [rangoExtraccion, setRangoExtraccion] = useState("");
  const [masivaProgress, setMasivaProgress] = useState(null);

  // ── Extraídos ─────────────────────────────────────────────────────────────
  const [extraidos, setExtraidos] = useState([]);
  const [totalExtraidos, setTotalExtraidos] = useState(0);
  const [loadingE, setLoadingE] = useState(true);
  const [showFiltersE, setShowFiltersE] = useState(false);

  const [letraE, setLetraE] = useState("");
  const [idExactoE, setIdExactoE] = useState("");
  const [idDesdeE, setIdDesdeE] = useState("");
  const [idHastaE, setIdHastaE] = useState("");
  const [minAcepciones, setMinAcepciones] = useState("");
  const [maxAcepciones, setMaxAcepciones] = useState("");
  const [ordenE, setOrdenE] = useState("asc");
  const [pageE, setPageE] = useState(1);

  // ── Modales ───────────────────────────────────────────────────────────────
  const [htmlModal, setHtmlModal] = useState({ open: false, id: null, html: "" });
  const [loadingHtmlId, setLoadingHtmlId] = useState(null);

  const [rlcModal, setRlcModal] = useState({
    open: false,
    id_rlc: null,
    lema: "",
    content: null,
  });
  const [isEditingRlc, setIsEditingRlc] = useState(false);
  const [editableRlcJson, setEditableRlcJson] = useState("");
  const [editMotivo, setEditMotivo] = useState("");
  const [jsonError, setJsonError] = useState("");
  const [savingLimpio, setSavingLimpio] = useState(false);

  // ── Configuración fuente ──────────────────────────────────────────────────
  const [showConfig, setShowConfig] = useState(false);
  const [urlConfig, setUrlConfig] = useState("https://diperu.apl.org.pe/buscar?entrada=");
  const [configStatus, setConfigStatus] = useState("Pendiente");
  const [savingConfig, setSavingConfig] = useState(false);

  const notify = (message, type = "info") => setToast({ message, type });

  const loadPendientes = useCallback(async (overridePage) => {
    setLoadingP(true);
    try {
      const data = await fetchIngenieroPendientes({
        page: overridePage ?? pageP,
        size: PAGE_SIZE,
        letra: letraP || undefined,
        id_exacto: idExactoP || undefined,
        id_desde: idDesdeP || undefined,
        id_hasta: idHastaP || undefined,
        orden: ordenP,
      });
      setPendientes(data.items || []);
      setTotalPendientes(data.total || 0);
    } catch (err) {
      notify(`Error al cargar pendientes: ${err.message}`, "error");
    } finally {
      setLoadingP(false);
    }
  }, [pageP, letraP, idExactoP, idDesdeP, idHastaP, ordenP]);

  const loadExtraidos = useCallback(async (overridePage) => {
    setLoadingE(true);
    try {
      const data = await fetchIngenieroExtraidos({
        page: overridePage ?? pageE,
        size: PAGE_SIZE,
        letra: letraE || undefined,
        id_exacto: idExactoE || undefined,
        id_desde: idDesdeE || undefined,
        id_hasta: idHastaE || undefined,
        acepciones_min: minAcepciones || undefined,
        acepciones_max: maxAcepciones || undefined,
        orden: ordenE,
      });
      setExtraidos(data.items || []);
      setTotalExtraidos(data.total || 0);
    } catch (err) {
      notify(`Error al cargar extraídos: ${err.message}`, "error");
    } finally {
      setLoadingE(false);
    }
  }, [pageE, letraE, idExactoE, idDesdeE, idHastaE, minAcepciones, maxAcepciones, ordenE]);

  // Cargar configuración + comprobar si existe job activo al montar
  useEffect(() => {
    fetchIngenieroConfig()
      .then((data) => {
        if (data.url_origen) setUrlConfig(data.url_origen);
        if (data.estado_conexion) setConfigStatus(data.estado_conexion);
      })
      .catch(() => {});

    fetchProgresoExtraccion()
      .then((progreso) => {
        if (progreso && progreso.estado === "Procesando") {
          setMasivaProgress(progreso);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (activeTab === "pendientes") loadPendientes();
    else loadExtraidos();
  }, [activeTab, pageP, ordenP, pageE, ordenE]); // eslint-disable-line react-hooks/exhaustive-deps

  // Polling de extracción masiva
  useEffect(() => {
    if (!masivaProgress || masivaProgress.estado !== "Procesando") return;
    const interval = setInterval(async () => {
      try {
        const prog = await fetchProgresoExtraccion();
        setMasivaProgress(prog);
        if (prog.estado === "Completado" || prog.estado === "Error") {
          clearInterval(interval);
          if (prog.estado === "Completado") {
            notify(prog.mensaje || "Extracción masiva finalizada.", "success");
            loadPendientes();
            loadExtraidos();
          } else {
            notify(prog.mensaje || "Error en extracción masiva.", "error");
          }
        }
      } catch {
        // Reintenta en el próximo ciclo
      }
    }, 1500);
    return () => clearInterval(interval);
  }, [masivaProgress?.estado]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleSaveConfig = async () => {
    setSavingConfig(true);
    try {
      const data = await updateIngenieroConfig(urlConfig);
      setConfigStatus(data.estado_conexion);
      notify("Conexión con DiPerú validada y guardada.", "success");
    } catch (err) {
      setConfigStatus("Fallo");
      notify(`Fallo de conexión: ${err.message}`, "error");
    } finally {
      setSavingConfig(false);
    }
  };

  const handleExtract = async (id, lema) => {
    setExtractingId(id);
    try {
      const res = await extraerDiPeru(parseInt(id, 10), lema || "Custom");
      notify(
        `Extraído "${res.lema}" (${res.rlc_json?.conteo?.acepciones_lema ?? 0} acepciones).`,
        "success"
      );
      loadPendientes();
    } catch (err) {
      notify(`Error extrayendo ID ${id}: ${err.message}`, "error");
    } finally {
      setExtractingId(null);
    }
  };

  const handleExtraccionMasiva = async () => {
    try {
      const resp = await iniciarExtraccionMasiva(rangoExtraccion);
      setMasivaProgress({
        estado: "Procesando",
        actual: 0,
        total: resp.total_estimado || 1,
        exitosos: 0,
        fallidos: 0,
        mensaje: "Iniciando sesión de Chromium...",
      });
      notify(`Lote iniciado (${resp.total_estimado} IDs).`, "info");
    } catch (err) {
      notify(err.message, "error");
    }
  };

  const handleViewHtml = async (id) => {
    setLoadingHtmlId(id);
    try {
      const res = await fetchHtmlCrudo(parseInt(id, 10));
      setHtmlModal({ open: true, id, html: res.html });
    } catch (err) {
      notify(`Error obteniendo HTML: ${err.message}`, "error");
    } finally {
      setLoadingHtmlId(null);
    }
  };

  const openRlcModal = (row) => {
    setRlcModal({ open: true, id_rlc: row.id_rlc, lema: row.lema, content: row.rlc_json });
    setEditableRlcJson(JSON.stringify(row.rlc_json, null, 2));
    setIsEditingRlc(false);
    setEditMotivo("");
    setJsonError("");
  };

  const handleSaveLimpieza = async () => {
    if (!editMotivo.trim()) {
      setJsonError("El motivo de la edición es obligatorio para auditoría.");
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(editableRlcJson);
      setJsonError("");
    } catch (e) {
      setJsonError(`JSON inválido: ${e.message}`);
      return;
    }

    setSavingLimpio(true);
    try {
      await limpiarRlc(rlcModal.id_rlc, parsed, editMotivo.trim());
      notify(`RLC de "${rlcModal.lema}" actualizado y registrado en auditoría.`, "success");
      setRlcModal({ open: false, id_rlc: null, lema: "", content: null });
      loadExtraidos();
    } catch (err) {
      setJsonError(err.message);
    } finally {
      setSavingLimpio(false);
    }
  };

  const handleClearP = () => {
    setLetraP(""); setIdExactoP(""); setIdDesdeP(""); setIdHastaP(""); setOrdenP("asc"); setPageP(1);
    setTimeout(() => loadPendientes(1), 0);
  };

  const handleClearE = () => {
    setLetraE(""); setIdExactoE(""); setIdDesdeE(""); setIdHastaE("");
    setMinAcepciones(""); setMaxAcepciones(""); setOrdenE("asc"); setPageE(1);
    setTimeout(() => loadExtraidos(1), 0);
  };

  const totalPagesP = Math.ceil(totalPendientes / PAGE_SIZE);
  const totalPagesE = Math.ceil(totalExtraidos / PAGE_SIZE);

  return (
    <div className="space-y-6">
      <Toast
        message={toast.message}
        type={toast.type}
        onClose={() => setToast({ message: "", type: "info" })}
      />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <p className="text-acento text-xs tracking-[0.25em] uppercase mb-2">
            Fase 1 · Socialización
          </p>
          <h1 className="font-display text-2xl sm:text-3xl text-niebla leading-tight">
            Ingeniería de Datos e Ingesta
          </h1>
          <p className="text-niebla/55 text-sm mt-1.5">
            Extracción fiel desde el DiPerú y depuración auditable de Registros Léxicos Crudos (RLC).
          </p>
        </div>

        <button
          onClick={() => (activeTab === "pendientes" ? loadPendientes() : loadExtraidos())}
          className="inline-flex items-center gap-2 self-start sm:self-auto px-3.5 py-2 text-xs rounded-md border border-marino-600/50 text-niebla/70 hover:text-acento hover:border-acento/40 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refrescar
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-marino-600/40">
        <button
          onClick={() => setActiveTab("pendientes")}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === "pendientes"
              ? "border-acento text-acento"
              : "border-transparent text-niebla/55 hover:text-niebla"
          }`}
        >
          Bandeja de Entrada
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-marino-900 border border-marino-600/50 text-niebla/75">
            {totalPendientes.toLocaleString("es-PE")}
          </span>
        </button>

        <button
          onClick={() => setActiveTab("extraidos")}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === "extraidos"
              ? "border-acento text-acento"
              : "border-transparent text-niebla/55 hover:text-niebla"
          }`}
        >
          Bandeja de Salida (RLC)
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-marino-900 border border-marino-600/50 text-niebla/75">
            {totalExtraidos.toLocaleString("es-PE")}
          </span>
        </button>
      </div>

      {/* ══════════════════ TAB PENDIENTES ══════════════════ */}
      {activeTab === "pendientes" && (
        <div className="space-y-4">
          {/* Herramienta de Extracción Masiva */}
          <div className="bg-marino-900/60 border border-marino-600/40 rounded-lg p-4">
            <div className="flex flex-col lg:flex-row gap-3 lg:items-end">
              <div className="flex-1">
                <label className="text-[11px] uppercase tracking-wider text-acento/90 font-medium block mb-1.5">
                  Extracción Masiva por Lotes (1 sesión Chromium)
                </label>
                <input
                  type="text"
                  value={rangoExtraccion}
                  onChange={(e) => setRangoExtraccion(e.target.value)}
                  placeholder="Ej: 1-50; 64; 100-120"
                  className="w-full bg-marino-800 border border-marino-600/60 rounded-md px-3 py-2 text-sm text-niebla placeholder:text-niebla/30 focus:border-acento focus:outline-none"
                />
              </div>
              <button
                onClick={handleExtraccionMasiva}
                disabled={
                  !rangoExtraccion.trim() ||
                  (masivaProgress && masivaProgress.estado === "Procesando")
                }
                className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-md bg-acento text-marino-900 text-sm font-semibold hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Download className="w-4 h-4" />
                Iniciar Extracción
              </button>
              <button
                onClick={() => setShowFiltersP((v) => !v)}
                className="inline-flex items-center justify-center gap-2 px-3.5 py-2 rounded-md border border-marino-600/50 text-xs text-niebla/70 hover:text-niebla hover:bg-marino-700/40 transition-colors"
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
                {showFiltersP ? "Ocultar filtros" : "Filtros"}
              </button>
            </div>

            {showFiltersP && (
              <div className="mt-4 pt-4 border-t border-marino-600/30 flex flex-wrap items-center gap-2.5 text-sm">
                <select
                  value={letraP}
                  onChange={(e) => setLetraP(e.target.value)}
                  className="bg-marino-800 border border-marino-600/50 rounded-md px-2.5 py-1.5 text-niebla focus:border-acento focus:outline-none"
                >
                  <option value="">Letra: todas</option>
                  {"ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((l) => (
                    <option key={l} value={l}>{l}</option>
                  ))}
                </select>
                <input
                  type="number"
                  placeholder="ID exacto"
                  value={idExactoP}
                  onChange={(e) => setIdExactoP(e.target.value)}
                  className="bg-marino-800 border border-marino-600/50 rounded-md px-2.5 py-1.5 text-niebla w-28 focus:border-acento focus:outline-none"
                />
                <input
                  type="number"
                  placeholder="Desde ID"
                  value={idDesdeP}
                  onChange={(e) => setIdDesdeP(e.target.value)}
                  className="bg-marino-800 border border-marino-600/50 rounded-md px-2.5 py-1.5 text-niebla w-28 focus:border-acento focus:outline-none"
                />
                <input
                  type="number"
                  placeholder="Hasta ID"
                  value={idHastaP}
                  onChange={(e) => setIdHastaP(e.target.value)}
                  className="bg-marino-800 border border-marino-600/50 rounded-md px-2.5 py-1.5 text-niebla w-28 focus:border-acento focus:outline-none"
                />
                <select
                  value={ordenP}
                  onChange={(e) => setOrdenP(e.target.value)}
                  className="bg-marino-800 border border-marino-600/50 rounded-md px-2.5 py-1.5 text-niebla focus:border-acento focus:outline-none"
                >
                  <option value="asc">Orden: A → Z</option>
                  <option value="desc">Orden: Z → A</option>
                </select>
                <div className="flex gap-2 ml-auto">
                  <button
                    onClick={() => { setPageP(1); loadPendientes(1); }}
                    className="px-3.5 py-1.5 rounded-md bg-marino-700 hover:bg-marino-600 text-niebla text-xs font-medium transition-colors"
                  >
                    Aplicar
                  </button>
                  <button
                    onClick={handleClearP}
                    className="px-2.5 py-1.5 text-xs text-niebla/50 hover:text-niebla transition-colors"
                  >
                    Limpiar
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Tabla Pendientes */}
          <div className="bg-marino-900/40 border border-marino-600/30 rounded-lg overflow-hidden">
            {loadingP ? (
              <LoadingSpinner text="Cargando lemas pendientes…" />
            ) : pendientes.length === 0 ? (
              <div className="py-16 text-center text-niebla/45 text-sm">
                No hay lemas pendientes con los filtros actuales.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="bg-marino-900 text-niebla/50 text-[11px] uppercase tracking-wider border-b border-marino-600/30">
                    <tr>
                      <th className="px-4 py-3 font-medium">Lema</th>
                      <th className="px-4 py-3 font-medium">ID DiPerú</th>
                      <th className="px-4 py-3 font-medium">Fuente</th>
                      <th className="px-4 py-3 font-medium text-right">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-marino-600/20">
                    {pendientes.map((p) => {
                      let id = "";
                      try {
                        id = new URL(p.url_origen).searchParams.get("entrada") || "";
                      } catch {}
                      return (
                        <tr key={p.id_lema} className="hover:bg-marino-700/25 transition-colors">
                          <td className="px-4 py-3 font-display text-base text-niebla">
                            {p.lema}
                          </td>
                          <td className="px-4 py-3 font-mono text-xs text-niebla/70">#{id}</td>
                          <td className="px-4 py-3 text-xs text-niebla/55 max-w-xs truncate">
                            <a
                              href={p.url_origen}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 hover:text-acento transition-colors"
                            >
                              <span className="truncate">{p.url_origen}</span>
                              <ExternalLink className="w-3 h-3 flex-shrink-0" />
                            </a>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="inline-flex items-center gap-2">
                              <button
                                onClick={() => handleViewHtml(id)}
                                disabled={!id || loadingHtmlId !== null}
                                className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-marino-600/50 text-niebla/75 hover:text-niebla hover:bg-marino-700/50 transition-colors disabled:opacity-40"
                              >
                                <Code className="w-3.5 h-3.5" />
                                {loadingHtmlId === id ? "Cargando…" : "HTML"}
                              </button>
                              <button
                                onClick={() => handleExtract(id, p.lema)}
                                disabled={!id || extractingId !== null}
                                className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-acento/15 border border-acento/35 text-acento hover:bg-acento hover:text-marino-900 font-medium transition-colors disabled:opacity-40"
                              >
                                <Play className="w-3.5 h-3.5" />
                                {extractingId === id ? "Extrayendo…" : "Extraer RLC"}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <Pagination page={pageP} totalPages={totalPagesP} onPageChange={setPageP} />
        </div>
      )}

      {/* ══════════════════ TAB EXTRAÍDOS ══════════════════ */}
      {activeTab === "extraidos" && (
        <div className="space-y-4">
          <div className="bg-marino-900/60 border border-marino-600/40 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs text-niebla/60">
                Mostrando registros capturados en <code className="text-acento">registro_lexico_crudo</code>
              </span>
              <button
                onClick={() => setShowFiltersE((v) => !v)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-marino-600/50 text-xs text-niebla/70 hover:text-niebla hover:bg-marino-700/40 transition-colors"
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
                {showFiltersE ? "Ocultar filtros" : "Filtros"}
              </button>
            </div>

            {showFiltersE && (
              <div className="mt-4 pt-4 border-t border-marino-600/30 flex flex-wrap items-center gap-2.5 text-sm">
                <select
                  value={letraE}
                  onChange={(e) => setLetraE(e.target.value)}
                  className="bg-marino-800 border border-marino-600/50 rounded-md px-2.5 py-1.5 text-niebla focus:border-acento focus:outline-none"
                >
                  <option value="">Letra: todas</option>
                  {"ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((l) => (
                    <option key={l} value={l}>{l}</option>
                  ))}
                </select>
                <input
                  type="number"
                  placeholder="ID exacto"
                  value={idExactoE}
                  onChange={(e) => setIdExactoE(e.target.value)}
                  className="bg-marino-800 border border-marino-600/50 rounded-md px-2.5 py-1.5 text-niebla w-24 focus:border-acento focus:outline-none"
                />
                <input
                  type="number"
                  placeholder="Desde ID"
                  value={idDesdeE}
                  onChange={(e) => setIdDesdeE(e.target.value)}
                  className="bg-marino-800 border border-marino-600/50 rounded-md px-2.5 py-1.5 text-niebla w-24 focus:border-acento focus:outline-none"
                />
                <input
                  type="number"
                  placeholder="Hasta ID"
                  value={idHastaE}
                  onChange={(e) => setIdHastaE(e.target.value)}
                  className="bg-marino-800 border border-marino-600/50 rounded-md px-2.5 py-1.5 text-niebla w-24 focus:border-acento focus:outline-none"
                />
                <input
                  type="number"
                  placeholder="Min acep."
                  value={minAcepciones}
                  onChange={(e) => setMinAcepciones(e.target.value)}
                  className="bg-marino-800 border border-marino-600/50 rounded-md px-2.5 py-1.5 text-niebla w-24 focus:border-acento focus:outline-none"
                />
                <input
                  type="number"
                  placeholder="Max acep."
                  value={maxAcepciones}
                  onChange={(e) => setMaxAcepciones(e.target.value)}
                  className="bg-marino-800 border border-marino-600/50 rounded-md px-2.5 py-1.5 text-niebla w-24 focus:border-acento focus:outline-none"
                />
                <select
                  value={ordenE}
                  onChange={(e) => setOrdenE(e.target.value)}
                  className="bg-marino-800 border border-marino-600/50 rounded-md px-2.5 py-1.5 text-niebla focus:border-acento focus:outline-none"
                >
                  <option value="asc">Orden: A → Z</option>
                  <option value="desc">Orden: Z → A</option>
                </select>
                <div className="flex gap-2 ml-auto">
                  <button
                    onClick={() => { setPageE(1); loadExtraidos(1); }}
                    className="px-3.5 py-1.5 rounded-md bg-marino-700 hover:bg-marino-600 text-niebla text-xs font-medium transition-colors"
                  >
                    Aplicar
                  </button>
                  <button
                    onClick={handleClearE}
                    className="px-2.5 py-1.5 text-xs text-niebla/50 hover:text-niebla transition-colors"
                  >
                    Limpiar
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="bg-marino-900/40 border border-marino-600/30 rounded-lg overflow-hidden">
            {loadingE ? (
              <LoadingSpinner text="Cargando RLCs extraídos…" />
            ) : extraidos.length === 0 ? (
              <div className="py-16 text-center text-niebla/45 text-sm">
                No hay registros extraídos con estos filtros.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="bg-marino-900 text-niebla/50 text-[11px] uppercase tracking-wider border-b border-marino-600/30">
                    <tr>
                      <th className="px-4 py-3 font-medium">Lema</th>
                      <th className="px-4 py-3 font-medium">ID</th>
                      <th className="px-4 py-3 font-medium text-center">Acepc.</th>
                      <th className="px-4 py-3 font-medium text-center">Integridad RLC</th>
                      <th className="px-4 py-3 font-medium text-center">Estado Pipeline</th>
                      <th className="px-4 py-3 font-medium">Extracción</th>
                      <th className="px-4 py-3 font-medium text-right">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-marino-600/20">
                    {extraidos.map((e) => {
                      const procBadge =
                        ESTADO_PROC_BADGE[e.estado_procesamiento] || ESTADO_PROC_BADGE.pendiente;
                      return (
                        <tr key={e.id_rlc} className="hover:bg-marino-700/25 transition-colors">
                          <td className="px-4 py-3 font-display text-base text-niebla">{e.lema}</td>
                          <td className="px-4 py-3 font-mono text-xs text-niebla/65">#{e.id_entrada}</td>
                          <td className="px-4 py-3 text-center">
                            <span className="px-2 py-0.5 rounded-full text-xs font-mono bg-marino-900 text-acento border border-marino-600/50">
                              {e.num_acepciones}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            {e.estado_limpieza === "limpio" ? (
                              <span className="inline-flex items-center gap-1 text-[11px] px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/25">
                                <CheckCircle2 className="w-3 h-3" /> Editado
                              </span>
                            ) : (
                              <span className="inline-flex items-center text-[11px] px-2.5 py-0.5 rounded-full bg-niebla/5 text-niebla/55 border border-marino-600/40">
                                Original
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className={`text-[11px] px-2.5 py-0.5 rounded-full border ${procBadge.cls}`}>
                              {procBadge.label}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs text-niebla/50">
                            {e.fecha_extraccion
                              ? new Date(e.fecha_extraccion).toLocaleDateString("es-PE")
                              : "—"}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button
                              onClick={() => openRlcModal(e)}
                              className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-marino-600/50 text-niebla/80 hover:text-acento hover:border-acento/40 transition-colors"
                            >
                              <FileJson className="w-3.5 h-3.5" />
                              Ver / Editar RLC
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <Pagination page={pageE} totalPages={totalPagesE} onPageChange={setPageE} />
        </div>
      )}

      {/* ══════════════════ CONFIGURACIÓN FUENTE ══════════════════ */}
      <div className="bg-marino-900/40 border border-marino-600/30 rounded-lg overflow-hidden">
        <button
          onClick={() => setShowConfig((v) => !v)}
          className="w-full px-5 py-3.5 flex items-center justify-between text-left hover:bg-marino-700/20 transition-colors"
        >
          <div className="flex items-center gap-2.5">
            <Settings className="w-4 h-4 text-acento/80" />
            <span className="text-sm font-medium text-niebla/85">
              Configuración de Fuente Oficial (DiPerú)
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span
              className={`text-[11px] px-2.5 py-0.5 rounded-full border ${
                configStatus === "Conectado"
                  ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/30"
                  : configStatus === "Fallo"
                  ? "bg-red-500/10 text-red-300 border-red-500/30"
                  : "bg-amber-500/10 text-amber-300 border-amber-500/30"
              }`}
            >
              {configStatus}
            </span>
            {showConfig ? (
              <ChevronUp className="w-4 h-4 text-niebla/50" />
            ) : (
              <ChevronDown className="w-4 h-4 text-niebla/50" />
            )}
          </div>
        </button>

        {showConfig && (
          <div className="px-5 py-4 border-t border-marino-600/30 flex flex-col sm:flex-row gap-3 sm:items-end">
            <div className="flex-1">
              <label className="block text-[11px] uppercase tracking-wider text-niebla/50 mb-1.5">
                URL Base del Diccionario de Peruanismos
              </label>
              <input
                type="text"
                value={urlConfig}
                onChange={(e) => setUrlConfig(e.target.value)}
                className="w-full bg-marino-800 border border-marino-600/50 rounded-md px-3 py-2 text-sm text-niebla focus:border-acento focus:outline-none"
              />
            </div>
            <button
              onClick={handleSaveConfig}
              disabled={savingConfig}
              className="px-4 py-2 rounded-md bg-acento/15 border border-acento/40 text-acento hover:bg-acento hover:text-marino-900 text-sm font-medium transition-colors disabled:opacity-50"
            >
              {savingConfig ? "Validando…" : "Guardar y probar"}
            </button>
          </div>
        )}
      </div>

      {/* ══════════════════ MODAL HTML ══════════════════ */}
      <Modal
        open={htmlModal.open}
        onClose={() => setHtmlModal({ open: false, id: null, html: "" })}
        title={`HTML capturado · Entrada #${htmlModal.id || ""}`}
        subtitle="Fragmento depurado del DOM de DiPerú (div#ListaEntradaIndex)"
      >
        <div className="bg-marino-800/80 border border-marino-600/40 rounded-lg p-4 overflow-x-auto">
          <pre className="font-mono text-xs text-acento-claro whitespace-pre-wrap break-words leading-relaxed">
            {htmlModal.html}
          </pre>
        </div>
      </Modal>

      {/* ══════════════════ MODAL RLC (VER / LIMPIAR) ══════════════════ */}
      <Modal
        open={rlcModal.open}
        onClose={() => setRlcModal({ open: false, id_rlc: null, lema: "", content: null })}
        title={`Registro Léxico Crudo · ${rlcModal.lema}`}
        subtitle={isEditingRlc ? "Modo edición manual (genera registro de auditoría)" : "Vista estructurada JSONB"}
        headerExtra={
          !isEditingRlc && (
            <button
              onClick={() => setIsEditingRlc(true)}
              className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-acento/15 border border-acento/40 text-acento hover:bg-acento hover:text-marino-900 font-medium transition-colors"
            >
              <Edit3 className="w-3.5 h-3.5" />
              Editar y limpiar
            </button>
          )
        }
        footer={
          isEditingRlc ? (
            <>
              <button
                onClick={() => {
                  setIsEditingRlc(false);
                  setJsonError("");
                }}
                className="px-4 py-2 text-sm rounded-md border border-marino-600/50 text-niebla/70 hover:text-niebla"
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveLimpieza}
                disabled={savingLimpio || !editMotivo.trim()}
                className="px-4 py-2 text-sm rounded-md bg-acento text-marino-900 font-semibold hover:brightness-110 disabled:opacity-40"
              >
                {savingLimpio ? "Guardando…" : "Guardar limpieza"}
              </button>
            </>
          ) : null
        }
      >
        {isEditingRlc ? (
          <div className="space-y-4">
            {jsonError && (
              <div className="flex items-center gap-2 p-3 rounded-md bg-red-500/10 border border-red-500/30 text-red-300 text-xs">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{jsonError}</span>
              </div>
            )}
            <div>
              <label className="block text-xs uppercase tracking-wider text-niebla/55 mb-1.5">
                JSON del Registro Léxico Crudo
              </label>
              <textarea
                value={editableRlcJson}
                onChange={(e) => setEditableRlcJson(e.target.value)}
                rows={14}
                className="w-full bg-marino-800 border border-marino-600/50 rounded-lg p-3.5 font-mono text-xs text-acento-claro focus:border-acento focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs uppercase tracking-wider text-acento mb-1.5">
                Motivo de la corrección (obligatorio para auditoría)
              </label>
              <input
                type="text"
                value={editMotivo}
                onChange={(e) => setEditMotivo(e.target.value)}
                placeholder="Ej: Corrección de categoría mal parseada o remisión rota..."
                className="w-full bg-marino-800 border border-marino-600/50 rounded-md px-3 py-2 text-sm text-niebla focus:border-acento focus:outline-none"
              />
            </div>
          </div>
        ) : (
          <div className="bg-marino-800/80 border border-marino-600/40 rounded-lg p-4 overflow-x-auto">
            <pre className="font-mono text-xs text-acento-claro whitespace-pre-wrap leading-relaxed">
              {JSON.stringify(rlcModal.content, null, 2)}
            </pre>
          </div>
        )}
      </Modal>

      {/* ══════════════════ TARJETA FLOTANTE DE LOTE ══════════════════ */}
      {masivaProgress && masivaProgress.estado === "Procesando" && (
        <div className="fixed bottom-5 right-5 z-40 w-[calc(100vw-2.5rem)] max-w-sm">
          <div className="bg-marino-900 border border-acento/40 rounded-xl shadow-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 text-acento animate-spin" />
                <h3 className="font-display text-sm text-acento">Extracción en curso</h3>
              </div>
              <span className="text-xs font-mono text-niebla/75">
                {masivaProgress.actual}/{masivaProgress.total}
              </span>
            </div>
            <div className="w-full h-2 bg-marino-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-acento transition-all duration-300"
                style={{
                  width: `${Math.min(
                    100,
                    (masivaProgress.actual / Math.max(1, masivaProgress.total)) * 100
                  )}%`,
                }}
              />
            </div>
            <div className="flex items-center justify-between text-[11px] text-niebla/60">
              <span>Exitosos: <strong className="text-emerald-400">{masivaProgress.exitosos ?? 0}</strong></span>
              <span>Fallidos: <strong className="text-red-400">{masivaProgress.fallidos ?? 0}</strong></span>
            </div>
            <p className="text-xs font-mono text-acento-claro/85 truncate">
              {masivaProgress.mensaje}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}