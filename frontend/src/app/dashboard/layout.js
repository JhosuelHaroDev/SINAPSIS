"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useRole } from "@/context/RoleContext";
import { Navbar } from "@/components/layout/Navbar";
import { Sidebar } from "@/components/layout/Sidebar";

export default function DashboardLayout({ children }) {
  const { rol } = useRole();
  const router = useRouter();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    if (!rol) {
      router.replace("/");
    }
  }, [rol, router]);

  if (!rol) return null;

  return (
    <div className="min-h-screen bg-marino-800 flex flex-col font-sans text-niebla">
      <Navbar onOpenMenu={() => setMobileMenuOpen(true)} />
      <div className="flex flex-1 min-h-0">
        <Sidebar
          mobileOpen={mobileMenuOpen}
          onCloseMobile={() => setMobileMenuOpen(false)}
        />
        <main className="flex-1 p-4 sm:p-6 lg:p-8 overflow-y-auto min-w-0">
          {children}
        </main>
      </div>
    </div>
  );
}