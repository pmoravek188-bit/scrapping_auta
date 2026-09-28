import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildCarvagoUrl, parseCarvagoHtml } from "../src/sources/carvago.js";
import type { SearchQuery } from "@scrapping-auta/core";

const fixturePath = fileURLToPath(new URL("./fixtures/carvago-search.html", import.meta.url));
const fixture = readFileSync(fixturePath, "utf-8");

const baseQuery: SearchQuery = {
  fuel: [],
  body: [],
  keywords: [],
  excludeKeywords: [],
  sources: [],
};

describe("carvago adapter", () => {
  it("builds the base listing URL with pagination", () => {
    const url = buildCarvagoUrl(baseQuery, 0);
    expect(url).toContain("https://carvago.com/cs/auta?");
    expect(url).toContain("page=1");
    expect(url).toContain("limit=20");
  });

  it("builds a make/model path with filters", () => {
    const url = buildCarvagoUrl(
      {
        ...baseQuery,
        make: "Skoda",
        model: "Octavia",
        priceTo: 300000,
        fuel: ["diesel"],
        transmission: "automatic",
      },
      1
    );
    expect(url).toContain("/cs/auta/skoda/octavia?");
    expect(url).toContain("page=2");
    expect(url).toContain("price-to=300000");
    expect(url).toContain("fuel-type%5B%5D=FUELTYPE_DIESEL");
    expect(url).toContain("transmission%5B%5D=TRANSMISSION_AUTOMATIC");
  });

  it("omits fuel filter with no known carvago mapping", () => {
    const url = buildCarvagoUrl({ ...baseQuery, fuel: ["plugin_hybrid"] }, 0);
    expect(url).not.toContain("fuel-type");
  });

  it("parses listings from the embedded __NEXT_DATA__ JSON", () => {
    const items = parseCarvagoHtml(fixture);
    expect(items).toHaveLength(3);

    expect(items[0]).toMatchObject({
      sourceId: "87429591",
      make: "Dacia",
      model: "Jogger",
      mileageKm: 20,
      price: 623990,
      currency: "CZK",
      year: 2025,
      fuel: "hybrid",
      transmission: "automatic",
      body: "mpv",
      sellerType: "dealer",
    });
    expect(items[0].url).toBe(
      "https://carvago.com/cs/auto/87429591/dacia-jogger-hybrid-140-extreme-103-kw"
    );

    expect(items[2]).toMatchObject({
      sourceId: "87429343",
      fuel: "diesel",
      body: "suv",
      powerKw: 110,
    });
  });

  it("returns an empty array when __NEXT_DATA__ is missing or malformed", () => {
    expect(parseCarvagoHtml("<html><body>no data</body></html>")).toEqual([]);
    expect(
      parseCarvagoHtml('<script id="__NEXT_DATA__">not json</script>')
    ).toEqual([]);
  });
});
