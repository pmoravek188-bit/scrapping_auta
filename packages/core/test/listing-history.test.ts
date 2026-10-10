import { describe, expect, it } from "vitest";
import { summarizeListingHistory } from "../src/listing-history.js";

const NOW = "2026-10-04T00:00:00.000Z";

describe("summarizeListingHistory", () => {
  it("computes whole days listed from first_seen to now", () => {
    const result = summarizeListingHistory("2026-08-20T00:00:00.000Z", [], "CZK", NOW);
    expect(result.daysListed).toBe(45);
  });

  it("never returns a negative day count", () => {
    const result = summarizeListingHistory("2026-12-01T00:00:00.000Z", [], "CZK", NOW);
    expect(result.daysListed).toBe(0);
  });

  it("counts price drops and sums the total drop amount (CZK source)", () => {
    const history = [
      { priceCzk: 400_000, seenAt: "2026-08-20T00:00:00.000Z" },
      { priceCzk: 390_000, seenAt: "2026-09-01T00:00:00.000Z" }, // -10k
      { priceCzk: 390_000, seenAt: "2026-09-10T00:00:00.000Z" }, // unchanged
      { priceCzk: 365_000, seenAt: "2026-09-20T00:00:00.000Z" }, // -25k
    ];
    const result = summarizeListingHistory("2026-08-20T00:00:00.000Z", history, "CZK", NOW);
    expect(result.priceDropCount).toBe(2);
    expect(result.totalDropCzk).toBe(35_000);
  });

  it("ignores null price points and sorts out-of-order history", () => {
    const history = [
      { priceCzk: 365_000, seenAt: "2026-09-20T00:00:00.000Z" },
      { priceCzk: null, seenAt: "2026-09-10T00:00:00.000Z" },
      { priceCzk: 400_000, seenAt: "2026-08-20T00:00:00.000Z" },
    ];
    const result = summarizeListingHistory("2026-08-20T00:00:00.000Z", history, "CZK", NOW);
    expect(result.priceDropCount).toBe(1);
    expect(result.totalDropCzk).toBe(35_000);
  });

  it("doesn't count a price increase as a drop", () => {
    const history = [
      { priceCzk: 300_000, seenAt: "2026-08-20T00:00:00.000Z" },
      { priceCzk: 320_000, seenAt: "2026-09-01T00:00:00.000Z" },
    ];
    const result = summarizeListingHistory("2026-08-20T00:00:00.000Z", history, "CZK", NOW);
    expect(result.priceDropCount).toBe(0);
    expect(result.totalDropCzk).toBe(0);
  });

  it("counts every individual decrease even if later partly offset by an increase", () => {
    const history = [
      { priceCzk: 400_000, seenAt: "2026-08-01T00:00:00.000Z" },
      { priceCzk: 380_000, seenAt: "2026-08-10T00:00:00.000Z" }, // -20k
      { priceCzk: 390_000, seenAt: "2026-08-20T00:00:00.000Z" }, // +10k, not a drop
      { priceCzk: 370_000, seenAt: "2026-08-30T00:00:00.000Z" }, // -20k
    ];
    const result = summarizeListingHistory("2026-08-01T00:00:00.000Z", history, "CZK", NOW);
    expect(result.priceDropCount).toBe(2);
    expect(result.totalDropCzk).toBe(40_000);
  });

  it("defaults to CZK (exact comparison) when currencyOrig is omitted", () => {
    const history = [
      { priceCzk: 400_000, seenAt: "2026-08-20T00:00:00.000Z" },
      { priceCzk: 399_000, seenAt: "2026-09-01T00:00:00.000Z" }, // -1k, still real for CZK
    ];
    const result = summarizeListingHistory("2026-08-20T00:00:00.000Z", history, undefined, NOW);
    expect(result.priceDropCount).toBe(1);
    expect(result.totalDropCzk).toBe(1_000);
  });

  it("ignores EUR/CZK conversion noise on a legacy EUR-sourced history (no price_orig)", () => {
    const history = [
      { priceCzk: 600_000, seenAt: "2026-08-20T00:00:00.000Z" },
      { priceCzk: 601_800, seenAt: "2026-08-21T00:00:00.000Z" }, // +0.3%, FX noise
      { priceCzk: 598_500, seenAt: "2026-08-22T00:00:00.000Z" }, // -0.5% from noisy baseline, still noise
      { priceCzk: 570_000, seenAt: "2026-08-23T00:00:00.000Z" }, // a real ~4.8% drop off the last point
    ];
    const result = summarizeListingHistory("2026-08-20T00:00:00.000Z", history, "EUR", NOW);
    expect(result.priceDropCount).toBe(1);
    // The noise steps slide the "current" CZK value forward (598,500) without
    // creating a step, so the one real drop is measured from there, not from
    // the original 600,000 baseline.
    expect(result.totalDropCzk).toBe(598_500 - 570_000);
  });

  it("uses exact price_orig comparison (immune to FX) once price_orig is recorded", () => {
    const history = [
      // Legacy point, no price_orig yet.
      { priceCzk: 600_000, seenAt: "2026-08-20T00:00:00.000Z" },
      // First point with price_orig -- becomes the new baseline, not a change.
      { priceCzk: 602_000, priceOrig: 24_080, seenAt: "2026-08-21T00:00:00.000Z" },
      // Same EUR price, CZK moved purely from the rate -- not real.
      { priceCzk: 615_000, priceOrig: 24_080, seenAt: "2026-08-22T00:00:00.000Z" },
      // EUR price itself dropped (and CZK with it) -- real.
      { priceCzk: 580_000, priceOrig: 23_000, seenAt: "2026-08-23T00:00:00.000Z" },
    ];
    const result = summarizeListingHistory("2026-08-20T00:00:00.000Z", history, "EUR", NOW);
    expect(result.priceDropCount).toBe(1);
    expect(result.totalDropCzk).toBe(615_000 - 580_000);
  });
});
