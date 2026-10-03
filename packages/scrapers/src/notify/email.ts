/**
 * Email notifications via the Resend REST API (fetch, no SDK dependency).
 * Enabled only when RESEND_API_KEY and NOTIFY_EMAIL_TO are both set — missing
 * config means notifications are silently skipped (with a log line).
 *
 * On Resend's free tier without a verified own domain, mail can only be sent
 * from `onboarding@resend.dev` to the Resend account owner's own address —
 * see README for details.
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

export interface EmailNotifyConfig {
  apiKey: string;
  to: string;
  from: string;
}

/** Reads email notification config from env vars; returns null if not configured. */
export function getEmailConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env
): EmailNotifyConfig | null {
  const apiKey = env.RESEND_API_KEY;
  const to = env.NOTIFY_EMAIL_TO;
  if (!apiKey || !to) return null;
  const from = env.NOTIFY_EMAIL_FROM || "Scrapping auta <onboarding@resend.dev>";
  return { apiKey, to, from };
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

export function renderDigestHtml(groups: NotifySearchGroup[]): string {
  const sections = groups.map(renderSearchSectionHtml).join("\n");
  return `<!doctype html>
<html lang="cs">
  <body style="margin:0;padding:24px;background:#f5f5f5;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#111">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;padding:24px">
      <tr><td>
        <h1 style="font-size:20px;margin:0 0 4px">Nové nabídky aut</h1>
        <p style="font-size:13px;color:#666;margin:0 0 16px">Scrapping auta — automatické hlídání inzerátů</p>
        ${sections}
      </td></tr>
    </table>
  </body>
</html>`;
}

export function renderDigestText(groups: NotifySearchGroup[]): string {
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
  return lines.join("\n");
}

/**
 * Sends the new-matches digest email via Resend. No-ops (with a log line) if
 * RESEND_API_KEY / NOTIFY_EMAIL_TO are not configured, or there is nothing
 * to send.
 */
export async function sendMatchDigestEmail(
  groups: NotifySearchGroup[],
  config: EmailNotifyConfig | null = getEmailConfigFromEnv()
): Promise<boolean> {
  if (!config) {
    console.log("[notify:email] RESEND_API_KEY / NOTIFY_EMAIL_TO not set, skipping");
    return false;
  }
  const nonEmpty = groups.filter((g) => g.listings.length > 0);
  if (nonEmpty.length === 0) {
    console.log("[notify:email] no new matches, nothing to send");
    return false;
  }
  const totalCars = nonEmpty.reduce((sum, g) => sum + g.listings.length, 0);
  const subject = `Scrapping auta: ${totalCars} nových nabídek`;

  const res = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: config.from,
      to: [config.to],
      subject,
      html: renderDigestHtml(nonEmpty),
      text: renderDigestText(nonEmpty),
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.warn(`[notify:email] Resend API returned ${res.status}: ${body}`);
    return false;
  }
  console.log(`[notify:email] sent digest for ${nonEmpty.length} searches, ${totalCars} cars`);
  return true;
}
