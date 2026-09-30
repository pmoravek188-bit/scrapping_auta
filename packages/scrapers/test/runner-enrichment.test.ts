import { describe, expect, it, vi } from "vitest";
import { normalizeListing, type Listing, type SearchQuery } from "@scrapping-auta/core";
import {
  enrichNearMatches,
  MAX_DETAIL_FETCHES_PER_SOURCE_PER_RUN,
  type DbClient,
} from "../src/runner.js";
import type { SourceAdapter } from "../src/adapter.js";

/**
 * Minimal fake `detail_text_cache` table covering exactly the calls
 * `enrichNearMatches` makes: a `select().eq("source", ...).in("source_id",
 * ...)` lookup, and an `upsert(row, {onConflict})` write. Thenable, like the
 * real supabase-js query builder (see gone-circuit-breaker.test.ts for the
 * same pattern against a different table).
 */
function makeFakeDb(initialRows: { source: string; source_id: string; features: string[]; fetched_at: string }[]) {
  const rows = [...initialRows];
  const upserts: { source: string; source_id: string; features: string[]; fetched_at: string }[] = [];

  function from(table: string) {
    if (table !== "detail_text_cache") {
      throw new Error(`unexpected table in test fake: ${table}`);
    }
    const obj = {
      _mode: null as "select" | "upsert" | null,
      _sourceFilter: undefined as string | undefined,
      _idsFilter: undefined as string[] | undefined,
      _upsertRow: undefined as (typeof rows)[number] | undefined,
      select() {
        obj._mode = "select";
        return obj;
      },
      eq(col: string, val: unknown) {
        if (col === "source") obj._sourceFilter = val as string;
        return obj;
      },
      in(col: string, vals: unknown[]) {
        if (col === "source_id") obj._idsFilter = vals as string[];
        return obj;
      },
      upsert(row: (typeof rows)[number]) {
        obj._mode = "upsert";
        obj._upsertRow = row;
        return obj;
      },
      then(resolve: (v: { data: unknown; error: null }) => void) {
        if (obj._mode === "select") {
          const matched = rows.filter(
            (r) =>
              (obj._sourceFilter == null || r.source === obj._sourceFilter) &&
              (obj._idsFilter == null || obj._idsFilter.includes(r.source_id))
          );
          resolve({ data: matched, error: null });
        } else if (obj._mode === "upsert" && obj._upsertRow) {
          upserts.push(obj._upsertRow);
          rows.push(obj._upsertRow);
          resolve({ data: null, error: null });
        } else {
          resolve({ data: null, error: null });
        }
      },
    };
    return obj;
  }

  return { db: { from } as unknown as DbClient, upserts, rows };
}

function multivanListing(overrides: Partial<Parameters<typeof normalizeListing>[0]> = {}): Listing {
  return normalizeListing(
    {
      sourceId: overrides.sourceId ?? "1",
      url: overrides.url ?? "https://example.com/1",
      title: "Volkswagen Multivan 2.0 TDI Trendline",
      make: "Volkswagen",
      model: "Multivan",
      year: 2018,
      mileageKm: 90000,
      price: 700000,
      currency: "CZK",
      fuel: "diesel",
      transmission: "automat",
      ...overrides,
    },
    { source: "sauto" }
  );
}

const query: SearchQuery = {
  make: "volkswagen",
  model: "multivan",
  yearFrom: 2016,
  priceTo: 1_000_000,
  features: ["prodlouzena"],
  fuel: [],
  body: [],
  keywords: [],
  excludeKeywords: [],
  sources: [],
};

function makeAdapter(fetchDetailText?: SourceAdapter["fetchDetailText"]): SourceAdapter {
  return {
    id: "sauto",
    verified: true,
    async search() {
      return [];
    },
    fetchDetailText,
  };
}

