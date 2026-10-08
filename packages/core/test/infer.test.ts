import { describe, expect, it } from "vitest";
import { inferMakeModel } from "../src/infer.js";

describe("inferMakeModel", () => {
  it("extracts a catalogued make+model from a plain title", () => {
    expect(inferMakeModel("Škoda Octavia 2.0 TDI Ambition")).toEqual({
      make: "skoda",
      model: "octavia",
    });
  });

  it("prefers a longer, more specific catalogued model over a shorter prefix", () => {
    // no dedicated "octavia-combi" catalog entry today, but a multi-word make
    // alias (mercedes-benz) must still be preferred over a shorter one (mb).
    expect(inferMakeModel("Mercedes-Benz E220 CDI")).toEqual({
      make: "mercedes-benz",
      model: "e220",
    });
  });

  it("falls back to the next 1-2 plain words when the model isn't in the curated catalog", () => {
    expect(inferMakeModel("Ford Tourneo Custom 2.0 EcoBlue 4X4")).toEqual({
      make: "ford",
      model: "tourneo-custom",
    });
  });

  it("handles a multi-word make (Land Rover, Alfa Romeo)", () => {
    expect(inferMakeModel("Land Rover Discovery 3.0 TDV6")).toEqual({
      make: "land-rover",
      model: "discovery",
    });
    expect(inferMakeModel("Alfa Romeo Giulia 2.2 JTD")).toEqual({
      make: "alfa-romeo",
      model: "giulia",
    });
  });

  it("infers only the model when the make is already known", () => {
    // dasweltauto-style: the raw title is only the model/variant text, make
    // comes from a separate structured field.
    expect(inferMakeModel("Superb Combi 2.0 TDI 140kW", "skoda")).toEqual({
      make: "skoda",
      model: "superb",
    });
  });

  it("matches a catalog model by its (localized) label, not just its slug — e.g. BMW 'Řada 3'", () => {
    // Regression: a source without a structured model field (Auto ESA,
    // confirmed live via the audit script) titles a BMW 3-series listing
    // "BMW Řada 3 2011" — the catalog's canonical slug is "3-series", so
    // slug-only phrase matching ("3 series") never finds it in the Czech
    // text, and the old digit-stopping fallback truncated it down to just
    // "rada" (losing the series number). Matching the catalog label ("Řada
    // 3" -> "rada 3") too fixes this without a BMW-specific special case.
    expect(inferMakeModel("BMW Řada 3 2011")).toEqual({ make: "bmw", model: "3-series" });
    expect(inferMakeModel("BMW Řada 5 2017")).toEqual({ make: "bmw", model: "5-series" });
    // 6/7/8 Series are also in the catalog now (previously only 1-5).
    expect(inferMakeModel("BMW Řada 7 2019")).toEqual({ make: "bmw", model: "7-series" });
  });

  it("infers BMW's numbered series from the bare European title style — a plain digit right after the make, no 'Řada'/'Series' word at all", () => {
    // Regression: autojarov.cz/autopalace.cz (and likely other sources
    // without a structured model field) title a BMW listing like
    // "BMW 3 325i TOURING" — just the series digit, then the engine code,
    // with no "Řada"/"Series"/"3er" word for `findModelInText` to key off.
    // The old digit-stopping `fallbackModelWords` refused to pick up ANY
    // word starting with a digit (by design, so e.g. Peugeot's "308" doesn't
    // get treated as an engine number), so these came back as model `null`.
    // The trailing engine code is kept as model detail (same convention as
    // `normalizeModel`'s existing bare-engine-code aliasing) when the next
    // word is itself a matching code for that series.
    expect(inferMakeModel("BMW 3 325i TOURING")).toEqual({ make: "bmw", model: "3-series-325i" });
    expect(inferMakeModel("BMW 5 520d xDrive")).toEqual({ make: "bmw", model: "5-series-520d" });
    // Displacement/cylinder detail that isn't itself a BMW engine code for
    // the same series ("4,4 V8") is just dropped, not glued onto the model.
    expect(inferMakeModel("BMW 6 4,4 V8")).toEqual({ make: "bmw", model: "6-series" });
  });

  it("infers BMW's numbered series from an engine-code-only title, no series digit at all", () => {
    expect(inferMakeModel("BMW 320d Touring")).toEqual({ make: "bmw", model: "3-series-320d" });
    expect(inferMakeModel("BMW 118d")).toEqual({ make: "bmw", model: "1-series-118d" });
  });

  it("infers every BMW numbered series (1-8) from a bare digit", () => {
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8]) {
      expect(inferMakeModel(`BMW ${n} 2015`)).toEqual({ make: "bmw", model: `${n}-series` });
    }
  });

  it("infers the model only (bare BMW series digit) when the make is already known", () => {
    // autopalace.cz-style: make comes from a structured attribute, and the
    // model text is sometimes just the bare series digit with no trim text
    // at all.
    expect(inferMakeModel("3", "bmw")).toEqual({ make: "bmw", model: "3-series" });
    expect(inferMakeModel("3 325i Touring", "bmw")).toEqual({ make: "bmw", model: "3-series-325i" });
  });

  it("does NOT treat a bare digit as a model for other makes (Mazda/Peugeot/Audi/Škoda unaffected)", () => {
    expect(inferMakeModel("Mazda 3 2.0 Skyactiv")).toEqual({ make: "mazda", model: null });
    expect(inferMakeModel("Peugeot 308 1.6 HDI")).toEqual({ make: "peugeot", model: "308" });
    expect(inferMakeModel("Peugeot 3008 2.0 BlueHDi")).toEqual({ make: "peugeot", model: "3008" });
    expect(inferMakeModel("Audi A3 2.0 TDI")).toEqual({ make: "audi", model: "a3" });
    expect(inferMakeModel("Škoda Octavia 2.0 TDI")).toEqual({ make: "skoda", model: "octavia" });
  });

  it("returns nulls for text with no recognizable make", () => {
    expect(inferMakeModel("Skvělý stav, nová STK")).toEqual({ make: null, model: null });
  });

  it("returns nulls for empty/missing input", () => {
    expect(inferMakeModel(null)).toEqual({ make: null, model: null });
    expect(inferMakeModel("")).toEqual({ make: null, model: null });
  });
});
