import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildAutoPalaceUrl,
  looksLikeAutoPalaceListingPage,
  parseAutoPalaceHtml,
} from "../src/sources/autopalace.js";

const fixturePath = fileURLToPath(new URL("./fixtures/autopalace-search.html", import.meta.url));
const html = readFileSync(fixturePath, "utf-8");

describe("autopalace adapter", () => {
  it("builds the unfiltered, brand-scoped and paginated URLs", () => {
    expect(buildAutoPalaceUrl(null, 0)).toBe("https://www.autopalace.cz/skladove-vozy/typy_ojete/");
    expect(buildAutoPalaceUrl("bmw", 0)).toBe(
      "https://www.autopalace.cz/skladove-vozy/typy_ojete/znacky_bmw/"
    );
    expect(buildAutoPalaceUrl("bmw", 1)).toBe(
      "https://www.autopalace.cz/skladove-vozy/typy_ojete/znacky_bmw/2/"
    );
  });

  it("recognizes the real listing-page template", () => {
    expect(looksLikeAutoPalaceListingPage(html)).toBe(true);
    expect(looksLikeAutoPalaceListingPage("<html><body>Request Rejected</body></html>")).toBe(false);
  });

  it("parses cards using the data-vehicle-* attributes and ssg-* icon classes", () => {
    const items = parseAutoPalaceHtml(html);
    expect(items).toHaveLength(3);

    expect(items[0].sourceId).toBe("32240");
    expect(items[0].url).toBe(
      "https://www.autopalace.cz/skladove-vozy/ojete-skoda-fabia-1-2-htp-47kw-kombi-2-maj-cr-47-kw-cervena-czto988038.html"
    );
    expect(items[0].make).toBe("skoda");
    expect(items[0].model).toBe("fabia");
    expect(items[0].body).toBe("kombi");
    expect(items[0].mileageKm).toBe(202550);
    expect(items[0].year).toBe(2005);
    expect(items[0].powerKw).toBe(47);
    expect(items[0].fuel).toBe("petrol");
    expect(items[0].transmission).toBe("manual");
    expect(items[0].price).toBe(29900);
    expect(items[0].location).toBe("Praha Spořilov");
    // No real photo yet -> site serves a shared placeholder, filtered out.
    expect(items[0].imageUrls).toEqual([]);

    expect(items[1].sourceId).toBe("31603");
    expect(items[1].make).toBe("peugeot");
    expect(items[1].mileageKm).toBe(168850);
    expect(items[1].year).toBe(2009);
    expect(items[1].price).toBe(34900);
    expect(items[1].imageUrls).toEqual([
      "https://www.autopalace.cz/uploads/images/vehicles/stock/31603/700x525x100x1_7720029-1O23520.webp",
    ]);

    expect(items[2].sourceId).toBe("32027");
    expect(items[2].fuel).toBe("diesel");
    expect(items[2].body).toBe("SUV");
    expect(items[2].price).toBe(38900);
  });
});
