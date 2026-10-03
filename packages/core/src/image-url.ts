/**
 * Resolves a listing image URL (as stored in `listings.image_urls`, which
 * may come from an old scrape run with a now-broken/low-quality URL) to one
 * that actually loads, sized for where it's displayed.
 *
 * Several sources need a fixup, confirmed live with curl:
 * - sauto.cz images are served from Seznam's sdn.cz CDN. The bare URL (no
 *   query params) returns HTTP 401. The CDN only accepts a small whitelist
 *   of `fl=` resize params — most sizes 400. Confirmed working:
 *   `res,360,270,3|jpg,80,,1` (small/card, no watermark segment needed) and
 *   `res,1024,768,1|wrm,/watermark/sauto.png,10,10|jpg,80,,1` (large/detail
 *   — the same params the sauto detail page itself uses; without the `wrm`
 *   segment, mode `1` 400s). Both already resolve to `image/jpeg` (the
 *   `jpg,80,,1` segment), so "email" reuses the "card" params as-is.
 * - autoscout24 image URLs end with a `/{width}x{height}.webp` suffix.
 *   `250x188` (the raw scraped size) still loads, but is small; `720x540`
 *   and other sizes on the same `prod.pictures.autoscout24.net` CDN also
 *   load, confirmed live — used for a sharper card/detail image. That CDN
 *   also serves a `.jpg` suffix instead of `.webp` at the same sizes
 *   (confirmed live `/480x360.jpg` -> 200, `image/jpeg`) — used for
 *   "email" size, since many mail clients (Outlook, some Apple Mail
 *   builds) don't render WebP.
 * - dasweltauto.cz images are served from Porsche Informatik's
 *   `vmscdn.porscheinformatik.com` CDN as a *bare* URL
 *   (`.../images/<uuid>`, no size suffix) straight out of its search API.
 *   That bare URL 405s ("not a valid media request") — confirmed live, it
 *   must have a `/<width>` segment appended (found by cross-referencing the
 *   site's own rendered `<img>` tags). Confirmed live `/440` and `/1024`
 *   both -> 200 `image/jpeg` regardless of the request's `Accept` header —
 *   an explicit `/webp/<width>` variant also exists and returns
 *   `image/webp`, so plain `/<width>` (no `webp/` segment) is what's used
 *   here for every size, including "email".
 * - aaaauto.cz images are served from `vshcdn.net`. Confirmed live: despite
 *   the URL's own `.jpg` extension, this CDN content-negotiates purely on
 *   the request's `Accept` header — any `Accept` that lists `image/webp`
 *   (which includes Gmail's image proxy and most modern mail clients) gets
 *   `image/webp` back regardless of URL/query params tried (`?format=`,
 *   `?fm=`, `?no_webp=`, `?type=jpg` all confirmed live to make no
 *   difference). There is no way to force a JPEG from this CDN by URL
 *   alone, so "email" keeps the webp URL (Gmail and Apple Mail render it;
 *   Outlook desktop does not).
 * - carvago.com images (`storage.alpha-analytics.cz/get/<id>`) 302-redirect
 *   to a presigned S3 object whose stored content-type is a fixed
 *   `image/webp` — confirmed live, unaffected by `Accept` header or query
 *   params. Same as aaaauto: no JPEG variant exists, so "email" keeps
 *   the webp URL.
 *
 * Because this runs at render time (not just at scrape time), it also
 * repairs URLs already sitting in the DB from a previous run without
 * needing a re-scrape.
 */
export type ImageDisplaySize = "card" | "large" | "email";

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

export function resolveImageUrl(
  url: string | null | undefined,
  size: ImageDisplaySize = "card"
): string | null {
  if (!url) return null;
  const withProtocol = url.startsWith("//") ? `https:${url}` : url;
  const host = safeHost(withProtocol);

  if (host.endsWith("sdn.cz")) {
    const base = withProtocol.split("?")[0];
    return size === "large"
      ? `${base}?fl=exf|res,1024,768,1|wrm,/watermark/sauto.png,10,10|jpg,80,,1`
      : `${base}?fl=exf|res,360,270,3|jpg,80,,1`;
  }

  if (/\/\d+x\d+\.webp$/.test(withProtocol)) {
    if (size === "email") return withProtocol.replace(/\/\d+x\d+\.webp$/, "/480x360.jpg");
    return withProtocol.replace(/\/\d+x\d+\.webp$/, size === "large" ? "/1024x768.webp" : "/480x360.webp");
  }

  if (host.endsWith("vmscdn.porscheinformatik.com")) {
    // Bare URL from the API 405s — strip any size segment already present
    // (keeps this idempotent) and append the one we want. Plain `/<width>`
    // (not `/webp/<width>`) is what resolves to image/jpeg.
    const base = withProtocol.replace(/\/(?:webp\/)?\d+$/, "");
    const width = size === "large" ? 1024 : 440;
    return `${base}/${width}`;
  }

  if (host.endsWith("vshcdn.net")) {
    // aaaauto: webp-only CDN, no JPEG variant exists by URL (see doc
    // comment above). Still used for email: Gmail and Apple Mail render
    // webp, and a missing photo is worse than one Outlook can't show.
    return withProtocol;
  }

  if (host.endsWith("alpha-analytics.cz")) {
    // carvago: redirects to a fixed-format (webp) S3 object, no JPEG
    // variant exists (see doc comment above) — same treatment as aaaauto.
    return withProtocol;
  }

  return withProtocol;
}

/** Maps a whole `image_urls` array through {@link resolveImageUrl}, dropping any nulls. */
export function resolveImageUrls(
  urls: readonly (string | null | undefined)[] | null | undefined,
  size: ImageDisplaySize = "card"
): string[] {
  if (!urls) return [];
  return urls.map((u) => resolveImageUrl(u, size)).filter((u): u is string => Boolean(u));
}
