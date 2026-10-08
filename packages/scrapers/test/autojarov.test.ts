import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  brandSlugsForAutoJarov,
  buildAutoJarovUrl,
  looksLikeAutoJarovListingPage,
  parseAutoJarovHtml,
} from "../src/sources/autojarov.js";

const fixturePath = fileURLToPath(new URL("./fixtures/autojarov-search.html", import.meta.url));
const html = readFileSync(fixturePath, "utf-8");

describe("autojarov adapter", () => {
  it("builds the unfiltered, brand-scoped and paginated URLs", () => {
    expect(buildAutoJarovUrl(null, 0)).toBe("https://www.autojarov.cz/nabidka-vozu/typy_ojete/");
    expect(buildAutoJarovUrl("skoda", 0)).toBe(
      "https://www.autojarov.cz/nabidka-vozu/typy_ojete/znacky_skoda/"
    );
    expect(buildAutoJarovUrl("skoda", 1)).toBe(
      "https://www.autojarov.cz/nabidka-vozu/typy_ojete/znacky_skoda/2/"
    );
  });

  it("queries both VW brand slugs for a volkswagen make, and just one for everything else", () => {
    expect(brandSlugsForAutoJarov("volkswagen")).toEqual(["volkswagen", "volkswagen-uzitkove-vozy"]);
    expect(brandSlugsForAutoJarov("VW")).toEqual(["volkswagen", "volkswagen-uzitkove-vozy"]);
    expect(brandSlugsForAutoJarov("skoda")).toEqual(["skoda"]);
    expect(brandSlugsForAutoJarov(undefined)).toEqual([null]);
  });

  it("recognizes the real listing-page template", () => {
    expect(looksLikeAutoJarovListingPage(html)).toBe(true);
    expect(looksLikeAutoJarovListingPage("<html><body>Request Rejected</body></html>")).toBe(false);
  });

  it("parses cards, collapsing the dealer's own VW-commercial brand label back to plain volkswagen", () => {
    const items = parseAutoJarovHtml(html);
    expect(items).toHaveLength(3);

    expect(items[0].sourceId).toBe("2870942");
    expect(items[0].url).toBe(
      "https://www.autojarov.cz/nabidka-vozu/ojete-volkswagen-uzitkove-vozy-caddy-maxi-2-0-tdi-dsg-dtr-90-kw-automat-2870942.html"
    );
    expect(items[0].make).toBe("volkswagen");
    expect(items[0].model).toContain("caddy");
    expect(items[0].transmission).toBe("automatic");
    expect(items[0].fuel).toBe("diesel");
    expect(items[0].powerKw).toBe(90);
    expect(items[0].mileageKm).toBe(144835);
    expect(items[0].year).toBe(2023);
    expect(items[0].price).toBe(559900);
    expect(items[0].currency).toBe("CZK");
    expect(items[0].location).toContain("Jarov");

    expect(items[1].sourceId).toBe("2896877");
    expect(items[1].make).toBe("volkswagen");
    expect(items[1].price).toBe(1860000);
    expect(items[1].mileageKm).toBe(12764);
    expect(items[1].year).toBe(2026);

    expect(items[2].sourceId).toBe("2879645");
    expect(items[2].transmission).toBe("manual");
    expect(items[2].fuel).toBe("diesel");
    expect(items[2].price).toBe(449900);
  });
});
