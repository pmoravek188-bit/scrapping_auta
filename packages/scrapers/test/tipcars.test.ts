import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildTipCarsUrl, parseTipCarsHtml } from "../src/sources/tipcars.js";
import type { SearchQuery } from "@scrapping-auta/core";

const fixturePath = fileURLToPath(new URL("./fixtures/tipcars-search.html", import.meta.url));
const html = readFileSync(fixturePath, "utf-8");

const baseQuery: SearchQuery = {
  fuel: [],
  body: [],
  keywords: [],
  excludeKeywords: [],
  sources: [],
};

describe("tipcars adapter", () => {
  it("builds a search URL", () => {
    const url = buildTipCarsUrl({ ...baseQuery, make: "skoda", yearFrom: 2015 }, 0);
    expect(url).toContain("znacka=skoda");
    expect(url).toContain("rok-od=2015");
    expect(url).toContain("strana=1");
  });

  it("parses listing cards from HTML", () => {
    const items = parseTipCarsHtml(html);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      sourceId: "123456",
      title: "Škoda Fabia 1.2 TSI",
      price: 159900,
      year: 2018,
      mileageKm: 62000,
    });
  });
});
