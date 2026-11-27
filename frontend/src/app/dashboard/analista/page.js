"use client";

import { useState, useEffect, useCallback } from "react";
import {
  RefreshCw,
  Play,
  Layers,
  Link2,
  GitBranch,
  FileJson,
  Trash2,
  Loader2,
  Eye,
  Sparkles,
} from "lucide-react";
import {
  fetchAnalistaPendientes,
  fetchAnalistaProcesados,
  procesarPipeline,
  procesarLoteAnalista,
  resolverRemisionesPendientes,
  engancharPendientes,
  fetchProgresoProcesamiento,
  descartarMasivo,
} from "@/services/api";
import StepProgress from "@/components/StepProgress";
import NetworkViewer from "@/components/NetworkViewer";
import { TipoBadge } from "@/components/peruanismos/TipoBadge";
import { Toast } from "@/components/ui/Toast";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Pagination } from "@/components/ui/Pagination";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";

const PAGE_SIZE = 20;

const SECI_STEPS = [
  { id: "remisiones", label: "Remisiones" },
  { id: "categorias", label: "Categorías" },
  { id: "ensamblado", label: "Ensamblado" },
  { id: "uce", label: "Poblar UCE" },
  { id: "vectorizado", label: "Vectorizado" },
  { id: "forma", label: "Criba Forma" },
  { id: "clasificado", label: "Enganche F3" },
];

const RELACION_BADGE = {
  near_synonym: {
    label: "Sinónimo",
    cls: "bg-emerald-500/10 text-emerald-300 border-emerald-500/25",
  },
  has_hyperonym: {
    label: "Hiperónimo",
    cls: "bg-acento/15 text-acento border-acento/30",
  },
  variante_existente: {
    label: "Ya en MCR",
    cls: "bg-sky-500/10 text-sky-300 border-sky-500/25",
  },
};

