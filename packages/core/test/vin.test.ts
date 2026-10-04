import { describe, expect, it } from "vitest";
import { extractVin, isValidVinFormat } from "../src/vin.js";

describe("isValidVinFormat", () => {
  it("accepts a valid 17-character VIN", () => {
    expect(isValidVinFormat("TMBJJ7NE1J0123456")).toBe(true);
  });

  it("rejects wrong length", () => {
    expect(isValidVinFormat("TMBJJ7NE1J012345")).toBe(false);
    expect(isValidVinFormat("TMBJJ7NE1J01234567")).toBe(false);
  });

  it("rejects I, O, Q (not valid VIN characters)", () => {
    expect(isValidVinFormat("TMBJJ7NE1J012345I")).toBe(false);
    expect(isValidVinFormat("TMBJJ7NE1J012345O")).toBe(false);
    expect(isValidVinFormat("TMBJJ7NE1J012345Q")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(isValidVinFormat("tmbjj7ne1j0123456")).toBe(true);
  });

  it("rejects null/empty", () => {
    expect(isValidVinFormat(null)).toBe(false);
    expect(isValidVinFormat("")).toBe(false);
  });
});

describe("extractVin", () => {
  it("finds a VIN embedded in free text", () => {
    expect(extractVin("Vozidlo VIN: TMBJJ7NE1J0123456, najeto 80000 km")).toBe("TMBJJ7NE1J0123456");
  });

  it("upper-cases the result", () => {
    expect(extractVin("vin tmbjj7ne1j0123456 ověřeno")).toBe("TMBJJ7NE1J0123456");
  });

  it("returns null when no 17-char token is present", () => {
    expect(extractVin("Škoda Octavia combi, 2019, 80000 km")).toBeNull();
  });

  it("doesn't match inside a longer alphanumeric run", () => {
    expect(extractVin("XTMBJJ7NE1J0123456X")).toBeNull();
  });

  it("returns null for null/empty input", () => {
    expect(extractVin(null)).toBeNull();
    expect(extractVin("")).toBeNull();
  });
});
