import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { buildTipCarsUrl, parseTipCarsHtml } from "../src/sources/tipcars.js";
import type { SearchQuery } from "@scrapping-auta/core";

const fixturePath = fileURLToPath(new URL("./fixtures/tipcars-search.html", import.meta.url));
const fixture = readFileSync(fixturePath, "utf-8");

const baseQuery: SearchQuery = {
  fuel: [],
  body: [],
  keywords: [],
  excludeKeywords: [],
  sources: [],
};

/** Builds a minimal but structurally-real listing page: an ld+json ItemList
 * (id/url/name/price) plus a data-measure-data-value card per item
 * (year/mileage/power), exactly like the live site. */
function makePage(ids: string[]): string {
  const items = ids.map((id, i) => ({
    "@type": "ListItem",
    position: i + 1,
    item: {
      "@type": "Product",
      url: `https://www.tipcars.com/skoda-octavia/kombi/nafta/skoda-octavia-${id}.html`,
      name: `Škoda Octavia ${id}`,
      image: "https://g.tipcars.com/img.jpg",
      offers: { "@type": "Offer", price: 100000, priceCurrency: "CZK" },
    },
  }));
  const cards = ids
    .map(
      (id) =>
        `<div data-measure-data-value="[&quot;advertise&quot;,{&quot;id&quot;:&quot;${id}&quot;,&quot;made_year&quot;:&quot;2019&quot;,&quot;engine_power&quot;:90,&quot;odometer&quot;:100000},&quot;h&quot;]"></div>`
    )
    .join("\n");
  return `<!DOCTYPE html><html><head><script type="application/ld+json">${JSON.stringify({
    "@type": "ItemList",
    itemListElement: items,
  })}</script></head><body>${cards}</body></html>`;
}

describe("tipcars adapter", () => {
  it("builds the used-cars listing URL with pagination", () => {
    const url = buildTipCarsUrl(baseQuery, 0);
    expect(url).toBe("https://www.tipcars.com/ojete?str=1-20");
  });

  it("builds a make/model-filtered path for page 2", () => {
    const url = buildTipCarsUrl({ ...baseQuery, make: "Skoda", model: "Octavia" }, 1);
    expect(url).toBe("https://www.tipcars.com/ojete/skoda-octavia?str=2-20");
  });

  it("splits a multi-word make out of the model slug", () => {
    const url = buildTipCarsUrl({ ...baseQuery, make: "Land Rover", model: "Discovery" }, 0);
    expect(url).toBe("https://www.tipcars.com/ojete/land-rover-discovery?str=1-20");
  });

  it("parses listings from the embedded ItemList JSON-LD, with year/mileage/power joined from data-measure-data-value", () => {
    const items = parseTipCarsHtml(fixture);
    expect(items).toHaveLength(3);

    expect(items[0]).toMatchObject({
      sourceId: "6611462",
      make: "skoda",
      model: "octavia",
      body: "liftback",
      fuel: "benzin",
      price: 240000,
      year: 2015,
      mileageKm: 108321,
      powerKw: 132,
    });
    expect(items[0].url).toBe(
      "https://www.tipcars.com/skoda-octavia/liftback/benzin/skoda-octavia-1-8tsi-cr-at-bixen-autoac-6611462.html"
    );

    // multi-word model slug handled without splitting off part of the make
    expect(items[2]).toMatchObject({
      sourceId: "55290129",
      make: "bmw",
      model: "rada-3",
      year: 2008,
      mileageKm: 290148,
      powerKw: 225,
    });
  });

  it("returns an empty array when there's no ItemList JSON-LD", () => {
    expect(parseTipCarsHtml("<html><body>no data</body></html>")).toEqual([]);
  });
});

describe("tipcars adapter pagination", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock("../src/http.js");
  });

  it("keeps paging past a short page (fewer items than the nominal page size)", async () => {
    const pages = [makePage(["1", "2"]), makePage(["3", "4"]), makePage([])];
    let call = 0;
    vi.doMock("../src/http.js", async () => {
      const actual = await vi.importActual<typeof import("../src/http.js")>("../src/http.js");
      return {
        ...actual,
        fetchText: vi.fn(async () => pages[call++] ?? ""),
      };
    });

    const { tipcarsAdapter } = await import("../src/sources/tipcars.js");
    const results = await tipcarsAdapter.search(baseQuery, { eurCzkRate: 24, maxPages: 5 });
    expect(results.map((r) => r.sourceId)).toEqual(["1", "2", "3", "4"]);
  });

  it("stops when a page repeats only already-seen ids instead of continuing forever", async () => {
    const pages = [makePage(["1", "2"]), makePage(["1", "2"]), makePage(["5", "6"])];
    let call = 0;
    vi.doMock("../src/http.js", async () => {
      const actual = await vi.importActual<typeof import("../src/http.js")>("../src/http.js");
      return {
        ...actual,
        fetchText: vi.fn(async () => pages[call++] ?? ""),
      };
    });

    const { tipcarsAdapter } = await import("../src/sources/tipcars.js");
    const results = await tipcarsAdapter.search(baseQuery, { eurCzkRate: 24, maxPages: 5 });
    // stopped after the repeat page — page 3's "5"/"6" must never be fetched
    expect(results.map((r) => r.sourceId)).toEqual(["1", "2"]);
    expect(call).toBe(2);
  });
});
