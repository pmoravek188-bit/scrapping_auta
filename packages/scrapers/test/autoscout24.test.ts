import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildAutoScout24Url,
  purchasePriceEur,
  parseAutoScout24Html,
} from "../src/sources/autoscout24.js";
import type { SearchQuery } from "@scrapping-auta/core";

const fixturePath = fileURLToPath(new URL("./fixtures/autoscout24-search.html", import.meta.url));
const html = readFileSync(fixturePath, "utf-8");

const baseQuery: SearchQuery = {
  fuel: [],
  body: [],
  keywords: [],
  excludeKeywords: [],
  sources: [],
};

const EUR_CZK_RATE = 25;

describe("autoscout24 adapter", () => {
  it("always searches Germany only and builds a make/model path", () => {
    const url = buildAutoScout24Url({ ...baseQuery, make: "skoda", model: "octavia" }, 0, EUR_CZK_RATE);
    expect(url).toContain("/lst/skoda/octavia");
    expect(url).toContain("cy=D");
  });

  it("converts CZK price filters to EUR, rounding the range outward", () => {
    const url = buildAutoScout24Url({ ...baseQuery, priceFrom: 251, priceTo: 999 }, 0, EUR_CZK_RATE);
    // 251/25 = 10.04 -> floor 10; 999/25 = 39.96 -> ceil 40.
    expect(url).toContain("pricefrom=10");
    expect(url).toContain("priceto=40");
  });

  it("builds the default /lst path with no make", () => {
    const url = buildAutoScout24Url({ ...baseQuery }, 0, EUR_CZK_RATE);
    expect(url).toContain("/lst?");
  });

  it("maps a canonical Mercedes-Benz class slug to autoscout24's own whole-class path segment", () => {
    // Confirmed live: autoscout24.cz's whole-class model path is
    // "trida-<letter>-vse" for most letters (e.g. numberOfResults narrows
    // from ~198k to ~6.4k for /lst/mercedes-benz/trida-v-vse), with two
    // irregular exceptions also confirmed live: T-Class is "t-class" (no
    // "-vse"), X-Class is "rada-x-vse" ("Řada X").
    expect(buildAutoScout24Url({ ...baseQuery, make: "mercedes-benz", model: "v-class" }, 0, EUR_CZK_RATE)).toContain(
      "/lst/mercedes-benz/trida-v-vse"
    );
    expect(buildAutoScout24Url({ ...baseQuery, make: "mercedes-benz", model: "c-class" }, 0, EUR_CZK_RATE)).toContain(
      "/lst/mercedes-benz/trida-c-vse"
    );
    expect(buildAutoScout24Url({ ...baseQuery, make: "mercedes-benz", model: "t-class" }, 0, EUR_CZK_RATE)).toContain(
      "/lst/mercedes-benz/t-class"
    );
    expect(buildAutoScout24Url({ ...baseQuery, make: "mercedes-benz", model: "x-class" }, 0, EUR_CZK_RATE)).toContain(
      "/lst/mercedes-benz/rada-x-vse"
    );
  });

  it("leaves a non-class Mercedes-Benz model slug untouched", () => {
    const url = buildAutoScout24Url({ ...baseQuery, make: "mercedes-benz", model: "vito" }, 0, EUR_CZK_RATE);
    expect(url).toContain("/lst/mercedes-benz/vito");
  });

  it("purchasePriceEur passes priceRaw through unchanged for a normal listing", () => {
    expect(purchasePriceEur({ priceRaw: 8700, isVatLabelLegallyRequired: false })).toBe(8700);
  });

  it("purchasePriceEur does NOT multiply by VAT for a vatDeductible listing — priceRaw is already gross", () => {
    // Regression test: an earlier version wrongly treated `priceRaw` as a
    // net price and multiplied by 1.19 when this flag was set, which would
    // have overstated the price by 19%. AutoScout24's displayed price is
    // always gross; the flag only means VAT is statable/reclaimable.
    expect(purchasePriceEur({ priceRaw: 20000, isVatLabelLegallyRequired: true })).toBe(20000);
  });

  it("parses listings from __NEXT_DATA__, using make+model+version for the title", () => {
    const items = parseAutoScout24Html(html);
    expect(items).toHaveLength(3);

    expect(items[0].sourceId).toBe("e6b42bd5-394c-4968-a33a-c7c3ec165674");
    expect(items[0].url).toContain("autoscout24.cz/nabidky/dacia-logan");
    expect(items[0].title).toBe("Dacia Logan 1.6 Lauréate 88 pk airco");
    expect(items[0].make).toBe("Dacia");
    expect(items[0].price).toBe(1350);
    expect(items[0].currency).toBe("EUR");
    expect(items[0].country).toBe("DE");
    expect(items[0].location).toBe("VAASSEN 12345");
    expect(items[0].mileageKm).toBe(155905);
    expect(items[0].fuel).toBe("petrol");
    expect(items[0].transmission).toBe("manual");
    expect(items[0].year).toBe(2019);
    expect(items[0].powerKw).toBe(65);

    expect(items[1].title).toBe("Skoda Octavia Combi 2.0 TDI Ambition");
    expect(items[1].fuel).toBe("diesel");
    expect(items[1].transmission).toBe("automatic");
    expect(items[1].year).toBe(2018);
    expect(items[1].powerKw).toBe(110);

    // VAT-deductible listing: priceRaw is used as-is (no 1.19 multiplication
    // — it's already the gross price), the title just gets the marker.
    expect(items[2].price).toBe(20000);
    expect(items[2].title).toContain("· odpočet DPH");
    expect(items[2].title.startsWith("Volkswagen Transporter")).toBe(true);
  });
});
