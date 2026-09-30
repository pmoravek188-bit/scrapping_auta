import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildSautoUrl, parseSautoDetailText, parseSautoResponse } from "../src/sources/sauto.js";
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
    const url = buildSautoUrl(
      {
        ...baseQuery,
        make: "Skoda",
        model: "Octavia",
        priceTo: 300000,
        fuel: ["diesel"],
        transmission: "automatic",
      },
      0
    );
    expect(url).toContain("category_id=838");
    expect(url).toContain("manufacturer_model_seo=skoda%3Aoctavia");
    expect(url).toContain("price_to=300000");
    expect(url).toContain("fuel_seo=nafta");
    expect(url).toContain("gearbox_seo=automaticka");
    expect(url).toContain("offset=0");
  });

  it("omits filters with no known sauto mapping", () => {
    const url = buildSautoUrl({ ...baseQuery, fuel: ["plugin_hybrid"] }, 0);
    expect(url).not.toContain("fuel_seo");
  });

  it("maps a canonical Mercedes-Benz class slug to sauto's own 'tridy-<letter>' seo slug", () => {
    // Confirmed live: sauto's model_cb.seo_name for every Mercedes-Benz
    // lettered class is "tridy-<letter>" (Czech genitive "Třídy X"), never
    // "v-class"/"trida-v"/"v-klasse" — see make-model.ts's normalizeModel,
    // which is what produces "v-class" from any of those spellings.
    const url = buildSautoUrl({ ...baseQuery, make: "mercedes-benz", model: "v-class" }, 0);
    expect(url).toContain("manufacturer_model_seo=mercedes-benz%3Atridy-v");
  });

  it("leaves a non-class Mercedes-Benz model slug untouched", () => {
    const url = buildSautoUrl({ ...baseQuery, make: "mercedes-benz", model: "vito" }, 0);
    expect(url).toContain("manufacturer_model_seo=mercedes-benz%3Avito");
  });

  it("maps a canonical BMW numbered-series slug to sauto's own 'rada-<n>' seo slug", () => {
    // Confirmed live: sauto's model_cb.seo_name for every BMW 3-series car
    // is "rada-3" (Czech "Řada 3"), never "3-series" — sending the literal
    // canonical slug is exactly the bug that made the saved BMW 3-series
    // search return 0 matches.
    const url = buildSautoUrl({ ...baseQuery, make: "bmw", model: "3-series" }, 0);
    expect(url).toContain("manufacturer_model_seo=bmw%3Arada-3");
  });

  it("collapses a specific BMW engine-code model down to the whole-series 'rada-<n>' slug", () => {
    const url = buildSautoUrl({ ...baseQuery, make: "bmw", model: "3-series-320d" }, 0);
    expect(url).toContain("manufacturer_model_seo=bmw%3Arada-3");
  });

  it("leaves a non-numbered BMW model slug (X/M/Z/i line) untouched", () => {
    const url = buildSautoUrl({ ...baseQuery, make: "bmw", model: "x5" }, 0);
    expect(url).toContain("manufacturer_model_seo=bmw%3Ax5");
  });

  it("parses listings from the API response, skipping broken items", () => {
    const items = parseSautoResponse(fixture);
    expect(items).toHaveLength(3);

    expect(items[0]).toMatchObject({
      sourceId: "211180971",
      make: "Hyundai",
      model: "i30",
      variant: "1.6 MPI, ČR, nové rozvody",
      mileageKm: 199000,
      price: 134900,
      year: 2013,
      fuel: "Benzín",
      transmission: "Manuální",
      sellerType: "private",
    });
    expect(items[0].url).toBe("https://www.sauto.cz/osobni/detail/hyundai/i30/211180971");
    expect(items[0].imageUrls[0]).toBe(
      "https://d19-a.sdn.cz/d_19/c_img_qF_C/k0OqwCKRDgcHsBVhH5hWw4/61af.jpeg"
    );

    // private seller: premise is null, only `user` is present
    expect(items[1].sellerType).toBe("private");

    // dealer: non-null `premise`
    expect(items[2].sellerType).toBe("dealer");
    expect(items[2].url).toBe("https://www.sauto.cz/osobni/detail/volkswagen/id3/211013553");
  });

  it("returns an empty array for an unexpected response shape", () => {
    expect(parseSautoResponse({ unexpected: true })).toEqual([]);
    expect(parseSautoResponse(null)).toEqual([]);
  });
});

describe("parseSautoDetailText (GET /api/v1/items/{id})", () => {
  it("combines the free-text variant + description + every equipment item name", () => {
    const json = {
      result: {
        additional_model_name: "2.0TDI 150kW DSG 4x4 Long TZ",
        description: "Vozidlo na cestě, další výbavy: automatické parkování",
        equipment_cb: [
          { equipment_category: "safety", name: "ABS", value: 8 },
          { equipment_category: "assist", name: "Adaptivní tempomat", value: 232 },
          { name: null },
        ],
      },
    };
    const text = parseSautoDetailText(json);
    expect(text).toContain("2.0TDI 150kW DSG 4x4 Long TZ");
    expect(text).toContain("Vozidlo na cestě");
    expect(text).toContain("ABS");
    expect(text).toContain("Adaptivní tempomat");
  });

  it("returns null for a missing/malformed result", () => {
    expect(parseSautoDetailText({})).toBeNull();
    expect(parseSautoDetailText(null)).toBeNull();
    expect(parseSautoDetailText({ result: { description: null, equipment_cb: null } })).toBeNull();
  });
});
