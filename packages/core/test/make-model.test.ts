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
});
