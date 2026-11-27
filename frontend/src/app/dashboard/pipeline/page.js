"use client";

import { useApi } from "@/hooks/useApi";
import { fetchPipelineStatus, fetchEmbudo, fetchMetricasPostTest } from "@/services/api";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { PostTestPanel } from "@/components/metricas/PostTestPanel";

function PhaseCard({ number, name, subtitle, status, metric, metricLabel, extra }) {
  const statusStyles = {
    completa: "border-emerald-500/30 bg-emerald-500/5",
    parcial: "border-amber-500/30 bg-amber-500/5",
    pendiente: "border-niebla/10 bg-niebla/5",
  };
  const statusLabels = {
    completa: "✓ Completa",
    parcial: "◐ En progreso",
    pendiente: "○ Pendiente",
  };
  const statusColors = {
    completa: "text-emerald-400",
    parcial: "text-amber-400",
    pendiente: "text-niebla/40",
  };

  return (
    <div className={`border rounded-lg p-5 flex flex-col ${statusStyles[status]}`}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-[10px] text-niebla/40 tracking-widest uppercase">
          Fase {number}
        </span>
        <span className={`text-[11px] ${statusColors[status]}`}>
          {statusLabels[status]}
        </span>
      </div>
      <h3 className="font-display text-lg text-niebla mb-1">{name}</h3>
      <p className="text-xs text-niebla/45 mb-4">{subtitle}</p>
      {metric != null && (
        <div className="pt-3 border-t border-marino-600/20 mt-auto">
          <p className="text-2xl font-display text-acento">
            {typeof metric === "number" ? metric.toLocaleString("es-PE") : metric}
          </p>
          <p className="text-[10px] text-niebla/40 tracking-wide uppercase mt-1">
            {metricLabel}
          </p>
          {extra && <p className="text-[11px] text-niebla/50 mt-1">{extra}</p>}
        </div>
      )}
    </div>
  );
}

