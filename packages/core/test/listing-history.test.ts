import { describe, expect, it } from "vitest";
import { summarizeListingHistory } from "../src/listing-history.js";

const NOW = "2026-10-04T00:00:00.000Z";

describe("summarizeListingHistory", () => {
  it("computes whole days listed from first_seen to now", () => {
    const result = summarizeListingHistory("2026-08-20T00:00:00.000Z", [], NOW);
    expect(result.daysListed).toBe(45);
  });

  it("never returns a negative day count", () => {
    const result = summarizeListingHistory("2026-12-01T00:00:00.000Z", [], NOW);
    expect(result.daysListed).toBe(0);
  });

  it("counts price drops and sums the total drop amount", () => {
    const history = [
      { priceCzk: 400_000, seenAt: "2026-08-20T00:00:00.000Z" },
      { priceCzk: 390_000, seenAt: "2026-09-01T00:00:00.000Z" }, // -10k
      { priceCzk: 390_000, seenAt: "2026-09-10T00:00:00.000Z" }, // unchanged
      { priceCzk: 365_000, seenAt: "2026-09-20T00:00:00.000Z" }, // -25k
    ];
    const result = summarizeListingHistory("2026-08-20T00:00:00.000Z", history, NOW);
    expect(result.priceDropCount).toBe(2);
    expect(result.totalDropCzk).toBe(35_000);
  });

  it("ignores null price points and sorts out-of-order history", () => {
    const history = [
      { priceCzk: 365_000, seenAt: "2026-09-20T00:00:00.000Z" },
      { priceCzk: null, seenAt: "2026-09-10T00:00:00.000Z" },
      { priceCzk: 400_000, seenAt: "2026-08-20T00:00:00.000Z" },
    ];
    const result = summarizeListingHistory("2026-08-20T00:00:00.000Z", history, NOW);
    expect(result.priceDropCount).toBe(1);
    expect(result.totalDropCzk).toBe(35_000);
  });

  it("doesn't count a price increase as a drop", () => {
    const history = [
      { priceCzk: 300_000, seenAt: "2026-08-20T00:00:00.000Z" },
      { priceCzk: 320_000, seenAt: "2026-09-01T00:00:00.000Z" },
    ];
    const result = summarizeListingHistory("2026-08-20T00:00:00.000Z", history, NOW);
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
    const result = summarizeListingHistory("2026-08-01T00:00:00.000Z", history, NOW);
    expect(result.priceDropCount).toBe(2);
    expect(result.totalDropCzk).toBe(40_000);
  });
});
