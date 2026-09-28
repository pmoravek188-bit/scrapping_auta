import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildSautoUrl, parseSautoResponse } from "../src/sources/sauto.js";
import type { SearchQuery } from "@scrapping-auta/core";

const fixturePath = fileURLToPath(new URL("./fixtures/sauto-search.json", import.meta.url));
const fixture = JSON.parse(readFileSync(fixturePath, "utf-8"));

const baseQuery: SearchQuery = {
  fuel: [],
  body: [],
  keywords: [],
  excludeKeywords: [],
  sources: [],
};

describe("sauto adapter", () => {
  it("builds a search URL with the given filters", () => {
    const url = buildSautoUrl({ ...baseQuery, make: "skoda", priceTo: 300000 }, 0);
    expect(url).toContain("manufacturer_cb_id=skoda");
    expect(url).toContain("price_to=300000");
    expect(url).toContain("offset=0");
  });

  it("parses listings from the API response, skipping broken items", () => {
    const items = parseSautoResponse(fixture);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      sourceId: "111222333",
      make: "Škoda",
      model: "Octavia",
      mileageKm: 87000,
      price: 359900,
      year: 2019,
    });
    expect(items[0].url).toBe("https://www.sauto.cz/detail/skoda-octavia-111222333");
    expect(items[1].url).toBe("https://www.sauto.cz/detail/bmw-3-444555666");
    expect(items[1].sellerType).toBe("private");
  });

  it("returns an empty array for an unexpected response shape", () => {
    expect(parseSautoResponse({ unexpected: true })).toEqual([]);
    expect(parseSautoResponse(null)).toEqual([]);
  });
});
