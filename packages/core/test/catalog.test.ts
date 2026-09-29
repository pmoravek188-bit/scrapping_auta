import { describe, expect, it } from "vitest";
import { MAKES, POPULAR_MODELS } from "../src/catalog.js";
import { normalizeMake, normalizeModel } from "../src/make-model.js";

describe("catalog slugs", () => {
  it("every catalog make slug is already normalized (normalizeMake is a no-op on it)", () => {
    for (const make of MAKES) {
      expect(normalizeMake(make.slug)).toBe(make.slug);
    }
  });

  it("every catalog model slug is already normalized (normalizeModel is a no-op on it)", () => {
    for (const [make, list] of Object.entries(POPULAR_MODELS)) {
      for (const model of list) {
        expect(normalizeModel(model.slug), `${make}/${model.slug}`).toBe(model.slug);
      }
    }
  });

  it("every make key used in POPULAR_MODELS is a known catalog make slug", () => {
    const makeSlugs = new Set(MAKES.map((m) => m.slug));
    for (const make of Object.keys(POPULAR_MODELS)) {
      expect(makeSlugs.has(make), make).toBe(true);
    }
  });

  it("has no duplicate model slugs within a single make", () => {
    for (const [make, list] of Object.entries(POPULAR_MODELS)) {
      const slugs = list.map((m) => m.slug);
      expect(new Set(slugs).size, make).toBe(slugs.length);
    }
  });
});

describe("VW van/MPV coverage (user complaint: Multivan/Caravelle missing)", () => {
  it("includes the current and recent VW commercial line-up", () => {
    const vwSlugs = POPULAR_MODELS.volkswagen!.map((m) => m.slug);
    expect(vwSlugs).toEqual(
      expect.arrayContaining([
        "multivan",
        "caravelle",
        "transporter",
        "california",
        "crafter",
        "caddy",
        "amarok",
        "id-buzz",
      ])
    );
  });

  it("tags VW vans/MPVs/pickups with a segment", () => {
    const bySlug = new Map(POPULAR_MODELS.volkswagen!.map((m) => [m.slug, m]));
    expect(bySlug.get("multivan")?.segment).toBe("mpv");
    expect(bySlug.get("transporter")?.segment).toBe("van");
    expect(bySlug.get("amarok")?.segment).toBe("pickup");
  });
});

describe("van coverage across every make (not just VW)", () => {
  it("every make in MAKES has at least one van/pickup/mpv-tagged model or is a car-only make", () => {
    // Makes that plausibly sell light commercials/MPVs in the CZ market -
    // each of these must have at least one segment-tagged model so the
    // future "jen dodávky" filter has something to show for every brand.
    const expectedCommercialMakes = [
      "skoda",
      "volkswagen",
      "mercedes-benz",
      "ford",
      "opel",
      "hyundai",
      "kia",
      "toyota",
      "renault",
      "peugeot",
      "citroen",
      "fiat",
      "nissan",
      "mitsubishi",
      "dacia",
      "jeep",
      "iveco",
      "man",
      "isuzu",
      "ssangyong",
      "maxus",
      "ldv",
      "piaggio",
      "dodge",
      "ram",
    ];
    for (const make of expectedCommercialMakes) {
      const list = POPULAR_MODELS[make] ?? [];
      const hasSegment = list.some((m) => m.segment != null);
      expect(hasSegment, make).toBe(true);
    }
  });

  it("adds dedicated commercial makes missing from the previous catalog", () => {
    const makeSlugs = new Set(MAKES.map((m) => m.slug));
    for (const make of ["iveco", "man", "isuzu", "ssangyong", "maxus", "ldv", "piaggio", "dodge", "ram"]) {
      expect(makeSlugs.has(make), make).toBe(true);
    }
  });
});

describe("Mercedes-Benz lettered classes: one catalog entry per class", () => {
  it("catalogues the V-Class once, under the canonical 'v-class' slug", () => {
    const bySlug = new Map(POPULAR_MODELS["mercedes-benz"]!.map((m) => [m.slug, m]));
    expect(bySlug.has("v-class")).toBe(true);
    expect(bySlug.has("v-klasse")).toBe(false);
    expect(bySlug.has("trida-v")).toBe(false);
    // Every spelling a source might use now normalizes to that one catalog
    // slug (see make-model.ts's Mercedes-Benz alias table) — this is what
    // lets a listing titled "Třída V"/"Třídy V"/"V-Klasse" match a saved
    // search built from this catalog's "v-class" option.
    expect(normalizeModel("Třída V", "mercedes-benz")).toBe("v-class");
    expect(normalizeModel("Třídy V", "mercedes-benz")).toBe("v-class");
    expect(normalizeModel("V-Klasse", "mercedes-benz")).toBe("v-class");
  });

  it("renamed T-Class and X-Class to the canonical '<letter>-class' slug", () => {
    const bySlug = new Map(POPULAR_MODELS["mercedes-benz"]!.map((m) => [m.slug, m]));
    expect(bySlug.has("t-class")).toBe(true);
    expect(bySlug.has("t-klasse")).toBe(false);
    expect(bySlug.has("x-class")).toBe(true);
    expect(bySlug.has("x-klasse")).toBe(false);
  });
});
