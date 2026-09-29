/**
 * Resolves a listing image URL (as stored in `listings.image_urls`, which
 * may come from an old scrape run with a now-broken/low-quality URL) to one
 * that actually loads, sized for where it's displayed.
 *
 * Two sources need a fixup, confirmed live with curl 2026-09-28:
 * - sauto.cz images are served from Seznam's sdn.cz CDN. The bare URL (no
 *   query params) returns HTTP 401. The CDN only accepts a small whitelist
 *   of `fl=` resize params — most sizes 400. Confirmed working:
 *   `res,360,270,3|jpg,80,,1` (small/card, no watermark segment needed) and
 *   `res,1024,768,1|wrm,/watermark/sauto.png,10,10|jpg,80,,1` (large/detail
 *   — the same params the sauto detail page itself uses; without the `wrm`
 *   segment, mode `1` 400s).
 * - autoscout24 image URLs end with a `/{width}x{height}.webp` suffix.
 * `250x188` (the raw scraped size) still loads, but is small; `720x540`
 *   and other sizes on the same `prod.pictures.autoscout24.net` CDN also
 *   load, confirmed live — used for a sharper card/detail image.
 *
 * Because this runs at render time (not just at scrape time), it also
 * repairs URLs already sitting in the DB from a previous run without
 * needing a re-scrape.
 */
export type ImageDisplaySize = "card" | "large";

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
    return withProtocol.replace(/\/\d+x\d+\.webp$/, size === "large" ? "/1024x768.webp" : "/480x360.webp");
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
