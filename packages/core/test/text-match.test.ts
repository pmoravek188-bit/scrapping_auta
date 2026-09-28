import { describe, expect, it } from "vitest";
import { includesPhrase, tokenize } from "../src/text-match.js";

describe("tokenize", () => {
  it("splits on non-alphanumeric characters and lowercases", () => {
    expect(tokenize("Ford Tourneo Custom, L2!")).toEqual(["ford", "tourneo", "custom", "l2"]);
  });

  it("keeps an alphanumeric run like L2H1 as one token", () => {
    expect(tokenize("Tourneo Custom 320 L1H1")).toEqual(["tourneo", "custom", "320", "l1h1"]);
  });

  it("normalizes × to x", () => {
    expect(tokenize("pohon 4×4")).toEqual(["pohon", "4x4"]);
  });

  it("strips diacritics", () => {
    expect(tokenize("nehavarovaná")).toEqual(["nehavarovana"]);
  });
});

describe("includesPhrase", () => {
  it("matches a whole token, not a substring of a longer one", () => {
    expect(includesPhrase("Ford Tourneo Custom 2.0 EcoBlue L2 Titanium AWD", "L2")).toBe(true);
    expect(includesPhrase("Ford Tourneo Custom 320 L1H1", "L2")).toBe(false);
    expect(includesPhrase("Ford HL2 special", "L2")).toBe(false);
    expect(includesPhrase("Tesla Model L20", "L2")).toBe(false);
  });

  it("does not match a word that merely shares a suffix", () => {
    expect(includesPhrase("Škoda Octavia, nehavarovaná", "havarovaná")).toBe(false);
    expect(includesPhrase("Škoda Octavia, havarovaná", "havarovaná")).toBe(true);
  });

  it("does not match 'long' inside a real trim name like 'Longitude'", () => {
    expect(includesPhrase("Jeep Compass Longitude", "long")).toBe(false);
  });

  it("matches a multi-word phrase as a contiguous token sequence", () => {
    expect(includesPhrase("Volkswagen Caddy Maxi 2.0 TDI", "maxi")).toBe(true);
    expect(includesPhrase("Auto s langer Radstand navíc", "langer radstand")).toBe(true);
    expect(includesPhrase("Auto s dlouhým radstandem", "langer radstand")).toBe(false);
  });

  it("is case/diacritics-insensitive", () => {
    expect(includesPhrase("Prodloužená verze vozu", "prodloužená")).toBe(true);
    expect(includesPhrase("PRODLOUZENA VERZE", "Prodloužená")).toBe(true);
  });
});
