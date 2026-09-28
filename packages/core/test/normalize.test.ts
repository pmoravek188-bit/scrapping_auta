import { describe, expect, it } from "vitest";
import { normalizeListing } from "../src/normalize.js";
import type { RawListing } from "../src/schemas.js";

const base: RawListing = {
  sourceId: "123",
  url: "https://example.com/123",
  title: "Škoda Octavia 2.0 TDI",
  make: "Škoda",
  model: "Octavia",
  variant: "2.0 TDI Style",
  year: 2019,
  mileageKm: 87000,
  price: 350000,
  currency: "CZK",
  fuel: "nafta",
  transmission: "manuální",
  powerKw: 110,
  body: "kombi",
  color: "šedá",
  location: "Praha",
  country: "CZ",
  sellerType: "dealer",
  vin: null,
  imageUrls: ["https://example.com/img.jpg"],
};

describe("normalizeListing", () => {
  it("normalizes make/model/fuel/transmission/body", () => {
    const listing = normalizeListing(base, { source: "sauto" });
    expect(listing.make).toBe("skoda");
    expect(listing.model).toBe("octavia");
    expect(listing.fuel).toBe("diesel");
    expect(listing.transmission).toBe("manual");
    expect(listing.body).toBe("combi");
    expect(listing.priceCzk).toBe(350000);
    expect(listing.sellerType).toBe("dealer");
  });

  it("converts EUR prices using the given rate", () => {
    const listing = normalizeListing(
      { ...base, price: 10000, currency: "EUR" },
      { source: "carvago", eurCzkRate: 25.5 }
    );
    expect(listing.priceCzk).toBe(255000);
    expect(listing.currencyOrig).toBe("EUR");
  });

  it("falls back to unknown fields gracefully", () => {
    const listing = normalizeListing(
      { sourceId: "x", url: "https://x", title: "", currency: "CZK" },
      { source: "bazos" }
    );
    expect(listing.make).toBeNull();
    expect(listing.fuel).toBeNull();
    expect(listing.sellerType).toBe("unknown");
    expect(listing.fingerprint).toContain("mk:unknown");
  });

  it("prefers VIN fingerprint when present", () => {
    const listing = normalizeListing({ ...base, vin: "TMBJJ7NE1K0123456" }, { source: "sauto" });
    expect(listing.fingerprint).toBe("vin:TMBJJ7NE1K0123456");
  });
});
