/**
 * Email notifications via the Resend REST API (fetch, no SDK dependency).
 *
 * Two distinct kinds of mail, with distinct recipients:
 *   - the new-matches/favourites digest (`sendMatchDigestEmail`) — sent
 *     per-user, to that user's own Supabase Auth e-mail (resolved by the
 *     caller, see runner.ts's `resolveUserEmail`);
 *   - the source-health alert (`sendSourceAlertEmail`) — an admin-only
 *     notice, sent to NOTIFY_EMAIL_TO (the ADMIN address).
 *
 * Both are enabled only when RESEND_API_KEY is set (and, for the source
 * alert, NOTIFY_EMAIL_TO too) — missing config means notifications are
 * silently skipped (with a log line).
 *
 * On Resend's free tier without a verified own domain, mail can only be sent
 * from `onboarding@resend.dev` to the Resend account owner's own address —
 * see README for details. With multiple users, this means only the Resend
 * account owner will actually receive their digest unless/until a custom
 * domain is verified in Resend — every OTHER user's send will fail with a
 * clear per-recipient log line (see `sendMatchDigestEmail` below) and that
 * run's matches simply stay unnotified (notified_at left null) until it
 * succeeds on a later run.
 */

import { resolveImageUrl } from "@scrapping-auta/core";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const MAX_CARS_PER_EMAIL = 20;

export interface NotifyListing {
  title: string;
  url: string;
  source: string;
  priceCzk: number | null;
  year: number | null;
  mileageKm: number | null;
  fuel: string | null;
  imageUrl: string | null;
}

export interface NotifySearchGroup {
  searchName: string;
  listings: NotifyListing[];
}

/** One favourites-digest line item (see favorites-alert.ts): either a price
 * drop or the listing becoming gone/sold. */
export interface NotifyFavoriteChange extends NotifyListing {
  kind: "price_drop" | "gone";
  /** The price this favourite was previously tracked at — only meaningful
   * for `kind: "price_drop"` (null for "gone"). */
  previousPriceCzk: number | null;
}

/** Sender-side config shared by every e-mail this module sends — the
 * recipient (`to`) is always passed separately per call, since it now
 * differs per digest (a user's own address) vs. per alert (the admin
 * address). */
export interface EmailSenderConfig {
  apiKey: string;
  from: string;
}

/** Reads the shared sender config (API key + from-address) from env vars;
 * returns null if RESEND_API_KEY is not set. */
export function getEmailSenderConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env
): EmailSenderConfig | null {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) return null;
  const from = env.NOTIFY_EMAIL_FROM || "Scrapping cars <onboarding@resend.dev>";
  return { apiKey, from };
}

/** The admin address (NOTIFY_EMAIL_TO) — used only for source-health alerts,
 * never for a per-user digest. Returns null if not set. */
export function getAdminEmailFromEnv(env: NodeJS.ProcessEnv = process.env): string | null {
  return env.NOTIFY_EMAIL_TO || null;
}

