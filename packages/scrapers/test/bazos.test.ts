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
  it("builds a make-rubric URL with a model keyword when the make is known", () => {
    const url = buildBazosUrl({ ...baseQuery, make: "skoda", model: "octavia" }, 20);
    expect(url).toContain("/skoda/?");
    expect(url).toContain("hledat=octavia");
    expect(url).toContain("crp=20");
  });

  it("falls back to a root keyword search when the make has no rubric", () => {
    const url = buildBazosUrl({ ...baseQuery, make: "tesla" }, 0);
    expect(url).toContain("rubriky=auto");
    expect(url).toContain("hledat=tesla");
  });

  it("falls back to the root auto category with no make/model at all", () => {
    const url = buildBazosUrl({ ...baseQuery }, 0);
    expect(url).toContain("rubriky=auto");
    expect(url).not.toContain("hledat=");
  });

  it("parses listing cards from HTML, extracting year/mileage from free text", () => {
    const items = parseBazosHtml(html);
    expect(items).toHaveLength(2);

    expect(items[0].sourceId).toBe("224366040");
    expect(items[0].title).toContain("Octavia");
    expect(items[0].price).toBe(724990);
    expect(items[0].year).toBe(2019);
    expect(items[0].mileageKm).toBe(21000);
    expect(items[0].location).toBe("Olomouc");
    expect(items[0].fuel).toBe("petrol");
    expect(items[0].transmission).toBe("automatic");

    expect(items[1].sourceId).toBe("224359337");
    expect(items[1].price).toBe(189900);
    expect(items[1].year).toBe(2017);
    expect(items[1].mileageKm).toBe(95000);
    expect(items[1].fuel).toBe("diesel");
  });

  it("drops obvious non-car junk ads (cheap, no year/mileage)", () => {
    const items = parseBazosHtml(html);
    expect(items.some((i) => i.title.includes("LED"))).toBe(false);
  });
});
