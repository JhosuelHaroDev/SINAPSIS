"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Search,
  Check,
  AlertTriangle,
  X,
  GitBranch,
  History,
  Sparkles,
  BookOpen,
} from "lucide-react";
import {
  fetchPropuestaDetalle,
  revisarPropuesta,
  buscarSynsetsMCR,
} from "@/services/api";
import NetworkViewer from "@/components/NetworkViewer";
import { TipoBadge } from "@/components/peruanismos/TipoBadge";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { Toast } from "@/components/ui/Toast";

const RELACION_OPCIONES = [
  {
    id: "has_hyperonym",
    label: "Hiperónimo (crear synset)",
    desc: "Concepto propio que se enlaza como hipónimo bajo el synset elegido.",
  },
  {
    id: "near_synonym",
    label: "Sinónimo (agregar variante)",
    desc: "Equivalente léxico directo que se integra dentro del synset existente.",
  },
  {
    id: "variante_existente",
    label: "Ya cubierto en WordNet",
    desc: "El sentido ya está representado en el MCR sin necesidad de inserción.",
  },
];

const ESTADO_STYLES = {
  pendiente: "bg-acento/15 text-acento border-acento/30",
  observado: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  aceptado: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  rechazado: "bg-red-500/15 text-red-300 border-red-500/30",
};

