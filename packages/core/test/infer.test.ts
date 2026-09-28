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

  it("returns nulls for text with no recognizable make", () => {
    expect(inferMakeModel("Skvělý stav, nová STK")).toEqual({ make: null, model: null });
  });

  it("returns nulls for empty/missing input", () => {
    expect(inferMakeModel(null)).toEqual({ make: null, model: null });
    expect(inferMakeModel("")).toEqual({ make: null, model: null });
  });
});
