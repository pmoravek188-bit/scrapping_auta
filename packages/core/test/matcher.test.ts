import { describe, expect, it } from "vitest";
import { explainMatch, isFeatureOnlyMismatch, matchesSearch } from "../src/matcher.js";
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

  it("treats a null drive on the listing as unknown (passes), not a mismatch", () => {
    // `listing` above has no `drive` field, so normalizeListing leaves it null.
    expect(listing.drive).toBeNull();
    const q: SearchQuery = {
      drive: ["awd"],
      fuel: [],
      body: [],
      keywords: [],
      excludeKeywords: [],
      sources: [],
    };
    // A source that can't tell drive type (many list pages don't expose it)
    // must not silently drop an otherwise-matching car just because this
    // particular listing didn't state a confirmed drive type.
    expect(matchesSearch(listing, q)).toBe(true);
  });

  it("still rejects when the listing DOES state a conflicting drive type", () => {
    const fwd = normalizeListing(
      {
        sourceId: "3",
        url: "https://example.com/3",
        title: "Škoda Octavia Combi 2.0 TDI",
        make: "Škoda",
        model: "Octavia",
        year: 2020,
        mileageKm: 60000,
        price: 450000,
        currency: "CZK",
        drive: "fwd",
      },
      { source: "carvago" }
    );
    const q: SearchQuery = {
      drive: ["awd"],
      fuel: [],
      body: [],
      keywords: [],
      excludeKeywords: [],
      sources: [],
    };
    expect(matchesSearch(fwd, q)).toBe(false);
  });

  // `Listing.detailFeatures`, populated by the scraper runner's detail-page
  // enrichment pass (see packages/scrapers/src/runner.ts), lets a listing
  // whose LIST-page text never mentioned a feature still match on it.
  it("matches on a feature confirmed only via listing.detailFeatures (not present in title/variant/equipment)", () => {
    const plain = normalizeListing(
      {
        sourceId: "6",
        url: "https://example.com/6",
        title: "Volkswagen Multivan 2.0 TDI Trendline",
        make: "Volkswagen",
        model: "Multivan",
        year: 2018,
        mileageKm: 90000,
        price: 700000,
        currency: "CZK",
        fuel: "diesel",
        transmission: "automat",
      },
      { source: "sauto" }
    );
    const q: SearchQuery = {
      make: "volkswagen",
      model: "multivan",
      features: ["prodlouzena"],
      fuel: [],
      body: [],
      keywords: [],
      excludeKeywords: [],
      sources: [],
    };
    expect(matchesSearch(plain, q)).toBe(false);
    const enriched = { ...plain, detailFeatures: ["prodlouzena"] };
    expect(matchesSearch(enriched, q)).toBe(true);
  });
});

describe("isFeatureOnlyMismatch", () => {
  const baseListing = normalizeListing(
    {
      sourceId: "7",
      url: "https://example.com/7",
      title: "Volkswagen Multivan 2.0 TDI Trendline",
      make: "Volkswagen",
      model: "Multivan",
      year: 2018,
      mileageKm: 90000,
      price: 700000,
      currency: "CZK",
      fuel: "diesel",
      transmission: "automat",
    },
    { source: "sauto" }
  );
  const query: SearchQuery = {
    make: "volkswagen",
    model: "multivan",
    yearFrom: 2016,
    priceTo: 1_000_000,
    features: ["prodlouzena"],
    fuel: [],
    body: [],
    keywords: [],
    excludeKeywords: [],
    sources: [],
  };

  it("is true when the listing would fully match if not for the feature chip", () => {
    expect(explainMatch(baseListing, query)).toBe("features");
    expect(isFeatureOnlyMismatch(baseListing, query)).toBe(true);
  });

  it("is false when the query has no feature chips at all", () => {
    expect(isFeatureOnlyMismatch(baseListing, { ...query, features: [] })).toBe(false);
  });

  it("is false when the listing already fully matches (nothing to enrich)", () => {
    const enriched = { ...baseListing, detailFeatures: ["prodlouzena"] };
    expect(matchesSearch(enriched, query)).toBe(true);
    expect(isFeatureOnlyMismatch(enriched, query)).toBe(false);
  });

  it("is false when the listing fails on something else too (year), not features alone", () => {
    const tooOld = { ...baseListing, year: 2010 };
    expect(explainMatch(tooOld, query)).toBe("year");
    expect(isFeatureOnlyMismatch(tooOld, query)).toBe(false);
  });

  it("is false for a listing that fails on make/model regardless of features", () => {
    const otherMake = { ...baseListing, make: "ford", model: "tourneo-custom" };
    expect(isFeatureOnlyMismatch(otherMake, query)).toBe(false);
  });
});

