/**
 * Source health alert: after a full scrape run, a source that returned 0
 * listings (or errored) while it USUALLY finds several is almost certainly
 * broken (markup change, IP block, dead URL) rather than genuinely having
 * zero matching cars right now — see supabase/migrations/
 * 20261003000000_source_health_alert.sql. `shouldAlertSource` is the pure
 * decision function (unit tested in isolation); `checkSourceHealthAndAlert`
 * wires it to the DB + e-mail + push side effects.
 */
import type { DbClient } from "./db.js";
import { loadEmailSenderConfig, sendSourceAlertEmail } from "./notify/email.js";
import { sendPushToAdmins, type VapidConfig } from "./push.js";

/** A source's median "found" count across its last N successful runs must be
 * at least this high for a 0/errored run to be considered suspicious —
 * guards against alerting on a source that genuinely only ever finds 0-4
 * cars (nothing currently for sale matching any saved search). */
export const HEALTH_ALERT_MIN_MEDIAN_FOUND = 5;
/** At most one alert e-mail/push per source per this many hours. */
export const HEALTH_ALERT_COOLDOWN_HOURS = 24;
/** How many of the most recent *successful* runs the median is computed over. */
export const HEALTH_ALERT_RECENT_RUNS_LOOKBACK = 5;

export interface SourceRunHistoryEntry {
  found: number;
  errored: boolean;
}

export interface HealthAlertDecisionInput {
  thisRunFound: number;
  thisRunErrored: boolean;
  /** Previous runs for this source, most-recent-first, NOT including the
   * current run. Only needs to go back far enough to find
   * HEALTH_ALERT_RECENT_RUNS_LOOKBACK successful ones (errored runs in
   * between are skipped, not counted against that limit). */
  recentRuns: SourceRunHistoryEntry[];
  lastAlertAt: string | null;
  /** Injectable for tests; defaults to the real current time. */
  now?: Date;
}

/** Standard median (average of the two middle values on an even-length
 * input). Returns 0 for an empty array (callers never alert on that case —
 * see `shouldAlertSource`, which requires at least one successful run). */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/**
 * True if this run's result for a source is suspicious enough to alert on:
 *   1. this run found 0 listings, or errored
 *   2. AND the source has at least one successful run in its recent history
 *      whose median `found` is >= HEALTH_ALERT_MIN_MEDIAN_FOUND (i.e. it
 *      normally finds plenty, so 0/error now is a real regression)
 *   3. AND no alert was already sent for this source within the last
 *      HEALTH_ALERT_COOLDOWN_HOURS (rate limit — see `sources.last_alert_at`)
 */
export function shouldAlertSource(input: HealthAlertDecisionInput): boolean {
  const { thisRunFound, thisRunErrored, recentRuns, lastAlertAt, now = new Date() } = input;

  const isBadRun = thisRunErrored || thisRunFound === 0;
  if (!isBadRun) return false;

  const recentSuccessfulFound = recentRuns
    .filter((r) => !r.errored)
    .slice(0, HEALTH_ALERT_RECENT_RUNS_LOOKBACK)
    .map((r) => r.found);
  if (recentSuccessfulFound.length === 0) return false;
  if (median(recentSuccessfulFound) < HEALTH_ALERT_MIN_MEDIAN_FOUND) return false;

  if (lastAlertAt != null) {
    const hoursSinceLastAlert = (now.getTime() - new Date(lastAlertAt).getTime()) / (1000 * 60 * 60);
    if (hoursSinceLastAlert < HEALTH_ALERT_COOLDOWN_HOURS) return false;
  }

  return true;
}

/**
 * Loads a source's recent run history, decides via `shouldAlertSource`, and
 * if it fires: sends the alert e-mail (to the admin address) + a push to
 * every admin's registered subscriptions (see `public.app_admins` /
 * `sendPushToAdmins`), then stamps `sources.last_alert_at` so the cooldown
 * applies to the next run. Never throws — a failed alert send must not
 * abort the overall scrape run.
 */
export async function checkSourceHealthAndAlert(
  db: DbClient,
  vapid: VapidConfig | null,
  source: { id: string; name: string; lastAlertAt: string | null },
  thisRunFound: number,
  thisRunErrored: boolean
): Promise<void> {
  const { data, error } = await db
    .from("scrape_runs")
    .select("found, errors")
    .eq("source", source.id)
    .order("started_at", { ascending: false })
    .limit(20);
  if (error) {
    console.warn(`[health-alert] ${source.id}: failed to load recent runs:`, error.message);
    return;
  }

  const recentRuns: SourceRunHistoryEntry[] = (data ?? []).map((r) => ({
    found: r.found,
    errored: r.errors != null,
  }));

  const alert = shouldAlertSource({
    thisRunFound,
    thisRunErrored,
    recentRuns,
    lastAlertAt: source.lastAlertAt,
  });
  if (!alert) return;

  console.warn(
    `[health-alert] ${source.id}: looks broken (found=${thisRunFound}, errored=${thisRunErrored}), alerting`
  );
  try {
    await sendSourceAlertEmail(source.name, await loadEmailSenderConfig(db));
  } catch (err) {
    console.warn(`[health-alert] ${source.id}: failed to send alert e-mail:`, (err as Error).message);
  }
  try {
    await sendPushToAdmins(db, vapid, {
      title: "⚠️ Scrapping cars",
      body: `Zdroj ${source.name} nevrací auta`,
      url: "/sources",
    });
  } catch (err) {
    console.warn(`[health-alert] ${source.id}: failed to send alert push:`, (err as Error).message);
  }
  const { error: updateError } = await db
    .from("sources")
    .update({ last_alert_at: new Date().toISOString() })
    .eq("id", source.id);
  if (updateError) {
    console.warn(`[health-alert] ${source.id}: failed to stamp last_alert_at:`, updateError.message);
  }
}
