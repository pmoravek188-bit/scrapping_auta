/**
 * Source health alert: after a full scrape run, a source that returned 0
 * listings (or errored) while it USUALLY finds several is almost certainly
 * broken (markup change, IP block, dead URL) rather than genuinely having
 * zero matching cars right now — see supabase/migrations/
 * 20261003000000_source_health_alert.sql. `shouldAlertSource` is the pure
 * decision function (unit tested in isolation); `checkSourceHealthAndAlert`
 * wires it to the DB + e-mail + push side effects.
 *
 * Blind spot this also covers (see HEALTH_ALERT_STUCK_RUNS_THRESHOLD): the
 * median rule above only fires on a *regression* — a source whose recent
 * successful runs still have a healthy median. A source that's been stuck at
 * found=0 for a long time (every run IS a bad run, so there's no healthy
 * "recent successful run" left to compute a median from — this happened to
 * aaaauto for days before anyone noticed) would never trip it. The second
 * rule below catches that: N consecutive bad runs in a row, backed by
 * evidence the source used to work (a healthy run in the last 14 days) — or,
 * for a source that's outright *erroring* (not just quietly returning 0),
 * no baseline is required at all, since an error is unambiguous regardless
 * of history (this matters for a source with NO healthy run in that window
 * yet, e.g. one that was broken from day one).
 */
import type { DbClient } from "./db.js";
import { loadEmailSenderConfig, sendSourceAlertEmail } from "./notify/email.js";
import { sendPushToAdmins, type VapidConfig } from "./push.js";

/** A source's median "found" count across its last N successful runs must be
 * at least this high for a 0/errored run to be considered suspicious —
 * guards against alerting on a source that genuinely only ever finds 0-4
 * cars (nothing currently for sale matching any saved search). Also used as
 * the bar for a "healthy run" in the stuck-runs rule below. */
export const HEALTH_ALERT_MIN_MEDIAN_FOUND = 5;
/** At most one alert e-mail/push per source per this many hours. */
export const HEALTH_ALERT_COOLDOWN_HOURS = 24;
/** How many of the most recent *successful* runs the median is computed over. */
export const HEALTH_ALERT_RECENT_RUNS_LOOKBACK = 5;
/** How many consecutive bad runs (this run + history) in a row count as
 * "stuck broken" for the blind-spot rule — the scrape runs ~3x/day, so this
 * is roughly one day. */
export const HEALTH_ALERT_STUCK_RUNS_THRESHOLD = 3;
/** How far back a past healthy run (found >= HEALTH_ALERT_MIN_MEDIAN_FOUND,
 * not errored) still counts as evidence a "stuck at zero" (not erroring)
 * source used to work, for the blind-spot rule's non-error branch. */
export const HEALTH_ALERT_STUCK_BASELINE_LOOKBACK_DAYS = 14;
/** How many past runs `checkSourceHealthAndAlert` loads to feed both rules —
 * needs to reach back HEALTH_ALERT_STUCK_BASELINE_LOOKBACK_DAYS at the
 * scrape's ~3 runs/day cadence, with room to spare. */
export const HEALTH_ALERT_HISTORY_ROWS = 60;

export interface SourceRunHistoryEntry {
  found: number;
  errored: boolean;
  /** ISO timestamp — needed for the 14-day healthy-baseline lookback below. */
  startedAt: string;
}

export interface HealthAlertDecisionInput {
  thisRunFound: number;
  thisRunErrored: boolean;
  /** Previous runs for this source, most-recent-first, NOT including the
   * current run. Needs to go back far enough to find
   * HEALTH_ALERT_RECENT_RUNS_LOOKBACK successful ones for the median rule
   * (errored runs in between are skipped, not counted against that limit),
   * AND far enough to cover HEALTH_ALERT_STUCK_BASELINE_LOOKBACK_DAYS for the
   * stuck-runs rule. */
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
 * True if this run's result for a source is suspicious enough to alert on
 * (subject to the cooldown in step 1). This run itself must be bad (errored,
 * or found 0) for either rule to fire; then:
 *
 *   RULE A (regression): the source has at least one successful run in its
 *   recent history whose median `found` is >= HEALTH_ALERT_MIN_MEDIAN_FOUND
 *   (i.e. it normally finds plenty, so 0/error now is a real regression).
 *
 *   RULE B (stuck broken): catches a source that's BEEN bad for
 *   HEALTH_ALERT_STUCK_RUNS_THRESHOLD+ runs in a row, which never trips rule
 *   A once there's no healthy run left in its (short) recent history to
 *   compute a median from:
 *     - if every one of those runs actually ERRORED (not just found 0), ALL
 *       of them, no baseline needed — an erroring source is unambiguously
 *       broken even if it never had a known-good run (e.g. broken since the
 *       day it was added).
 *     - otherwise (stuck at found=0, not necessarily erroring), only if the
 *       source had at least one healthy run (found >= MIN_MEDIAN_FOUND, not
 *       errored) within the last HEALTH_ALERT_STUCK_BASELINE_LOOKBACK_DAYS —
 *       a source that's always found 0-4 isn't broken, it's just quiet.
 */
export function shouldAlertSource(input: HealthAlertDecisionInput): boolean {
  const { thisRunFound, thisRunErrored, recentRuns, lastAlertAt, now = new Date() } = input;

  const isBadRun = thisRunErrored || thisRunFound === 0;
  if (!isBadRun) return false;

  if (lastAlertAt != null) {
    const hoursSinceLastAlert = (now.getTime() - new Date(lastAlertAt).getTime()) / (1000 * 60 * 60);
    if (hoursSinceLastAlert < HEALTH_ALERT_COOLDOWN_HOURS) return false;
  }

  // Rule A.
  const recentSuccessfulFound = recentRuns
    .filter((r) => !r.errored)
    .slice(0, HEALTH_ALERT_RECENT_RUNS_LOOKBACK)
    .map((r) => r.found);
  if (recentSuccessfulFound.length > 0 && median(recentSuccessfulFound) >= HEALTH_ALERT_MIN_MEDIAN_FOUND) {
    return true;
  }

  // Rule B.
  const window = [{ found: thisRunFound, errored: thisRunErrored }, ...recentRuns].slice(
    0,
    HEALTH_ALERT_STUCK_RUNS_THRESHOLD
  );
  const longEnoughHistory = window.length === HEALTH_ALERT_STUCK_RUNS_THRESHOLD;
  const allErrored = longEnoughHistory && window.every((r) => r.errored);
  if (allErrored) return true;

  const allBad = longEnoughHistory && window.every((r) => r.errored || r.found === 0);
  if (allBad) {
    const cutoff = now.getTime() - HEALTH_ALERT_STUCK_BASELINE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
    const hadHealthyRunRecently = recentRuns.some(
      (r) => !r.errored && r.found >= HEALTH_ALERT_MIN_MEDIAN_FOUND && new Date(r.startedAt).getTime() >= cutoff
    );
    if (hadHealthyRunRecently) return true;
  }

  return false;
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
    .select("found, errors, started_at")
    .eq("source", source.id)
    .order("started_at", { ascending: false })
    .limit(HEALTH_ALERT_HISTORY_ROWS);
  if (error) {
    console.warn(`[health-alert] ${source.id}: failed to load recent runs:`, error.message);
    return;
  }

  const recentRuns: SourceRunHistoryEntry[] = (data ?? []).map((r) => ({
    found: r.found,
    errored: r.errors != null,
    startedAt: r.started_at,
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