export default function PropuestaDetallePage({ params }) {
  const router = useRouter();
  const { id } = params;

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState({ message: "", type: "info" });

  // Estado curatorial editable
  const [notas, setNotas] = useState("");
  const [selectedSynset, setSelectedSynset] = useState(null);
  const [tipoRelacion, setTipoRelacion] = useState("has_hyperonym");

  // Buscador manual MCR
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const searchTimeoutRef = useRef(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const res = await fetchPropuestaDetalle(id);
        setData(res);
        setNotas(res.propuesta?.notas_revision || "");
        setSelectedSynset(res.synset_mas_cercano || res.relaciones?.synset_objetivo || null);
        setTipoRelacion(
          res.relaciones?.relacion_propuesta ||
            (res.clasificacion?.tipo === "ya_presente" ? "variante_existente" : "has_hyperonym")
        );
      } catch (err) {
        setToast({ message: `Error cargando ficha: ${err.message}`, type: "error" });
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [id]);

  // Previsualización viva del grafo si el lexicógrafo cambia synset o relación
  const liveUceForGraph = useMemo(() => {
    if (!data) return null;
    const baseRel = data.relaciones || {};
    const aristasBase = Array.isArray(baseRel.relaciones_grafo) ? baseRel.relaciones_grafo : [];
    const secundarias = aristasBase.filter((a) => !a.principal);

    const etiquetaMap = {
      near_synonym: "sinónimo (near_synonym)",
      has_hyperonym: "es un / hiperónimo (has_hyperonym)",
      variante_existente: "ya en WordNet",
    };

    const aristasVivas = selectedSynset
      ? [
          {
            tipo: tipoRelacion,
            etiqueta: etiquetaMap[tipoRelacion] || tipoRelacion,
            target_offset: selectedSynset.offset,
            target_sinonimos: selectedSynset.sinonimos,
            target_glosa: selectedSynset.glosa_es || selectedSynset.glosa_en,
            score: selectedSynset.similitud ?? selectedSynset.score_coseno ?? null,
            principal: true,
          },
          ...secundarias.filter((s) => s.target_offset !== selectedSynset.offset),
        ]
      : aristasBase;

    return {
      lema: data.peruanismo.lema,
      pos_mcr: data.peruanismo.pos,
      numero_acepcion: data.peruanismo.numero_acepcion,
      base_gloss: data.peruanismo.glosa,
      tipo_peruanismo: data.clasificacion.tipo,
      relaciones: {
        ...baseRel,
        relacion_propuesta: tipoRelacion,
        relaciones_grafo: aristasVivas,
      },
    };
  }, [data, selectedSynset, tipoRelacion]);

  const handleSearchChange = (e) => {
    const val = e.target.value;
    setSearchTerm(val);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);

    if (val.trim().length < 2) {
      setSearchResults([]);
      return;
    }

    searchTimeoutRef.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const results = await buscarSynsetsMCR(val, data?.peruanismo?.pos);
        setSearchResults(results);
      } catch {
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 350);
  };

  const handleDecision = async (decision) => {
    if ((decision === "rechazar" || decision === "observar") && !notas.trim()) {
      setToast({
        message: "Escribe un motivo en las notas para observar o rechazar la propuesta.",
        type: "error",
      });
      return;
    }

    setSaving(true);
    try {
      const offsetOriginal = data?.synset_mas_cercano?.offset || null;
      const nuevoOffset =
        selectedSynset && selectedSynset.offset !== offsetOriginal
          ? selectedSynset.offset
          : null;

      await revisarPropuesta(id, decision, notas, nuevoOffset, tipoRelacion);
      router.push("/dashboard/lexicografo");
    } catch (err) {
      setToast({ message: `Error al guardar decisión: ${err.message}`, type: "error" });
      setSaving(false);
    }
  };

  if (loading) return <LoadingSpinner text="Cargando ficha de curaduría…" />;
  if (!data) {
    return (
      <div className="py-16 text-center space-y-3">
        <p className="text-red-300 text-sm">No se pudo cargar la propuesta.</p>
        <button
          onClick={() => router.push("/dashboard/lexicografo")}
          className="text-xs text-acento underline"
        >
          Volver a la bandeja
        </button>
      </div>
    );
  }

  const { peruanismo, clasificacion, relaciones, propuesta, historial_auditoria } = data;
  const candidatosTop = Array.isArray(relaciones?.candidatos) ? relaciones.candidatos : [];
  const evidenciaCriba = relaciones?.evidencia_criba;

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-12">
      <Toast
        message={toast.message}
        type={toast.type}
        onClose={() => setToast({ message: "", type: "info" })}
      />

      {/* Cabecera */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <button
            onClick={() => router.back()}
            className="inline-flex items-center gap-1.5 text-xs text-niebla/50 hover:text-acento transition-colors mb-1"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Volver a curaduría
          </button>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-display text-3xl text-niebla">{peruanismo.lema}</h1>
            <span className="text-xs font-mono px-2 py-0.5 rounded bg-marino-900 border border-marino-600/50 text-niebla/70">
              POS: {peruanismo.pos} · Acep. #{peruanismo.numero_acepcion}
            </span>
            <TipoBadge tipo={clasificacion.tipo} />
          </div>
          <p className="text-xs text-niebla/55">{clasificacion.tipo_legible}</p>
        </div>

        <span
          className={`self-start sm:self-center text-xs uppercase tracking-wider px-3 py-1 rounded-full border font-medium ${
            ESTADO_STYLES[propuesta.estado_revision] || ESTADO_STYLES.pendiente
          }`}
        >
          Estado: {propuesta.estado_revision}
        </span>
      </div>

      {/* Grid principal: Ficha DiPerú + Enganche WordNet */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Columna 1: Evidencia lexicográfica DiPerú */}
        <div className="bg-marino-900/50 border border-marino-600/35 rounded-lg p-6 space-y-5">
          <div className="flex items-center gap-2 border-b border-marino-600/30 pb-3">
            <BookOpen className="w-4 h-4 text-acento" />
            <h2 className="font-display text-lg text-niebla">Evidencia DiPerú (UCE)</h2>
          </div>

          <div>
            <p className="text-[10px] uppercase tracking-widest text-niebla/45 mb-1.5">
              Definición ({peruanismo.glosa_origen === "glosa_referida" ? "Referida por remisión" : "Glosa propia"})
            </p>
            <p className="text-base text-niebla leading-relaxed">{peruanismo.glosa}</p>
          </div>

          {peruanismo.ejemplo && (
            <div>
              <p className="text-[10px] uppercase tracking-widest text-niebla/45 mb-1.5">
                Ejemplo de uso
              </p>
              <p className="text-sm text-niebla/80 italic border-l-2 border-acento/60 pl-3.5 py-0.5">
                «{peruanismo.ejemplo}»
              </p>
            </div>
          )}

          {peruanismo.marcas &&
            Object.values(peruanismo.marcas).some((v) => Array.isArray(v) && v.length > 0) && (
              <div>
                <p className="text-[10px] uppercase tracking-widest text-niebla/45 mb-2">
                  Marcas lexicográficas
                </p>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(peruanismo.marcas)
                    .filter(([, v]) => Array.isArray(v) && v.length > 0)
                    .map(([cat, list]) =>
                      list.map((m, idx) => (
                        <span
                          key={`${cat}-${idx}`}
                          title={m.expansion || undefined}
                          className="text-xs bg-marino-800 border border-marino-600/50 text-niebla/80 px-2.5 py-1 rounded-md"
                        >
                          <strong className="capitalize text-acento/85 font-medium">{cat}:</strong>{" "}
                          {m.abrev}
                          {m.expansion ? <span className="text-niebla/45"> ({m.expansion})</span> : null}
                        </span>
                      ))
                    )}
                </div>
              </div>
            )}

          {relaciones?.genero_proximo && (
            <div className="text-xs text-niebla/65 bg-marino-800/60 border border-marino-600/40 rounded-md px-3.5 py-2.5">
              <span className="text-acento font-medium">Género próximo detectado:</span>{" "}
              <span className="font-mono text-niebla">{relaciones.genero_proximo}</span>
            </div>
          )}

          {/* Evidencia de criba (homógrafo descartado en T1) */}
          {evidenciaCriba && evidenciaCriba.offset_homografo && (
            <div className="bg-red-950/25 border border-red-500/25 rounded-md p-3.5 space-y-1">
              <p className="text-[11px] uppercase tracking-wider text-red-300 font-medium">
                Evidencia de criba (Homógrafo MCR · cos{" "}
                {evidenciaCriba.sim_homografo != null
                  ? evidenciaCriba.sim_homografo.toFixed(3)
                  : "—"}
                )
              </p>
              <p className="text-xs text-niebla/80">
                <strong>{evidenciaCriba.sinonimos_homografo}</strong>{" "}
                <span className="font-mono text-niebla/45">({evidenciaCriba.offset_homografo})</span>
              </p>
              {evidenciaCriba.glosa_es_homografo && (
                <p className="text-xs text-niebla/55">{evidenciaCriba.glosa_es_homografo}</p>
              )}
            </div>
          )}
        </div>

        {/* Columna 2: Propuesta de Enganche MCR editable */}
        <div className="bg-marino-900/50 border border-marino-600/35 rounded-lg p-6 space-y-5">
          <div className="flex items-center justify-between border-b border-marino-600/30 pb-3">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-acento" />
              <h2 className="font-display text-lg text-niebla">Enganche en WordNet (MCR)</h2>
            </div>
            <button
              onClick={() => setIsSearchOpen((v) => !v)}
              className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-marino-600/50 text-niebla/75 hover:text-acento hover:border-acento/40 transition-colors"
            >
              <Search className="w-3.5 h-3.5" />
              {isSearchOpen ? "Cerrar buscador" : "Buscar otro synset"}
            </button>
          </div>

          {/* Selector de Tipo de Relación */}
          <div>
            <p className="text-[10px] uppercase tracking-widest text-niebla/45 mb-2">
              Tipo de relación propuesta
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {RELACION_OPCIONES.map((op) => {
                const active = tipoRelacion === op.id;
                return (
                  <button
                    key={op.id}
                    type="button"
                    onClick={() => setTipoRelacion(op.id)}
                    title={op.desc}
                    className={`text-left p-2.5 rounded-md border text-xs transition-all ${
                      active
                        ? "bg-acento/15 border-acento text-acento font-medium"
                        : "bg-marino-800/60 border-marino-600/40 text-niebla/65 hover:text-niebla"
                    }`}
                  >
                    {op.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Buscador manual MCR */}
          {isSearchOpen && (
            <div className="bg-marino-800 border border-acento/35 rounded-lg p-3.5 space-y-2 relative">
              <label className="block text-[10px] uppercase tracking-wider text-acento">
                Buscar synset manual en MCR (filtrado por POS: {peruanismo.pos})
              </label>
              <input
                type="text"
                value={searchTerm}
                onChange={handleSearchChange}
                placeholder="Escribe sinónimo o definición (mín. 2 letras)…"
                className="w-full bg-marino-900 border border-marino-600/60 rounded-md px-3 py-2 text-sm text-niebla focus:border-acento focus:outline-none"
                autoFocus
              />
              {isSearching && <p className="text-xs text-niebla/50">Buscando synsets…</p>}
              {searchResults.length > 0 && (
                <div className="max-h-52 overflow-y-auto divide-y divide-marino-600/30 border border-marino-600/40 rounded-md bg-marino-900">
                  {searchResults.map((res) => (
                    <button
                      key={res.offset}
                      type="button"
                      onClick={() => {
                        setSelectedSynset(res);
                        setIsSearchOpen(false);
                        setSearchTerm("");
                        setSearchResults([]);
                      }}
                      className="w-full text-left p-2.5 hover:bg-marino-700/60 transition-colors"
                    >
                      <div className="flex justify-between gap-2 text-xs">
                        <span className="font-semibold text-acento-claro">{res.sinonimos}</span>
                        <span className="font-mono text-niebla/45 flex-shrink-0">{res.offset}</span>
                      </div>
                      <p className="text-[11px] text-niebla/60 mt-0.5 line-clamp-1">
                        {res.glosa_es || res.glosa_en || "Sin glosa"}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Synset seleccionado */}
          {selectedSynset ? (
            <div className="bg-marino-800/80 border border-acento/30 rounded-lg p-4 space-y-2.5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-acento/80">
                    Synset objetivo seleccionado
                  </p>
                  <p className="text-base font-medium text-niebla mt-0.5">
                    {selectedSynset.sinonimos}
                  </p>
                </div>
                <span className="text-xs font-mono text-niebla/60 bg-marino-900 px-2 py-1 rounded border border-marino-600/40 flex-shrink-0">
                  {selectedSynset.offset}
                </span>
              </div>
              <p className="text-xs text-niebla/75 leading-relaxed">
                {selectedSynset.glosa_es || selectedSynset.glosa_en || "Sin definición disponible."}
              </p>
              {(selectedSynset.similitud != null || selectedSynset.score_coseno != null) && (
                <p className="text-[11px] font-mono text-acento/90">
                  Similitud coseno:{" "}
                  {((selectedSynset.similitud ?? selectedSynset.score_coseno) * 100).toFixed(1)}%
                </p>
              )}
            </div>
          ) : (
            <div className="p-4 rounded-lg border border-marino-600/30 bg-marino-800/40 text-xs text-niebla/50">
              Sin synset asignado aún. Usa el buscador manual o ejecuta el enganche Fase 3 desde Analista.
            </div>
          )}

          {/* Top-5 candidatos sugeridos por Fase 3 */}
          {candidatosTop.length > 1 && (
            <div>
              <p className="text-[10px] uppercase tracking-widest text-niebla/45 mb-2">
                Candidatos alternativos (Top-{candidatosTop.length} Fase 3)
              </p>
              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                {candidatosTop.map((cand) => {
                  const isSelected = selectedSynset?.offset === cand.offset;
                  return (
                    <button
                      key={cand.offset}
                      type="button"
                      onClick={() => setSelectedSynset(cand)}
                      className={`w-full text-left px-3 py-2 rounded-md border text-xs transition-colors flex items-center justify-between gap-3 ${
                        isSelected
                          ? "bg-acento/10 border-acento/50 text-niebla"
                          : "bg-marino-800/40 border-marino-600/30 text-niebla/70 hover:bg-marino-700/40"
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="font-medium truncate">{cand.sinonimos}</p>
                        <p className="text-[11px] text-niebla/45 truncate">
                          {cand.glosa_es || cand.glosa_en || cand.offset}
                        </p>
                      </div>
                      <span className="font-mono text-[11px] text-acento/85 flex-shrink-0">
                        {(cand.score_coseno * 100).toFixed(1)}%
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Grafo Semántico Interactivo */}
      <div className="bg-marino-900/50 border border-marino-600/35 rounded-lg p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-acento" />
            <h2 className="font-display text-lg text-niebla">
              Previsualización del Grafo Semántico
            </h2>
          </div>
          <span className="text-[11px] text-niebla/45">
            Se actualiza en vivo al cambiar synset o relación
          </span>
        </div>
        <NetworkViewer uceData={liveUceForGraph} />
      </div>

      {/* Panel de Decisión Curatorial */}
      <div className="bg-marino-900/60 border border-marino-600/40 rounded-lg p-6 space-y-4">
        <h2 className="font-display text-lg text-niebla">Decisión Lexicográfica</h2>
        <textarea
          value={notas}
          onChange={(e) => setNotas(e.target.value)}
          placeholder="Justificación, observaciones lingüísticas o motivo de corrección (obligatorio para observar o rechazar)…"
          rows={3}
          className="w-full bg-marino-800 border border-marino-600/50 rounded-md p-3 text-sm text-niebla placeholder:text-niebla/35 focus:border-acento focus:outline-none resize-none"
        />

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <button
            disabled={saving}
            onClick={() => handleDecision("aceptar")}
            className="inline-flex items-center justify-center gap-2 py-3 rounded-md bg-emerald-600/20 hover:bg-emerald-600/35 text-emerald-300 border border-emerald-500/40 text-sm font-medium transition-colors disabled:opacity-40"
          >
            <Check className="w-4 h-4" />
            Aceptar propuesta
          </button>

          <button
            disabled={saving || !notas.trim()}
            onClick={() => handleDecision("observar")}
            title={!notas.trim() ? "Escribe una nota para observar" : ""}
            className="inline-flex items-center justify-center gap-2 py-3 rounded-md bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/35 text-sm font-medium transition-colors disabled:opacity-35 disabled:cursor-not-allowed"
          >
            <AlertTriangle className="w-4 h-4" />
            Observar
          </button>

          <button
            disabled={saving || !notas.trim()}
            onClick={() => handleDecision("rechazar")}
            title={!notas.trim() ? "Escribe un motivo para rechazar" : ""}
            className="inline-flex items-center justify-center gap-2 py-3 rounded-md bg-red-500/15 hover:bg-red-500/25 text-red-300 border border-red-500/35 text-sm font-medium transition-colors disabled:opacity-35 disabled:cursor-not-allowed"
          >
            <X className="w-4 h-4" />
            Rechazar
          </button>
        </div>
      </div>

      {/* Historial de Auditoría de esta UCE */}
      {historial_auditoria?.length > 0 && (
        <div className="bg-marino-900/40 border border-marino-600/30 rounded-lg p-6 space-y-3">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-acento/80" />
            <h2 className="font-display text-base text-niebla">
              Historial de decisiones ({historial_auditoria.length})
            </h2>
          </div>
          <div className="divide-y divide-marino-600/20">
            {historial_auditoria.map((h) => (
              <div key={h.id} className="py-3 text-xs space-y-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="uppercase font-semibold text-acento">{h.decision}</span>
                    {h.tipo_relacion && (
                      <span className="text-niebla/60 font-mono">· {h.tipo_relacion}</span>
                    )}
                    {h.offset_final && (
                      <span className="text-niebla/50 font-mono">
                        · {h.offset_sugerido && h.offset_sugerido !== h.offset_final
                          ? `${h.offset_sugerido} → ${h.offset_final}`
                          : h.offset_final}
                      </span>
                    )}
                  </div>
                  <span className="text-niebla/40">
                    {h.creado_en ? new Date(h.creado_en).toLocaleString("es-PE") : "—"}
                  </span>
                </div>
                {h.notas && <p className="text-niebla/70">{h.notas}</p>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}