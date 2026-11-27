"use client";

import { FileSpreadsheet, FileText, TrendingUp, Award, AlertCircle } from "lucide-react";
import {
  getExportCpwUrl,
  getExportPrsUrl,
  getExportReporteUrl,
} from "@/services/api";

export function PostTestPanel({ metricas }) {
  if (!metricas) return null;

  if (!metricas.linea_base_cargada) {
    return (
      <div className="bg-marino-900/50 border border-amber-500/30 rounded-lg p-5 flex items-start gap-3">
        <AlertCircle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
        <div className="text-sm">
          <p className="font-medium text-amber-300">Línea Base Pre-Test aún no cargada</p>
          <p className="text-niebla/60 text-xs mt-1">
            Ejecuta <code className="text-acento">python -m scripts.poblar_linea_base</code> en el
            backend para habilitar el comparativo Pre-Test vs. Post-Test y la exportación de fichas.
          </p>
        </div>
      </div>
    );
  }

  const { cpw, prs, aceptadas, universo_censal } = metricas;

  return (
    <div className="bg-marino-900/50 border border-acento/30 rounded-xl p-6 space-y-6">
      {/* Encabezado + Exportables */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-marino-600/30 pb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Award className="w-4 h-4 text-acento" />
            <span className="text-[11px] uppercase tracking-[0.2em] text-acento font-medium">
              Evaluación Cuantitativa · Universo Censal ({universo_censal.toLocaleString("es-PE")})
            </span>
          </div>
          <h2 className="font-display text-xl text-niebla">
            Contraste Pre-Test vs. Post-Test (CPW y PRS)
          </h2>
        </div>

        <div className="flex flex-wrap gap-2">
          <a
            href={getExportCpwUrl()}
            download="ficha_1_cpw_post_test.csv"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-acento/15 border border-acento/40 text-acento hover:bg-acento hover:text-marino-900 text-xs font-medium transition-colors"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            Ficha 1 · CPW (.csv)
          </a>
          <a
            href={getExportPrsUrl()}
            download="ficha_2_prs_post_test.csv"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-acento/15 border border-acento/40 text-acento hover:bg-acento hover:text-marino-900 text-xs font-medium transition-colors"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            Ficha 2 · PRS (.csv)
          </a>
          <a
            href={getExportReporteUrl()}
            download="reporte_post_test_sinapsis.md"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-marino-600/60 text-niebla/75 hover:text-niebla hover:bg-marino-700/50 text-xs font-medium transition-colors"
          >
            <FileText className="w-3.5 h-3.5" />
            Reporte (.md)
          </a>
        </div>
      </div>

      {/* Tarjetas comparativas CPW y PRS */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Bloque CPW */}
        <div className="bg-marino-800/60 border border-marino-600/35 rounded-lg p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-base text-niebla">
              Indicador 1 · Cobertura (CPW)
            </h3>
            <span className="inline-flex items-center gap-1 text-xs font-mono px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
              <TrendingUp className="w-3 h-3" />+{cpw.delta_cpw_pp.toFixed(2)} pp
            </span>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="bg-marino-900/70 rounded-md p-3 border border-marino-600/25">
              <p className="text-[10px] uppercase tracking-wider text-niebla/45">Pre-Test</p>
              <p className="font-display text-xl text-niebla/80 mt-0.5">{cpw.cpw_pre.toFixed(2)}%</p>
              <p className="text-[11px] text-niebla/40">{cpw.pre_presentes.toLocaleString("es-PE")} lemas</p>
            </div>
            <div className="bg-marino-900/70 rounded-md p-3 border border-acento/40">
              <p className="text-[10px] uppercase tracking-wider text-acento">Post-Test</p>
              <p className="font-display text-xl text-acento mt-0.5">{cpw.cpw_post.toFixed(2)}%</p>
              <p className="text-[11px] text-niebla/55">{cpw.post_presentes.toLocaleString("es-PE")} lemas</p>
            </div>
            <div className="bg-marino-900/70 rounded-md p-3 border border-marino-600/25">
              <p className="text-[10px] uppercase tracking-wider text-sky-300/80">Potencial</p>
              <p className="font-display text-xl text-sky-300 mt-0.5">{cpw.cpw_potencial.toFixed(2)}%</p>
              <p className="text-[11px] text-niebla/40">{cpw.potencial_presentes.toLocaleString("es-PE")} lemas</p>
            </div>
          </div>

          {/* Barra apilada Pre + Post + Potencial */}
          <div className="space-y-1.5">
            <div className="h-2.5 bg-marino-900 rounded-full overflow-hidden relative">
              <div
                className="absolute inset-y-0 left-0 bg-sky-500/35"
                style={{ width: `${Math.min(100, cpw.cpw_potencial)}%` }}
              />
              <div
                className="absolute inset-y-0 left-0 bg-emerald-400"
                style={{ width: `${Math.min(100, cpw.cpw_post)}%` }}
              />
              <div
                className="absolute inset-y-0 left-0 bg-acento"
                style={{ width: `${Math.min(100, cpw.cpw_pre)}%` }}
              />
            </div>
            <div className="flex flex-wrap justify-between text-[11px] text-niebla/50">
              <span>Nuevos integrados (T2): <strong className="text-emerald-300">+{cpw.nuevos_integrados}</strong></span>
              <span>Enriquecidos (T1): <strong className="text-acento">+{cpw.enriquecidos_t1}</strong></span>
              <span>Brecha restante: <strong>{cpw.post_ausentes.toLocaleString("es-PE")}</strong></span>
            </div>
          </div>
        </div>

        {/* Bloque PRS */}
        <div className="bg-marino-800/60 border border-marino-600/35 rounded-lg p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-base text-niebla">
              Indicador 2 · Densidad Relacional (PRS)
            </h3>
            <span className="inline-flex items-center gap-1 text-xs font-mono px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
              +{prs.delta_relaciones.toLocaleString("es-PE")} rel.
            </span>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="bg-marino-900/70 rounded-md p-3 border border-marino-600/25">
              <p className="text-[10px] uppercase tracking-wider text-niebla/45">PRS Censal Pre</p>
              <p className="font-display text-xl text-niebla/80 mt-0.5">{prs.prs_pre_censal.toFixed(2)}</p>
              <p className="text-[11px] text-niebla/40">Σ {prs.suma_relaciones_pre.toLocaleString("es-PE")}</p>
            </div>
            <div className="bg-marino-900/70 rounded-md p-3 border border-acento/40">
              <p className="text-[10px] uppercase tracking-wider text-acento">PRS Censal Post</p>
              <p className="font-display text-xl text-acento mt-0.5">{prs.prs_post_censal.toFixed(2)}</p>
              <p className="text-[11px] text-niebla/55">Σ {prs.suma_relaciones_post.toLocaleString("es-PE")}</p>
            </div>
            <div className="bg-marino-900/70 rounded-md p-3 border border-marino-600/25">
              <p className="text-[10px] uppercase tracking-wider text-emerald-300/80">PRS Nuevos</p>
              <p className="font-display text-xl text-emerald-300 mt-0.5">{prs.prs_nuevos_integrados.toFixed(2)}</p>
              <p className="text-[11px] text-niebla/40">De 0.00 en Pre</p>
            </div>
          </div>

          <div className="flex flex-wrap justify-between text-[11px] text-niebla/50 pt-1 border-t border-marino-600/25">
            <span>
              PRS nodos presentes: <strong>{prs.prs_pre_presentes.toFixed(2)}</strong> →{" "}
              <strong className="text-acento">{prs.prs_post_presentes.toFixed(2)}</strong>
            </span>
            <span>
              Ref. español estándar: <strong>{prs.prs_referencia_espanol.toFixed(2)}</strong>
            </span>
          </div>
        </div>
      </div>

      {/* Pie de curaduría validada */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-niebla/55 bg-marino-900/70 border border-marino-600/30 rounded-lg px-4 py-3">
        <span>
          UCEs validadas por el Lexicógrafo:{" "}
          <strong className="text-acento font-mono">{aceptadas.total.toLocaleString("es-PE")}</strong>
        </span>
        <div className="flex flex-wrap gap-4">
          <span>
            Hiperónimos (nuevo synset):{" "}
            <strong className="text-niebla">{aceptadas.por_relacion?.has_hyperonym || 0}</strong>
          </span>
          <span>
            Sinónimos (variante):{" "}
            <strong className="text-emerald-300">{aceptadas.por_relacion?.near_synonym || 0}</strong>
          </span>
        </div>
      </div>
    </div>
  );
}