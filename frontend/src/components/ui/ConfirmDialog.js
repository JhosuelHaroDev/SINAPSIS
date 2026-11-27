"use client";

import { AlertTriangle } from "lucide-react";
import { Modal } from "./Modal";

export function ConfirmDialog({
  open,
  title = "Confirmar acción",
  description,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  danger = false,
  loading = false,
  onConfirm,
  onCancel,
}) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      size="md"
      footer={
        <>
          <button
            onClick={onCancel}
            disabled={loading}
            className="px-4 py-2 text-sm rounded-md border border-marino-600/50 text-niebla/70 hover:text-niebla hover:bg-marino-700/40 transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className={`px-4 py-2 text-sm rounded-md font-medium transition-colors disabled:opacity-50 ${
              danger
                ? "bg-red-600/80 hover:bg-red-600 text-white"
                : "bg-acento hover:brightness-110 text-marino-900"
            }`}
          >
            {loading ? "Procesando…" : confirmLabel}
          </button>
        </>
      }
    >
      <div className="flex items-start gap-3">
        {danger && <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />}
        <p className="text-sm text-niebla/80 leading-relaxed">{description}</p>
      </div>
    </Modal>
  );
}