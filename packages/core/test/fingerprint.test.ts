import { describe, expect, it } from "vitest";
import { computeFingerprint } from "../src/fingerprint.js";

describe("computeFingerprint", () => {
  it("rounds mileage to nearest 1000 km bucket", () => {
    const a = computeFingerprint({ make: "skoda", model: "octavia", year: 2019, mileageKm: 87400, powerKw: 110 });
    const b = computeFingerprint({ make: "skoda", model: "octavia", year: 2019, mileageKm: 87200, powerKw: 110 });
    expect(a).toBe(b);
  });

  it("uses VIN when present regardless of other fields", () => {
    const fp = computeFingerprint({ vin: "abc12345678", make: "x", model: "y" });
    expect(fp).toBe("vin:ABC12345678");
  });
});
