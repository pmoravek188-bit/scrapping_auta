import { describe, expect, it } from "vitest";
import { evaluatePrice, selectComparables, type PriceEvaluationListing } from "../src/price-evaluation.js";

function listing(
  id: string,
  priceCzk: number | null,
  year: number | null = 2020,
  mileageKm: number | null = 80_000
): PriceEvaluationListing {
  return { id, priceCzk, year, mileageKm };
}

describe("selectComparables", () => {
  it("excludes the target itself by id", () => {
    const target = listing("a", 300_000);
    const result = selectComparables(target, [target, listing("b", 310_000)]);
    expect(result.map((c) => c.id)).toEqual(["b"]);
  });

  it("excludes candidates with no price", () => {
    const target = listing("a", 300_000);
    const result = selectComparables(target, [listing("b", null)]);
    expect(result).toHaveLength(0);
  });

  it("excludes candidates outside the year tolerance (±1)", () => {
    const target = listing("a", 300_000, 2020);
    const result = selectComparables(target, [listing("b", 300_000, 2022), listing("c", 300_000, 2021)]);
    expect(result.map((c) => c.id)).toEqual(["c"]);
  });

  it("excludes candidates outside the mileage tolerance (±30% or ±25k km, whichever is wider)", () => {
    // target mileage 50k -> 30% window is 15k, so the absolute 25k floor applies
    const target = listing("a", 300_000, 2020, 50_000);
    const withinAbsolute = listing("b", 300_000, 2020, 74_000); // +24k, within 25k floor
    const outsideBoth = listing("c", 300_000, 2020, 80_000); // +30k, outside both
    const result = selectComparables(target, [withinAbsolute, outsideBoth]);
    expect(result.map((c) => c.id)).toEqual(["b"]);
  });

  it("uses the percentage window when it's wider than the absolute floor", () => {
    // target mileage 200k -> 30% window is 60k, wider than the 25k floor
    const target = listing("a", 300_000, 2020, 200_000);
    const within = listing("b", 300_000, 2020, 255_000); // +55k, within 60k window
    const outside = listing("c", 300_000, 2020, 265_000); // +65k, outside
    const result = selectComparables(target, [within, outside]);
    expect(result.map((c) => c.id)).toEqual(["b"]);
  });

  it("doesn't filter on a dimension that's null on either side", () => {
    const target = listing("a", 300_000, null, null);
    const result = selectComparables(target, [listing("b", 300_000, 1999, 500_000)]);
    expect(result).toHaveLength(1);
  });
});

describe("evaluatePrice", () => {
  it("returns null when the target has no price", () => {
    expect(evaluatePrice(listing("a", null), [listing("b", 300_000)])).toBeNull();
  });

  it("returns null with fewer than 4 comparables", () => {
    const target = listing("a", 300_000);
    const result = evaluatePrice(target, [listing("b", 300_000), listing("c", 300_000), listing("d", 300_000)]);
    expect(result).toBeNull();
  });

  it("labels a price ≤5% below the median as 'good'", () => {
    const target = listing("a", 285_000); // -5% of 300k median
    const comparables = [
      listing("b", 300_000),
      listing("c", 300_000),
      listing("d", 300_000),
      listing("e", 300_000),
    ];
    const result = evaluatePrice(target, comparables);
    expect(result).not.toBeNull();
    expect(result!.fairPriceCzk).toBe(300_000);
    expect(result!.comparableCount).toBe(4);
    expect(result!.diffPct).toBeCloseTo(-5, 5);
    expect(result!.label).toBe("good");
  });

  it("labels a price within ±5% of the median as 'fair'", () => {
    const target = listing("a", 300_000);
    const comparables = [
      listing("b", 290_000),
      listing("c", 300_000),
      listing("d", 310_000),
      listing("e", 300_000),
    ];
    const result = evaluatePrice(target, comparables);
    expect(result!.label).toBe("fair");
  });

  it("labels a price ≥5% above the median as 'expensive'", () => {
    const target = listing("a", 336_000); // +12% of 300k median
    const comparables = [
      listing("b", 300_000),
      listing("c", 300_000),
      listing("d", 300_000),
      listing("e", 300_000),
    ];
    const result = evaluatePrice(target, comparables);
    expect(result!.diffPct).toBeCloseTo(12, 5);
    expect(result!.label).toBe("expensive");
  });

  it("computes the median correctly for an even number of comparables", () => {
    const target = listing("a", 300_000);
    // sorted comparable prices: 280k, 290k, 310k, 320k -> median (290k+310k)/2 = 300k
    const comparables = [
      listing("b", 320_000),
      listing("c", 280_000),
      listing("d", 310_000),
      listing("e", 290_000),
    ];
    const result = evaluatePrice(target, comparables);
    expect(result!.fairPriceCzk).toBe(300_000);
    expect(result!.label).toBe("fair");
  });

  it("is robust to a single outlier comparable", () => {
    const target = listing("a", 300_000);
    const comparables = [
      listing("b", 300_000),
      listing("c", 305_000),
      listing("d", 295_000),
      listing("e", 300_000),
      listing("f", 2_000_000), // wildly mispriced outlier
    ];
    const result = evaluatePrice(target, comparables);
    expect(result!.fairPriceCzk).toBe(300_000);
    expect(result!.label).toBe("fair");
  });

  it("excludes the target from its own comparable pool", () => {
    const target = listing("a", 1_000_000);
    const comparables = [target, listing("b", 300_000), listing("c", 300_000), listing("d", 300_000), listing("e", 300_000)];
    const result = evaluatePrice(target, comparables);
    expect(result!.comparableCount).toBe(4);
    expect(result!.fairPriceCzk).toBe(300_000);
  });
});
