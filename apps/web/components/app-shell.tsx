"use client";

import { usePathname } from "next/navigation";
import clsx from "clsx";
import { SiteHeader } from "@/components/site-header";
import { CompareBar } from "@/components/compare-bar";
import { useCompareIds } from "@/lib/compare-store";

const NO_CHROME_PREFIXES = ["/login", "/auth"];

/** Hides the app chrome (top nav bar) on the login/auth-callback pages. Also
 * mounts the "Porovnat (N)" sticky bottom bar globally so a selection made
 * on one page (e.g. /results) follows the user to another before they hit
 * "Porovnat" — see compare-bar.tsx / lib/compare-store.ts. */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const showChrome = !NO_CHROME_PREFIXES.some((p) => pathname.startsWith(p));
  const { ids } = useCompareIds();
  const compareBarVisible = showChrome && ids.length >= 2;

  return (
    <div className="min-h-screen">
      {showChrome && <SiteHeader />}
      <main className={showChrome ? clsx("mx-auto max-w-6xl px-4 py-6", compareBarVisible && "pb-20") : ""}>
        {children}
      </main>
      {showChrome && <CompareBar />}
    </div>
  );
}
