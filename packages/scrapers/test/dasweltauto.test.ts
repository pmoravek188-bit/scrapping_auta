import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildDasWeltAutoUrl, parseDasWeltAutoResponse } from "../src/sources/dasweltauto.js";
import type { SearchQuery } from "@scrapping-auta/core";

const fixturePath = fileURLToPath(new URL("./fixtures/dasweltauto-search.json", import.meta.url));
const data = JSON.parse(readFileSync(fixturePath, "utf-8"));

const baseQuery: SearchQuery = {
  fuel: [],
  body: [],
  keywords: [],
  excludeKeywords: [],
  sources: [],
};

describe("dasweltauto adapter", () => {
  it("builds the vehicles search API URL, mapping volkswagen -> vw", () => {
    const url = buildDasWeltAutoUrl({ ...baseQuery, make: "volkswagen" }, 0);
    expect(url).toContain("/api/locales/cs_CZ/vehicles/search/");
    expect(url).toContain("brands=vw");
    expect(url).toContain("page=1");
  });

  it("keeps skoda as-is (matches the API's own brand slug)", () => {
    const url = buildDasWeltAutoUrl({ ...baseQuery, make: "skoda" }, 0);
    expect(url).toContain("brands=skoda");
  });

  it("parses vehicles from the search API response", () => {
    const items = parseDasWeltAutoResponse(data);
    expect(items).toHaveLength(2);

    expect(items[0].sourceId).toBe("5105700191");
    expect(items[0].url).toBe("https://www.dasweltauto.cz/vehicle/5105700191");
    expect(items[0].price).toBe(348000);
    expect(items[0].mileageKm).toBe(120740);
    expect(items[0].year).toBe(2022);
    expect(items[0].fuel).toBe("petrol");
    expect(items[0].transmission).toBe("manual");
    expect(items[0].vin).toBe("TMBER6NW7P3055713");

    expect(items[1].sourceId).toBe("5105700195");
    expect(items[1].fuel).toBe("diesel");
    expect(items[1].transmission).toBe("automatic");
  });
});
