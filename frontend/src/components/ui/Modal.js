"use client";

import { useEffect } from "react";
import { X } from "lucide-react";

const SIZE_MAP = {
  md: "max-w-xl",
  lg: "max-w-3xl",
  xl: "max-w-5xl",
};

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  headerExtra,
  size = "xl",
  children,
  footer,
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div
        className={`bg-marino-900 border border-marino-600/60 rounded-xl shadow-2xl w-full ${
          SIZE_MAP[size] || SIZE_MAP.xl
        } max-h-[90vh] flex flex-col overflow-hidden`}
      >
        <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-marino-600/40 bg-marino-900">
          <div className="min-w-0">
            <h3 className="font-display text-lg text-acento truncate">{title}</h3>
            {subtitle && <p className="text-xs text-niebla/50 mt-0.5 truncate">{subtitle}</p>}
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            {headerExtra}
            <button
              onClick={onClose}
              aria-label="Cerrar modal"
              className="p-1.5 rounded-md text-niebla/50 hover:text-niebla hover:bg-marino-700/60 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 text-niebla">{children}</div>

        {footer && (
          <div className="px-5 py-3.5 border-t border-marino-600/30 bg-marino-900/90 flex justify-end gap-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}