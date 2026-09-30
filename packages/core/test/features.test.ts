import { describe, expect, it } from "vitest";
import { detectFeatures, detectLengthBasedProdlouzena, hasAllFeatures } from "../src/features.js";

describe("detectFeatures", () => {
  it("detects equipment groups from free text", () => {
    const ids = detectFeatures("Ford Tourneo Custom, tažné zařízení, navigace, kožené sedačky");
    expect(ids).toEqual(expect.arrayContaining(["tazne", "navigace", "kuze"]));
  });

  it("detects the 'prodlouzena' (Verze) group from a wheelbase token", () => {
    expect(detectFeatures("Ford Tourneo Custom 2.0 EcoBlue L2 Titanium AWD")).toContain("prodlouzena");
  });

  it("does not false-positive 'prodlouzena' on a short-wheelbase L1H1 listing", () => {
    expect(detectFeatures("Tourneo Custom 320 L1H1")).not.toContain("prodlouzena");
  });

  it("does not false-positive on a real trim name containing 'long' as a substring", () => {
    expect(detectFeatures("Jeep Compass Longitude")).not.toContain("prodlouzena");
  });

  it("detects the German 'Lang' wording", () => {
    expect(detectFeatures("Ford Transit Custom Kombi Lang 4x4")).toContain("prodlouzena");
  });

  it("returns an empty array for text with no recognized features", () => {
    expect(detectFeatures("Auto v pěkném stavu")).toEqual([]);
  });

  it("returns an empty array for empty/missing input", () => {
    expect(detectFeatures(null)).toEqual([]);
    expect(detectFeatures("")).toEqual([]);
  });

  // Added for detail-page description text (see scrapers/runner.ts's
  // near-match enrichment pass) — real-world Czech/German wordings beyond
  // the model-name-style synonyms already covered above.
  it("detects 'dlouhý rozvor'/'prodloužený rozvor' description wording", () => {
    expect(detectFeatures("Vůz má dlouhý rozvor a je v perfektním stavu")).toContain("prodlouzena");
    expect(detectFeatures("Multivan s prodlouženým rozvorem, 7 míst")).toContain("prodlouzena");
  });

  it("does not false-positive on a bare, standalone 'rozvor' mention", () => {
    // A wheelbase is mentioned on plenty of listings that are NOT the long
    // version — only the qualified phrases above should match.
    expect(detectFeatures("Rozvor 3000 mm, standardní verze")).not.toContain("prodlouzena");
  });
});

describe("detectLengthBasedProdlouzena", () => {
  it("detects a length at or above the long-wheelbase threshold in mm", () => {
    expect(detectLengthBasedProdlouzena("Délka vozu: 5304 mm")).toBe(true);
    expect(detectLengthBasedProdlouzena("celková délka 5200mm")).toBe(true);
  });

  it("detects a length given in meters", () => {
    expect(detectLengthBasedProdlouzena("délka 5,30 m")).toBe(true);
    expect(detectLengthBasedProdlouzena("length 5.25 m")).toBe(true);
  });

  it("does not flag a standard/short-wheelbase length", () => {
    expect(detectLengthBasedProdlouzena("Délka vozu: 4904 mm")).toBe(false);
  });

  it("ignores an implausibly large number (not a real vehicle length)", () => {
    expect(detectLengthBasedProdlouzena("objem zavazadlového prostoru 9500 mm3")).toBe(false);
  });

  it("returns false for empty/missing input", () => {
    expect(detectLengthBasedProdlouzena(null)).toBe(false);
    expect(detectLengthBasedProdlouzena("")).toBe(false);
  });

  it("feeds into detectFeatures/hasAllFeatures for the 'prodlouzena' group", () => {
    expect(detectFeatures("VW Multivan Trendline, rozvor 5304 mm")).toContain("prodlouzena");
    expect(hasAllFeatures("VW Multivan Trendline, rozvor 5304 mm", ["prodlouzena"])).toBe(true);
  });
});

describe("hasAllFeatures", () => {
  const text = "Ford Tourneo Custom 2.0 EcoBlue L2 Titanium AWD, tažné zařízení, navi";

  it("requires every ticked feature to be present", () => {
    expect(hasAllFeatures(text, ["prodlouzena", "tazne", "navigace"])).toBe(true);
    expect(hasAllFeatures(text, ["prodlouzena", "kuze"])).toBe(false);
  });

  it("passes trivially with no requested features", () => {
    expect(hasAllFeatures(null, [])).toBe(true);
  });

  it("fails on null text when features are requested", () => {
    expect(hasAllFeatures(null, ["tazne"])).toBe(false);
  });

  // `confirmedIds` — populated from `Listing.detailFeatures` by the scraper
  // runner's detail-page enrichment pass (see runner.ts) — lets a caller
  // short-circuit the free-text scan for an id it already confirmed by other
  // means (e.g. the source's list-page text never mentioned "prodloužená",
  // but its detail page did).
  describe("confirmedIds", () => {
    it("treats a confirmed id as satisfied even when absent from the text", () => {
      expect(hasAllFeatures("Ford Tourneo Custom 2.0 EcoBlue", ["prodlouzena"], ["prodlouzena"])).toBe(true);
    });

    it("still requires every OTHER ticked feature to be found in the text", () => {
      expect(hasAllFeatures("Ford Tourneo Custom 2.0 EcoBlue", ["prodlouzena", "tazne"], ["prodlouzena"])).toBe(
        false
      );
      expect(
        hasAllFeatures("Ford Tourneo Custom 2.0 EcoBlue, tažné zařízení", ["prodlouzena", "tazne"], ["prodlouzena"])
      ).toBe(true);
    });

    it("works even with null/empty text, as long as every requested id is confirmed", () => {
      expect(hasAllFeatures(null, ["prodlouzena"], ["prodlouzena"])).toBe(true);
    });

    it("ignores an empty/undefined confirmedIds list (falls back to text-only)", () => {
      expect(hasAllFeatures(text, ["prodlouzena"], [])).toBe(true);
      expect(hasAllFeatures(text, ["prodlouzena"])).toBe(true);
    });
  });
});