export default function PipelinePage() {
  const { data: pipeline, loading: l1 } = useApi(fetchPipelineStatus, []);
  const { data: embudo, loading: l2 } = useApi(fetchEmbudo, []);
  const { data: metricas, loading: l3 } = useApi(fetchMetricasPostTest, []);

  if (l1 || l2 || l3) return <LoadingSpinner text="Cargando estado del pipeline SECI…" />;

  const p = pipeline || {};
  const e = embudo || {};
  const rev = e.por_revision || {};

  const statusF1 =
    e.rlc_extraidos >= e.lemas_indexados && e.lemas_indexados > 0
      ? "completa"
      : e.rlc_extraidos > 0
      ? "parcial"
      : "pendiente";

  const statusF2 =
    e.uce_integrables > 0 && statusF1 === "completa"
      ? "completa"
      : e.uce_integrables > 0
      ? "parcial"
      : "pendiente";

  const statusF3 =
    e.uces_enganchadas > 0 && e.uces_enganchadas >= e.uce_integrables
      ? "completa"
      : e.uces_enganchadas > 0
      ? "parcial"
      : "pendiente";

  const statusF4 =
    rev.aceptado > 0 && rev.pendiente === 0
      ? "completa"
      : rev.aceptado > 0 || rev.observado > 0 || rev.rechazado > 0
      ? "parcial"
      : "pendiente";

  return (
    <div className="space-y-8">
      <div>
        <p className="text-acento text-xs tracking-[0.25em] uppercase mb-2">
          Modelo SECI
        </p>
        <h1 className="font-display text-2xl sm:text-3xl text-niebla leading-tight">
          Pipeline de Creación del Conocimiento
        </h1>
        <p className="text-niebla/50 text-sm mt-2">
          Socialización → Externalización → Combinación → Internalización
        </p>
      </div>

      {/* 4 Fases SECI */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <PhaseCard
          number={1}
          name="Socialización"
          subtitle="Scraping del DiPerú — captura fiel del léxico"
          status={statusF1}
          metric={e.rlc_extraidos}
          metricLabel="RLC extraídos"
          extra={`de ${(e.lemas_indexados || 0).toLocaleString("es-PE")} indexados`}
        />
        <PhaseCard
          number={2}
          name="Externalización"
          subtitle="Destilación, POS y vectorización OpenAI"
          status={statusF2}
          metric={e.uce_integrables}
          metricLabel="UCE integrables"
          extra={`de ${(e.acepciones_brutas || 0).toLocaleString("es-PE")} acep. brutas`}
        />
        <PhaseCard
          number={3}
          name="Combinación"
          subtitle="Criba MCR, clasificación y enganche semántico"
          status={statusF3}
          metric={e.uces_enganchadas ?? 0}
          metricLabel="UCE enganchadas"
          extra={`de ${(e.uce_integrables || 0).toLocaleString("es-PE")} UCEs`}
        />
        <PhaseCard
          number={4}
          name="Internalización"
          subtitle="Curaduría lexicográfica y métricas Post-Test"
          status={statusF4}
          metric={rev.aceptado ?? e.uces_aceptadas ?? 0}
          metricLabel="Propuestas aceptadas"
          extra={`Obs: ${rev.observado || 0} · Rech: ${rev.rechazado || 0}`}
        />
      </div>

      {/* Panel Pre-Test vs Post-Test */}
      <PostTestPanel metricas={metricas} />

      {/* Progreso de extracción + Embudo */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-marino-900/40 border border-marino-600/30 rounded-lg p-6">
          <h2 className="font-display text-lg text-niebla mb-4">Máquina de Extracción</h2>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-niebla/60">
                Progreso ({(p.por_estado?.completados || 0).toLocaleString("es-PE")} /{" "}
                {(p.total_lemas || 0).toLocaleString("es-PE")})
              </span>
              <span className="text-acento font-display text-lg">
                {((p.tasa_extraccion || 0) * 100).toFixed(1)}%
              </span>
            </div>
            <div className="h-3 bg-marino-900 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-acento/80 to-acento rounded-full transition-all duration-700"
                style={{ width: `${(p.tasa_extraccion || 0) * 100}%` }}
              />
            </div>
            <div className="grid grid-cols-3 gap-3 text-center pt-2">
              <div>
                <p className="font-display text-lg text-emerald-400">
                  {(p.por_estado?.completados || 0).toLocaleString("es-PE")}
                </p>
                <p className="text-[10px] uppercase text-niebla/40">Completados</p>
              </div>
              <div>
                <p className="font-display text-lg text-niebla/60">
                  {(p.por_estado?.pendientes || 0).toLocaleString("es-PE")}
                </p>
                <p className="text-[10px] uppercase text-niebla/40">Pendientes</p>
              </div>
              <div>
                <p className="font-display text-lg text-red-400">
                  {(p.por_estado?.errores || 0).toLocaleString("es-PE")}
                </p>
                <p className="text-[10px] uppercase text-niebla/40">Errores</p>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-marino-900/40 border border-marino-600/30 rounded-lg p-6">
          <h2 className="font-display text-lg text-niebla mb-4">Embudo de Destilación</h2>
          <div className="space-y-3">
            {[
              { label: "Lemas indexados (DiPerú)", value: e.lemas_indexados, max: e.lemas_indexados || 1 },
              { label: "RLC extraídos", value: e.rlc_extraidos, max: e.lemas_indexados || 1 },
              { label: "UCE integrables", value: e.uce_integrables, max: Math.max(e.lemas_indexados || 1, e.uce_integrables || 1) },
              { label: "UCE enganchadas (Fase 3)", value: e.uces_enganchadas ?? 0, max: Math.max(e.uce_integrables || 1, 1) },
              { label: "Propuestas aceptadas (Fase 4)", value: rev.aceptado ?? 0, max: Math.max(e.uce_integrables || 1, 1) },
            ].map((item, i) => (
              <div key={i}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-niebla/55">{item.label}</span>
                  <span className="text-niebla/80 font-display">
                    {typeof item.value === "number" ? item.value.toLocaleString("es-PE") : "—"}
                  </span>
                </div>
                <div className="h-2 bg-marino-900 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-acento/70 rounded-full transition-all duration-500"
                    style={{ width: `${Math.min(100, ((item.value || 0) / item.max) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}