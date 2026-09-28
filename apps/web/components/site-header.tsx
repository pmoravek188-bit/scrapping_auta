"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import clsx from "clsx";
import { Car, LogOut, Menu, X } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const NAV = [
  { href: "/searches", label: "Hledání" },
  { href: "/results", label: "Výsledky" },
  { href: "/sources", label: "Zdroje" },
];

export function SiteHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  async function logout() {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;
    setLoggingOut(true);
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-40 border-b border-gray-200 bg-white/95 backdrop-blur">
      <nav className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
        <Link href="/" className="flex items-center gap-1.5 text-base font-bold text-gray-900">
          <Car className="h-5 w-5 text-brand-600" aria-hidden />
          Scrapping auta
        </Link>

        <div className="hidden flex-1 items-center gap-1 text-sm font-medium sm:flex">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={clsx(
                "rounded-lg px-3 py-2 transition",
                pathname.startsWith(item.href)
                  ? "bg-brand-50 text-brand-700"
                  : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
              )}
            >
              {item.label}
            </Link>
          ))}
        </div>

        <button
          type="button"
          onClick={logout}
          disabled={loggingOut}
          className="btn-ghost ml-auto hidden sm:inline-flex"
        >
          <LogOut className="h-4 w-4" aria-hidden />
          Odhlásit
        </button>

        <button
          type="button"
          className="ml-auto rounded-lg p-2 text-gray-600 hover:bg-gray-100 sm:hidden"
          onClick={() => setMenuOpen((v) => !v)}
          aria-label="Otevřít menu"
        >
          {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </nav>

      {menuOpen && (
        <div className="border-t border-gray-200 bg-white px-4 py-2 sm:hidden">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMenuOpen(false)}
              className={clsx(
                "block rounded-lg px-3 py-2 text-sm font-medium",
                pathname.startsWith(item.href) ? "bg-brand-50 text-brand-700" : "text-gray-600"
              )}
            >
              {item.label}
            </Link>
          ))}
          <button
            type="button"
            onClick={logout}
            disabled={loggingOut}
            className="mt-1 flex w-full items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-gray-600"
          >
            <LogOut className="h-4 w-4" aria-hidden />
            Odhlásit
          </button>
        </div>
      )}
    </header>
  );
}
