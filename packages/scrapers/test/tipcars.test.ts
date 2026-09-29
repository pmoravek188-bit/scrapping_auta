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

/** Builds a minimal but structurally-real listing page: one card per id,
 * each carrying a data-measure-data-value attribute (year/mileage/power)
 * and a detail link, exactly like the live site (no ld+json ItemList — the
 * site dropped that from search pages). */
function makePage(ids: string[]): string {
  const cards = ids
    .map(
      (id) => `
<div class="advertisement" data-listing-item-id-value="${id}"
     data-measure-data-value="[&quot;advertise&quot;,{&quot;id&quot;:&quot;${id}&quot;,&quot;made_year&quot;:&quot;2019&quot;,&quot;engine_power&quot;:90,&quot;odometer&quot;:100000},&quot;h&quot;]">
    <section class="advertisement-name">
        <section class="advertisement-name__title">
            <a href="/skoda-octavia/kombi/nafta/skoda-octavia-${id}.html"><h3>Škoda Octavia</h3></a>
        </section>
        <section class="advertisement-name__price"><h3>100 000 Kč</h3></section>
    </section>
</div>`
    )
    .join("\n");
  return `<!DOCTYPE html><html><head></head><body>${cards}</body></html>`;
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

  it("maps a canonical Mercedes-Benz class slug to tipcars's own 'tridy-<letter>' slug", () => {
    // Confirmed live: tipcars.com's own URL slug for every Mercedes-Benz
    // lettered class is "tridy-<letter>" (Czech genitive "Třídy X") —
    // `/ojete/mercedes-benz-tridy-v` narrows "Zobrazeno N inzerátů" from 302
    // (unfiltered make) to 216, never "trida-v"/"v-class"/"v-klasse".
    const url = buildTipCarsUrl({ ...baseQuery, make: "mercedes-benz", model: "v-class" }, 0);
    expect(url).toBe("https://www.tipcars.com/ojete/mercedes-benz-tridy-v?str=1-20");
  });

  it("leaves a non-class Mercedes-Benz model slug untouched", () => {
    const url = buildTipCarsUrl({ ...baseQuery, make: "mercedes-benz", model: "vito" }, 0);
    expect(url).toBe("https://www.tipcars.com/ojete/mercedes-benz-vito?str=1-20");
  });

  it("maps a canonical BMW numbered-series slug to tipcars's own 'rada-<n>' slug", () => {
    // Confirmed live: a BMW 3-series listing's own detail URL is under
    // "/bmw-rada-3/...", and `/ojete/bmw-rada-3` narrows the listing count
    // (unlike `/ojete/bmw-3-series`, which 404s — the bug that made the
    // production saved search return nothing).
    const url = buildTipCarsUrl({ ...baseQuery, make: "bmw", model: "3-series" }, 0);
    expect(url).toBe("https://www.tipcars.com/ojete/bmw-rada-3?str=1-20");
  });

  it("collapses a specific BMW engine-code model down to the whole-series 'rada-<n>' slug", () => {
    const url = buildTipCarsUrl({ ...baseQuery, make: "bmw", model: "3-series-320d" }, 0);
    expect(url).toBe("https://www.tipcars.com/ojete/bmw-rada-3?str=1-20");
  });

  it("parses listings straight from the rendered cards (no ld+json ItemList on the live site anymore), with detail-box-S values for year/mileage/power/fuel/transmission", () => {
    const items = parseTipCarsHtml(fixture);
    expect(items).toHaveLength(3);

    expect(items[0]).toMatchObject({
      sourceId: "6611462",
      make: "skoda",
      model: "octavia",
      body: "liftback",
      fuel: "petrol",
      transmission: "automatic",
      price: 240000,
      year: 2015,
      mileageKm: 108321,
      powerKw: 132,
    });
    expect(items[0].url).toBe(
      "https://www.tipcars.com/skoda-octavia/liftback/benzin/skoda-octavia-1-8tsi-cr-at-bixen-autoac-6611462.html"
    );
    expect(items[0].imageUrls).toEqual([
      "https://g.tipcars.com/nJx7prwYfvHcrlcEMQmsQDWuK9pQ_yhRO_z6PXqn5OI/rs:fit:800:600:0:0/sh:0.5/f:jpg/aHR0cHM6Ly9pbWcu.jpg",
    ]);

    expect(items[1]).toMatchObject({
      sourceId: "47710005",
      make: "skoda",
      model: "octavia",
      fuel: "diesel",
      transmission: "manual",
      year: 2005,
      mileageKm: 209648,
      powerKw: 77,
    });
  });

  it("falls back to inferring make/model from the title when the URL's leading segment is a mis-parsed category (e.g. 'uzitkove'), and to data-measure-data-value when there are no detail-box-S rows", () => {
    const items = parseTipCarsHtml(fixture);
    const small = items.find((i) => i.sourceId === "55290129");
    expect(small).toBeDefined();
    expect(small?.make).toBe("bmw");
    expect(small?.year).toBe(2008);
    expect(small?.mileageKm).toBe(290148);
    expect(small?.powerKw).toBe(225);
  });

  it("returns an empty array when there are no listing cards", () => {
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
