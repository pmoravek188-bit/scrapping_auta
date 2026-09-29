import { describe, expect, it } from "vitest";
import {
  bmwSeriesNumber,
  isVwVanFamilyModel,
  normalizeMake,
  normalizeModel,
  vwIdModelUrlSlug,
} from "../src/make-model.js";

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

describe("normalizeModel — Kia Cee'd aliasing", () => {
  it("canonicalizes every punctuated spelling of Cee'd to the catalog's 'ceed' slug", () => {
    // Confirmed live: sauto.cz's title text for every Ceed listing is
    // "Kia Cee´d" (a bare acute-accent character, not a plain apostrophe).
    expect(normalizeModel("Cee´d", "kia")).toBe("ceed");
    expect(normalizeModel("Cee'd", "kia")).toBe("ceed");
    // Already-plain spellings (aaaauto.cz, tipcars.com) are a no-op.
    expect(normalizeModel("Ceed", "kia")).toBe("ceed");
    expect(normalizeModel("ceed", "kia")).toBe("ceed");
  });

  it("preserves a trailing detail suffix", () => {
    expect(normalizeModel("Cee'd GT", "kia")).toBe("ceed-gt");
  });

  it("leaves other Kia models unaffected", () => {
    expect(normalizeModel("Sportage", "kia")).toBe("sportage");
    expect(normalizeModel("Rio", "kia")).toBe("rio");
  });
});

describe("normalizeModel with a Volkswagen make — ID./van-family aliasing", () => {
  const MAKE = "volkswagen";

  it("canonicalizes a hyphen-less 'ID' electric model to 'id-N'", () => {
    // Confirmed live: aaaauto.cz's own URL model-path segment for these is
    // exactly this hyphen-less spelling.
    expect(normalizeModel("id3", MAKE)).toBe("id-3");
    expect(normalizeModel("ID4", MAKE)).toBe("id-4");
    expect(normalizeModel("id5", MAKE)).toBe("id-5");
    expect(normalizeModel("ID.4", MAKE)).toBe("id-4");
    expect(normalizeModel("idbuzz", MAKE)).toBe("id-buzz");
    expect(normalizeModel("ID. Buzz", MAKE)).toBe("id-buzz");
  });

  it("canonicalizes a generation-code-first van name to the model-first catalog slug", () => {
    // Confirmed live: autoscout24.cz's structured `vehicle.model` field for a
    // VW Multivan is literally "T6 Multivan"/"T6.1 Multivan", not "Multivan".
    expect(normalizeModel("T6 Multivan", MAKE)).toBe("multivan-t6");
    expect(normalizeModel("T6.1 Multivan", MAKE)).toBe("multivan-t6-1");
    expect(normalizeModel("T7 Multivan", MAKE)).toBe("multivan-t7");
    expect(normalizeModel("T6 Transporter", MAKE)).toBe("transporter-t6");
    expect(normalizeModel("T6 Caravelle", MAKE)).toBe("caravelle-t6");
    expect(normalizeModel("T6 California", MAKE)).toBe("california-t6");
  });

  it("leaves an already model-first van name unaffected", () => {
    expect(normalizeModel("Multivan T6.1", MAKE)).toBe("multivan-t6-1");
    expect(normalizeModel("Transporter", MAKE)).toBe("transporter");
  });

  it("leaves ordinary VW models unaffected", () => {
    expect(normalizeModel("Golf", MAKE)).toBe("golf");
    expect(normalizeModel("Golf Variant", MAKE)).toBe("golf-variant");
    expect(normalizeModel("Tiguan Allspace", MAKE)).toBe("tiguan-allspace");
  });
});

describe("vwIdModelUrlSlug", () => {
  it("extracts aaaauto.cz's hyphen-less URL slug from a canonical ID. model", () => {
    expect(vwIdModelUrlSlug("id-3")).toBe("id3");
    expect(vwIdModelUrlSlug("id-4")).toBe("id4");
    expect(vwIdModelUrlSlug("id-5-pro")).toBe("id5");
  });

  it("returns null for non-ID models", () => {
    expect(vwIdModelUrlSlug("golf")).toBeNull();
    expect(vwIdModelUrlSlug("id-buzz")).toBeNull();
    expect(vwIdModelUrlSlug(null)).toBeNull();
  });
});

describe("isVwVanFamilyModel", () => {
  it("is true for the generation-less T4-T7 van family names", () => {
    expect(isVwVanFamilyModel("multivan")).toBe(true);
    expect(isVwVanFamilyModel("transporter")).toBe(true);
    expect(isVwVanFamilyModel("caravelle")).toBe(true);
    expect(isVwVanFamilyModel("california")).toBe(true);
  });

  it("is false for a generation-qualified slug or any other model", () => {
    expect(isVwVanFamilyModel("multivan-t6")).toBe(false);
    expect(isVwVanFamilyModel("golf")).toBe(false);
    expect(isVwVanFamilyModel(null)).toBe(false);
  });
});
