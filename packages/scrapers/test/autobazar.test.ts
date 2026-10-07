import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildAutobazarUrl,
  looksLikeAutobazarListingPage,
  parseAutobazarHtml,
} from "../src/sources/autobazar.js";
import type { SearchQuery } from "@scrapping-auta/core";

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf-8");
}

// Captured live 2026-10-07 from
// `https://www.autobazar.eu/cs/vysledky/osobne-vozidla/?location=200000000&brandSef=volkswagen&modelSef=multivan`
// (8 matching cars that day), trimmed to the embedded __NEXT_DATA__'s
// `props.pageProps.searchRecords` (2 of the 8 `data` entries kept, every
// other top-level __NEXT_DATA__ key dropped — the parser only ever reads
// this one path).
const multivanFixture = fixture("autobazar-multivan.html");
// Captured live from the same endpoint with `brandSef=ford&modelSef=tourneo-custom`
// (34 matching cars that day).
const tourneoFixture = fixture("autobazar-tourneo-custom.html");
// Captured live with `brandSef=bmw&modelSef=rad-3&yearFrom=2022&priceTo=1000000&mileageTo=100000`
// (27 matching cars that day).
const bmwFixture = fixture("autobazar-bmw-3series.html");
// Captured live DURING this adapter's own research: a burst of requests
// got this F5-style WAF interstitial swapped in instead of a real page —
// HTTP 200, no `__NEXT_DATA__` at all (see autobazar.ts's file header).
const blockedFixture = fixture("autobazar-blocked-live.html");

const baseQuery: SearchQuery = {
  fuel: [],
  body: [],
  keywords: [],
  excludeKeywords: [],
  sources: [],
};

const EUR_CZK_RATE = 25;

