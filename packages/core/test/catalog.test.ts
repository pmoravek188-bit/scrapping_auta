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

describe("Mercedes-Benz V-Class dual naming", () => {
  it("catalogues both the 'Třída V' and 'V-Klasse' spellings, since normalizeModel doesn't alias them together", () => {
    const bySlug = new Map(POPULAR_MODELS["mercedes-benz"]!.map((m) => [m.slug, m]));
    expect(bySlug.has("v-klasse")).toBe(true);
    expect(bySlug.has("trida-v")).toBe(true);
    expect(normalizeModel("V-Klasse")).toBe("v-klasse");
    expect(normalizeModel("Třída V")).toBe("trida-v");
  });
});
