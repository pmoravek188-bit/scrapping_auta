import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildCarvagoRequestBody, parseCarvagoResponse } from "../src/sources/carvago.js";
import type { SearchQuery } from "@scrapping-auta/core";

const fixturePath = fileURLToPath(new URL("./fixtures/carvago-search.json", import.meta.url));
const fixture = JSON.parse(readFileSync(fixturePath, "utf-8"));

const baseQuery: SearchQuery = {
  fuel: [],
  body: [],
  keywords: [],
  excludeKeywords: [],
  sources: [],
};

describe("carvago adapter", () => {
  it("builds a request body with the given filters", () => {
    const body = buildCarvagoRequestBody({ ...baseQuery, make: "skoda", priceTo: 500000 }, 1);
    expect(body.filter).toMatchObject({ make: ["skoda"], price: { to: 500000 } });
    expect(body.page).toBe(1);
  });

  it("parses listings, skipping broken items", () => {
    const items = parseCarvagoResponse(fixture);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      sourceId: "9001",
      make: "Škoda",
      model: "Octavia",
      price: 15900,
      currency: "EUR",
      year: 2020,
      vin: "TMBJJ7NE1L0123456",
    });
    expect(items[0].url).toBe("https://www.carvago.com/cz/car/skoda-octavia-2020-9001");
  });
});
