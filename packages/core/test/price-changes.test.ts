import { describe, expect, it } from "vitest";
import { realPriceChanges } from "../src/price-changes.js";

describe("realPriceChanges", () => {
  it("returns an empty array for no history", () => {
    expect(realPriceChanges([], "CZK")).toEqual([]);
  });

  it("drops rows with a null priceCzk", () => {
    const result = realPriceChanges(
      [
        { priceCzk: 100_000, seenAt: "2026-08-01T00:00:00.000Z" },
        { priceCzk: null, seenAt: "2026-08-02T00:00:00.000Z" },
      ],
      "CZK"
    );
    expect(result).toHaveLength(1);
  });

  it("sorts out-of-order rows chronologically", () => {
    const result = realPriceChanges(
      [
        { priceCzk: 90_000, seenAt: "2026-08-10T00:00:00.000Z" },
        { priceCzk: 100_000, seenAt: "2026-08-01T00:00:00.000Z" },
      ],
      "CZK"
    );
    expect(result.map((p) => p.priceCzk)).toEqual([100_000, 90_000]);
  });

  describe("CZK-native source", () => {
    it("treats every CZK change as real, however small", () => {
      const result = realPriceChanges(
        [
          { priceCzk: 300_000, seenAt: "2026-08-01T00:00:00.000Z" },
          { priceCzk: 299_900, seenAt: "2026-08-02T00:00:00.000Z" }, // -100 Kc, still real
        ],
        "CZK"
      );
      expect(result.map((p) => p.priceCzk)).toEqual([300_000, 299_900]);
    });

    it("collapses an exact repeat into a single point", () => {
      const result = realPriceChanges(
        [
          { priceCzk: 300_000, seenAt: "2026-08-01T00:00:00.000Z" },
          { priceCzk: 300_000, seenAt: "2026-08-02T00:00:00.000Z" },
        ],
        "CZK"
      );
      expect(result).toHaveLength(1);
    });
  });

  describe("legacy EUR-sourced rows (no price_orig)", () => {
    it("collapses a sub-threshold wobble into the baseline", () => {
      const result = realPriceChanges(
        [
          { priceCzk: 600_000, seenAt: "2026-08-01T00:00:00.000Z" },
          { priceCzk: 602_000, seenAt: "2026-08-02T00:00:00.000Z" }, // +0.33%
        ],
        "EUR"
      );
      expect(result).toHaveLength(1);
      expect(result[0]!.priceCzk).toBe(602_000); // still slides to the latest value
    });

    it("keeps a change past the 2.5% threshold as real", () => {
      const result = realPriceChanges(
        [
          { priceCzk: 600_000, seenAt: "2026-08-01T00:00:00.000Z" },
          { priceCzk: 570_000, seenAt: "2026-08-02T00:00:00.000Z" }, // -5%
        ],
        "EUR"
      );
      expect(result.map((p) => p.priceCzk)).toEqual([600_000, 570_000]);
    });

    it("measures the next real change from the noise-slid point, not the original baseline", () => {
      const result = realPriceChanges(
        [
          { priceCzk: 600_000, seenAt: "2026-08-01T00:00:00.000Z" },
          { priceCzk: 601_800, seenAt: "2026-08-02T00:00:00.000Z" }, // noise
          { priceCzk: 598_500, seenAt: "2026-08-03T00:00:00.000Z" }, // noise off 601_800
          { priceCzk: 570_000, seenAt: "2026-08-04T00:00:00.000Z" }, // real off 598_500
        ],
        "EUR"
      );
      expect(result.map((p) => p.priceCzk)).toEqual([598_500, 570_000]);
    });

    it("matches the production noise profile: ~2,000 Kc EUR-conversion wobbles are all noise", () => {
      // Mirrors the task's verified prod numbers (autoscout24/carvago): most
      // consecutive EUR-source price_history changes are <=3,000 Kc on a
      // ~600,000 Kc car (well under the 2.5% / ~15,000 Kc threshold).
      const base = 600_000;
      const history = [
        { priceCzk: base, seenAt: "2026-08-01T00:00:00.000Z" },
        { priceCzk: base + 1_800, seenAt: "2026-08-02T00:00:00.000Z" },
        { priceCzk: base + 900, seenAt: "2026-08-03T00:00:00.000Z" },
        { priceCzk: base + 2_400, seenAt: "2026-08-04T00:00:00.000Z" },
        { priceCzk: base - 1_100, seenAt: "2026-08-05T00:00:00.000Z" },
      ];
      const result = realPriceChanges(history, "EUR");
      expect(result).toHaveLength(1); // every step was noise -- one collapsed point
    });
  });

  describe("rows carrying price_orig (post-migration)", () => {
    it("compares the original currency exactly, ignoring any CZK movement", () => {
      const result = realPriceChanges(
        [
          { priceCzk: 600_000, priceOrig: 24_000, seenAt: "2026-08-01T00:00:00.000Z" },
          // EUR unchanged; CZK moved >2.5% purely from the rate -- not real.
          { priceCzk: 630_000, priceOrig: 24_000, seenAt: "2026-08-02T00:00:00.000Z" },
        ],
        "EUR"
      );
      expect(result).toHaveLength(1);
      expect(result[0]!.priceOrig).toBe(24_000);
    });

    it("flags a real EUR price change regardless of CZK delta size", () => {
      const result = realPriceChanges(
        [
          { priceCzk: 600_000, priceOrig: 24_000, seenAt: "2026-08-01T00:00:00.000Z" },
          // EUR dropped by only ~2% but CZK barely moved -- still real.
          { priceCzk: 600_500, priceOrig: 23_500, seenAt: "2026-08-02T00:00:00.000Z" },
        ],
        "EUR"
      );
      expect(result.map((p) => p.priceOrig)).toEqual([24_000, 23_500]);
    });

    it("treats the first price_orig-carrying row after legacy rows as a new baseline, not a change", () => {
      const result = realPriceChanges(
        [
          { priceCzk: 600_000, seenAt: "2026-08-01T00:00:00.000Z" }, // legacy
          { priceCzk: 602_000, priceOrig: 24_080, seenAt: "2026-08-02T00:00:00.000Z" }, // first with orig
        ],
        "EUR"
      );
      expect(result).toHaveLength(1);
      expect(result[0]!.priceOrig).toBe(24_080);
    });
  });
});
