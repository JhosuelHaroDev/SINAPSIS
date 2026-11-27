"use client";

import { useState, useEffect } from "react";
import { FileDown, Search, AlertTriangle, Cpu, CheckSquare } from "lucide-react";
import { useApi } from "@/hooks/useApi";
import { fetchAuditoria, getAuditoriaExportUrl } from "@/services/api";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { Pagination } from "@/components/ui/Pagination";

const CONFIANZA_STYLES = {
  alta: "text-emerald-300 bg-emerald-500/10 border-emerald-500/25",
  media: "text-amber-300 bg-amber-500/10 border-amber-500/25",
  baja: "text-red-300 bg-red-500/10 border-red-500/25",
};

const DECISION_STYLES = {
  aceptar: "text-emerald-300 bg-emerald-500/10 border-emerald-500/25",
  observar: "text-amber-300 bg-amber-500/10 border-amber-500/25",
  rechazar: "text-red-300 bg-red-500/10 border-red-500/25",
};

export default function AuditoriaPage() {
  const [queryInput, setQueryInput] = useState("");
  const [filters, setFilters] = useState({
    origen: "",
    fase: "",
    q: "",
    revision: null,
    page: 1,
    size: 20,
  });

  useEffect(() => {
    const t = setTimeout(() => {
      setFilters((f) => ({ ...f, q: queryInput, page: 1 }));
    }, 350);
    return () => clearTimeout(t);
  }, [queryInput]);

  const { data, loading } = useApi(
    () => fetchAuditoria(filters),
    [filters.origen, filters.fase, filters.q, filters.revision, filters.page]
  );

  const items = data?.items || [];
  const total = data?.total || 0;
  const resumen = data?.resumen || {
    total_pipeline: 0,
    total_curaduria: 0,
    requieren_revision: 0,
  };
  const fasesDisponibles = data?.filtros?.fases || [];
  const totalPages = Math.ceil(total / filters.size);
  const exportUrl = getAuditoriaExportUrl(filters);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <p className="text-acento text-xs tracking-[0.25em] uppercase mb-2">
            Supervisión · Trazabilidad Unificada
          </p>
          <h1 className="font-display text-2xl sm:text-3xl text-niebla leading-tight">
            Registro de Auditoría
          </h1>
          <p className="text-niebla/55 text-sm mt-1.5">
            Incidencias automáticas del pipeline SECI y decisiones curatoriales del lexicógrafo.
          </p>
        </div>

        <a
          href={exportUrl}
          download="auditoria_sinapsis.csv"
          className="inline-flex items-center gap-2 self-start sm:self-auto px-4 py-2 rounded-md bg-acento/15 border border-acento/40 text-acento hover:bg-acento hover:text-marino-900 text-xs font-semibold transition-colors"
        >
          <FileDown className="w-4 h-4" />
          Exportar CSV
        </a>
      </div>

      {/* KPIs de trazabilidad */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-marino-900/60 border border-marino-600/35 rounded-lg p-4">
          <p className="text-[10px] uppercase tracking-widest text-niebla/45 mb-1">
            Eventos de Pipeline
          </p>
          <p className="font-display text-2xl text-niebla">
            {resumen.total_pipeline.toLocaleString("es-PE")}
          </p>
          <p className="text-[11px] text-niebla/40 mt-0.5">
            Inferencias LLM y limpiezas manuales
          </p>
        </div>

        <div className="bg-marino-900/60 border border-marino-600/35 rounded-lg p-4">
          <p className="text-[10px] uppercase tracking-widest text-niebla/45 mb-1">
            Decisiones de Curaduría
          </p>
          <p className="font-display text-2xl text-acento">
            {resumen.total_curaduria.toLocaleString("es-PE")}
          </p>
          <p className="text-[11px] text-niebla/40 mt-0.5">
            Aceptaciones, observaciones y rechazos
          </p>
        </div>

        <div className="bg-marino-900/60 border border-marino-600/35 rounded-lg p-4">
          <p className="text-[10px] uppercase tracking-widest text-niebla/45 mb-1">
            Requieren Revisión
          </p>
          <p className="font-display text-2xl text-amber-300">
            {resumen.requieren_revision.toLocaleString("es-PE")}
          </p>
          <p className="text-[11px] text-niebla/40 mt-0.5">
            Confianza baja, inciertos u observados
          </p>
        </div>
      </div>

      {/* Filtros */}
      <div className="bg-marino-900/60 border border-marino-600/40 rounded-lg p-4 flex flex-wrap items-center gap-3">
        <div className="flex gap-1.5">
          {[
            { id: "", label: "Todos" },
            { id: "pipeline", label: "Pipeline" },
            { id: "curaduria", label: "Curaduría" },
          ].map((op) => (
            <button
              key={op.id}
              onClick={() => setFilters({ ...filters, origen: op.id, page: 1 })}
              className={`px-3 py-1.5 rounded-md text-xs border transition-colors ${
                filters.origen === op.id
                  ? "bg-acento text-marino-900 border-acento font-semibold"
                  : "bg-marino-800/70 text-niebla/65 border-marino-600/40 hover:text-niebla"
              }`}
            >
              {op.label}
            </button>
          ))}
        </div>

        <select
          value={filters.fase}
          onChange={(e) => setFilters({ ...filters, fase: e.target.value, page: 1 })}
          className="bg-marino-800 border border-marino-600/50 rounded-md px-3 py-1.5 text-xs text-niebla focus:border-acento focus:outline-none"
        >
          <option value="">Todas las fases</option>
          {fasesDisponibles.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>

        <button
          onClick={() =>
            setFilters({
              ...filters,
              revision: filters.revision === true ? null : true,
              page: 1,
            })
          }
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border transition-colors ${
            filters.revision === true
              ? "bg-amber-500/15 border-amber-500/35 text-amber-300"
              : "border-marino-600/50 text-niebla/60 hover:text-niebla"
          }`}
        >
          <AlertTriangle className="w-3.5 h-3.5" />
          Requiere revisión
        </button>

        <div className="relative ml-auto">
          <Search className="w-3.5 h-3.5 text-niebla/40 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={queryInput}
            onChange={(e) => setQueryInput(e.target.value)}
            placeholder="Filtrar por lema…"
            className="bg-marino-800 border border-marino-600/50 rounded-md pl-8 pr-3 py-1.5 text-xs text-niebla placeholder:text-niebla/30 w-44 focus:border-acento focus:outline-none"
          />
        </div>
      </div>

      {/* Línea de tiempo */}
      {loading ? (
        <LoadingSpinner text="Cargando registros de auditoría…" />
      ) : items.length === 0 ? (
        <div className="py-16 text-center bg-marino-900/40 border border-marino-600/30 rounded-lg text-niebla/45 text-sm">
          No se encontraron eventos con los filtros seleccionados.
        </div>
      ) : (
        <>
          <div className="bg-marino-900/40 border border-marino-600/30 rounded-lg divide-y divide-marino-600/20 overflow-hidden">
            {items.map((item) => {
              const isCuraduria = item.origen === "curaduria";
              return (
                <div key={item.uid} className="px-5 py-4 space-y-2 hover:bg-marino-700/15 transition-colors">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <span
                        className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-wider px-2 py-0.5 rounded border ${
                          isCuraduria
                            ? "bg-acento/15 text-acento border-acento/30"
                            : "bg-sky-500/10 text-sky-300 border-sky-500/25"
                        }`}
                      >
                        {isCuraduria ? (
                          <CheckSquare className="w-3 h-3" />
                        ) : (
                          <Cpu className="w-3 h-3" />
                        )}
                        {isCuraduria ? "Curaduría" : "Pipeline"}
                      </span>

                      <span className="font-display text-base text-niebla">
                        {item.lema || "—"}
                      </span>

                      {item.numero_acepcion != null && (
                        <span className="text-[11px] font-mono text-niebla/45">
                          acep. #{item.numero_acepcion}
                        </span>
                      )}

                      {item.pos_mcr && (
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-marino-800 border border-marino-600/40 text-niebla/60">
                          {item.pos_mcr}
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {isCuraduria && item.resultado && (
                        <span
                          className={`text-[10px] uppercase px-2 py-0.5 rounded border ${
                            DECISION_STYLES[item.resultado] || "text-niebla/60 border-marino-600/40"
                          }`}
                        >
                          {item.resultado}
                        </span>
                      )}
                      {item.confianza && (
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded border ${
                            CONFIANZA_STYLES[item.confianza] || "text-niebla/50 border-marino-600/30"
                          }`}
                        >
                          confianza: {item.confianza}
                        </span>
                      )}
                      {item.requiere_revision && (
                        <span className="text-[10px] text-amber-300 bg-amber-500/10 border border-amber-500/25 px-2 py-0.5 rounded">
                          Revisar
                        </span>
                      )}
                      <span className="text-[11px] text-niebla/40">
                        {item.creado_en
                          ? new Date(item.creado_en).toLocaleString("es-PE")
                          : "—"}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-niebla/50">
                    <span>
                      <span className="text-niebla/30">Fase:</span> {item.fase}
                    </span>
                    <span>
                      <span className="text-niebla/30">Tipo:</span> {item.tipo}
                    </span>
                    {!isCuraduria && item.resultado && (
                      <span>
                        <span className="text-niebla/30">Resultado:</span> {item.resultado}
                      </span>
                    )}
                    {item.tipo_relacion && (
                      <span>
                        <span className="text-niebla/30">Relación:</span>{" "}
                        <span className="font-mono text-acento/85">{item.tipo_relacion}</span>
                      </span>
                    )}
                    {item.offset_final && (
                      <span>
                        <span className="text-niebla/30">Offset:</span>{" "}
                        <span className="font-mono text-niebla/75">
                          {item.offset_sugerido && item.offset_sugerido !== item.offset_final
                            ? `${item.offset_sugerido} → ${item.offset_final}`
                            : item.offset_final}
                        </span>
                      </span>
                    )}
                  </div>

                  {item.glosa && (
                    <p className="text-xs text-niebla/45 line-clamp-1">
                      <span className="text-niebla/30">Glosa:</span> {item.glosa}
                    </p>
                  )}
                  {item.justificacion && (
                    <p className="text-xs text-niebla/70">
                      <span className="text-niebla/35">Justificación / Nota:</span>{" "}
                      {item.justificacion}
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          <Pagination
            page={filters.page}
            totalPages={totalPages}
            onPageChange={(p) => setFilters({ ...filters, page: p })}
          />
        </>
      )}
    </div>
  );
}