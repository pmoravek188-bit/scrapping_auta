import { resolveImageUrl } from "@scrapping-auta/core";

/**
 * "Does this listing's photo actually load?" check for the runner (see
 * runner.ts): a listing whose only image(s) 404/401/timeout/aren't actually
 * an image gets skipped rather than stored — see README "Co se ukládá do
 * databáze" / the "broken image" product decision. Deliberately NOT part of
 * image-url.ts: that module is a pure, synchronous URL-rewriter used at
 * render time; this one makes real network requests and belongs with the
 * other runner-side network helpers (http.ts).
 */

const IMAGE_CHECK_TIMEOUT_MS = 8_000;
/** A realistic browser UA -- several image CDNs used by sources (sdn.cz,
 * vshcdn.net, ...) reject/throttle obviously-non-browser clients. */
const IMAGE_CHECK_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/129.0.0.0 Safari/537.36";
/** First image + up to 2 more -- a listing with one broken photo but a
 * working second/third one shouldn't be dropped. */
const MAX_IMAGE_URLS_TO_TRY = 3;
/** Small concurrency so a run with a lot of new listings doesn't fire off
 * hundreds of simultaneous image requests at once. */
export const IMAGE_CHECK_CONCURRENCY = 4;

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function looksLikeImage(res: Response): boolean {
  if (res.status !== 200 && res.status !== 206) return false;
  const contentType = res.headers.get("content-type") ?? "";
  return contentType.toLowerCase().startsWith("image/");
}

/** Status codes that mean "this server doesn't like the Range header I
 * sent" rather than "this URL is genuinely broken" — worth a HEAD retry
 * (without Range) rather than trusting them as a real failure. */
const RANGE_REJECTED_STATUSES = new Set([400, 405, 416]);

/**
 * Checks whether a single (already-resolved, i.e. post `resolveImageUrl`)
 * URL actually loads: a ranged GET (cheap -- doesn't pull the whole image
 * over the wire) accepted as 200/206 with an `image/*` content-type. Falls
 * back to a HEAD request for servers that error on `Range` (some CDNs
 * reject it outright rather than ignoring it). Never throws -- any network
 * failure, timeout, non-2xx status or non-image content-type is simply
 * "doesn't load".
 */
export async function checkImageUrlLoads(url: string): Promise<boolean> {
  let shouldFallBackToHead = false;
  try {
    const res = await fetchWithTimeout(
      url,
      {
        method: "GET",
        headers: { "User-Agent": IMAGE_CHECK_USER_AGENT, Range: "bytes=0-1023" },
      },
      IMAGE_CHECK_TIMEOUT_MS
    );
    if (looksLikeImage(res)) return true;
    // A clean (non-Range-related) response -- trust it: a 2xx with the
    // wrong content-type (e.g. an HTML error page served with 200) or a
    // genuine 404/403/5xx both mean "doesn't load", and a HEAD retry
    // wouldn't change that.
    if (!RANGE_REJECTED_STATUSES.has(res.status)) return false;
    shouldFallBackToHead = true;
  } catch {
    // Network error/timeout/abort on the ranged GET -- try HEAD before
    // giving up entirely.
    shouldFallBackToHead = true;
  }
  if (!shouldFallBackToHead) return false;
  try {
    const res = await fetchWithTimeout(
      url,
      { method: "HEAD", headers: { "User-Agent": IMAGE_CHECK_USER_AGENT } },
      IMAGE_CHECK_TIMEOUT_MS
    );
    return looksLikeImage(res);
  } catch {
    return false;
  }
}

/**
 * Checks a listing's raw `image_urls` (as scraped, i.e. BEFORE
 * `resolveImageUrl` -- this resolves each candidate itself at "card" size,
 * the same size actually shown on cards/results) in order, stopping at the
 * first one that loads. Returns `false` (nothing loads) for a listing with
 * no image URLs at all.
 */
export async function anyListingImageLoads(
  rawImageUrls: readonly (string | null | undefined)[],
  maxToTry: number = MAX_IMAGE_URLS_TO_TRY
): Promise<boolean> {
  const candidates = rawImageUrls
    .slice(0, maxToTry)
    .map((u) => resolveImageUrl(u, "card"))
    .filter((u): u is string => Boolean(u));
  for (const url of candidates) {
    if (await checkImageUrlLoads(url)) return true;
  }
  return false;
}

/**
 * Runs {@link anyListingImageLoads} over several listings' `imageUrls` with
 * bounded concurrency (see {@link IMAGE_CHECK_CONCURRENCY}). Returns a
 * same-length boolean array (`true` = at least one image loads) in the same
 * order as `imageUrlsList` -- NOT necessarily the order checks complete in.
 */
export async function checkListingsHaveLoadableImages(
  imageUrlsList: readonly (readonly (string | null | undefined)[])[],
  concurrency: number = IMAGE_CHECK_CONCURRENCY
): Promise<boolean[]> {
  const results = new Array<boolean>(imageUrlsList.length).fill(false);
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= imageUrlsList.length) return;
      results[i] = await anyListingImageLoads(imageUrlsList[i]!);
    }
  }
  const workerCount = Math.max(1, Math.min(concurrency, imageUrlsList.length));
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}
