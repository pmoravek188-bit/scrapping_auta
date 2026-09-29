import { describe, expect, it } from "vitest";
import { bmwSeriesNumber, normalizeMake, normalizeModel } from "../src/make-model.js";

describe("normalizeMake", () => {
  it("maps common aliases to a canonical slug", () => {
    expect(normalizeMake("Škoda")).toBe("skoda");
    expect(normalizeMake("skoda")).toBe("skoda");
    expect(normalizeMake("VW")).toBe("volkswagen");
    expect(normalizeMake("Volkswagen")).toBe("volkswagen");
    expect(normalizeMake("Mercedes-Benz")).toBe("mercedes-benz");
  });

  it("falls back to a slug for unknown makes", () => {
    expect(normalizeMake("SsangYong")).toBe("ssangyong");
  });
});

describe("normalizeModel", () => {
  it("slugifies model names", () => {
    expect(normalizeModel("Octavia")).toBe("octavia");
    expect(normalizeModel("A6 Avant")).toBe("a6-avant");
  });

  it("leaves a plain letter untouched when no make (or a non-Mercedes make) is given", () => {
    expect(normalizeModel("A")).toBe("a");
    expect(normalizeModel("A", "audi")).toBe("a");
  });
});

describe("normalizeModel with a Mercedes-Benz make — lettered-class aliasing", () => {
  const MAKE = "mercedes-benz";

  it("canonicalizes every spelling of the V-Class to the same 'v-class' slug", () => {
    expect(normalizeModel("Třída V", MAKE)).toBe("v-class");
    // Czech genitive ("Třídy V") — confirmed live as sauto.cz's and
    // tipcars.com's own spelling for every Mercedes-Benz class.
    expect(normalizeModel("Třídy V", MAKE)).toBe("v-class");
    expect(normalizeModel("V-Klasse", MAKE)).toBe("v-class");
    expect(normalizeModel("V-Class", MAKE)).toBe("v-class");
    expect(normalizeModel("Class V", MAKE)).toBe("v-class");
    // Bare letter — confirmed live as aaaauto.cz's own structured `model`
    // field for every V-Class listing.
    expect(normalizeModel("V", MAKE)).toBe("v-class");
  });

  it("accepts a raw (non-normalized) make spelling too", () => {
    expect(normalizeModel("Třída V", "Mercedes-Benz")).toBe("v-class");
    expect(normalizeModel("Třída V", "mercedes")).toBe("v-class");
    expect(normalizeModel("Třída V", "mb")).toBe("v-class");
  });

  it("canonicalizes every lettered class the app knows about", () => {
    const cases: Array<[string, string]> = [
      ["Třída A", "a-class"],
      ["Třída B", "b-class"],
      ["Třída C", "c-class"],
      ["Třída E", "e-class"],
      ["Třída S", "s-class"],
      ["Třída G", "g-class"],
      ["Třída T", "t-class"],
      ["Třída X", "x-class"],
    ];
    for (const [input, expected] of cases) {
      expect(normalizeModel(input, MAKE), input).toBe(expected);
    }
  });

  it("preserves a trailing model-detail suffix so matcher.ts prefix matching still works", () => {
    expect(normalizeModel("Třídy V 250", MAKE)).toBe("v-class-250");
    expect(normalizeModel("V-Klasse 250", MAKE)).toBe("v-class-250");
  });

  it("leaves non-lettered Mercedes-Benz models unaffected", () => {
    expect(normalizeModel("Vito", MAKE)).toBe("vito");
    expect(normalizeModel("GLC", MAKE)).toBe("glc");
    expect(normalizeModel("Sprinter", MAKE)).toBe("sprinter");
  });
});

describe("normalizeModel with a BMW make — numbered-series aliasing", () => {
  const MAKE = "bmw";

  it("canonicalizes every spelling of the 3 Series to the same '3-series' slug", () => {
    // Czech ("Řada 3") — confirmed live as sauto.cz's `model_cb.seo_name`.
    expect(normalizeModel("Řada 3", MAKE)).toBe("3-series");
    expect(normalizeModel("3-series", MAKE)).toBe("3-series");
    // German.
    expect(normalizeModel("3er", MAKE)).toBe("3-series");
    // A bare series number, no other token.
    expect(normalizeModel("3", MAKE)).toBe("3-series");
  });

  it("derives the series from a bare engine-designation code (no series word at all)", () => {
    // Confirmed live: autoscout24.cz's structured `vehicle.model` for a
    // 3-series car is literally "320"/"318" (no suffix letter).
    expect(normalizeModel("320", MAKE)).toBe("3-series-320");
    expect(normalizeModel("318", MAKE)).toBe("3-series-318");
    // With a suffix letter.
    expect(normalizeModel("320d", MAKE)).toBe("3-series-320d");
    expect(normalizeModel("318i", MAKE)).toBe("3-series-318i");
    expect(normalizeModel("325xd", MAKE)).toBe("3-series-325xd");
    // Other series numbers, from the code's first digit.
    expect(normalizeModel("116d", MAKE)).toBe("1-series-116d");
    expect(normalizeModel("530d", MAKE)).toBe("5-series-530d");
    expect(normalizeModel("740le", MAKE)).toBe("7-series-740le");
  });

  it("folds an 'M Performance' trim into its base series", () => {
    expect(normalizeModel("M340i", MAKE)).toBe("3-series-m340i");
    expect(normalizeModel("M235i", MAKE)).toBe("2-series-m235i");
    expect(normalizeModel("M550i", MAKE)).toBe("5-series-m550i");
  });

  it("does NOT fold a standalone M-badged model into a numbered series", () => {
    expect(normalizeModel("M3", MAKE)).toBe("m3");
    expect(normalizeModel("M5", MAKE)).toBe("m5");
  });

  it("leaves the X/Z/i model lines unaffected", () => {
    expect(normalizeModel("X1", MAKE)).toBe("x1");
    expect(normalizeModel("X5", MAKE)).toBe("x5");
    expect(normalizeModel("Z4", MAKE)).toBe("z4");
    expect(normalizeModel("i4", MAKE)).toBe("i4");
  });
});

describe("bmwSeriesNumber", () => {
  it("extracts the bare digit from a canonical numbered-series slug", () => {
    expect(bmwSeriesNumber("3-series")).toBe("3");
    expect(bmwSeriesNumber("3-series-320d")).toBe("3");
    expect(bmwSeriesNumber("7-series")).toBe("7");
  });

  it("returns null for non-numbered-series slugs", () => {
    expect(bmwSeriesNumber("x5")).toBeNull();
    expect(bmwSeriesNumber("m3")).toBeNull();
    expect(bmwSeriesNumber(null)).toBeNull();
  });
});

describe("normalizeModel — Toyota RAV4 aliasing", () => {
  it("canonicalizes 'RAV 4' to the catalog's 'rav4' slug", () => {
    expect(normalizeModel("RAV 4", "toyota")).toBe("rav4");
    expect(normalizeModel("RAV4", "toyota")).toBe("rav4");
  });
});

describe("normalizeModel — Mazda bare-number aliasing", () => {
  it("canonicalizes a bare model number to 'mazdaN'", () => {
    expect(normalizeModel("2", "mazda")).toBe("mazda2");
    expect(normalizeModel("3", "mazda")).toBe("mazda3");
    expect(normalizeModel("6", "mazda")).toBe("mazda6");
    expect(normalizeModel("CX-5", "mazda")).toBe("cx-5");
  });
});
