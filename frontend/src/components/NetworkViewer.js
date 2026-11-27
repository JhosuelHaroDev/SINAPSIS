"use client";

import React, { useMemo, useState } from "react";
import ReactFlow, { Controls, Background, MarkerType } from "reactflow";
import "reactflow/dist/style.css";

const TIPO_LABEL = {
  tipo_1_semantico: "Semántico (T1)",
  tipo_2_lexico: "Léxico (T2)",
  ya_presente: "Ya presente",
  indeterminado: "Indeterminado",
  sin_clasificar: "Sin clasificar",
};

const EDGE_CONFIG = {
  has_hyperonym: { stroke: "#C6A45C", animated: true, dash: undefined },
  near_synonym: { stroke: "#34D399", animated: true, dash: undefined },
  variante_existente: { stroke: "#38BDF8", animated: false, dash: undefined },
  candidato_alternativo: { stroke: "#476B94", animated: false, dash: "5 5" },
  homografo_descartado: { stroke: "#F87171", animated: false, dash: "4 4" },
};

function recortar(texto, max = 38) {
  if (!texto) return "—";
  return texto.length > max ? texto.slice(0, max - 1) + "…" : texto;
}

export default function NetworkViewer({ uceData }) {
  const [selectedNodeInfo, setSelectedNodeInfo] = useState(null);

  const rels = uceData?.relaciones || {};
  const aristasReales = Array.isArray(rels.relaciones_grafo) ? rels.relaciones_grafo : [];

  const { nodes, edges } = useMemo(() => {
    const builtNodes = [];
    const builtEdges = [];

    // Nodo central: la UCE
    builtNodes.push({
      id: "center",
      position: { x: 340, y: 210 },
      data: {
        label: (
          <div className="flex flex-col items-center text-center px-2 py-1">
            <span className="text-[10px] uppercase tracking-widest text-acento/80">
              {TIPO_LABEL[uceData?.tipo_peruanismo] || "UCE"}
            </span>
            <span className="font-bold text-niebla text-base mt-0.5">
              {uceData?.lema || "Desconocido"}
            </span>
            <span className="text-[11px] text-niebla/60 mt-0.5">
              POS: {uceData?.pos_mcr || "?"} · Acep. #{uceData?.numero_acepcion || 1}
            </span>
          </div>
        ),
        meta: {
          titulo: `${uceData?.lema} (Acep. #${uceData?.numero_acepcion || 1})`,
          subtitulo: `UCE · ${TIPO_LABEL[uceData?.tipo_peruanismo] || ""}`,
          glosa: uceData?.base_gloss || uceData?.embedding_input_gloss,
          extra: rels.genero_proximo ? `Género próximo detectado: "${rels.genero_proximo}"` : null,
        },
      },
      style: {
        background: "#0F2847",
        color: "#E8EEF5",
        border: "2px solid #C6A45C",
        borderRadius: "10px",
        width: 210,
        boxShadow: "0 0 20px rgba(198,164,92,0.18)",
      },
    });

    const principal = aristasReales.find((a) => a.principal);
    const alternativos = aristasReales.filter((a) => a.tipo === "candidato_alternativo");
    const homografo = aristasReales.find((a) => a.tipo === "homografo_descartado");

    // Nodo principal (arriba del centro)
    if (principal) {
      const cfg = EDGE_CONFIG[principal.tipo] || EDGE_CONFIG.has_hyperonym;
      const borderColor =
        principal.tipo === "near_synonym"
          ? "#34D399"
          : principal.tipo === "variante_existente"
          ? "#38BDF8"
          : "#C6A45C";

      builtNodes.push({
        id: "target_main",
        position: { x: 325, y: 20 },
        data: {
          label: (
            <div className="flex flex-col text-left px-2 py-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[9px] uppercase tracking-wider font-semibold" style={{ color: borderColor }}>
                  {principal.tipo.replace(/_/g, " ")}
                </span>
                {principal.score != null && (
                  <span className="text-[10px] font-mono text-niebla/70">
                    {(principal.score * 100).toFixed(1)}%
                  </span>
                )}
              </div>
              <span className="text-xs font-semibold text-niebla mt-1">
                {recortar(principal.target_sinonimos, 42)}
              </span>
              <span className="text-[10px] font-mono text-niebla/45 mt-0.5">
                {principal.target_offset}
              </span>
            </div>
          ),
          meta: {
            titulo: principal.target_sinonimos,
            subtitulo: `Synset MCR objetivo · ${principal.target_offset}`,
            glosa: principal.target_glosa,
            extra: `Relación propuesta: ${principal.etiqueta} · Similitud coseno: ${
              principal.score != null ? principal.score.toFixed(4) : "—"
            }`,
          },
        },
        style: {
          background: "#173456",
          color: "#E8EEF5",
          border: `1.5px solid ${borderColor}`,
          borderRadius: "8px",
          width: 240,
        },
      });

      builtEdges.push({
        id: "e-center-main",
        source: "center",
        target: "target_main",
        label: principal.etiqueta,
        animated: cfg.animated,
        labelStyle: { fill: "#E4D3A8", fontSize: 11, fontWeight: 600 },
        labelBgStyle: { fill: "#0A1F3C", fillOpacity: 0.9 },
        style: { stroke: cfg.stroke, strokeWidth: 2 },
        markerEnd: { type: MarkerType.ArrowClosed, color: cfg.stroke },
      });
    }

    // Candidatos alternativos (columna derecha)
    alternativos.forEach((alt, idx) => {
      const nodeId = `alt_${idx}`;
      const yPos = 120 + idx * 115;
      builtNodes.push({
        id: nodeId,
        position: { x: 640, y: yPos },
        data: {
          label: (
            <div className="flex flex-col text-left px-2 py-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[9px] uppercase tracking-wider text-niebla/50">
                  Alternativa #{idx + 2}
                </span>
                {alt.score != null && (
                  <span className="text-[10px] font-mono text-niebla/60">
                    {(alt.score * 100).toFixed(1)}%
                  </span>
                )}
              </div>
              <span className="text-xs text-niebla/90 mt-0.5">
                {recortar(alt.target_sinonimos, 34)}
              </span>
              <span className="text-[10px] font-mono text-niebla/40">
                {alt.target_offset}
              </span>
            </div>
          ),
          meta: {
            titulo: alt.target_sinonimos,
            subtitulo: `Candidato alternativo · ${alt.target_offset}`,
            glosa: alt.target_glosa,
            extra: `Similitud coseno: ${alt.score != null ? alt.score.toFixed(4) : "—"}`,
          },
        },
        style: {
          background: "#0F2847",
          color: "#E8EEF5",
          border: "1px solid #1F4470",
          borderRadius: "8px",
          width: 215,
        },
      });

      builtEdges.push({
        id: `e-center-${nodeId}`,
        source: "center",
        target: nodeId,
        label: alt.etiqueta,
        labelStyle: { fill: "#94A3B8", fontSize: 10 },
        labelBgStyle: { fill: "#0A1F3C", fillOpacity: 0.85 },
        style: { stroke: "#476B94", strokeDasharray: "5 5" },
      });
    });

    // Homógrafo descartado en Tipo 1 (izquierda)
    if (homografo) {
      builtNodes.push({
        id: "homografo",
        position: { x: 30, y: 210 },
        data: {
          label: (
            <div className="flex flex-col text-left px-2 py-1">
              <span className="text-[9px] uppercase tracking-wider text-red-400">
                Homógrafo MCR descartado
              </span>
              <span className="text-xs text-niebla/85 mt-0.5">
                {recortar(homografo.target_sinonimos, 34)}
              </span>
              <span className="text-[10px] font-mono text-niebla/40">
                {homografo.target_offset}
              </span>
            </div>
          ),
          meta: {
            titulo: homografo.target_sinonimos,
            subtitulo: `Sentido estándar descartado (Tipo 1) · ${homografo.target_offset}`,
            glosa: homografo.target_glosa,
            extra: `Similitud contra sentido estándar: ${
              homografo.score != null ? homografo.score.toFixed(4) : "—"
            } (< 0.35)`,
          },
        },
        style: {
          background: "#1E1622",
          color: "#E8EEF5",
          border: "1px dashed #F87171",
          borderRadius: "8px",
          width: 220,
        },
      });

      builtEdges.push({
        id: "e-center-homografo",
        source: "center",
        target: "homografo",
        label: homografo.etiqueta,
        labelStyle: { fill: "#FCA5A5", fontSize: 10 },
        labelBgStyle: { fill: "#0A1F3C", fillOpacity: 0.9 },
        style: { stroke: "#F87171", strokeDasharray: "4 4" },
      });
    }

    return { nodes: builtNodes, edges: builtEdges };
  }, [uceData, aristasReales, rels.genero_proximo]);

  if (aristasReales.length === 0) {
    return (
      <div className="w-full h-[460px] bg-marino-900 rounded-lg border border-marino-600/40 flex flex-col items-center justify-center p-6 text-center">
        <p className="font-display text-lg text-acento mb-2">
          Grafo semántico aún no generado
        </p>
        <p className="text-sm text-niebla/60 max-w-md">
          Esta UCE todavía no tiene propuestas de enganche (Fase 3). Ejecuta el enganche
          semántico desde la bandeja del Analista para calcular su sinónimo o hiperónimo
          en el MCR.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="w-full h-[420px] bg-marino-900 rounded-lg border border-marino-600/40 overflow-hidden">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          fitView
          fitViewOptions={{ padding: 0.22 }}
          onNodeClick={(_, node) => setSelectedNodeInfo(node?.data?.meta || null)}
        >
          <Background color="#1F4470" gap={18} />
          <Controls />
        </ReactFlow>
      </div>

      {/* Inspector del nodo seleccionado */}
      <div className="bg-marino-900/80 border border-marino-600/40 rounded-lg px-4 py-3 text-xs min-h-[72px]">
        {selectedNodeInfo ? (
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-acento">{selectedNodeInfo.titulo}</span>
              <span className="text-niebla/45 font-mono">{selectedNodeInfo.subtitulo}</span>
            </div>
            {selectedNodeInfo.glosa && (
              <p className="text-niebla/80 leading-relaxed">{selectedNodeInfo.glosa}</p>
            )}
            {selectedNodeInfo.extra && (
              <p className="text-niebla/50">{selectedNodeInfo.extra}</p>
            )}
          </div>
        ) : (
          <p className="text-niebla/45">
            Haz clic en cualquier nodo del grafo para inspeccionar su offset, sinónimos y
            definición completa.
          </p>
        )}
      </div>
    </div>
  );
}