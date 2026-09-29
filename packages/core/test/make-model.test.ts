import { describe, expect, it } from "vitest";
import { normalizeMake, normalizeModel } from "../src/make-model.js";

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
