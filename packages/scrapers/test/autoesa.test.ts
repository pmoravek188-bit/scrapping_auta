import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildAutoEsaUrl, parseAutoEsaHtml } from "../src/sources/autoesa.js";
import type { SearchQuery } from "@scrapping-auta/core";

const fixturePath = fileURLToPath(new URL("./fixtures/autoesa-search.html", import.meta.url));
const html = readFileSync(fixturePath, "utf-8");

const baseQuery: SearchQuery = {
  fuel: [],
  body: [],
  keywords: [],
  excludeKeywords: [],
  sources: [],
};

describe("autoesa adapter", () => {
  it("builds a make-scoped URL", () => {
    const url = buildAutoEsaUrl({ ...baseQuery, make: "skoda" }, 1);
    expect(url).toContain("/skoda");
    expect(url).toContain("stranka=2");
  });

  it("falls back to /vsechna-auta with no make", () => {
    const url = buildAutoEsaUrl({ ...baseQuery }, 0);
    expect(url).toContain("/vsechna-auta");
  });

  it("parses listing cards, using the 'Akční cena' price block", () => {
    const items = parseAutoEsaHtml(html);
    expect(items).toHaveLength(2);

    expect(items[0].sourceId).toBe("699459281");
    expect(items[0].title).toContain("Audi A6 Allroad");
    expect(items[0].year).toBe(2016);
    expect(items[0].price).toBe(390000);
    expect(items[0].mileageKm).toBe(161431);
    expect(items[0].powerKw).toBe(200);
    expect(items[0].fuel).toBe("diesel");
    expect(items[0].imageUrls).toEqual(["https://www.autoesa.cz/files/cars/699459281/1.jpg"]);

    expect(items[1].sourceId).toBe("126460941");
    expect(items[1].price).toBe(259900);
    expect(items[1].fuel).toBe("petrol");
    expect(items[1].year).toBe(2011);
  });
});
