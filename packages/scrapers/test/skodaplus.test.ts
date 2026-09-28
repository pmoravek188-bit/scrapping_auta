import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseSkodaPlusEdges } from "../src/sources/skodaplus.js";

const fixturePath = fileURLToPath(new URL("./fixtures/skodaplus-cars.json", import.meta.url));
const response = JSON.parse(readFileSync(fixturePath, "utf-8"));

describe("skodaplus adapter", () => {
  it("parses cars from the GraphQL cars(...) response", () => {
    const items = parseSkodaPlusEdges(response.data);
    expect(items).toHaveLength(3);

    expect(items[0].sourceId).toBe("10625124");
    expect(items[0].url).toBe(
      "https://www.skodaplus.cz/Car/10625124/skoda-fabia-combi-ambition-1-0-tsi-70-kw"
    );
    expect(items[0].make).toBe("Škoda");
    expect(items[0].model).toBe("Fabia");
    expect(items[0].variant).toBe("Ambition 1.0 TSI 70 kW");
    expect(items[0].title).toBe("Škoda Fabia Ambition 1.0 TSI 70 kW");
    expect(items[0].price).toBe(199900);
    expect(items[0].mileageKm).toBe(160439);
    expect(items[0].year).toBe(2022);
    expect(items[0].fuel).toBe("petrol");
    expect(items[0].transmission).toBe("manual");
    expect(items[0].vin).toBe("TMBJP6NJ9PZ011573");
    expect(items[0].imageUrls[0]).toContain("https://www.skodaplus.cz/images/car/");

    expect(items[1].sourceId).toBe("10624910");
    expect(items[1].fuel).toBe("diesel");
    expect(items[1].year).toBe(2013);

    // Despite the "Škoda Plus" branding, the platform also lists other
    // VW-Group-certified makes (confirmed live) — make must NOT be
    // hardcoded to "Škoda".
    expect(items[2].make).toBe("Audi");
    expect(items[2].model).toBe("A4");
    expect(items[2].title).toBe("Audi A4 2.0 TDI 140 kW S line");
  });
});
