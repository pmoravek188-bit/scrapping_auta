import { describe, expect, it } from "vitest";
import {
  HEALTH_ALERT_COOLDOWN_HOURS,
  HEALTH_ALERT_MIN_MEDIAN_FOUND,
  HEALTH_ALERT_STUCK_BASELINE_LOOKBACK_DAYS,
  HEALTH_ALERT_STUCK_RUNS_THRESHOLD,
  median,
  shouldAlertSource,
  type SourceRunHistoryEntry,
} from "../src/health-alert.js";

const NOW = new Date("2026-10-07T12:00:00Z");

/** `startedAt` only matters for the stuck-runs rule's 14-day baseline
 * lookback — defaults to well within that window so tests of the OTHER
 * rule (median-based) aren't affected by it. */
function successfulRuns(...found: number[]): SourceRunHistoryEntry[] {
  return found.map((f) => ({ found: f, errored: false, startedAt: NOW.toISOString() }));
}

function erroredRuns(count: number, startedAt = NOW.toISOString()): SourceRunHistoryEntry[] {
  return Array.from({ length: count }, () => ({ found: 0, errored: true, startedAt }));
}

function zeroRuns(count: number, startedAt = NOW.toISOString()): SourceRunHistoryEntry[] {
  return Array.from({ length: count }, () => ({ found: 0, errored: false, startedAt }));
}

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

