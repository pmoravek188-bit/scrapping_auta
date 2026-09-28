import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseAaaAutoHtml } from "../src/sources/aaaauto.js";

const fixturePath = fileURLToPath(new URL("./fixtures/aaaauto-search.html", import.meta.url));
const html = readFileSync(fixturePath, "utf-8");

describe("aaaauto adapter", () => {
  it("parses listing cards from HTML", () => {
    const items = parseAaaAutoHtml(html);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      sourceId: "77701",
      title: "Ford Focus 1.5 TDCi",
      price: 229900,
      year: 2018,
      mileageKm: 80000,
    });
  });
});
