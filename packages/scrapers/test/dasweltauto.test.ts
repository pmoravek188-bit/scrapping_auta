import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseDasWeltAutoHtml } from "../src/sources/dasweltauto.js";

const fixturePath = fileURLToPath(new URL("./fixtures/dasweltauto-search.html", import.meta.url));
const html = readFileSync(fixturePath, "utf-8");

describe("dasweltauto adapter", () => {
  it("parses listing cards from HTML", () => {
    const items = parseDasWeltAutoHtml(html);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      sourceId: "55501",
      title: "Škoda Superb 2.0 TDI",
      price: 459900,
      year: 2019,
      mileageKm: 55000,
      transmission: "Automat",
    });
  });
});
