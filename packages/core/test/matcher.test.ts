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
    // Keyword matching is whole-token (see text-match.ts): "nehavarovaná" is
    // a single token, distinct from "havarovaná" — a shared suffix isn't the
    // same word, so this must NOT be excluded (this also prevents e.g. a
    // "corsa" keyword from wrongly matching "corsair").
    expect(matchesSearch(listing, excludeQuery)).toBe(true);

    const exactExcludeQuery: SearchQuery = {
      keywords: [],
      fuel: [],
      body: [],
      excludeKeywords: ["nehavarovaná"],
      sources: [],
    };
    expect(matchesSearch(listing, exactExcludeQuery)).toBe(false);
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

  it("treats a null fuel/transmission/body/powerKw on the listing as unknown (passes), not a mismatch", () => {
    const sparse = normalizeListing(
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
      },
      { source: "sauto" }
    );
    const q: SearchQuery = {
      fuel: ["diesel"],
      transmission: "automatic",
      body: ["combi"],
      powerMinKw: 100,
      keywords: [],
      excludeKeywords: [],
      sources: [],
    };
    expect(matchesSearch(sparse, q)).toBe(true);
  });

  it("still rejects when the listing DOES state a conflicting fuel/transmission/body/power", () => {
    const q: SearchQuery = {
      fuel: ["petrol"],
      keywords: [],
      body: [],
      excludeKeywords: [],
      sources: [],
    };
    expect(matchesSearch(listing, q)).toBe(false); // listing.fuel is "diesel"
  });
});

// Regression coverage for the production search that returned 719 scraped
// listings but 0 matches: "ford " (trailing space, raw user text), model
// "tourneo custom" (raw, spaced), year_from 2020, price_to 1500000,
// mileage_max 100000, transmission automatic, power_min_kw 100,
// keywords ["4X4"]. The root cause was `matchesSearch` comparing the raw,
// un-normalized query make/model against normalized listing.make/model with
// strict `===`, so it never matched even sources that scraped correctly.
describe("matchesSearch (production Ford Tourneo Custom regression)", () => {
  const fordQuery: SearchQuery = {
    make: "ford ",
    model: "tourneo custom",
    yearFrom: 2020,
    priceTo: 1_500_000,
    mileageMax: 100_000,
    transmission: "automatic",
    powerMinKw: 100,
    keywords: ["4X4"],
    fuel: [],
    body: [],
    excludeKeywords: [],
    sources: [],
  };

  function fordListing(overrides: Partial<Parameters<typeof normalizeListing>[0]> = {}) {
    return normalizeListing(
      {
        sourceId: "1",
        url: "https://example.com/1",
        title: "Ford Tourneo Custom 2.0 EcoBlue 4X4 L2",
        make: "Ford",
        model: "Tourneo Custom",
        year: 2021,
        mileageKm: 80000,
        price: 950000,
        currency: "CZK",
        fuel: "diesel",
        transmission: "automat",
        powerKw: 125,
        ...overrides,
      },
      { source: "sauto" }
    );
  }

  it("matches a correctly-scraped listing (make/model normalized, raw query has trailing space + un-hyphenated model)", () => {
    expect(matchesSearch(fordListing(), fordQuery)).toBe(true);
  });

  it("rejects a listing without '4X4' in the title/variant (keyword filter)", () => {
    const listing = fordListing({ title: "Ford Tourneo Custom 2.0 EcoBlue L2" });
    expect(matchesSearch(listing, fordQuery)).toBe(false);
  });

  it("rejects a manual-transmission listing", () => {
    const listing = fordListing({ transmission: "manuální" });
    expect(matchesSearch(listing, fordQuery)).toBe(false);
  });

  it("rejects underpowered listings (below power_min_kw)", () => {
    const listing = fordListing({ powerKw: 88 });
    expect(matchesSearch(listing, fordQuery)).toBe(false);
  });

  it("matches a listing whose model is a more specific slug than the query (tourneo-custom-l2 style body suffix)", () => {
    const listing = normalizeListing(
      {
        sourceId: "2",
        url: "https://example.com/2",
        title: "Ford Tourneo Custom L2 4X4",
        make: "ford",
        model: "tourneo-custom-l2",
        year: 2022,
        mileageKm: 40000,
        price: 1_200_000,
        currency: "CZK",
        fuel: "diesel",
        transmission: "automatic",
        powerKw: 136,
      },
      { source: "carvago" }
    );
    expect(matchesSearch(listing, fordQuery)).toBe(true);
  });

  it("matches via title fallback when a source never set listing.model (e.g. bazos/autoesa before make/model inference)", () => {
    const listing = normalizeListing(
      {
        sourceId: "3",
        url: "https://example.com/3",
        title: "Ford Tourneo Custom 2.0 TDCi 4x4 automat",
        make: null,
        model: null,
        year: 2021,
        mileageKm: 60000,
        price: 890000,
        currency: "CZK",
        fuel: "diesel",
        transmission: "automat",
        powerKw: 110,
      },
      { source: "bazos" }
    );
    // inferMakeModel should have recovered make/model from the title.
    expect(listing.make).toBe("ford");
    expect(matchesSearch(listing, fordQuery)).toBe(true);
  });

  it("matches a listing with null powerKw/transmission/fuel/body (e.g. sauto's list API never returns power) — unknown, not a mismatch", () => {
    const listing = normalizeListing(
      {
        sourceId: "5",
        url: "https://example.com/5",
        title: "Ford Tourneo Custom 2.0 EcoBlue 4X4 Automat",
        make: "Ford",
        model: "Tourneo Custom",
        year: 2021,
        mileageKm: 70000,
        price: 1_000_000,
        currency: "CZK",
        // fuel/transmission/powerKw intentionally omitted, as sauto's
        // list endpoint frequently doesn't supply them.
      },
      { source: "sauto" }
    );
    expect(listing.powerKw).toBeNull();
    expect(matchesSearch(listing, fordQuery)).toBe(true);
  });

  it("still rejects year/price/mileage mismatches even though power/fuel/transmission/body are lenient on null", () => {
    const tooOld = fordListing({ year: 2015 });
    expect(matchesSearch(tooOld, fordQuery)).toBe(false);

    const tooExpensive = fordListing({ price: 2_000_000 });
    expect(matchesSearch(tooExpensive, fordQuery)).toBe(false);

    const tooHighMileage = fordListing({ mileageKm: 150_000 });
    expect(matchesSearch(tooHighMileage, fordQuery)).toBe(false);
  });

  it("rejects a different Ford model entirely", () => {
    const listing = normalizeListing(
      {
        sourceId: "4",
        url: "https://example.com/4",
        title: "Ford Focus 2.0 EcoBlue 4X4",
        make: "Ford",
        model: "Focus",
        year: 2021,
        mileageKm: 50000,
        price: 700000,
        currency: "CZK",
        fuel: "diesel",
        transmission: "automat",
        powerKw: 110,
      },
      { source: "sauto" }
    );
    expect(matchesSearch(listing, fordQuery)).toBe(false);
  });
});
