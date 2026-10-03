import { describe, expect, it } from "vitest";
import {
  HEALTH_ALERT_COOLDOWN_HOURS,
  HEALTH_ALERT_MIN_MEDIAN_FOUND,
  median,
  shouldAlertSource,
  type SourceRunHistoryEntry,
} from "../src/health-alert.js";

function successfulRuns(...found: number[]): SourceRunHistoryEntry[] {
  return found.map((f) => ({ found: f, errored: false }));
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
