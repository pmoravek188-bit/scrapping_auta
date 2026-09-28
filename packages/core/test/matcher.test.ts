import { describe, expect, it } from "vitest";
import { matchesSearch } from "../src/matcher.js";
import { normalizeListing } from "../src/normalize.js";
import type { SearchQuery } from "../src/schemas.js";

const listing = normalizeListing(
  {
    sourceId: "1",
    url: "https://example.com/1",
    title: "Škoda Octavia Combi 2.0 TDI DSG, nehavarovaná",
    make: "Škoda",
    model: "Octavia",
    year: 2020,
    mileageKm: 60000,
    price: 450000,
    currency: "CZK",
    fuel: "diesel",
    transmission: "automat",
    powerKw: 110,
    body: "kombi",
    sellerType: "dealer",
  },
  { source: "sauto" }
);

describe("matchesSearch", () => {
  it("matches on make/model/year/price/mileage", () => {
    const q: SearchQuery = {
      make: "skoda",
      model: "octavia",
      yearFrom: 2018,
      yearTo: 2022,
      priceTo: 500000,
      mileageMax: 100000,
      fuel: [],
      body: [],
      keywords: [],
      excludeKeywords: [],
      sources: [],
    };
    expect(matchesSearch(listing, q)).toBe(true);
  });

  it("rejects when price is above priceTo", () => {
    const q: SearchQuery = { priceTo: 400000, fuel: [], body: [], keywords: [], excludeKeywords: [], sources: [] };
    expect(matchesSearch(listing, q)).toBe(false);
  });

  it("respects keywords and exclude_keywords", () => {
    const okQuery: SearchQuery = {
      keywords: ["nehavarovaná"],
      fuel: [],
      body: [],
      excludeKeywords: [],
      sources: [],
    };
    expect(matchesSearch(listing, okQuery)).toBe(true);

    const excludeQuery: SearchQuery = {
      keywords: [],
      fuel: [],
      body: [],
      excludeKeywords: ["havarovaná"],
      sources: [],
    };
    // "nehavarovaná" contains "havarovaná" as substring on purpose -> should exclude
    expect(matchesSearch(listing, excludeQuery)).toBe(false);
  });

  it("filters by source list", () => {
    const q: SearchQuery = {
      sources: ["carvago"],
      fuel: [],
      body: [],
      keywords: [],
      excludeKeywords: [],
    };
    expect(matchesSearch(listing, q)).toBe(false);
  });
});