describe("median", () => {
  it("returns 0 for an empty array", () => {
    expect(median([])).toBe(0);
  });

  it("returns the middle value for an odd-length array", () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it("averages the two middle values for an even-length array", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
});

describe("shouldAlertSource", () => {
  it("does not alert when this run found cars and didn't error", () => {
    expect(
      shouldAlertSource({
        thisRunFound: 12,
        thisRunErrored: false,
        recentRuns: successfulRuns(10, 12, 8, 15, 9),
        lastAlertAt: null,
      })
    ).toBe(false);
  });

  it("alerts when this run found 0 but the source's recent median is >= the threshold", () => {
    expect(
      shouldAlertSource({
        thisRunFound: 0,
        thisRunErrored: false,
        recentRuns: successfulRuns(10, 12, 8, 15, 9), // median 10
        lastAlertAt: null,
      })
    ).toBe(true);
  });

  it("alerts when this run errored, even if found happened to be non-zero", () => {
    expect(
      shouldAlertSource({
        thisRunFound: 2,
        thisRunErrored: true,
        recentRuns: successfulRuns(10, 12, 8, 15, 9),
        lastAlertAt: null,
      })
    ).toBe(true);
  });

  it("does not alert when the source's recent median is below the threshold (genuinely low-volume source)", () => {
    expect(
      shouldAlertSource({
        thisRunFound: 0,
        thisRunErrored: false,
        recentRuns: successfulRuns(1, 2, 0, 3, 1), // median 1 < 5
        lastAlertAt: null,
      })
    ).toBe(false);
  });

  it(`alerts exactly at the median == ${HEALTH_ALERT_MIN_MEDIAN_FOUND} boundary`, () => {
    expect(
      shouldAlertSource({
        thisRunFound: 0,
        thisRunErrored: false,
        recentRuns: successfulRuns(5, 5, 5),
        lastAlertAt: null,
      })
    ).toBe(true);
  });

  it("does not alert when there is no successful run history at all (nothing to compare against)", () => {
    expect(
      shouldAlertSource({
        thisRunFound: 0,
        thisRunErrored: false,
        recentRuns: [],
        lastAlertAt: null,
      })
    ).toBe(false);
  });

  it("only considers successful runs for the median, skipping errored ones in the history", () => {
    const recentRuns: SourceRunHistoryEntry[] = [
      { found: 0, errored: true },
      { found: 10, errored: false },
      { found: 0, errored: true },
      { found: 12, errored: false },
      { found: 8, errored: false },
    ];
    expect(
      shouldAlertSource({ thisRunFound: 0, thisRunErrored: false, recentRuns, lastAlertAt: null })
    ).toBe(true); // median of [10, 12, 8] = 10 >= 5
  });

  it("only looks at the most recent HEALTH_ALERT_RECENT_RUNS_LOOKBACK successful runs", () => {
    // 5 very recent low-found runs, then a long tail of high-found runs —
    // the median must be computed over the recent ones only.
    const recentRuns = successfulRuns(0, 1, 0, 1, 0, 50, 50, 50, 50, 50);
    expect(
      shouldAlertSource({ thisRunFound: 0, thisRunErrored: false, recentRuns, lastAlertAt: null })
    ).toBe(false);
  });

  it("does not re-alert within the cooldown window", () => {
    const now = new Date("2026-10-03T12:00:00Z");
    const lastAlertAt = new Date("2026-10-03T06:00:00Z").toISOString(); // 6h ago
    expect(
      shouldAlertSource({
        thisRunFound: 0,
        thisRunErrored: false,
        recentRuns: successfulRuns(10, 10, 10),
        lastAlertAt,
        now,
      })
    ).toBe(false);
  });

  it("alerts again once the cooldown window has fully elapsed", () => {
    const now = new Date("2026-10-03T12:00:00Z");
    const lastAlertAt = new Date(
      now.getTime() - (HEALTH_ALERT_COOLDOWN_HOURS + 1) * 60 * 60 * 1000
    ).toISOString();
    expect(
      shouldAlertSource({
        thisRunFound: 0,
        thisRunErrored: false,
        recentRuns: successfulRuns(10, 10, 10),
        lastAlertAt,
        now,
      })
    ).toBe(true);
  });
});

describe("shouldAlertSource — stuck-broken blind spot (rule B)", () => {
  it(`alerts on ${HEALTH_ALERT_STUCK_RUNS_THRESHOLD} consecutive found=0 runs backed by a healthy run within the ${HEALTH_ALERT_STUCK_BASELINE_LOOKBACK_DAYS}-day baseline window`, () => {
    // No recent SUCCESSFUL run left to feed rule A's median at all — the
    // source has been stuck at 0 so long that even its "recent" history is
    // all bad. Rule A can't fire; this is exactly the blind spot rule B
    // exists for.
    const recentRuns: SourceRunHistoryEntry[] = [
      ...zeroRuns(HEALTH_ALERT_STUCK_RUNS_THRESHOLD - 1, daysAgo(1)),
      { found: 8, errored: false, startedAt: daysAgo(10) }, // healthy, 10 days ago
    ];
    expect(
      shouldAlertSource({ thisRunFound: 0, thisRunErrored: false, recentRuns, lastAlertAt: null, now: NOW })
    ).toBe(true);
  });

  it("does not alert on a found=0 streak with NO healthy run in the last 14 days (genuinely-quiet source, not broken)", () => {
    const recentRuns: SourceRunHistoryEntry[] = zeroRuns(10, daysAgo(1));
    expect(
      shouldAlertSource({ thisRunFound: 0, thisRunErrored: false, recentRuns, lastAlertAt: null, now: NOW })
    ).toBe(false);
  });

  it("does not credit a healthy run from OUTSIDE the 14-day baseline window", () => {
    const recentRuns: SourceRunHistoryEntry[] = [
      ...zeroRuns(HEALTH_ALERT_STUCK_RUNS_THRESHOLD - 1, daysAgo(1)),
      { found: 8, errored: false, startedAt: daysAgo(HEALTH_ALERT_STUCK_BASELINE_LOOKBACK_DAYS + 1) },
    ];
    expect(
      shouldAlertSource({ thisRunFound: 0, thisRunErrored: false, recentRuns, lastAlertAt: null, now: NOW })
    ).toBe(false);
  });

  it(`alerts on ${HEALTH_ALERT_STUCK_RUNS_THRESHOLD} consecutive ERRORED runs even with NO healthy run ever (broken since it was added — the aaaauto case)`, () => {
    const recentRuns: SourceRunHistoryEntry[] = erroredRuns(10, daysAgo(1));
    expect(
      shouldAlertSource({ thisRunFound: 0, thisRunErrored: true, recentRuns, lastAlertAt: null, now: NOW })
    ).toBe(true);
  });

  it("does not alert on fewer than the threshold of consecutive bad runs", () => {
    // Only 1 prior bad run + this one = 2, one short of the threshold (3),
    // and no healthy baseline to fall back on either.
    const recentRuns: SourceRunHistoryEntry[] = [
      { found: 0, errored: false, startedAt: daysAgo(1) },
      { found: 6, errored: false, startedAt: daysAgo(2) },
    ];
    expect(
      shouldAlertSource({ thisRunFound: 0, thisRunErrored: false, recentRuns, lastAlertAt: null, now: NOW })
    ).toBe(false);
  });

  it("still respects the cooldown for a stuck-broken source", () => {
    const recentRuns: SourceRunHistoryEntry[] = erroredRuns(10, daysAgo(1));
    const lastAlertAt = new Date(NOW.getTime() - 6 * 60 * 60 * 1000).toISOString(); // 6h ago
    expect(
      shouldAlertSource({ thisRunFound: 0, thisRunErrored: true, recentRuns, lastAlertAt, now: NOW })
    ).toBe(false);
  });
});
