import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildHavexUrl, parseHavexHtml } from "../src/sources/havex.js";
import type { SearchQuery } from "@scrapping-auta/core";

const fixturePath = fileURLToPath(new URL("./fixtures/havex-search.html", import.meta.url));
const html = readFileSync(fixturePath, "utf-8");

const baseQuery: SearchQuery = {
  fuel: [],
  body: [],
  keywords: [],
  excludeKeywords: [],
  sources: [],
};

describe("havex adapter", () => {
  it("builds a brand-scoped URL for a known brand", () => {
    const url = buildHavexUrl({ ...baseQuery, make: "skoda" }, 1);
    expect(url).toContain("/cz/ojete-vozy-skoda");
    expect(url).toContain("page=2");
  });

  it("falls back to the all-brands listing for an unsupported brand", () => {
    const url = buildHavexUrl({ ...baseQuery, make: "bmw" }, 0);
    expect(url).toContain("/cz/ojete-vozy");
    expect(url).not.toContain("ojete-vozy-bmw");
  });

  it("parses listing cards from HTML", () => {
    const items = parseHavexHtml(html);
    expect(items).toHaveLength(2);

    expect(items[0].sourceId).toBe("528453");
    expect(items[0].title).toContain("Škoda Fabia");
    expect(items[0].price).toBe(148000);
    expect(items[0].year).toBe(2006);
    expect(items[0].mileageKm).toBe(278610);
    expect(items[0].fuel).toBe("diesel");
    expect(items[0].transmission).toBe("manual");

    expect(items[1].sourceId).toBe("528371");
    expect(items[1].fuel).toBe("petrol");
    expect(items[1].transmission).toBe("automatic");
    expect(items[1].mileageKm).toBe(212780);
  });
});
