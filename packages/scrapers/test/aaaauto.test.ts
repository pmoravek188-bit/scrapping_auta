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
