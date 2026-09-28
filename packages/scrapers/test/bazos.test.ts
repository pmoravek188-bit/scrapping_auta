import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildBazosUrl, parseBazosHtml } from "../src/sources/bazos.js";
import type { SearchQuery } from "@scrapping-auta/core";

const fixturePath = fileURLToPath(new URL("./fixtures/bazos-search.html", import.meta.url));
const html = readFileSync(fixturePath, "utf-8");

const baseQuery: SearchQuery = {
  fuel: [],
  body: [],
  keywords: [],
  excludeKeywords: [],
  sources: [],
};

describe("bazos adapter", () => {
  it("builds a search URL", () => {
    const url = buildBazosUrl({ ...baseQuery, make: "skoda", model: "octavia" }, 20);
    expect(url).toContain("hledat=skoda+octavia");
    expect(url).toContain("rubriky=auto");
    expect(url).toContain("crp=20");
  });

  it("parses listing cards from HTML", () => {
    const items = parseBazosHtml(html);
    expect(items).toHaveLength(2);
    expect(items[0].sourceId).toBe("12345");
    expect(items[0].title).toContain("Octavia");
    expect(items[0].price).toBe(189900);
    expect(items[0].mileageKm).toBe(95000);
    expect(items[0].year).toBe(2017);
    expect(items[0].location).toBe("Praha");
  });
});
