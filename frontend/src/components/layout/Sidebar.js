"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Download,
  Cpu,
  CheckSquare,
  BookOpen,
  Search,
  GitBranch,
  ShieldCheck,
  X,
} from "lucide-react";
import { useRole } from "@/context/RoleContext";

const NAV_ITEMS = [
  {
    href: "/dashboard",
    label: "Dashboard",
    Icon: LayoutDashboard,
    roles: ["ingeniero", "analista", "lexicografo", "administrador"],
  },
  {
    href: "/dashboard/ingeniero",
    label: "Extracción",
    Icon: Download,
    roles: ["ingeniero", "administrador"],
  },
  {
    href: "/dashboard/analista",
    label: "Procesamiento",
    Icon: Cpu,
    roles: ["analista", "administrador"],
  },
  {
    href: "/dashboard/lexicografo",
    label: "Curaduría",
    Icon: CheckSquare,
    roles: ["lexicografo", "administrador"],
  },
  {
    href: "/dashboard/peruanismos",
    label: "Peruanismos",
    Icon: BookOpen,
    roles: ["ingeniero", "analista", "lexicografo", "administrador"],
  },
  {
    href: "/dashboard/buscar",
    label: "Búsqueda",
    Icon: Search,
    roles: ["analista", "lexicografo", "administrador"],
  },
  {
    href: "/dashboard/pipeline",
    label: "Pipeline SECI",
    Icon: GitBranch,
    roles: ["ingeniero", "administrador"],
  },
  {
    href: "/dashboard/auditoria",
    label: "Auditoría",
    Icon: ShieldCheck,
    roles: ["administrador"],
  },
];

export function Sidebar({ mobileOpen = false, onCloseMobile }) {
  const pathname = usePathname();
  const { rol } = useRole();

  const visibleItems = NAV_ITEMS.filter((item) => item.roles.includes(rol));

  const renderLinks = (isMobile = false) => (
    <nav className="flex-1 px-3 space-y-1">
      {visibleItems.map(({ href, label, Icon }) => {
        const isActive =
          href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(href);

        return (
          <Link
            key={href}
            href={href}
            onClick={isMobile ? onCloseMobile : undefined}
            className={[
              "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-all duration-150",
              isActive
                ? "bg-acento/15 text-acento border border-acento/30 font-medium"
                : "text-niebla/55 hover:text-niebla hover:bg-marino-700/40 border border-transparent",
            ].join(" ")}
          >
            <Icon className="w-4 h-4 flex-shrink-0 opacity-85" />
            <span className="tracking-wide">{label}</span>
          </Link>
        );
      })}
    </nav>
  );

  return (
    <>
      {/* Sidebar Desktop */}
      <aside className="hidden md:flex w-56 flex-col bg-marino-900 border-r border-marino-600/40 py-4 flex-shrink-0">
        {renderLinks(false)}
        <div className="px-4 pt-4 border-t border-marino-600/20 mt-auto">
          <p className="text-[10px] text-niebla/30 tracking-wide">SINAPSIS v0.2.0</p>
          <p className="text-[10px] text-niebla/25 tracking-wide">Modelo SECI · WordNet</p>
        </div>
      </aside>

      {/* Drawer Móvil */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden flex">
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-xs"
            onClick={onCloseMobile}
          />
          <aside className="relative z-50 w-64 max-w-[80vw] bg-marino-900 border-r border-marino-600/40 py-4 flex flex-col shadow-2xl">
            <div className="flex items-center justify-between px-4 pb-3 mb-2 border-b border-marino-600/30">
              <span className="font-display text-base text-acento">Navegación</span>
              <button
                onClick={onCloseMobile}
                aria-label="Cerrar menú"
                className="p-1 text-niebla/50 hover:text-niebla"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {renderLinks(true)}
          </aside>
        </div>
      )}
    </>
  );
}