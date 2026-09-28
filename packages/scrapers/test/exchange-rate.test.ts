import { describe, expect, it } from "vitest";
import { parseCnbEurRate } from "../src/exchange-rate.js";

const CNB_SAMPLE = `28 Sep 2026 #188
zeme|mena|mnozstvi|kod|kurz
Australie|dolar|1|AUD|16.234
EMU|euro|1|EUR|25.180
USA|dolar|1|USD|21.760
`;

describe("parseCnbEurRate", () => {
  it("extracts the EUR/CZK rate from the CNB daily text format", () => {
    expect(parseCnbEurRate(CNB_SAMPLE)).toBeCloseTo(25.18, 5);
  });

  it("handles amount != 1 (rate per N units)", () => {
    const text = `28 Sep 2026 #188\nzeme|mena|mnozstvi|kod|kurz\nEMU|euro|100|EUR|2518.0\n`;
    expect(parseCnbEurRate(text)).toBeCloseTo(25.18, 5);
  });

  it("returns null when EUR is not present", () => {
    expect(parseCnbEurRate("zeme|mena|mnozstvi|kod|kurz\nUSA|dolar|1|USD|21.76\n")).toBeNull();
  });
});
