import { describe, expect, it } from "vitest";
import { getScrapeStatus, parseScrapeErrors, summarizeScrapeIssues } from "./scrape-status";

/**
 * Unit tests for the scrape-status helper — turns the raw, machine-oriented
 * `scrape_runs.errors` text (see packages/scrapers/src/runner.ts) into
 * structured, Czech, human-friendly issues for the "Stav zdrojů" page.
 * Covers the real message shapes runner.ts/the source adapters produce, per
 * the task: page cap, gone-guard, blocked/bot-detection, HTTP errors, query
 * failures, and unrecognized text — plus the never-leak-raw-text guarantee.
 */

describe("parseScrapeErrors", () => {
  it("returns [] for null/undefined/empty/whitespace-only input", () => {
    expect(parseScrapeErrors(null)).toEqual([]);
    expect(parseScrapeErrors(undefined)).toEqual([]);
    expect(parseScrapeErrors("")).toEqual([]);
    expect(parseScrapeErrors("   ")).toEqual([]);
  });

  it("parses a page-cap warning with the search name and page limit", () => {
    const issues = parseScrapeErrors("[pages] carvago: hit page cap 60 for search Vw multivan");
    expect(issues).toEqual([
      {
        kind: "page_cap",
        source: "carvago",
        searchName: "Vw multivan",
        message: "Nestaženo vše pro hledání „Vw multivan“ (limit 60 stran)",
      },
    ]);
  });

  it("parses a gone-guard circuit-breaker warning", () => {
    const issues = parseScrapeErrors("[gone] sauto: suspicious gone ratio 7/12, skipping deletions");
    expect(issues).toEqual([
      { kind: "gone_guard", source: "sauto", message: "Mazání zmizelých inzerátů přeskočeno (podezřele mnoho)" },
    ]);
  });

  it("parses a bot/geo-block detection as 'blocked', dropping the URL", () => {
    const issues = parseScrapeErrors(
      "[aaaauto] response doesn't look like a real aaaauto.cz page (possible bot/geo-block) at https://aaaauto.cz/ojete-vozy?page=1"
    );
    expect(issues).toEqual([{ kind: "blocked", source: "aaaauto", message: "Web nás zablokoval" }]);
    expect(issues[0]!.message).not.toMatch(/https?:\/\//);
  });

  it("parses a WAF/bot-mitigation block from a different source", () => {
    const issues = parseScrapeErrors(
      "[autobazar] response doesn't look like a real autobazar.eu page (possible bot-mitigation/WAF block) at https://autobazar.eu/x"
    );
    expect(issues[0]).toMatchObject({ kind: "blocked", source: "autobazar", message: "Web nás zablokoval" });
  });

  it("parses an HTTP error wrapped in a source's own 'request failed' message", () => {
    const issues = parseScrapeErrors("[aaaauto] request failed on page 0: HTTP 404 for https://aaaauto.cz/x");
    expect(issues).toEqual([{ kind: "error", source: "aaaauto", message: "Web neodpověděl" }]);
  });

  it("parses a bare HTTP error with no source prefix, still dropping the URL", () => {
    const issues = parseScrapeErrors("HTTP 404 for https://example.com/listing/123");
    expect(issues).toEqual([{ kind: "error", message: "Web neodpověděl" }]);
  });

  it("treats HTTP 403/429 as blocked rather than a generic network error", () => {
    expect(parseScrapeErrors("HTTP 403 for https://example.com")[0]).toMatchObject({ kind: "blocked" });
    expect(parseScrapeErrors("HTTP 429 for https://example.com")[0]).toMatchObject({ kind: "blocked" });
  });

  it("parses a timeout/network failure as 'Web neodpověděl'", () => {
    expect(parseScrapeErrors("[sauto] request failed on page 0: This operation was aborted")[0]).toMatchObject({
      kind: "error",
      message: "Web neodpověděl",
    });
    expect(parseScrapeErrors("fetch failed")[0]).toMatchObject({ kind: "error", message: "Web neodpověděl" });
  });

  it("parses a query-failure summary by classifying its inner failure", () => {
    const issues = parseScrapeErrors(
      "[search] aaaauto: 2/3 queries failed: [aaaauto] response doesn't look like a real aaaauto.cz page (possible bot/geo-block) at https://aaaauto.cz/x (+1 more)"
    );
    expect(issues).toEqual([{ kind: "blocked", source: "aaaauto", message: "Web nás zablokoval" }]);
  });

  it("falls back to a generic Czech message for unrecognized text, never showing it raw", () => {
    const issues = parseScrapeErrors("TypeError: Cannot read properties of undefined (reading 'foo')");
    expect(issues).toEqual([{ kind: "other", message: "Chyba při stahování" }]);
  });

  it("splits several joined pieces into separate issues", () => {
    const raw = [
      "[gone] sauto: suspicious gone ratio 7/12, skipping deletions",
      "[pages] sauto: hit page cap 30 for search BMW combi",
    ].join("; ");
    const issues = parseScrapeErrors(raw);
    expect(issues).toHaveLength(2);
    expect(issues[0]!.kind).toBe("gone_guard");
    expect(issues[1]!.kind).toBe("page_cap");
  });

  it("never includes a URL in any produced message, across every parsed kind", () => {
    const raw = [
      "[aaaauto] request failed on page 0: HTTP 500 for https://aaaauto.cz/a?x=1",
      "[autobazar] response doesn't look like a real autobazar.eu page (possible bot-mitigation/WAF block) at https://autobazar.eu/b",
      "[pages] carvago: hit page cap 60 for search Vw multivan",
      "[gone] sauto: suspicious gone ratio 7/12, skipping deletions",
    ].join("; ");
    for (const issue of parseScrapeErrors(raw)) {
      expect(issue.message).not.toMatch(/https?:\/\//);
    }
  });
});

describe("summarizeScrapeIssues", () => {
  it("is 'ok' with no issues", () => {
    expect(summarizeScrapeIssues([])).toEqual({ level: "ok", summary: "Bez chyb", issues: [] });
  });

  it("is 'warning' (amber) when only page_cap/gone_guard issues are present", () => {
    const issues = parseScrapeErrors("[pages] carvago: hit page cap 60 for search Vw multivan");
    const status = summarizeScrapeIssues(issues);
    expect(status.level).toBe("warning");
    expect(status.summary).toBe("Nestaženo vše pro hledání „Vw multivan“ (limit 60 stran)");
  });

  it("is 'error' (red) when a hard issue (error/blocked/other) is present", () => {
    const issues = parseScrapeErrors("[aaaauto] request failed on page 0: HTTP 500 for https://aaaauto.cz/x");
    expect(summarizeScrapeIssues(issues).level).toBe("error");
  });

  it("prefers a hard issue for the summary even when it isn't first, and counts the rest", () => {
    const raw = [
      "[pages] sauto: hit page cap 30 for search BMW combi",
      "[aaaauto] request failed on page 0: HTTP 500 for https://aaaauto.cz/x",
    ].join("; ");
    const status = summarizeScrapeIssues(parseScrapeErrors(raw));
    expect(status.level).toBe("error");
    expect(status.summary).toBe("Web neodpověděl (+1)");
  });
});

describe("getScrapeStatus", () => {
  it("is 'ok' for null/empty input", () => {
    expect(getScrapeStatus(null)).toEqual({ level: "ok", summary: "Bez chyb", issues: [] });
    expect(getScrapeStatus("")).toEqual({ level: "ok", summary: "Bez chyb", issues: [] });
  });

  it("parses and summarizes in one call", () => {
    const status = getScrapeStatus("[gone] sauto: suspicious gone ratio 7/12, skipping deletions");
    expect(status.level).toBe("warning");
    expect(status.summary).toBe("Mazání zmizelých inzerátů přeskočeno (podezřele mnoho)");
    expect(status.issues).toHaveLength(1);
  });
});
