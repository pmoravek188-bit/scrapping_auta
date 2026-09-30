"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import clsx from "clsx";
import { Car, Heart, LogOut, Menu, X, type LucideIcon } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const NAV: { href: string; label: string; icon?: LucideIcon }[] = [
  { href: "/searches", label: "Hledání" },
  { href: "/results", label: "Výsledky" },
  { href: "/favorites", label: "Oblíbené", icon: Heart },
  { href: "/sources", label: "Zdroje" },
];

/** Count pill on the "Oblíbené" nav item — number of rows in the signed-in
 * user's public.favorites (RLS owner-only, so a plain count is always just
 * their own). */
function useFavoritesCount(): number {
  const pathname = usePathname();
  const [count, setCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;
    supabase
      .from("favorites")
      .select("listing_id", { count: "exact", head: true })
      .then(({ count: c }) => {
        if (!cancelled && typeof c === "number") setCount(c);
      });
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  return count;
}

/** Task F: count pill on the "Výsledky" nav item — matches created since the
 * user's results_seen_prev watermark, across all of their searches. Fetched
 * client-side (public.new_matches_count RPC) since SiteHeader itself is a
 * client component (needs usePathname for the active-link styling). */
function useNewMatchesCount(): number {
  const pathname = usePathname();
  const [count, setCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;
    supabase.rpc("new_matches_count").then(({ data }) => {
      if (!cancelled && typeof data === "number") setCount(data);
    });
    return () => {
      cancelled = true;
    };
    // Re-check whenever the route changes (e.g. after visiting /results,
    // which rolls the watermark forward and should shrink/clear the pill).
  }, [pathname]);

  return count;
}

export function SiteHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const newMatchesCount = useNewMatchesCount();
  const favoritesCount = useFavoritesCount();

  async function logout() {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;
    setLoggingOut(true);
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <header
      className="sticky top-0 z-40 border-b border-gray-200 bg-white/95 backdrop-blur"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
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
                "flex items-center gap-1.5 rounded-lg px-3 py-2 transition",
                pathname.startsWith(item.href)
                  ? "bg-brand-50 text-brand-700"
                  : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
              )}
            >
              {item.icon && <item.icon className="h-3.5 w-3.5" aria-hidden />}
              {item.label}
              {item.href === "/results" && newMatchesCount > 0 && (
                <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-emerald-500 px-1 text-[11px] font-semibold text-white">
                  {newMatchesCount}
                </span>
              )}
              {item.href === "/favorites" && favoritesCount > 0 && (
                <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[11px] font-semibold text-white">
                  {favoritesCount}
                </span>
              )}
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