export default function AnalistaPage() {
  const [activeTab, setActiveTab] = useState("pendientes");
  const [toast, setToast] = useState({ message: "", type: "info" });

  // ── Pendientes ────────────────────────────────────────────────────────────
  const [pendientes, setPendientes] = useState([]);
  const [totalP, setTotalP] = useState(0);
  const [resumenCola, setResumenCola] = useState({
    pendiente: 0,
    remision_pendiente: 0,
    sin_uce: 0,
    procesado: 0,
  });
  const [estadoCola, setEstadoCola] = useState("pendiente");
  const [loadingP, setLoadingP] = useState(true);
  const [processingId, setProcessingId] = useState(null);
  const [completedSteps, setCompletedSteps] = useState([]);
  const [selectedRlcs, setSelectedRlcs] = useState(new Set());
  const [loteCantidad, setLoteCantidad] = useState(25);
  const [engancheCantidad, setEngancheCantidad] = useState(50);

  const [lemaP, setLemaP] = useState("");
  const [acepcionesP, setAcepcionesP] = useState("");
  const [fechaDesdeP, setFechaDesdeP] = useState("");
  const [fechaHastaP, setFechaHastaP] = useState("");
  const [pageP, setPageP] = useState(1);

  // Job en segundo plano
  const [jobProgress, setJobProgress] = useState(null);

  // ── Procesados (UCEs) ─────────────────────────────────────────────────────
  const [procesados, setProcesados] = useState([]);
  const [totalE, setTotalE] = useState(0);
  const [loadingE, setLoadingE] = useState(true);

  const [lemaE, setLemaE] = useState("");
  const [posMcr, setPosMcr] = useState("");
  const [tipoPeruanismo, setTipoPeruanismo] = useState("");
  const [pageE, setPageE] = useState(1);
  const [selectedUces, setSelectedUces] = useState(new Set());

  // ── Modales y confirmación ────────────────────────────────────────────────
  const [rlcModal, setRlcModal] = useState({ open: false, lema: "", content: null });
  const [uceModal, setUceModal] = useState({ open: false, content: null, tab: "grafo" });
  const [confirmDescarte, setConfirmDescarte] = useState(false);
  const [descartando, setDescartando] = useState(false);

  const notify = (message, type = "info") => setToast({ message, type });

  const loadPendientes = useCallback(async (overridePage, overrideEstado) => {
    setLoadingP(true);
    try {
      const data = await fetchAnalistaPendientes({
        page: overridePage ?? pageP,
        size: PAGE_SIZE,
        estado_procesamiento: overrideEstado ?? estadoCola,
        lema: lemaP || undefined,
        acepciones: acepcionesP ? parseInt(acepcionesP, 10) : undefined,
        fecha_desde: fechaDesdeP ? new Date(fechaDesdeP).toISOString() : undefined,
        fecha_hasta: fechaHastaP ? new Date(fechaHastaP).toISOString() : undefined,
      });
      setPendientes(data.items || []);
      setTotalP(data.total || 0);
      if (data.resumen_cola) setResumenCola(data.resumen_cola);
      setSelectedRlcs(new Set());
    } catch (err) {
      notify(`Error al cargar bandeja de entrada: ${err.message}`, "error");
    } finally {
      setLoadingP(false);
    }
  }, [pageP, estadoCola, lemaP, acepcionesP, fechaDesdeP, fechaHastaP]);

  const loadProcesados = useCallback(async (overridePage) => {
    setLoadingE(true);
    try {
      const data = await fetchAnalistaProcesados({
        page: overridePage ?? pageE,
        size: PAGE_SIZE,
        lema: lemaE || undefined,
        pos_mcr: posMcr || undefined,
        tipo_peruanismo: tipoPeruanismo || undefined,
      });
      setProcesados(data.items || []);
      setTotalE(data.total || 0);
      setSelectedUces(new Set());
    } catch (err) {
      notify(`Error al cargar UCEs: ${err.message}`, "error");
    } finally {
      setLoadingE(false);
    }
  }, [pageE, lemaE, posMcr, tipoPeruanismo]);

  // Comprobar si ya existe job activo al montar
  useEffect(() => {
    fetchProgresoProcesamiento()
      .then((prog) => {
        if (prog && prog.estado === "procesando") setJobProgress(prog);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (activeTab === "pendientes") loadPendientes();
    else loadProcesados();
  }, [activeTab, pageP, pageE, estadoCola]); // eslint-disable-line react-hooks/exhaustive-deps

  // Polling de job en segundo plano
  useEffect(() => {
    if (!jobProgress || jobProgress.estado !== "procesando") return;
    const interval = setInterval(async () => {
      try {
        const prog = await fetchProgresoProcesamiento();
        setJobProgress(prog);
        if (prog.estado === "completado" || prog.estado === "error") {
          clearInterval(interval);
          if (prog.estado === "completado") {
            notify(prog.mensaje || "Proceso por lote completado.", "success");
            loadPendientes();
            loadProcesados();
          } else {
            notify(prog.mensaje || "El lote terminó con error.", "error");
          }
        }
      } catch {}
    }, 1500);
    return () => clearInterval(interval);
  }, [jobProgress?.estado]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleProcessOne = async (id_rlc) => {
    setProcessingId(id_rlc);
    setCompletedSteps([]);

    const sim = setInterval(() => {
      setCompletedSteps((prev) => {
        if (prev.length < SECI_STEPS.length - 1) {
          return [...prev, SECI_STEPS[prev.length].id];
        }
        clearInterval(sim);
        return prev;
      });
    }, 700);

    try {
      const res = await procesarPipeline(id_rlc);
      clearInterval(sim);
      setCompletedSteps(res.pasos_completados || SECI_STEPS.map((s) => s.id));
      const nUces = res.uces_creados?.length || 0;
      const detalleMotivos =
        nUces === 0 && res.motivos_descarte
          ? ` (${Object.entries(res.motivos_descarte)
              .map(([k, v]) => `${k}: ${v}`)
              .join(", ")})`
          : "";
      notify(
        `Procesado "${res.lema}": ${nUces} UCE(s) clasificados y enganchados${detalleMotivos}.`,
        "success"
      );
      loadPendientes();
    } catch (err) {
      clearInterval(sim);
      notify(`Error procesando RLC: ${err.message}`, "error");
    } finally {
      setProcessingId(null);
    }
  };

  const handleProcesarLote = async () => {
    try {
      const ids = Array.from(selectedRlcs);
      const resp = await procesarLoteAnalista(
        ids.length > 0 ? { ids_rlc: ids } : { limite: loteCantidad }
      );
      setJobProgress({
        tipo: "procesamiento_masivo",
        estado: "procesando",
        actual: 0,
        total: resp.total || 1,
        exitosos: 0,
        fallidos: 0,
        mensaje: `Procesando lote de ${resp.total} RLCs...`,
      });
      notify(`Lote iniciado (${resp.total} RLCs).`, "info");
    } catch (err) {
      notify(err.message, "error");
    }
  };

  const handleResolverRemisiones = async () => {
    try {
      const resp = await resolverRemisionesPendientes();
      if (resp.total > 0) {
        setJobProgress({
          tipo: "resolver_remisiones",
          estado: "procesando",
          actual: 0,
          total: resp.total,
          exitosos: 0,
          fallidos: 0,
          mensaje: `Re-resolviendo ${resp.total} remisiones...`,
        });
        notify(`Re-resolución iniciada para ${resp.total} RLC(s).`, "info");
      } else {
        notify(resp.mensaje || "No hay remisiones listas para resolver.", "info");
      }
    } catch (err) {
      notify(err.message, "error");
    }
  };

  const handleEngancharPendientes = async () => {
    try {
      const resp = await engancharPendientes({ limite: engancheCantidad, forzar: false });
      if (resp.total > 0) {
        setJobProgress({
          tipo: "enganche_masivo",
          estado: "procesando",
          actual: 0,
          total: resp.total,
          exitosos: 0,
          fallidos: 0,
          mensaje: `Calculando enganche Fase 3 para ${resp.total} UCEs...`,
        });
        notify(`Enganche Fase 3 iniciado (${resp.total} UCEs).`, "info");
      } else {
        notify(resp.mensaje || "Todas las UCEs ya tienen enganche.", "info");
      }
    } catch (err) {
      notify(err.message, "error");
    }
  };

  const handleConfirmDescartar = async () => {
    setDescartando(true);
    try {
      await descartarMasivo(Array.from(selectedUces));
      notify(`${selectedUces.size} UCE(s) descartadas correctamente.`, "success");
      setConfirmDescarte(false);
      setSelectedUces(new Set());
      loadProcesados();
    } catch (err) {
      notify(`Error al descartar: ${err.message}`, "error");
    } finally {
      setDescartando(false);
    }
  };

  const toggleRlc = (id, checked) => {
    const next = new Set(selectedRlcs);
    if (checked) next.add(id);
    else next.delete(id);
    setSelectedRlcs(next);
  };

  const toggleUce = (id, checked) => {
    const next = new Set(selectedUces);
    if (checked) next.add(id);
    else next.delete(id);
    setSelectedUces(next);
  };

  const isJobRunning = jobProgress?.estado === "procesando";
  const totalPagesP = Math.ceil(totalP / PAGE_SIZE);
  const totalPagesE = Math.ceil(totalE / PAGE_SIZE);

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
            Fases 2 y 3 · Externalización y Combinación
          </p>
          <h1 className="font-display text-2xl sm:text-3xl text-niebla leading-tight">
            Procesamiento Semántico
          </h1>
          <p className="text-niebla/55 text-sm mt-1.5">
            Destila RLCs en UCEs vectorizados, clasifica su tipo y genera propuestas de enganche en el MCR.
          </p>
        </div>

        <button
          onClick={() => (activeTab === "pendientes" ? loadPendientes() : loadProcesados())}
          className="inline-flex items-center gap-2 self-start sm:self-auto px-3.5 py-2 text-xs rounded-md border border-marino-600/50 text-niebla/70 hover:text-acento hover:border-acento/40 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refrescar
        </button>
      </div>

      {/* Progreso individual */}
      {processingId && (
        <div className="bg-marino-900/70 rounded-lg border border-acento/40 p-6 pb-12">
          <h2 className="font-display text-base text-acento mb-6">
            Ejecutando pipeline SECI para{" "}
            <span className="text-niebla">
              {pendientes.find((p) => p.id_rlc === processingId)?.lema}
            </span>
            …
          </h2>
          <StepProgress steps={SECI_STEPS} completedSteps={completedSteps} />
        </div>
      )}

      {/* Tabs principales */}
      <div className="flex gap-2 border-b border-marino-600/40">
        <button
          onClick={() => setActiveTab("pendientes")}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === "pendientes"
              ? "border-acento text-acento"
              : "border-transparent text-niebla/55 hover:text-niebla"
          }`}
        >
          Bandeja de Entrada (RLC)
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-marino-900 border border-marino-600/50 text-niebla/75">
            {resumenCola.pendiente.toLocaleString("es-PE")}
          </span>
        </button>
        <button
          onClick={() => setActiveTab("procesados")}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === "procesados"
              ? "border-acento text-acento"
              : "border-transparent text-niebla/55 hover:text-niebla"
          }`}
        >
          Bandeja de Salida (UCE)
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-marino-900 border border-marino-600/50 text-niebla/75">
            {totalE.toLocaleString("es-PE")}
          </span>
        </button>
      </div>

      {/* ══════════════════ TAB PENDIENTES ══════════════════ */}
      {activeTab === "pendientes" && (
        <div className="space-y-4">
          {/* Sub-filtros de cola + Acciones masivas */}
          <div className="bg-marino-900/60 border border-marino-600/40 rounded-lg p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              {/* Sub-pestañas de estado de cola */}
              <div className="flex flex-wrap gap-1.5">
                {[
                  { id: "pendiente", label: "Pendientes", count: resumenCola.pendiente },
                  { id: "remision_pendiente", label: "Remisiones pend.", count: resumenCola.remision_pendiente },
                  { id: "sin_uce", label: "Sin UCE", count: resumenCola.sin_uce },
                ].map((st) => (
                  <button
                    key={st.id}
                    onClick={() => {
                      setEstadoCola(st.id);
                      setPageP(1);
                    }}
                    className={`px-3 py-1.5 rounded-md text-xs transition-colors border ${
                      estadoCola === st.id
                        ? "bg-acento/15 text-acento border-acento/35 font-medium"
                        : "bg-marino-800/70 text-niebla/60 border-marino-600/40 hover:text-niebla"
                    }`}
                  >
                    {st.label} ({st.count.toLocaleString("es-PE")})
                  </button>
                ))}
              </div>

              {/* Acciones de lote */}
              <div className="flex flex-wrap items-center gap-2">
                {selectedRlcs.size === 0 && (
                  <select
                    value={loteCantidad}
                    onChange={(e) => setLoteCantidad(Number(e.target.value))}
                    className="bg-marino-800 border border-marino-600/50 rounded-md px-2.5 py-1.5 text-xs text-niebla focus:border-acento focus:outline-none"
                    title="Cantidad de RLCs pendientes a procesar en lote"
                  >
                    <option value={10}>Lote: 10</option>
                    <option value={25}>Lote: 25</option>
                    <option value={50}>Lote: 50</option>
                    <option value={100}>Lote: 100</option>
                  </select>
                )}

                <button
                  onClick={handleProcesarLote}
                  disabled={isJobRunning || (selectedRlcs.size === 0 && resumenCola.pendiente === 0)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-acento text-marino-900 text-xs font-semibold hover:brightness-110 transition-all disabled:opacity-40"
                >
                  <Layers className="w-3.5 h-3.5" />
                  {selectedRlcs.size > 0
                    ? `Procesar (${selectedRlcs.size})`
                    : `Procesar lote (${loteCantidad})`}
                </button>

                <button
                  onClick={handleResolverRemisiones}
                  disabled={isJobRunning || resumenCola.remision_pendiente === 0}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-amber-500/35 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 text-xs font-medium transition-colors disabled:opacity-40"
                >
                  <Link2 className="w-3.5 h-3.5" />
                  Re-resolver remisiones ({resumenCola.remision_pendiente})
                </button>
              </div>
            </div>

            {/* Filtros de búsqueda */}
            <div className="pt-3 border-t border-marino-600/30 flex flex-wrap items-center gap-2.5 text-sm">
              <input
                type="text"
                placeholder="Buscar lema…"
                value={lemaP}
                onChange={(e) => setLemaP(e.target.value)}
                className="bg-marino-800 border border-marino-600/50 rounded-md px-3 py-1.5 text-niebla placeholder:text-niebla/30 w-44 focus:border-acento focus:outline-none"
              />
              <input
                type="number"
                placeholder="Acepciones"
                value={acepcionesP}
                onChange={(e) => setAcepcionesP(e.target.value)}
                className="bg-marino-800 border border-marino-600/50 rounded-md px-2.5 py-1.5 text-niebla w-28 focus:border-acento focus:outline-none"
              />
              <input
                type="date"
                value={fechaDesdeP}
                onChange={(e) => setFechaDesdeP(e.target.value)}
                className="bg-marino-800 border border-marino-600/50 rounded-md px-2.5 py-1.5 text-xs text-niebla focus:border-acento focus:outline-none"
              />
              <input
                type="date"
                value={fechaHastaP}
                onChange={(e) => setFechaHastaP(e.target.value)}
                className="bg-marino-800 border border-marino-600/50 rounded-md px-2.5 py-1.5 text-xs text-niebla focus:border-acento focus:outline-none"
              />
              <div className="flex gap-2 ml-auto">
                <button
                  onClick={() => { setPageP(1); loadPendientes(1); }}
                  className="px-3.5 py-1.5 rounded-md bg-marino-700 hover:bg-marino-600 text-niebla text-xs font-medium"
                >
                  Filtrar
                </button>
                <button
                  onClick={() => {
                    setLemaP(""); setAcepcionesP(""); setFechaDesdeP(""); setFechaHastaP(""); setPageP(1);
                    setTimeout(() => loadPendientes(1), 0);
                  }}
                  className="px-2.5 py-1.5 text-xs text-niebla/50 hover:text-niebla"
                >
                  Limpiar
                </button>
              </div>
            </div>
          </div>

          {/* Tabla Pendientes */}
          <div className="bg-marino-900/40 border border-marino-600/30 rounded-lg overflow-hidden">
            {loadingP ? (
              <LoadingSpinner text="Cargando cola de RLCs…" />
            ) : pendientes.length === 0 ? (
              <div className="py-16 text-center text-niebla/45 text-sm">
                No hay RLCs en estado &ldquo;{estadoCola}&rdquo; con los filtros actuales.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="bg-marino-900 text-niebla/50 text-[11px] uppercase tracking-wider border-b border-marino-600/30">
                    <tr>
                      <th className="px-4 py-3 w-10 text-center">
                        <input
                          type="checkbox"
                          checked={pendientes.length > 0 && selectedRlcs.size === pendientes.length}
                          onChange={(e) =>
                            setSelectedRlcs(
                              e.target.checked ? new Set(pendientes.map((p) => p.id_rlc)) : new Set()
                            )
                          }
                          className="rounded border-marino-600 bg-marino-800 accent-acento"
                        />
                      </th>
                      <th className="px-4 py-3 font-medium">Lema</th>
                      <th className="px-4 py-3 font-medium text-center">Acepc.</th>
                      <th className="px-4 py-3 font-medium">Extracción</th>
                      <th className="px-4 py-3 font-medium text-right">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-marino-600/20">
                    {pendientes.map((p) => (
                      <tr key={p.id_rlc} className="hover:bg-marino-700/25 transition-colors">
                        <td className="px-4 py-3 text-center">
                          <input
                            type="checkbox"
                            checked={selectedRlcs.has(p.id_rlc)}
                            onChange={(e) => toggleRlc(p.id_rlc, e.target.checked)}
                            className="rounded border-marino-600 bg-marino-800 accent-acento"
                          />
                        </td>
                        <td className="px-4 py-3 font-display text-base text-niebla">{p.lema}</td>
                        <td className="px-4 py-3 text-center text-xs font-mono text-niebla/70">
                          {p.num_acepciones}
                        </td>
                        <td className="px-4 py-3 text-xs text-niebla/55">
                          {p.fecha_extraccion
                            ? new Date(p.fecha_extraccion).toLocaleString("es-PE")
                            : "—"}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="inline-flex items-center gap-2">
                            <button
                              onClick={() =>
                                setRlcModal({ open: true, lema: p.lema, content: p.rlc_json })
                              }
                              className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-marino-600/50 text-niebla/75 hover:text-niebla hover:bg-marino-700/50 transition-colors"
                            >
                              <FileJson className="w-3.5 h-3.5" />
                              Ver RLC
                            </button>
                            <button
                              onClick={() => handleProcessOne(p.id_rlc)}
                              disabled={processingId !== null || isJobRunning}
                              className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-acento/15 border border-acento/35 text-acento hover:bg-acento hover:text-marino-900 font-medium transition-colors disabled:opacity-40"
                            >
                              <Play className="w-3.5 h-3.5" />
                              {processingId === p.id_rlc ? "Procesando…" : "Procesar"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <Pagination page={pageP} totalPages={totalPagesP} onPageChange={setPageP} />
        </div>
      )}

      {/* ══════════════════ TAB PROCESADOS (UCEs) ══════════════════ */}
      {activeTab === "procesados" && (
        <div className="space-y-4">
          <div className="bg-marino-900/60 border border-marino-600/40 rounded-lg p-4 space-y-3">
            {/* Herramienta de enganche Fase 3 sobre UCEs históricas */}
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-marino-600/30">
              <p className="text-xs text-niebla/60">
                Genera propuestas de sinónimo / hiperónimo y grafos para UCEs sin enganche Fase 3.
              </p>
              <div className="flex items-center gap-2">
                <select
                  value={engancheCantidad}
                  onChange={(e) => setEngancheCantidad(Number(e.target.value))}
                  className="bg-marino-800 border border-marino-600/50 rounded-md px-2.5 py-1.5 text-xs text-niebla focus:border-acento focus:outline-none"
                >
                  <option value={25}>25 UCEs</option>
                  <option value={50}>50 UCEs</option>
                  <option value={100}>100 UCEs</option>
                  <option value={250}>250 UCEs</option>
                </select>
                <button
                  onClick={handleEngancharPendientes}
                  disabled={isJobRunning}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-acento/15 border border-acento/40 text-acento hover:bg-acento hover:text-marino-900 text-xs font-medium transition-colors disabled:opacity-40"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  Enganchar Fase 3
                </button>
              </div>
            </div>

            {/* Filtros */}
            <div className="flex flex-wrap items-center gap-2.5 text-sm">
              <input
                type="text"
                placeholder="Buscar lema…"
                value={lemaE}
                onChange={(e) => setLemaE(e.target.value)}
                className="bg-marino-800 border border-marino-600/50 rounded-md px-3 py-1.5 text-niebla placeholder:text-niebla/30 w-44 focus:border-acento focus:outline-none"
              />
              <select
                value={posMcr}
                onChange={(e) => setPosMcr(e.target.value)}
                className="bg-marino-800 border border-marino-600/50 rounded-md px-2.5 py-1.5 text-niebla focus:border-acento focus:outline-none"
              >
                <option value="">Categoría: todas</option>
                <option value="n">Sustantivo (n)</option>
                <option value="v">Verbo (v)</option>
                <option value="a">Adjetivo (a)</option>
                <option value="r">Adverbio (r)</option>
              </select>
              <select
                value={tipoPeruanismo}
                onChange={(e) => setTipoPeruanismo(e.target.value)}
                className="bg-marino-800 border border-marino-600/50 rounded-md px-2.5 py-1.5 text-niebla focus:border-acento focus:outline-none"
              >
                <option value="">Tipo: todos</option>
                <option value="tipo_2_lexico">Léxico (T2)</option>
                <option value="tipo_1_semantico">Semántico (T1)</option>
                <option value="ya_presente">Ya presente</option>
                <option value="indeterminado">Indeterminado</option>
              </select>
              <div className="flex gap-2 ml-auto">
                <button
                  onClick={() => { setPageE(1); loadProcesados(1); }}
                  className="px-3.5 py-1.5 rounded-md bg-marino-700 hover:bg-marino-600 text-niebla text-xs font-medium"
                >
                  Filtrar
                </button>
                <button
                  onClick={() => {
                    setLemaE(""); setPosMcr(""); setTipoPeruanismo(""); setPageE(1);
                    setTimeout(() => loadProcesados(1), 0);
                  }}
                  className="px-2.5 py-1.5 text-xs text-niebla/50 hover:text-niebla"
                >
                  Limpiar
                </button>
              </div>
            </div>

            {selectedUces.size > 0 && (
              <div className="flex items-center justify-between gap-4 bg-red-950/40 border border-red-500/30 rounded-md px-3.5 py-2">
                <span className="text-xs text-red-200">
                  {selectedUces.size} UCE(s) seleccionadas
                </span>
                <button
                  onClick={() => setConfirmDescarte(true)}
                  className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-red-600/80 hover:bg-red-600 text-white font-medium transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Descartar seleccionadas
                </button>
              </div>
            )}
          </div>

          {/* Tabla UCEs */}
          <div className="bg-marino-900/40 border border-marino-600/30 rounded-lg overflow-hidden">
            {loadingE ? (
              <LoadingSpinner text="Cargando UCEs procesados…" />
            ) : procesados.length === 0 ? (
              <div className="py-16 text-center text-niebla/45 text-sm">
                No se encontraron UCEs con estos filtros.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="bg-marino-900 text-niebla/50 text-[11px] uppercase tracking-wider border-b border-marino-600/30">
                    <tr>
                      <th className="px-4 py-3 w-10 text-center">
                        <input
                          type="checkbox"
                          checked={procesados.length > 0 && selectedUces.size === procesados.length}
                          onChange={(e) =>
                            setSelectedUces(
                              e.target.checked ? new Set(procesados.map((p) => p.id_uce)) : new Set()
                            )
                          }
                          className="rounded border-marino-600 bg-marino-800 accent-acento"
                        />
                      </th>
                      <th className="px-4 py-3 font-medium">Lema</th>
                      <th className="px-4 py-3 font-medium text-center">Acep.</th>
                      <th className="px-4 py-3 font-medium text-center">POS</th>
                      <th className="px-4 py-3 font-medium">Tipo</th>
                      <th className="px-4 py-3 font-medium">Enganche F3</th>
                      <th className="px-4 py-3 font-medium text-right">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-marino-600/20">
                    {procesados.map((u) => {
                      const relProp = u.uce_completo?.relaciones?.relacion_propuesta;
                      const relBadge = RELACION_BADGE[relProp];
                      return (
                        <tr key={u.id_uce} className="hover:bg-marino-700/25 transition-colors">
                          <td className="px-4 py-3 text-center">
                            <input
                              type="checkbox"
                              checked={selectedUces.has(u.id_uce)}
                              onChange={(e) => toggleUce(u.id_uce, e.target.checked)}
                              className="rounded border-marino-600 bg-marino-800 accent-acento"
                            />
                          </td>
                          <td className="px-4 py-3">
                            <p className="font-display text-base text-niebla">{u.lema}</p>
                            <p className="text-xs text-niebla/45 line-clamp-1 max-w-xs">
                              {u.base_gloss || "—"}
                            </p>
                          </td>
                          <td className="px-4 py-3 text-center font-mono text-xs text-niebla/65">
                            #{u.numero_acepcion}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className="px-2 py-0.5 rounded text-xs font-mono bg-marino-900 text-acento border border-marino-600/50">
                              {u.pos_mcr}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <TipoBadge tipo={u.tipo_peruanismo} />
                          </td>
                          <td className="px-4 py-3">
                            {relBadge ? (
                              <span className={`text-[11px] px-2.5 py-0.5 rounded-full border ${relBadge.cls}`}>
                                {relBadge.label}
                              </span>
                            ) : (
                              <span className="text-[11px] text-niebla/35">Sin enganche</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="inline-flex items-center gap-2">
                              <button
                                onClick={() =>
                                  setUceModal({ open: true, content: u.uce_completo, tab: "grafo" })
                                }
                                className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-acento/15 border border-acento/35 text-acento hover:bg-acento hover:text-marino-900 font-medium transition-colors"
                              >
                                <GitBranch className="w-3.5 h-3.5" />
                                Grafo
                              </button>
                              <button
                                onClick={() =>
                                  setUceModal({ open: true, content: u.uce_completo, tab: "detalle" })
                                }
                                className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-marino-600/50 text-niebla/75 hover:text-niebla hover:bg-marino-700/50 transition-colors"
                              >
                                <Eye className="w-3.5 h-3.5" />
                                JSON
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

          <Pagination page={pageE} totalPages={totalPagesE} onPageChange={setPageE} />
        </div>
      )}

      {/* ══════════════════ MODAL RLC ══════════════════ */}
      <Modal
        open={rlcModal.open}
        onClose={() => setRlcModal({ open: false, lema: "", content: null })}
        title={`Registro Léxico Crudo · ${rlcModal.lema}`}
        subtitle="Entrada capturada desde DiPerú"
      >
        <div className="bg-marino-800/80 border border-marino-600/40 rounded-lg p-4 overflow-x-auto">
          <pre className="font-mono text-xs text-acento-claro whitespace-pre-wrap leading-relaxed">
            {JSON.stringify(rlcModal.content, null, 2)}
          </pre>
        </div>
      </Modal>

      {/* ══════════════════ MODAL UCE (GRAFO + JSON) ══════════════════ */}
      <Modal
        open={uceModal.open}
        onClose={() => setUceModal({ open: false, content: null, tab: "grafo" })}
        title={`Unidad de Conocimiento Explícito · ${uceModal.content?.lema || ""}`}
        subtitle={`Acepción #${uceModal.content?.numero_acepcion || 1} · POS: ${uceModal.content?.pos_mcr || "—"}`}
        headerExtra={
          <div className="flex gap-1.5 bg-marino-800 p-1 rounded-md border border-marino-600/40">
            <button
              onClick={() => setUceModal((m) => ({ ...m, tab: "grafo" }))}
              className={`px-3 py-1 text-xs rounded transition-colors ${
                uceModal.tab === "grafo"
                  ? "bg-acento text-marino-900 font-semibold"
                  : "text-niebla/65 hover:text-niebla"
              }`}
            >
              Grafo Semántico
            </button>
            <button
              onClick={() => setUceModal((m) => ({ ...m, tab: "detalle" }))}
              className={`px-3 py-1 text-xs rounded transition-colors ${
                uceModal.tab === "detalle"
                  ? "bg-acento text-marino-900 font-semibold"
                  : "text-niebla/65 hover:text-niebla"
              }`}
            >
              Detalle JSON
            </button>
          </div>
        }
      >
        {uceModal.tab === "grafo" ? (
          <NetworkViewer uceData={uceModal.content} />
        ) : (
          <div className="bg-marino-800/80 border border-marino-600/40 rounded-lg p-4 overflow-x-auto">
            <pre className="font-mono text-xs text-acento-claro whitespace-pre-wrap leading-relaxed">
              {JSON.stringify(uceModal.content, null, 2)}
            </pre>
          </div>
        )}
      </Modal>

      {/* ══════════════════ CONFIRMACIÓN DESCARTE MASIVO ══════════════════ */}
      <ConfirmDialog
        open={confirmDescarte}
        title="Descartar UCEs seleccionadas"
        description={`Se marcarán ${selectedUces.size} UCE(s) como rechazadas y dejarán de aparecer en la bandeja de salida del Analista. ¿Deseas continuar?`}
        confirmLabel="Sí, descartar"
        danger
        loading={descartando}
        onConfirm={handleConfirmDescartar}
        onCancel={() => setConfirmDescarte(false)}
      />

      {/* ══════════════════ TARJETA FLOTANTE DE LOTE ══════════════════ */}
      {isJobRunning && (
        <div className="fixed bottom-5 right-5 z-40 w-[calc(100vw-2.5rem)] max-w-sm">
          <div className="bg-marino-900 border border-acento/40 rounded-xl shadow-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 text-acento animate-spin" />
                <h3 className="font-display text-sm text-acento">
                  {jobProgress.tipo === "enganche_masivo"
                    ? "Enganche Fase 3"
                    : jobProgress.tipo === "resolver_remisiones"
                    ? "Re-resolviendo remisiones"
                    : "Procesamiento en lote"}
                </h3>
              </div>
              <span className="text-xs font-mono text-niebla/75">
                {jobProgress.actual}/{jobProgress.total}
              </span>
            </div>
            <div className="w-full h-2 bg-marino-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-acento transition-all duration-300"
                style={{
                  width: `${Math.min(
                    100,
                    (jobProgress.actual / Math.max(1, jobProgress.total)) * 100
                  )}%`,
                }}
              />
            </div>
            <div className="flex items-center justify-between text-[11px] text-niebla/60">
              <span>Exitosos: <strong className="text-emerald-400">{jobProgress.exitosos ?? 0}</strong></span>
              <span>Fallidos: <strong className="text-red-400">{jobProgress.fallidos ?? 0}</strong></span>
            </div>
            <p className="text-xs font-mono text-acento-claro/85 truncate">{jobProgress.mensaje}</p>
          </div>
        </div>
      )}
    </div>
  );
}