describe("autobazar adapter", () => {
  it("builds the search URL with the fixed Czech-Republic location and category", () => {
    const url = buildAutobazarUrl(baseQuery, 0, EUR_CZK_RATE);
    expect(url).toContain("/cs/vysledky/osobne-vozidla/?");
    expect(url).toContain("location=200000000");
    expect(url).toContain("category=30900");
  });

  it("uses brandSef/modelSef (NOT a plain brand=/model=) for make/model filtering", () => {
    const url = buildAutobazarUrl({ ...baseQuery, make: "volkswagen", model: "multivan" }, 0, EUR_CZK_RATE);
    expect(url).toContain("brandSef=volkswagen");
    expect(url).toContain("modelSef=multivan");
  });

  it("maps a canonical BMW numbered-series slug to this site's own Slovak 'rad-<n>' modelSef", () => {
    // Confirmed live: autobazar.eu's own sefName for a BMW 3-series car is
    // "rad-3" ("Rad 3" — Slovak), not sauto's Czech "rada-3".
    const url = buildAutobazarUrl({ ...baseQuery, make: "bmw", model: "3-series" }, 0, EUR_CZK_RATE);
    expect(url).toContain("brandSef=bmw");
    expect(url).toContain("modelSef=rad-3");
  });

  it("collapses a specific BMW engine-code model down to the bare series modelSef", () => {
    const url = buildAutobazarUrl({ ...baseQuery, make: "bmw", model: "3-series-320d" }, 0, EUR_CZK_RATE);
    expect(url).toContain("modelSef=rad-3");
  });

  it("maps a canonical VW 'ID.' model slug to this site's own hyphen-less modelSef", () => {
    const url = buildAutobazarUrl({ ...baseQuery, make: "volkswagen", model: "id-4" }, 0, EUR_CZK_RATE);
    expect(url).toContain("modelSef=id4");
  });

  it("leaves a plain model slug (e.g. Multivan, no generation) untouched", () => {
    const url = buildAutobazarUrl({ ...baseQuery, make: "volkswagen", model: "multivan" }, 0, EUR_CZK_RATE);
    expect(url).toContain("modelSef=multivan");
  });

  it("converts CZK price filters to EUR, rounding the range outward", () => {
    const url = buildAutobazarUrl({ ...baseQuery, priceFrom: 251, priceTo: 999 }, 0, EUR_CZK_RATE);
    // 251/25 = 10.04 -> floor 10; 999/25 = 39.96 -> ceil 40.
    expect(url).toContain("priceFrom=10");
    expect(url).toContain("priceTo=40");
  });

  it("passes yearFrom/yearTo/mileageTo through as plain CZK-independent numbers", () => {
    const url = buildAutobazarUrl({ ...baseQuery, yearFrom: 2022, yearTo: 2024, mileageMax: 100_000 }, 0, EUR_CZK_RATE);
    expect(url).toContain("yearFrom=2022");
    expect(url).toContain("yearTo=2024");
    expect(url).toContain("mileageTo=100000");
  });

  it("omits the page param entirely for the first page, and 1-indexes it from the second page on", () => {
    // Confirmed live: an explicit `page=1` 404s on this site for every
    // query — page 1 must be requested with no `page` param at all.
    const firstPageUrl = buildAutobazarUrl(baseQuery, 0, EUR_CZK_RATE);
    expect(firstPageUrl).not.toContain("page=");
    expect(buildAutobazarUrl(baseQuery, 1, EUR_CZK_RATE)).toContain("page=2");
    expect(buildAutobazarUrl(baseQuery, 2, EUR_CZK_RATE)).toContain("page=3");
  });

  it("parses listings from the embedded __NEXT_DATA__ (VW Multivan)", () => {
    const items = parseAutobazarHtml(multivanFixture);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      sourceId: "Abje9ij6w4f",
      make: "Volkswagen",
      model: "Multivan",
      year: 2003,
      mileageKm: 208000,
      currency: "EUR",
      fuel: "Diesel",
      country: "CZ",
    });
    expect(items[0].url).toBe(
      "https://www.autobazar.eu/cs/detail/volkswagen-multivan-2-5-tdi-7-mist-auto-klima/Abje9ij6w4f/"
    );
    expect(items[0].price).toBeCloseTo(8156.07);
    expect(items[0].imageUrls[0]).toContain("https://s.autobazar.eu/");
  });

  it("parses listings with driveValue and vin (Ford Tourneo Custom)", () => {
    const items = parseAutobazarHtml(tourneoFixture);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      make: "Ford",
      model: "Tourneo Custom",
      drive: "Predný",
      body: "Minibus",
      transmission: "5-st. manuálna",
    });
    // No vin on the first Tourneo entry.
    expect(items[0].vin).toBeNull();
    // Second entry has a real-looking 17ish-char VIN.
    expect(items[1].vin).toBe("WF03XXTTG3GY67868");
  });

  it("treats an implausibly short placeholder vin (e.g. the literal \"0\") as absent", () => {
    const items = parseAutobazarHtml(bmwFixture);
    expect(items).toHaveLength(2);
    expect(items[0].vin).toBeNull();
    expect(items[0]).toMatchObject({ make: "BMW", model: "Rad 3", drive: "Zadný" });
  });

  it("returns an empty array when there's no searchRecords at all", () => {
    expect(parseAutobazarHtml("<html><body>no data</body></html>")).toEqual([]);
  });
});

describe("looksLikeAutobazarListingPage", () => {
  it("recognizes a real page with matching listings", () => {
    expect(looksLikeAutobazarListingPage(multivanFixture)).toBe(true);
  });

  it("does NOT recognize the live-captured F5 WAF interstitial (no __NEXT_DATA__ at all)", () => {
    expect(looksLikeAutobazarListingPage(blockedFixture)).toBe(false);
    expect(parseAutobazarHtml(blockedFixture)).toEqual([]);
  });

  it("does NOT recognize a page with no __NEXT_DATA__ script", () => {
    expect(looksLikeAutobazarListingPage("<html><body>nope</body></html>")).toBe(false);
  });

  it("recognizes a genuinely-empty-but-real result (searchRecords present, data: [])", () => {
    const html =
      '<!DOCTYPE html><html><head><script id="__NEXT_DATA__" type="application/json">' +
      JSON.stringify({ props: { pageProps: { searchRecords: { data: [], total: 0 } } } }) +
      "</script></head><body></body></html>";
    expect(looksLikeAutobazarListingPage(html)).toBe(true);
    expect(parseAutobazarHtml(html)).toEqual([]);
  });
});
