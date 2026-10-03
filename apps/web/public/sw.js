// Minimal service worker for the installed PWA.
//
// This app is auth-gated and shows live data (matches, prices, Supabase
// queries), so it must NEVER serve a stale cached copy of HTML, API routes,
// or Supabase responses. The only thing this worker caches opportunistically
// is hashed static assets (_next/static) and the PWA icons — both are
// content-addressed / rarely-changing and safe to serve from cache.
//
// Everything else is network-first: try the network, and only for full-page
// navigations that fail (offline), fall back to a tiny inline "Jste offline"
// page. Bump CACHE_VERSION to invalidate previously cached static assets.
//
// Also handles Web Push (see apps/web/lib/push.ts for subscribing and
// packages/scrapers/src/push.ts for sending): `push` shows a notification
// from the payload JSON ({title, body, url}), `notificationclick` focuses an
// already-open tab on that URL if there is one, else opens a new one.

const CACHE_VERSION = "v2";
const STATIC_CACHE = `scrapping-auta-static-${CACHE_VERSION}`;

const OFFLINE_HTML = `<!doctype html>
<html lang="cs">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>Jste offline – Scrapping cars</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
        padding-bottom: max(24px, env(safe-area-inset-bottom));
        background: #f3f4f6;
        color: #111827;
        font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
        text-align: center;
      }
      .box { max-width: 320px; }
      h1 { font-size: 1.15rem; margin: 0 0 0.5rem; }
      p { margin: 0; color: #6b7280; font-size: 0.9rem; }
    </style>
  </head>
  <body>
    <div class="box">
      <h1>Jste offline</h1>
      <p>Zkontrolujte připojení k internetu a zkuste to znovu.</p>
    </div>
  </body>
</html>`;

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== STATIC_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

function isCacheableStatic(url) {
  return url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/");
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Static, content-hashed assets: stale-while-revalidate.
  if (isCacheableStatic(url)) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        const networkFetch = fetch(request)
          .then((response) => {
            if (response.ok) cache.put(request, response.clone());
            return response;
          })
          .catch(() => cached);
        return cached || networkFetch;
      })
    );
    return;
  }

  // Full-page navigations: network-first, offline fallback page on failure.
  // Never cached — always reflects the live (auth-gated) response.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(
        () =>
          new Response(OFFLINE_HTML, {
            status: 200,
            headers: { "Content-Type": "text/html; charset=utf-8" },
          })
      )
    );
    return;
  }

  // Everything else (API routes, Supabase requests, auth, RSC data, etc.):
  // straight to the network, no caching, no fallback.
  event.respondWith(fetch(request));
});

self.addEventListener("push", (event) => {
  let payload = { title: "Scrapping cars", body: "" };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch {
    // Non-JSON payload (shouldn't happen — the runner always sends JSON) —
    // fall back to the default title/empty body rather than failing to show
    // anything at all.
  }

  const url = payload.url || "/";
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data && event.notification.data.url ? event.notification.data.url : "/";
  const targetUrl = new URL(url, self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url === targetUrl && "focus" in client) return client.focus();
      }
      // No exact-URL match: focus any open tab and navigate it, else open a new one.
      for (const client of clients) {
        if ("focus" in client && "navigate" in client) {
          return client.focus().then(() => client.navigate(targetUrl));
        }
      }
      return self.clients.openWindow(targetUrl);
    })
  );
});
