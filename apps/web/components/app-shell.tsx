"use client";

import { usePathname } from "next/navigation";
import { SiteHeader } from "@/components/site-header";

const NO_CHROME_PREFIXES = ["/login", "/auth"];

/** Hides the app chrome (top nav bar) on the login/auth-callback pages. */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const showChrome = !NO_CHROME_PREFIXES.some((p) => pathname.startsWith(p));

  return (
    <div className="min-h-screen">
      {showChrome && <SiteHeader />}
      <main className={showChrome ? "mx-auto max-w-6xl px-4 py-6" : ""}>{children}</main>
    </div>
  );
}
