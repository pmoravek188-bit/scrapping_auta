import { describe, expect, it } from "vitest";
import { detectFeatures, hasAllFeatures } from "../src/features.js";

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
});
