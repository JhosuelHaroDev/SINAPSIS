"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Search, ArrowRight, RefreshCw } from "lucide-react";
import { fetchLexicografoPropuestas } from "@/services/api";
import { TipoBadge } from "@/components/peruanismos/TipoBadge";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { Pagination } from "@/components/ui/Pagination";

const PAGE_SIZE = 20;

const TABS_ESTADO = [
  { id: "pendiente", label: "Pendientes", dot: "bg-acento" },
  { id: "observado", label: "Observados", dot: "bg-amber-400" },
  { id: "aceptado", label: "Aceptados", dot: "bg-emerald-400" },
  { id: "rechazado", label: "Rechazados", dot: "bg-red-400" },
];

const TIPOS = [
  { id: "", label: "Todos" },
  { id: "tipo_2_lexico", label: "Léxico nuevo (T2)" },
  { id: "tipo_1_semantico", label: "Sentido nuevo (T1)" },
  { id: "indeterminado", label: "Indeterminado" },
];

const REL_LABELS = {
  near_synonym: "Sinónimo",
  has_hyperonym: "Hiperónimo",
  variante_existente: "Ya en MCR",
};

export default function LexicografoPage() {
  const [estado, setEstado] = useState("pendiente");
  const [filtroTipo, setFiltroTipo] = useState("");
  const [incluirYaPresente, setIncluirYaPresente] = useState(false);
  const [queryInput, setQueryInput] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [page, setPage] = useState(1);

  const [propuestas, setPropuestas] = useState([]);
  const [total, setTotal] = useState(0);
  const [conteos, setConteos] = useState({
    pendiente: 0,
    observado: 0,
    aceptado: 0,
    rechazado: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedQ(queryInput);
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [queryInput]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await fetchLexicografoPropuestas({
        tipo: filtroTipo || undefined,
        estado,
        q: debouncedQ || undefined,
        incluir_ya_presente: incluirYaPresente,
        page,
        size: PAGE_SIZE,
      });
      setPropuestas(data.items || []);
      setTotal(data.total || 0);
      if (data.conteos_estado) setConteos(data.conteos_estado);
    } catch (err) {
      setError(`Error al cargar propuestas: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [estado, filtroTipo, debouncedQ, incluirYaPresente, page]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <p className="text-acento text-xs tracking-[0.25em] uppercase mb-2">
            Fase 4 · Internalización
          </p>
          <h1 className="font-display text-2xl sm:text-3xl text-niebla leading-tight">
            Bandeja de Curaduría Lexicográfica
          </h1>
          <p className="text-niebla/55 text-sm mt-1.5">
            Evalúa, corrige y valida las propuestas generadas antes de su integración definitiva en WordNet.
          </p>
        </div>

        <button
          onClick={loadData}
          className="inline-flex items-center gap-2 self-start sm:self-auto px-3.5 py-2 text-xs rounded-md border border-marino-600/50 text-niebla/70 hover:text-acento hover:border-acento/40 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refrescar
        </button>
      </div>

      {/* Pestañas de estado */}
      <div className="flex flex-wrap gap-2 border-b border-marino-600/40">
        {TABS_ESTADO.map((t) => {
          const active = estado === t.id;
          return (
            <button
              key={t.id}
              onClick={() => {
                setEstado(t.id);
                setPage(1);
              }}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
                active
                  ? "border-acento text-acento"
                  : "border-transparent text-niebla/55 hover:text-niebla"
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${t.dot}`} />
              {t.label}
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-marino-900 border border-marino-600/50 text-niebla/75">
                {(conteos[t.id] || 0).toLocaleString("es-PE")}
              </span>
            </button>
          );
        })}
      </div>

      {/* Filtros */}
      <div className="bg-marino-900/60 border border-marino-600/40 rounded-lg p-4 flex flex-col lg:flex-row lg:items-center gap-3 justify-between">
        <div className="flex flex-wrap gap-1.5">
          {TIPOS.map((t) => (
            <button
              key={t.id}
              onClick={() => {
                setFiltroTipo(t.id);
                setPage(1);
              }}
              className={`px-3 py-1.5 rounded-md text-xs transition-colors border ${
                filtroTipo === t.id
                  ? "bg-acento text-marino-900 border-acento font-semibold"
                  : "bg-marino-800/70 text-niebla/65 border-marino-600/40 hover:text-niebla"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex items-center gap-2 text-xs text-niebla/65 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={incluirYaPresente}
              onChange={(e) => {
                setIncluirYaPresente(e.target.checked);
                setPage(1);
              }}
              className="rounded border-marino-600 bg-marino-800 accent-acento"
            />
            Incluir &ldquo;Ya presente&rdquo;
          </label>

          <div className="relative">
            <Search className="w-3.5 h-3.5 text-niebla/40 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={queryInput}
              onChange={(e) => setQueryInput(e.target.value)}
              placeholder="Buscar lema…"
              className="bg-marino-800 border border-marino-600/50 rounded-md pl-8 pr-3 py-1.5 text-sm text-niebla placeholder:text-niebla/30 w-48 focus:border-acento focus:outline-none"
            />
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-950/50 text-red-300 p-4 rounded-lg border border-red-500/30 text-sm">
          {error}
        </div>
      )}

      {/* Listado */}
      {loading ? (
        <LoadingSpinner text="Cargando propuestas…" />
      ) : propuestas.length === 0 ? (
        <div className="py-16 text-center bg-marino-900/40 border border-marino-600/30 rounded-lg text-niebla/45 text-sm">
          No hay propuestas en estado &ldquo;{estado}&rdquo; con estos filtros.
        </div>
      ) : (
        <div className="space-y-3">
          {propuestas.map((p) => (
            <div
              key={p.id_uce}
              className="bg-marino-900/40 border border-marino-600/30 rounded-lg p-4 sm:p-5 flex flex-col md:flex-row gap-4 items-start md:items-center justify-between hover:border-acento/40 hover:bg-marino-700/20 transition-all"
            >
              <div className="flex-1 min-w-0 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2.5">
                  <h3 className="font-display text-lg text-niebla">{p.lema}</h3>
                  <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-marino-800 border border-marino-600/40 text-niebla/60">
                    {p.pos_mcr} · #{p.numero_acepcion}
                  </span>
                  <TipoBadge tipo={p.tipo_peruanismo} />
                  {p.relacion_propuesta && (
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-acento/10 text-acento border border-acento/25">
                      {REL_LABELS[p.relacion_propuesta] || p.relacion_propuesta}
                    </span>
                  )}
                  {p.sim_mcr != null && (
                    <span className="text-[11px] font-mono text-niebla/45">
                      cos {(p.sim_mcr * 100).toFixed(1)}%
                    </span>
                  )}
                </div>

                <p className="text-sm text-niebla/70 line-clamp-2">{p.glosa || "Sin glosa"}</p>

                {p.notas_revision && (
                  <p className="text-xs text-amber-300/80 italic line-clamp-1">
                    Nota: {p.notas_revision}
                  </p>
                )}
              </div>

              <Link
                href={`/dashboard/lexicografo/${p.id_uce}`}
                className="inline-flex items-center gap-1.5 whitespace-nowrap px-4 py-2 rounded-md bg-acento/15 border border-acento/35 text-acento hover:bg-acento hover:text-marino-900 text-xs font-medium transition-colors"
              >
                {estado === "pendiente" || estado === "observado" ? "Evaluar ficha" : "Ver ficha"}
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          ))}
        </div>
      )}

      <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
    </div>
  );
}