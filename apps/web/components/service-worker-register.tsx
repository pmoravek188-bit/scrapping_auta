"use client";

import { useEffect } from "react";

/**
 * Registers the network-first service worker (see public/sw.js) that gives
 * the installed PWA a minimal "Jste offline" fallback for page navigations.
 * It never caches HTML/API/Supabase responses — only static assets/icons —
 * since this app is auth-gated and shows live data.
 *
 * Only registered in production: in `next dev` a stale service worker can
 * intercept requests and mask fast-refresh/HMR changes.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Registration failures (unsupported browser, blocked by settings,
      // etc.) should never break the app — it works fine without a SW.
    });
  }, []);

  return null;
}
