"use client";

import { useEffect } from "react";
import { CheckCircle2, AlertTriangle, Info, X } from "lucide-react";

const STYLES = {
  success: {
    wrap: "bg-emerald-950/95 border-emerald-500/40 text-emerald-200",
    Icon: CheckCircle2,
    iconColor: "text-emerald-400",
  },
  error: {
    wrap: "bg-red-950/95 border-red-500/40 text-red-200",
    Icon: AlertTriangle,
    iconColor: "text-red-400",
  },
  info: {
    wrap: "bg-marino-900/95 border-acento/40 text-niebla",
    Icon: Info,
    iconColor: "text-acento",
  },
};

export function Toast({ message, type = "info", onClose, duration = 5000 }) {
  useEffect(() => {
    if (!message || !duration) return;
    const t = setTimeout(() => onClose?.(), duration);
    return () => clearTimeout(t);
  }, [message, duration, onClose]);

  if (!message) return null;

  const { wrap, Icon, iconColor } = STYLES[type] || STYLES.info;

  return (
    <div className="fixed top-5 right-5 z-[100] max-w-md w-[calc(100vw-2.5rem)]">
      <div
        role="status"
        className={`flex items-start gap-3 px-4 py-3 rounded-lg border shadow-2xl backdrop-blur ${wrap}`}
      >
        <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${iconColor}`} />
        <p className="text-sm flex-1 leading-snug">{message}</p>
        <button
          onClick={onClose}
          aria-label="Cerrar notificación"
          className="text-current opacity-60 hover:opacity-100 transition-opacity"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}