import { describe, expect, it } from "vitest";
import { normalizeListing, type SearchQuery } from "@scrapping-auta/core";
import { selectListingsToStore } from "../src/selection.js";

function query(overrides: Partial<SearchQuery> = {}): SearchQuery {
  return {
    make: null,
    model: null,
    yearFrom: null,
    yearTo: null,
    priceFrom: null,
    priceTo: null,
    mileageMax: null,
    fuel: [],
    transmission: null,
    body: [],
    powerMinKw: null,
    keywords: [],
    excludeKeywords: [],
    sources: [],
    ...overrides,
  };
}

const fordTourneo = normalizeListing(
  {
    sourceId: "1",
    url: "https://example.com/1",
    title: "Ford Tourneo Custom 2.0 TDCI",
    make: "Ford",
    model: "Tourneo Custom",
    year: 2019,
    mileageKm: 90000,
    price: 550000,
    currency: "CZK",
    fuel: "diesel",
    sellerType: "dealer",
  },
  { source: "sauto" }
);

const skodaOctavia = normalizeListing(
  {
    sourceId: "2",
    url: "https://example.com/2",
    title: "Škoda Octavia Combi 2.0 TDI",
    make: "Škoda",
    model: "Octavia",
    year: 2020,
    mileageKm: 60000,
    price: 450000,
    currency: "CZK",
    fuel: "diesel",
    sellerType: "dealer",
  },
  { source: "sauto" }
);

describe("selectListingsToStore", () => {
  it("keeps only listings that match at least one search", () => {
    const searches = [query({ make: "ford", model: "tourneo-custom" })];
    const result = selectListingsToStore([fordTourneo, skodaOctavia], searches);
    expect(result).toEqual([fordTourneo]);
  });

  it("keeps a listing matched by any of several searches (union, not intersection)", () => {
    const searches = [
      query({ make: "ford", model: "tourneo-custom" }),
      query({ make: "skoda", model: "octavia" }),
    ];
    const result = selectListingsToStore([fordTourneo, skodaOctavia], searches);
    expect(result).toEqual([fordTourneo, skodaOctavia]);
  });

  it("stores nothing when no search matches", () => {
    const searches = [query({ make: "bmw" })];
    expect(selectListingsToStore([fordTourneo, skodaOctavia], searches)).toEqual([]);
  });

  it("stores nothing when there are no searches at all", () => {
    expect(selectListingsToStore([fordTourneo, skodaOctavia], [])).toEqual([]);
  });

  it("does not mutate or reorder input beyond filtering", () => {
    const searches = [query()]; // empty query matches everything
    const result = selectListingsToStore([skodaOctavia, fordTourneo], searches);
    expect(result).toEqual([skodaOctavia, fordTourneo]);
  });
});