function formatCzk(value: number | null): string {
  if (value == null) return "cena neuvedena";
  return `${value.toLocaleString("cs-CZ").replace(/\u{00A0}/gu, " ")} Kč`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderCarCardHtml(listing: NotifyListing): string {
  const details = [
    listing.year ? `${listing.year}` : null,
    listing.mileageKm != null ? `${listing.mileageKm.toLocaleString("cs-CZ")} km` : null,
    listing.fuel,
    listing.source,
  ]
    .filter(Boolean)
    .join(" · ");
  // "email" size (not "card"): several source CDNs serve WebP, which many
  // mail clients (Outlook, some Apple Mail builds) and Gmail's own image
  // proxy don't render — resolveImageUrl(..., "email") picks a JPEG variant
  // where one exists, and returns null (-> the grey placeholder box, not a
  // silently-broken <img>) where it doesn't. See image-url.ts for the
  // per-source verification.
  const resolvedImg = resolveImageUrl(listing.imageUrl, "email");
  const img = resolvedImg
    ? `<img src="${escapeHtml(resolvedImg)}" alt="" width="96" height="72" style="object-fit:cover;border-radius:8px;display:block" />`
    : `<div style="width:96px;height:72px;border-radius:8px;background:#e5e7eb"></div>`;
  return `
  <tr>
    <td style="padding:8px 0;border-bottom:1px solid #eee">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td width="96" style="vertical-align:top">${img}</td>
          <td style="padding-left:12px;vertical-align:top">
            <a href="${escapeHtml(listing.url)}" style="font-size:15px;font-weight:600;color:#111;text-decoration:none">${escapeHtml(listing.title)}</a>
            <div style="font-size:13px;color:#666;margin-top:2px">${escapeHtml(details)}</div>
            <div style="font-size:15px;font-weight:700;color:#0a7d3b;margin-top:4px">${formatCzk(listing.priceCzk)}</div>
          </td>
        </tr>
      </table>
    </td>
  </tr>`;
}

function renderSearchSectionHtml(group: NotifySearchGroup): string {
  const shown = group.listings.slice(0, MAX_CARS_PER_EMAIL);
  const rows = shown.map(renderCarCardHtml).join("\n");
  const more =
    group.listings.length > shown.length
      ? `<p style="font-size:13px;color:#666">…a dalších ${group.listings.length - shown.length} nabídek.</p>`
      : "";
  return `
  <h2 style="font-size:17px;margin:24px 0 8px">${escapeHtml(group.searchName)} (${group.listings.length})</h2>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>
  ${more}`;
}

function renderFavoriteChangeCardHtml(change: NotifyFavoriteChange): string {
  const priceLine =
    change.kind === "gone"
      ? `<span style="color:#991b1b;font-weight:600">Prodáno / nedostupné</span>`
      : `<span style="color:#0a7d3b;font-weight:700">${formatCzk(change.priceCzk)}</span> ` +
        `<span style="color:#999;text-decoration:line-through">${formatCzk(change.previousPriceCzk)}</span>`;
  const resolvedImg = resolveImageUrl(change.imageUrl, "email");
  const img = resolvedImg
    ? `<img src="${escapeHtml(resolvedImg)}" alt="" width="96" height="72" style="object-fit:cover;border-radius:8px;display:block" />`
    : `<div style="width:96px;height:72px;border-radius:8px;background:#e5e7eb"></div>`;
  return `
  <tr>
    <td style="padding:8px 0;border-bottom:1px solid #eee">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td width="96" style="vertical-align:top">${img}</td>
          <td style="padding-left:12px;vertical-align:top">
            <a href="${escapeHtml(change.url)}" style="font-size:15px;font-weight:600;color:#111;text-decoration:none">${escapeHtml(change.title)}</a>
            <div style="font-size:13px;color:#666;margin-top:2px">${escapeHtml(change.source)}</div>
            <div style="font-size:15px;margin-top:4px">${priceLine}</div>
          </td>
        </tr>
      </table>
    </td>
  </tr>`;
}

function renderFavoritesSectionHtml(changes: NotifyFavoriteChange[]): string {
  if (changes.length === 0) return "";
  const rows = changes.map(renderFavoriteChangeCardHtml).join("\n");
  return `
  <h2 style="font-size:17px;margin:24px 0 8px">Oblíbené: zlevnění / prodáno (${changes.length})</h2>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>`;
}

export function renderDigestHtml(
  groups: NotifySearchGroup[],
  favoriteChanges: NotifyFavoriteChange[] = []
): string {
  const sections = groups.map(renderSearchSectionHtml).join("\n");
  const favoritesSection = renderFavoritesSectionHtml(favoriteChanges);
  return `<!doctype html>
<html lang="cs">
  <body style="margin:0;padding:24px;background:#f5f5f5;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#111">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;padding:24px">
      <tr><td>
        <h1 style="font-size:20px;margin:0 0 4px">Nové nabídky aut</h1>
        <p style="font-size:13px;color:#666;margin:0 0 16px">Scrapping cars — automatické hlídání inzerátů</p>
        ${sections}
        ${favoritesSection}
      </td></tr>
    </table>
  </body>
</html>`;
}

export function renderDigestText(
  groups: NotifySearchGroup[],
  favoriteChanges: NotifyFavoriteChange[] = []
): string {
  const lines: string[] = ["Nové nabídky aut", ""];
  for (const group of groups) {
    lines.push(`${group.searchName} (${group.listings.length})`);
    for (const listing of group.listings.slice(0, MAX_CARS_PER_EMAIL)) {
      const details = [
        listing.year,
        listing.mileageKm != null ? `${listing.mileageKm} km` : null,
        listing.fuel,
        listing.source,
      ]
        .filter(Boolean)
        .join(", ");
      lines.push(`- ${listing.title} — ${formatCzk(listing.priceCzk)} (${details})`);
      lines.push(`  ${listing.url}`);
    }
    lines.push("");
  }
  if (favoriteChanges.length > 0) {
    lines.push(`Oblíbené: zlevnění / prodáno (${favoriteChanges.length})`);
    for (const change of favoriteChanges) {
      const priceText =
        change.kind === "gone"
          ? "Prodáno / nedostupné"
          : `${formatCzk(change.priceCzk)} (dřív ${formatCzk(change.previousPriceCzk)})`;
      lines.push(`- ${change.title} — ${priceText}`);
      lines.push(`  ${change.url}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

/**
 * Sends one user's new-matches + favourites-changes digest email via Resend.
 * No-ops (with a log line) if RESEND_API_KEY is not configured, or there is
 * nothing at all to send for this recipient. `favoriteChanges` (see
 * favorites-alert.ts) is rendered as an extra "Oblíbené: zlevnění / prodáno"
 * section — on its own it can still trigger a send even with no new matches.
 *
 * Returns false (never throws) on a Resend API error for this recipient —
 * the caller (runner.ts's `notifyNewMatches`) sends one of these per user
 * and must keep going to the next user/favourite event when one recipient's
 * send fails (e.g. the well-known Resend free-tier "only the account owner"
 * limitation — see this file's header comment), rather than aborting the
 * whole run.
 */
export async function sendMatchDigestEmail(
  to: string,
  groups: NotifySearchGroup[],
  favoriteChanges: NotifyFavoriteChange[] = [],
  config: EmailSenderConfig | null = getEmailSenderConfigFromEnv()
): Promise<boolean> {
  if (!config) {
    console.log("[notify:email] RESEND_API_KEY not set, skipping digest");
    return false;
  }
  const nonEmpty = groups.filter((g) => g.listings.length > 0);
  if (nonEmpty.length === 0 && favoriteChanges.length === 0) {
    console.log(`[notify:email] ${to}: no new matches or favourite changes, nothing to send`);
    return false;
  }
  const totalCars = nonEmpty.reduce((sum, g) => sum + g.listings.length, 0);
  const subjectParts = [
    totalCars > 0 ? `${totalCars} nových nabídek` : null,
    favoriteChanges.length > 0 ? `${favoriteChanges.length} změn v oblíbených` : null,
  ].filter((p): p is string => Boolean(p));
  const subject = `Scrapping cars: ${subjectParts.join(", ")}`;

  const res = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: config.from,
      to: [to],
      subject,
      html: renderDigestHtml(nonEmpty, favoriteChanges),
      text: renderDigestText(nonEmpty, favoriteChanges),
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.warn(`[notify:email] Resend API returned ${res.status} for ${to}: ${body}`);
    return false;
  }
  console.log(`[notify:email] sent digest to ${to} for ${nonEmpty.length} searches, ${totalCars} cars`);
  return true;
}

/**
 * Sends the "source looks broken" alert e-mail (see
 * packages/scrapers/src/health-alert.ts for the decision logic that calls
 * this — it's already rate-limited to at most once per source per 24h
 * before this is ever called). Admin-only: always goes to NOTIFY_EMAIL_TO
 * (`to`, defaulted from env), never to a regular user. No-ops (with a log
 * line) if RESEND_API_KEY or NOTIFY_EMAIL_TO are not configured.
 */
export async function sendSourceAlertEmail(
  sourceName: string,
  config: EmailSenderConfig | null = getEmailSenderConfigFromEnv(),
  to: string | null = getAdminEmailFromEnv()
): Promise<boolean> {
  if (!config || !to) {
    console.log("[notify:email] RESEND_API_KEY / NOTIFY_EMAIL_TO not set, skipping source alert");
    return false;
  }
  const subject = `⚠️ Scrapping cars: zdroj ${sourceName} nevrací auta`;
  const text =
    `Zdroj "${sourceName}" v posledním běhu scraperu nevrátil žádné auto (nebo selhal), ` +
    `přestože obvykle vrací víc. Zkontrolujte stránku „Stav zdrojů" v appce — mohlo dojít ` +
    `ke změně webu, bloku, nebo chybě scraperu.`;
  const html = `<!doctype html>
<html lang="cs">
  <body style="margin:0;padding:24px;background:#f5f5f5;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#111">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;padding:24px">
      <tr><td>
        <h1 style="font-size:18px;margin:0 0 12px">⚠️ Zdroj ${escapeHtml(sourceName)} nevrací auta</h1>
        <p style="font-size:14px;color:#333;margin:0">${escapeHtml(text)}</p>
      </td></tr>
    </table>
  </body>
</html>`;

  const res = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: config.from,
      to: [to],
      subject,
      html,
      text,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.warn(`[notify:email] Resend API returned ${res.status} for source alert: ${body}`);
    return false;
  }
  console.log(`[notify:email] sent source health alert for "${sourceName}"`);
  return true;
}
