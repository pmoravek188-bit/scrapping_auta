/**
 * "Is this listing actually gone from its source?" heuristics.
 *
 * A listing missing from this run's fetched results is only a CANDIDATE for
 * removal — it could just as easily be beyond `maxPages`, or excluded by a
 * search's filters this run happened to use. Before deleting anything we
 * fetch the listing's own detail URL and classify the response with
 * `isGone()`: a confirmed-gone response is a 404/410, a redirect away from
 * a detail-page-shaped URL to the source's search/list root, or a 200 page
 * whose body says (in whatever language that source uses) the ad was
 * deleted/sold/doesn't exist. Anything else (a network error, or a 200 page
 * that still looks like a real listing) is NOT confirmed and the listing is
 * left alone for the next run to re-check.
 *
 * Per-source overrides exist where the generic phrase/redirect check isn't
 * reliable enough on its own; every source not listed here just uses the
 * generic default.
 */

export interface GoneCheckInput {
  /** The listing's own detail URL, as requested (before any redirect). */
  originalUrl: string;
  /** HTTP status of the final response, or null on a network-level failure
   * (timeout, DNS, etc — never treated as confirmed-gone). */
  status: number | null;
  /** The response's final URL after following redirects. */
  finalUrl: string;
  /** Response body, when one was received (e.g. "" for a bare 404/410 with
   * no useful body, or when the request itself failed). */
  html: string;
}

/** Naive eTLD+1 ("registrable domain") — last two dot-separated labels.
 * Not correct for two-part public suffixes (e.g. "co.uk"), but every site
 * this app scrapes uses a plain ccTLD/gTLD (.cz, .com), so it's good enough
 * here and avoids pulling in a full public-suffix-list dependency. */
function registrableDomain(hostname: string): string {
  const parts = hostname.split(".");
  return parts.length <= 2 ? hostname : parts.slice(-2).join(".");
}

/** Whether two URLs share the same site, by registrable domain. GitHub
 * Actions runners run from US/EU cloud IPs, which some of these sites (or
 * an intermediary, e.g. Seznam's cmp.seznam.cz consent wall, a captcha
 * service, or a generic geo-block page) may redirect to instead of the
 * requested page. That redirect must never be read as "the listing is
 * gone" — it's a redirect to an entirely different site, not a signal
 * about the listing at all. */
function isSameSite(urlA: string, urlB: string): boolean {
  try {
    return registrableDomain(new URL(urlA).hostname) === registrableDomain(new URL(urlB).hostname);
  } catch {
    return false;
  }
}

/** Phrases seen (or plausible, per each site's own language/tone) on a
 * "this ad no longer exists" page, across the languages this app's sources
 * use. Deliberately broad substrings, checked case-insensitively — a false
 * "gone" here just means a listing is re-fetched and re-confirmed wrong
 * next run (cheap), whereas a false "not gone" leaves a dead listing
 * visible a bit longer (also cheap) — so this leans permissive. */
const GENERIC_GONE_PHRASES = [
  // Czech
  "inzerát byl smazán",
  "inzerát byl odstraněn",
  "inzerát již neexistuje",
  "inzerát nenalezen",
  "inzerát nebyl nalezen",
  "tento inzerát již není aktivní",
  "vozidlo bylo prodáno",
  "nabídka již není k dispozici",
  "stránka nebyla nalezena",
  // German (autoscout24.cz's underlying inventory is DE)
  "anzeige wurde gelöscht",
  "anzeige ist nicht mehr verfügbar",
  "inserat wurde gelöscht",
  "fahrzeug wurde bereits verkauft",
  "seite nicht gefunden",
  // English fallback
  "listing has been removed",
  "listing no longer available",
  "advertisement has expired",
  "this ad is no longer available",
  "page not found",
  "vehicle no longer available",
];

function hasGoneMarker(html: string): boolean {
  const lower = html.toLowerCase();
  return GENERIC_GONE_PHRASES.some((phrase) => lower.includes(phrase));
}

/** Generic default: a 404/410 status, or a 200 body carrying one of the
 * known "gone" phrases. Does NOT look at `finalUrl` (a redirect alone is too
 * source-specific to interpret generically — see the per-source overrides
 * below for that).
 *
 * Everything else — including 403 (bot-blocked, not "gone"), 429
 * (rate-limited), any 5xx, and a null status (network-level failure) — is
 * deliberately left as "not confirmed" (false) rather than guessed at,
 * since none of those say anything reliable about whether the ad still
 * exists. */
export function isGoneGeneric(input: GoneCheckInput): boolean {
  if (input.status === 403 || input.status === 429 || (input.status != null && input.status >= 500)) {
    return false;
  }
  if (input.status === 404 || input.status === 410) return true;
  if (input.status != null && input.status >= 200 && input.status < 300 && hasGoneMarker(input.html)) {
    return true;
  }
  return false;
}

/** sauto detail URLs are always `/osobni/detail/{make}/{model}/{id}`; a
 * removed listing 404s or redirects to the plain `sauto.cz` root/search
 * (confirmed shape of the URL scheme in packages/scrapers/src/sources/sauto.ts —
 * not live-observed against an actual deleted listing, since none was
 * available to sample on demand; treat as best-effort pending a live
 * sighting). */
function isGoneSauto(input: GoneCheckInput): boolean {
  if (isGoneGeneric(input)) return true;
  try {
    const path = new URL(input.finalUrl).pathname;
    return !path.startsWith("/osobni/detail/");
  } catch {
    return false;
  }
}

/** tipcars detail URLs always end in `.html`; a removed listing redirects to
 * the `/ojete` list root (best-effort, same caveat as sauto above). */
function isGoneTipcars(input: GoneCheckInput): boolean {
  if (isGoneGeneric(input)) return true;
  try {
    const path = new URL(input.finalUrl).pathname;
    return !path.endsWith(".html");
  } catch {
    return false;
  }
}

/** bazos.cz detail URLs are `/inzerat/{id}/...`; a removed listing redirects
 * to the search results (best-effort, same caveat as sauto above). */
function isGoneBazos(input: GoneCheckInput): boolean {
  if (isGoneGeneric(input)) return true;
  try {
    const path = new URL(input.finalUrl).pathname;
    return !path.startsWith("/inzerat/");
  } catch {
    return false;
  }
}

const OVERRIDES: Partial<Record<string, (input: GoneCheckInput) => boolean>> = {
  sauto: isGoneSauto,
  tipcars: isGoneTipcars,
  bazos: isGoneBazos,
};

/** Classifies whether a listing's detail page confirms it's gone from its
 * source. `sourceId` picks a per-adapter override when one exists (sauto,
 * tipcars, bazos); every other source (carvago, aaaauto, autoscout24,
 * dasweltauto, skodaplus, autoesa, havex, generic-html, ...) falls back to
 * {@link isGoneGeneric}.
 *
 * SAFETY GUARD: a response that ended up on a different site entirely (see
 * {@link isSameSite} — a consent wall, captcha, or geo-block page, none of
 * which say anything about whether the listing itself still exists) is
 * ALWAYS treated as unknown/not-confirmed, regardless of what the
 * status/redirect-shape/phrase checks below would otherwise say. This is
 * checked centrally here rather than in each check, so no override can
 * accidentally skip it.
 */
export function isGone(sourceId: string, input: GoneCheckInput): boolean {
  if (!isSameSite(input.originalUrl, input.finalUrl)) return false;
  const override = OVERRIDES[sourceId];
  return override ? override(input) : isGoneGeneric(input);
}
