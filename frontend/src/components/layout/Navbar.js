"use client";

import { Menu, LogOut } from "lucide-react";
import { useRole } from "@/context/RoleContext";

export function Navbar({ onOpenMenu }) {
  const { rolInfo, logout } = useRole();

  return (
    <header className="sticky top-0 z-30 w-full bg-marino-900 border-b border-marino-600/40">
      <div className="px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            onClick={onOpenMenu}
            aria-label="Abrir menú de navegación"
            className="md:hidden p-1.5 rounded-md border border-marino-600/40 text-niebla/70 hover:text-acento hover:border-acento/40 transition-colors"
          >
            <Menu className="w-5 h-5" />
          </button>

          <div className="w-8 h-8 rounded-md bg-acento/15 border border-acento/40 flex items-center justify-center">
            <span className="text-acento font-display text-base font-bold">S</span>
          </div>
          <div className="leading-tight">
            <p className="font-display text-base text-niebla tracking-wide">SINAPSIS</p>
            <p className="text-[10px] text-niebla/40 tracking-widest uppercase hidden xs:block">
              PerúNET · Curaduría Léxica
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 sm:gap-4">
          {rolInfo && (
            <div className="flex items-center gap-2.5">
              <div className="text-right hidden sm:block">
                <p className="text-sm text-niebla/85">{rolInfo.nombre}</p>
                <p className="text-[10px] text-acento/80 tracking-wide uppercase">
                  {rolInfo.etapa}
                </p>
              </div>
              <div className="w-8 h-8 rounded-full bg-acento text-marino-900 flex items-center justify-center text-xs font-semibold">
                {rolInfo.inicial}
              </div>
            </div>
          )}
          <button
            onClick={logout}
            className="inline-flex items-center gap-1.5 text-xs text-niebla/50 hover:text-niebla transition-colors border border-marino-600/40 hover:border-marino-600 rounded-md px-3 py-1.5"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Cambiar rol</span>
          </button>
        </div>
      </div>
    </header>
  );
}