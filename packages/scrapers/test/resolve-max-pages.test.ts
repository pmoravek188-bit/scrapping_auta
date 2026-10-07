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
  it("uses the shared default for a source with no override", () => {
    expect(resolveMaxPages("sauto", bareQuery)).toBe(MAX_RESULT_PAGES);
  });

  it("uses the shared default for tipcars regardless of a year filter (no longer a special case — see doc comment)", () => {
    expect(resolveMaxPages("tipcars", bareQuery)).toBe(MAX_RESULT_PAGES);
    expect(resolveMaxPages("tipcars", { ...bareQuery, yearFrom: 2018 })).toBe(MAX_RESULT_PAGES);
    expect(resolveMaxPages("tipcars", { ...bareQuery, yearTo: 2018 })).toBe(MAX_RESULT_PAGES);
  });

  it("uses autoscout24's fixed override regardless of the query", () => {
    expect(resolveMaxPages("autoscout24", bareQuery)).toBe(50);
    expect(resolveMaxPages("autoscout24", { ...bareQuery, yearFrom: 2020 })).toBe(50);
  });

  it("uses carvago's fixed override regardless of the query", () => {
    expect(resolveMaxPages("carvago", bareQuery)).toBe(60);
  });
});
