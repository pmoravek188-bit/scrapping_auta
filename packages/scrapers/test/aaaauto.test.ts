import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildAaaAutoUrl, parseAaaAutoHtml } from "../src/sources/aaaauto.js";
import type { SearchQuery } from "@scrapping-auta/core";

const fixturePath = fileURLToPath(new URL("./fixtures/aaaauto-search.html", import.meta.url));
const fixture = readFileSync(fixturePath, "utf-8");

const baseQuery: SearchQuery = {
  fuel: [],
  body: [],
  keywords: [],
  excludeKeywords: [],
  sources: [],
};

describe("aaaauto adapter", () => {
  it("builds the listing URL with make/model path and filters", () => {
    const url = buildAaaAutoUrl(
      { ...baseQuery, make: "Skoda", model: "Octavia", priceTo: 300000, yearFrom: 2018 },
      0
    );
    expect(url).toContain("/ojete-vozy/skoda/octavia?");
    expect(url).toContain("page=1");
    expect(url).toContain("priceTo=300000");
    expect(url).toContain("yearFrom=2018");
  });

  it("maps a canonical Mercedes-Benz class slug to aaaauto's own bare-letter model path", () => {
    // Confirmed live: aaaauto.cz's own model path segment for every
    // Mercedes-Benz lettered class is just the bare letter (e.g.
    // /ojete-vozy/mercedes-benz/v, totalItems 14 vs 340 unfiltered) —
    // matching its own ld+json `model` field, which is literally "V" for a
    // V-Class listing, not "V-Class".
    const url = buildAaaAutoUrl({ ...baseQuery, make: "mercedes-benz", model: "v-class" }, 0);
    expect(url).toContain("/ojete-vozy/mercedes-benz/v?");
  });

  it("leaves a non-class Mercedes-Benz model slug untouched", () => {
    const url = buildAaaAutoUrl({ ...baseQuery, make: "mercedes-benz", model: "vito" }, 0);
    expect(url).toContain("/ojete-vozy/mercedes-benz/vito?");
  });

  it("maps a canonical BMW numbered-series slug to aaaauto's own bare-digit model path", () => {
    // Confirmed live: aaaauto.cz's own model path segment for a BMW
    // 3-series car is the bare digit "3" (/ojete-vozy/bmw/3), matching its
    // own ld+json `model` field, which is literally "3".
    const url = buildAaaAutoUrl({ ...baseQuery, make: "bmw", model: "3-series" }, 0);
    expect(url).toContain("/ojete-vozy/bmw/3?");
  });

  it("collapses a specific BMW engine-code model down to the bare series digit", () => {
    const url = buildAaaAutoUrl({ ...baseQuery, make: "bmw", model: "3-series-320d" }, 0);
    expect(url).toContain("/ojete-vozy/bmw/3?");
  });

  it("leaves a non-numbered BMW model slug (X/M/Z/i line) untouched", () => {
    const url = buildAaaAutoUrl({ ...baseQuery, make: "bmw", model: "x5" }, 0);
    expect(url).toContain("/ojete-vozy/bmw/x5?");
  });

  it("maps a canonical VW 'ID.' model slug to aaaauto's own hyphen-less model path", () => {
    // Confirmed live: aaaauto.cz's own model path segment for VW's electric
    // "ID." range is hyphen-less ("id4") — the hyphenated canonical form
    // 302-redirects to the unfiltered /ojete-vozy listing instead of
    // filtering (soft-404).
    expect(buildAaaAutoUrl({ ...baseQuery, make: "volkswagen", model: "id-4" }, 0)).toContain(
      "/ojete-vozy/volkswagen/id4?"
    );
    expect(buildAaaAutoUrl({ ...baseQuery, make: "volkswagen", model: "id-3" }, 0)).toContain(
      "/ojete-vozy/volkswagen/id3?"
    );
  });

  it("leaves a non-ID VW model slug (including id-buzz) untouched", () => {
    expect(buildAaaAutoUrl({ ...baseQuery, make: "volkswagen", model: "golf" }, 0)).toContain(
      "/ojete-vozy/volkswagen/golf?"
    );
    expect(buildAaaAutoUrl({ ...baseQuery, make: "volkswagen", model: "id-buzz" }, 0)).toContain(
      "/ojete-vozy/volkswagen/id-buzz?"
    );
  });

  it("maps our canonical Audi 'q8-e-tron' to aaaauto's own unsplit 'e-tron' model path", () => {
    // Confirmed live: aaaauto.cz has not split "Q8 e-tron" out of "e-tron" in
    // its own catalog — /ojete-vozy/audi/q8-e-tron 302-redirects to the
    // unfiltered listing (its own ld+json `model` field for every e-tron/Q8
    // e-tron car is literally just "e-tron").
    expect(buildAaaAutoUrl({ ...baseQuery, make: "audi", model: "q8-e-tron" }, 0)).toContain(
      "/ojete-vozy/audi/e-tron?"
    );
  });

  it("leaves a plain Audi 'e-tron' model slug untouched", () => {
    expect(buildAaaAutoUrl({ ...baseQuery, make: "audi", model: "e-tron" }, 0)).toContain(
      "/ojete-vozy/audi/e-tron?"
    );
  });

  it("only applies the confirmed body filter values", () => {
    const suvUrl = buildAaaAutoUrl({ ...baseQuery, body: ["suv"] }, 0);
    expect(suvUrl).toContain("bodyTypeId-array=SUV");

    const combiUrl = buildAaaAutoUrl({ ...baseQuery, body: ["combi"] }, 0);
    expect(combiUrl).not.toContain("bodyTypeId-array");
  });

  it("parses listings from the embedded ld+json ItemList", () => {
    const items = parseAaaAutoHtml(fixture);
    expect(items).toHaveLength(3);

    expect(items[0]).toMatchObject({
      sourceId: "23655594",
      make: "Škoda",
      model: "Octavia",
      year: 2017,
      mileageKm: 237394,
      fuel: "Diesel",
      transmission: "Automatic",
      sellerType: "dealer",
    });
    expect(items[0].url).toBe("https://www.aaaauto.cz/detail/skoda/octavia/23655594");
    expect(items[0].vin).toBeNull();

    expect(items[1]).toMatchObject({ sourceId: "21844078", transmission: "Manual", body: "Kombi" });
  });

  it("returns an empty array when there's no ld+json ItemList", () => {
    expect(parseAaaAutoHtml("<html><body>no data</body></html>")).toEqual([]);
  });
});
