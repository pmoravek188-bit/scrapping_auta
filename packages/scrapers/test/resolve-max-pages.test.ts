import { describe, expect, it } from "vitest";
import type { SearchQuery } from "@scrapping-auta/core";
import { resolveMaxPages } from "../src/runner.js";
import { MAX_RESULT_PAGES } from "../src/http.js";

const bareQuery: SearchQuery = {
  fuel: [],
  body: [],
  keywords: [],
  excludeKeywords: [],
  sources: [],
};

describe("resolveMaxPages", () => {
  it("uses the shared default for a source with no override and no year filter", () => {
    expect(resolveMaxPages("sauto", bareQuery)).toBe(MAX_RESULT_PAGES);
  });

  it("uses autoscout24's fixed override regardless of the query", () => {
    expect(resolveMaxPages("autoscout24", bareQuery)).toBe(15);
    expect(resolveMaxPages("autoscout24", { ...bareQuery, yearFrom: 2020 })).toBe(15);
  });

  it("uses the shared default for tipcars when the query has no year filter", () => {
    expect(resolveMaxPages("tipcars", bareQuery)).toBe(MAX_RESULT_PAGES);
  });

  it("raises tipcars' page cap to 10 when the query sets yearFrom", () => {
    expect(resolveMaxPages("tipcars", { ...bareQuery, yearFrom: 2018 })).toBe(10);
  });

  it("raises tipcars' page cap to 10 when the query sets yearTo", () => {
    expect(resolveMaxPages("tipcars", { ...bareQuery, yearTo: 2018 })).toBe(10);
  });
});