describe("enrichNearMatches", () => {
  it("is a no-op when the adapter has no fetchDetailText", async () => {
    const listing = multivanListing();
    const adapter = makeAdapter(undefined);
    await enrichNearMatches(null, "sauto", adapter, [listing], [query]);
    expect(listing.detailFeatures).toEqual([]);
  });

  it("is a no-op when there are no relevant queries", async () => {
    const listing = multivanListing();
    const fetchDetailText = vi.fn(async () => "dlouhý rozvor");
    const adapter = makeAdapter(fetchDetailText);
    await enrichNearMatches(null, "sauto", adapter, [listing], []);
    expect(fetchDetailText).not.toHaveBeenCalled();
  });

  it("skips a listing that already fully matches (nothing to enrich)", async () => {
    const listing = { ...multivanListing(), detailFeatures: ["prodlouzena"] };
    const fetchDetailText = vi.fn(async () => "irrelevant");
    const adapter = makeAdapter(fetchDetailText);
    await enrichNearMatches(null, "sauto", adapter, [listing], [query]);
    expect(fetchDetailText).not.toHaveBeenCalled();
  });

  it("skips a listing that fails on something other than features (year)", async () => {
    const listing = multivanListing({ year: 2010 });
    const fetchDetailText = vi.fn(async () => "dlouhý rozvor");
    const adapter = makeAdapter(fetchDetailText);
    await enrichNearMatches(null, "sauto", adapter, [listing], [query]);
    expect(fetchDetailText).not.toHaveBeenCalled();
  });

  it("fetches detail text for a feature-only near-match and sets detailFeatures from it", async () => {
    const listing = multivanListing();
    const fetchDetailText = vi.fn(async () => "Vůz má dlouhý rozvor, tažné zařízení");
    const adapter = makeAdapter(fetchDetailText);
    await enrichNearMatches(null, "sauto", adapter, [listing], [query]);
    expect(fetchDetailText).toHaveBeenCalledWith({ url: listing.url, sourceId: listing.sourceId });
    expect(listing.detailFeatures).toContain("prodlouzena");
    expect(listing.detailFeatures).toContain("tazne");
  });

  it("sets an empty detailFeatures array (not left untouched) when detail text has nothing relevant", async () => {
    const listing = multivanListing();
    const adapter = makeAdapter(async () => "Pěkný vůz, nic zvláštního");
    await enrichNearMatches(null, "sauto", adapter, [listing], [query]);
    expect(listing.detailFeatures).toEqual([]);
  });

  it("treats a fetchDetailText rejection as 'no detail text' rather than aborting the run", async () => {
    const listing = multivanListing();
    const adapter = makeAdapter(async () => {
      throw new Error("network boom");
    });
    await expect(enrichNearMatches(null, "sauto", adapter, [listing], [query])).resolves.toBeUndefined();
    expect(listing.detailFeatures).toEqual([]);
  });

  it("caps detail fetches at MAX_DETAIL_FETCHES_PER_SOURCE_PER_RUN", async () => {
    const listings = Array.from({ length: MAX_DETAIL_FETCHES_PER_SOURCE_PER_RUN + 10 }, (_, i) =>
      multivanListing({ sourceId: String(i), url: `https://example.com/${i}` })
    );
    const fetchDetailText = vi.fn(async () => "dlouhý rozvor");
    const adapter = makeAdapter(fetchDetailText);
    await enrichNearMatches(null, "sauto", adapter, listings, [query]);
    expect(fetchDetailText).toHaveBeenCalledTimes(MAX_DETAIL_FETCHES_PER_SOURCE_PER_RUN);
  });

  it("works in dry-run (db=null): still fetches and enriches, just without any caching", async () => {
    const listing = multivanListing();
    const fetchDetailText = vi.fn(async () => "dlouhý rozvor");
    const adapter = makeAdapter(fetchDetailText);
    await enrichNearMatches(null, "sauto", adapter, [listing], [query]);
    expect(fetchDetailText).toHaveBeenCalledTimes(1);
    expect(listing.detailFeatures).toContain("prodlouzena");
  });

  it("uses a fresh cache hit instead of calling fetchDetailText, and sets detailFeatures from it", async () => {
    const listing = multivanListing();
    const { db } = makeFakeDb([
      { source: "sauto", source_id: listing.sourceId, features: ["prodlouzena"], fetched_at: new Date().toISOString() },
    ]);
    const fetchDetailText = vi.fn(async () => "irrelevant, should never be called");
    const adapter = makeAdapter(fetchDetailText);
    await enrichNearMatches(db, "sauto", adapter, [listing], [query]);
    expect(fetchDetailText).not.toHaveBeenCalled();
    expect(listing.detailFeatures).toEqual(["prodlouzena"]);
  });

  it("ignores a stale cache row (older than 14 days) and re-fetches instead", async () => {
    const listing = multivanListing();
    const staleDate = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();
    const { db, upserts } = makeFakeDb([
      { source: "sauto", source_id: listing.sourceId, features: [], fetched_at: staleDate },
    ]);
    const fetchDetailText = vi.fn(async () => "dlouhý rozvor");
    const adapter = makeAdapter(fetchDetailText);
    await enrichNearMatches(db, "sauto", adapter, [listing], [query]);
    expect(fetchDetailText).toHaveBeenCalledTimes(1);
    expect(listing.detailFeatures).toContain("prodlouzena");
    expect(upserts).toHaveLength(1);
    expect(upserts[0]).toMatchObject({ source: "sauto", source_id: listing.sourceId, features: ["prodlouzena"] });
  });

  it("writes an empty-array cache row (not skipped) when a fresh fetch finds nothing", async () => {
    const listing = multivanListing();
    const { db, upserts } = makeFakeDb([]);
    const adapter = makeAdapter(async () => "nic zvláštního");
    await enrichNearMatches(db, "sauto", adapter, [listing], [query]);
    expect(upserts).toHaveLength(1);
    expect(upserts[0]?.features).toEqual([]);
  });
});