describe("explainMatch", () => {
  it("returns null for a full match", () => {
    const q: SearchQuery = {
      make: "skoda",
      model: "octavia",
      fuel: [],
      body: [],
      keywords: [],
      excludeKeywords: [],
      sources: [],
    };
    expect(explainMatch(listing, q)).toBeNull();
  });

  it("returns the first failing criterion, in a fixed check order (make before model before year...)", () => {
    const q: SearchQuery = {
      make: "bmw",
      model: "3-series",
      yearFrom: 2099,
      fuel: [],
      body: [],
      keywords: [],
      excludeKeywords: [],
      sources: [],
    };
    expect(explainMatch(listing, q)).toBe("make");
  });

  it("identifies a model mismatch distinctly from a make mismatch", () => {
    const q: SearchQuery = {
      make: "skoda",
      model: "fabia",
      fuel: [],
      body: [],
      keywords: [],
      excludeKeywords: [],
      sources: [],
    };
    expect(explainMatch(listing, q)).toBe("model");
  });

  it("identifies each of price/mileage/fuel/drive/features as distinct reasons", () => {
    expect(
      explainMatch(listing, {
        priceTo: 100,
        fuel: [],
        body: [],
        keywords: [],
        excludeKeywords: [],
        sources: [],
      })
    ).toBe("price");

    expect(
      explainMatch(listing, {
        mileageMax: 1,
        fuel: [],
        body: [],
        keywords: [],
        excludeKeywords: [],
        sources: [],
      })
    ).toBe("mileage");

    expect(
      explainMatch(listing, {
        fuel: ["petrol"],
        body: [],
        keywords: [],
        excludeKeywords: [],
        sources: [],
      })
    ).toBe("fuel");

    expect(
      explainMatch(listing, {
        fuel: [],
        body: [],
        features: ["prodlouzena"],
        keywords: [],
        excludeKeywords: [],
        sources: [],
      })
    ).toBe("features");
  });
});

// Regression coverage for the latent Mercedes-Benz class-naming bug: sources
// spell the same class differently ("Třída V", "Třídy V", "V-Klasse",
// "V-Class", bare "V"), and a saved search built from the catalog's
// canonical "v-class" option must match a listing however its source spelled
// it — see make-model.ts's Mercedes-Benz alias table.
describe("matchesSearch (Mercedes-Benz lettered-class naming)", () => {
  const vClassQuery: SearchQuery = {
    make: "mercedes-benz",
    model: "v-class",
    fuel: [],
    body: [],
    keywords: [],
    excludeKeywords: [],
    sources: [],
  };

  it("matches a listing titled 'Třídy V 250 d' (sauto's/tipcars' own genitive spelling)", () => {
    const listing = normalizeListing(
      {
        sourceId: "1",
        url: "https://example.com/1",
        title: "Mercedes-Benz Třídy V, V 250 d L 4matic",
        make: "Mercedes-Benz",
        model: "Třídy V",
        variant: "V 250 d L 4matic",
        year: 2021,
        mileageKm: 61000,
        price: 1069000,
        currency: "CZK",
        fuel: "diesel",
        transmission: "automat",
      },
      { source: "sauto" }
    );
    expect(listing.model).toBe("v-class");
    expect(matchesSearch(listing, vClassQuery)).toBe(true);
  });

  it("matches listings titled 'Třída V', 'V-Klasse' and a bare 'V' model field alike", () => {
    const spellings = ["Třída V", "V-Klasse", "V"];
    for (const model of spellings) {
      const listing = normalizeListing(
        {
          sourceId: `spelling-${model}`,
          url: "https://example.com/x",
          title: `Mercedes-Benz ${model} 250 d`,
          make: "Mercedes-Benz",
          model,
          year: 2020,
          mileageKm: 80000,
          price: 900000,
          currency: "CZK",
        },
        { source: "aaaauto" }
      );
      expect(listing.model, model).toBe("v-class");
      expect(matchesSearch(listing, vClassQuery), model).toBe(true);
    }
  });

  it("does not match a different Mercedes-Benz class", () => {
    const listing = normalizeListing(
      {
        sourceId: "2",
        url: "https://example.com/2",
        title: "Mercedes-Benz Třídy C 220 d",
        make: "Mercedes-Benz",
        model: "Třídy C",
        year: 2021,
        mileageKm: 40000,
        price: 800000,
        currency: "CZK",
      },
      { source: "sauto" }
    );
    expect(listing.model).toBe("c-class");
    expect(matchesSearch(listing, vClassQuery)).toBe(false);
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
