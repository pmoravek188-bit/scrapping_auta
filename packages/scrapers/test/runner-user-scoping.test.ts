import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RawListing } from "@scrapping-auta/core";
import type { SourceAdapter } from "../src/adapter.js";
import type { DbClient } from "../src/db.js";
import { runScrape } from "../src/runner.js";
import { checkSourceHealthAndAlert } from "../src/health-alert.js";
import { sendMatchDigestEmail } from "../src/notify/email.js";
import { sendPushToUser } from "../src/push.js";

/**
 * Tests for `runScrape`'s `--user=<uuid>` scoping (RunOptions.userFilter —
 * see runner.ts's doc comment on that field): a manual, user-scoped run must
 * only touch one user's enabled searches (and therefore only the sources
 * those searches actually reference), must skip every maintenance step that
 * needs a full, all-users picture, must tag its `scrape_runs` rows, and must
 * notify only that one user — even when a DIFFERENT user has a leftover
 * unnotified match sitting in the table from an earlier (global) run.
 *
 * Every side-effecting dependency the real runner talks to besides the DB
 * itself (adapters, e-mail, push, favourites-alert, health-alert, the
 * exchange-rate fetch) is mocked out below, so this test never touches the
 * network. The fake DB is a set of small per-table "thenable" query-builder
 * stand-ins, same pattern as the rest of this suite's fakes (see
 * runner-enrichment.test.ts / runner-image-check.test.ts) — just covering
 * more tables since `runScrape` itself (unlike those files' narrower
 * exported helpers) is under test here.
 */

const sautoSearch = vi.fn<SourceAdapter["search"]>();
const bazosSearch = vi.fn<SourceAdapter["search"]>();

vi.mock("../src/registry.js", () => ({
  getAdapter: (id: string) =>
    ({
      sauto: { id: "sauto", verified: true, search: sautoSearch },
      bazos: { id: "bazos", verified: true, search: bazosSearch },
    })[id],
}));

vi.mock("../src/exchange-rate.js", () => ({
  fetchEurCzkRate: vi.fn().mockResolvedValue(25),
}));

vi.mock("../src/health-alert.js", () => ({
  checkSourceHealthAndAlert: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../src/notify/email.js", () => ({
  loadEmailSenderConfig: vi.fn().mockResolvedValue(null),
  sendMatchDigestEmail: vi.fn().mockResolvedValue(true),
}));

vi.mock("../src/push.js", () => ({
  getVapidConfig: vi.fn().mockResolvedValue(null),
  sendPushToUser: vi.fn().mockResolvedValue(undefined),
  sendPushToAdmins: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../src/favorites-alert.js", () => ({
  checkFavoritesAlerts: vi.fn().mockResolvedValue([]),
  sendFavoritesAlertPush: vi.fn().mockResolvedValue(undefined),
}));

let fakeDb: DbClient;
vi.mock("../src/db.js", () => ({
  createSupabaseClient: () => fakeDb,
}));

interface MatchRow {
  id: string;
  search_id: string;
  listing_id: string;
  notified_at: string | null;
}
interface SearchSeed {
  id: string;
  user_id: string;
  name: string;
  sources: string[];
  notify: boolean;
  enabled: boolean;
}

function rawListing(sourceId: string): RawListing {
  return {
    sourceId,
    url: `https://example.com/${sourceId}`,
    title: `Listing ${sourceId}`,
    make: null,
    model: null,
    year: 2018,
    mileageKm: 90000,
    price: 300000,
    currency: "CZK",
    imageUrls: [`https://example.com/${sourceId}.jpg`],
  };
}

/** Builds the fake DB for one test run. See the file doc comment. */
function makeFakeDb(opts: { searches: SearchSeed[]; seedMatches: MatchRow[]; seedListings: Record<string, unknown> }) {
  const sourcesRows = [
    { id: "sauto", enabled: true, name: "Sauto", last_alert_at: null },
    { id: "bazos", enabled: true, name: "Bazos", last_alert_at: null },
  ];
  const sourcesUpdateCalls: { id: string; patch: unknown }[] = [];
  const scrapeRunsInserted: { source: string; user_id: string | null }[] = [];
  const listingsRows = new Map<string, Record<string, unknown>>(Object.entries(opts.seedListings));
  const counters = { goneCheck: 0, cleanup: 0, deletes: 0 };
  const matches: MatchRow[] = [...opts.seedMatches];
  const matchesUpdateCalls: string[][] = [];
  const searchesById = new Map(
    opts.searches.map((s) => [s.id, { name: s.name, notify: s.notify, user_id: s.user_id }])
  );

  function sourcesTable() {
    const obj: {
      _mode: "select" | "update" | null;
      _eq: Record<string, unknown>;
      _patch: unknown;
      select(): typeof obj;
      update(patch: unknown): typeof obj;
      eq(col: string, val: unknown): typeof obj;
      then(resolve: (v: { data: unknown; error: null }) => void): void;
    } = {
      _mode: null,
      _eq: {},
      _patch: undefined,
      select() {
        if (!obj._mode) obj._mode = "select";
        return obj;
      },
      update(patch: unknown) {
        obj._mode = "update";
        obj._patch = patch;
        return obj;
      },
      eq(col, val) {
        obj._eq[col] = val;
        return obj;
      },
      then(resolve) {
        if (obj._mode === "update") {
          sourcesUpdateCalls.push({ id: obj._eq.id as string, patch: obj._patch });
          resolve({ data: null, error: null });
          return;
        }
        const rows = sourcesRows.filter((r) =>
          Object.entries(obj._eq).every(([k, v]) => (r as Record<string, unknown>)[k] === v)
        );
        resolve({ data: rows, error: null });
      },
    };
    return obj;
  }

  function searchesTable() {
    const obj: {
      _eq: Record<string, unknown>;
      select(): typeof obj;
      eq(col: string, val: unknown): typeof obj;
      then(resolve: (v: { data: unknown; error: null }) => void): void;
    } = {
      _eq: {},
      select() {
        return obj;
      },
      eq(col, val) {
        obj._eq[col] = val;
        return obj;
      },
      then(resolve) {
        const rows = opts.searches.filter((r) =>
          Object.entries(obj._eq).every(([k, v]) => (r as Record<string, unknown>)[k] === v)
        );
        resolve({ data: rows, error: null });
      },
    };
    return obj;
  }

  function listingsTable() {
    const obj: {
      _mode: "select" | "upsert" | "delete" | null;
      _selectCols: string | undefined;
      _eq: Record<string, unknown>;
      _row: Record<string, unknown> | undefined;
      select(cols: string): typeof obj;
      eq(col: string, val: unknown): typeof obj;
      is(col: string, val: unknown): typeof obj;
      in(): typeof obj;
      not(): typeof obj;
      lt(): typeof obj;
      gt(): typeof obj;
      order(): typeof obj;
      limit(): typeof obj;
      maybeSingle(): typeof obj;
      single(): typeof obj;
      upsert(row: Record<string, unknown>): typeof obj;
      delete(): typeof obj;
      then(resolve: (v: { data: unknown; error: null }) => void): void;
    } = {
      _mode: null,
      _selectCols: undefined,
      _eq: {},
      _row: undefined,
      select(cols) {
        if (!obj._mode) obj._mode = "select";
        obj._selectCols = cols;
        return obj;
      },
      eq(col, val) {
        obj._eq[col] = val;
        return obj;
      },
      is(col, val) {
        obj._eq[col] = val;
        return obj;
      },
      in() {
        return obj;
      },
      not() {
        return obj;
      },
      lt() {
        return obj;
      },
      gt() {
        return obj;
      },
      order() {
        return obj;
      },
      limit() {
        return obj;
      },
      maybeSingle() {
        return obj;
      },
      single() {
        return obj;
      },
      upsert(row) {
        obj._mode = "upsert";
        obj._row = row;
        return obj;
      },
      delete() {
        obj._mode = "delete";
        return obj;
      },
      then(resolve) {
        if (obj._mode === "upsert") {
          const row = obj._row!;
          const id = `${row.source}:${row.source_id}`;
          listingsRows.set(id, { id, ...row });
          resolve({ data: { id, price_czk: row.price_czk }, error: null });
          return;
        }
        if (obj._mode === "delete") {
          counters.deletes++;
          resolve({ data: [], error: null });
          return;
        }
        switch (obj._selectCols) {
          case "id, price_czk, group_id": {
            const id = `${obj._eq.source}:${obj._eq.source_id}`;
            const row = listingsRows.get(id);
            resolve({
              data: row ? { id: row.id, price_czk: row.price_czk, group_id: row.group_id ?? null } : null,
              error: null,
            });
            return;
          }
          case "group_id":
            resolve({ data: null, error: null });
            return;
          case "id, source_id, url":
            counters.goneCheck++;
            resolve({ data: [], error: null });
            return;
          case "id, matches(id), favorites(user_id)":
            counters.cleanup++;
            resolve({ data: [], error: null });
            return;
          case "source_id, image_urls":
            resolve({ data: [], error: null });
            return;
          default:
            resolve({ data: [], error: null });
        }
      },
    };
    return obj;
  }

  function matchesTable() {
    const obj: {
      _mode: "select" | "upsert" | "update" | null;
      _eq: Record<string, unknown>;
      _is: Record<string, unknown>;
      _inIds: string[] | undefined;
      _row: { search_id: string; listing_id: string } | undefined;
      _patch: { notified_at: string } | undefined;
      select(cols: string): typeof obj;
      eq(col: string, val: unknown): typeof obj;
      is(col: string, val: unknown): typeof obj;
      in(col: string, ids: string[]): typeof obj;
      upsert(row: { search_id: string; listing_id: string }, opts: unknown): typeof obj;
      update(patch: { notified_at: string }): typeof obj;
      maybeSingle(): typeof obj;
      then(resolve: (v: { data: unknown; error: null }) => void): void;
    } = {
      _mode: null,
      _eq: {},
      _is: {},
      _inIds: undefined,
      _row: undefined,
      _patch: undefined,
      select(_cols) {
        if (!obj._mode) obj._mode = "select";
        return obj;
      },
      eq(col, val) {
        obj._eq[col] = val;
        return obj;
      },
      is(col, val) {
        obj._is[col] = val;
        return obj;
      },
      in(_col, ids) {
        obj._inIds = ids;
        return obj;
      },
      upsert(row, _opts) {
        obj._mode = "upsert";
        obj._row = row;
        return obj;
      },
      update(patch) {
        obj._mode = "update";
        obj._patch = patch;
        return obj;
      },
      maybeSingle() {
        return obj;
      },
      then(resolve) {
        if (obj._mode === "upsert") {
          const row = obj._row!;
          const existing = matches.find((m) => m.search_id === row.search_id && m.listing_id === row.listing_id);
          if (existing) {
            resolve({ data: null, error: null });
            return;
          }
          const created: MatchRow = {
            id: `${row.search_id}:${row.listing_id}`,
            search_id: row.search_id,
            listing_id: row.listing_id,
            notified_at: null,
          };
          matches.push(created);
          resolve({ data: { id: created.id }, error: null });
          return;
        }
        if (obj._mode === "update") {
          const ids = obj._inIds ?? [];
          matchesUpdateCalls.push(ids);
          for (const m of matches) {
            if (ids.includes(m.id)) m.notified_at = obj._patch!.notified_at;
          }
          resolve({ data: null, error: null });
          return;
        }
        const rows = matches
          .filter((m) => !("notified_at" in obj._is) || m.notified_at === obj._is.notified_at)
          .map((m) => ({ ...m, search: searchesById.get(m.search_id)! }))
          .filter((m) =>
            Object.entries(obj._eq).every(([k, v]) => {
              if (k === "searches.notify") return m.search.notify === v;
              if (k === "searches.user_id") return m.search.user_id === v;
              return true;
            })
          )
          .map((m) => ({
            id: m.id,
            search_id: m.search_id,
            listing_id: m.listing_id,
            searches: m.search,
            listings: listingsRows.get(m.listing_id) ?? null,
          }));
        resolve({ data: rows, error: null });
      },
    };
    return obj;
  }

  function from(table: string) {
    switch (table) {
      case "sources":
        return sourcesTable();
      case "searches":
        return searchesTable();
      case "listings":
        return listingsTable();
      case "matches":
        return matchesTable();
      case "scrape_runs":
        return {
          insert(row: { source: string; user_id?: string | null }) {
            scrapeRunsInserted.push({ source: row.source, user_id: row.user_id ?? null });
            return Promise.resolve({ data: null, error: null });
          },
        };
      case "price_history":
        return { insert: () => Promise.resolve({ data: null, error: null }) };
      case "exchange_rates":
        return { upsert: () => Promise.resolve({ data: null, error: null }) };
      default:
        throw new Error(`unexpected table in test fake: ${table}`);
    }
  }

  const db = {
    from,
    auth: {
      admin: {
        getUserById: async (id: string) => ({ data: { user: { email: `${id}@example.com` } }, error: null }),
      },
    },
  } as unknown as DbClient;

  return { db, sourcesUpdateCalls, scrapeRunsInserted, counters, matches, matchesUpdateCalls };
}

describe("runScrape user scoping (--user=<uuid> / RunOptions.userFilter)", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    sautoSearch.mockResolvedValue([rawListing("s1")]);
    bazosSearch.mockResolvedValue([rawListing("b1")]);
    // Loadable-image check (filterListingsWithLoadableImages): every URL
    // "loads" so no listing is dropped on that basis.
    global.fetch = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      headers: { get: () => "image/jpeg" },
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  const searches: SearchSeed[] = [
    { id: "search-a", user_id: "user-a", name: "A hledani", sources: ["sauto"], notify: true, enabled: true },
    { id: "search-b", user_id: "user-b", name: "B hledani", sources: ["bazos"], notify: true, enabled: true },
  ];

  function toFullSearchRow(s: SearchSeed) {
    return {
      ...s,
      make: null,
      model: null,
      year_from: null,
      year_to: null,
      price_from: null,
      price_to: null,
      mileage_max: null,
      fuel: [],
      transmission: null,
      body: [],
      power_min_kw: null,
      keywords: [],
      exclude_keywords: [],
      drive: [],
      features: [],
    };
  }

  it("a user-scoped run only touches that user's searches/sources, skips global maintenance, tags scrape_runs, and notifies only that user", async () => {
    const leftoverMatch: MatchRow = {
      id: "match-b-1",
      search_id: "search-b",
      listing_id: "existing-listing-b",
      notified_at: null,
    };
    const { db, sourcesUpdateCalls, scrapeRunsInserted, counters, matches, matchesUpdateCalls } = makeFakeDb({
      searches: searches.map(toFullSearchRow),
      seedMatches: [leftoverMatch],
      seedListings: {
        "existing-listing-b": {
          id: "existing-listing-b",
          title: "Stara Fabia",
          url: "https://example.com/old-fabia",
          source: "bazos",
          price_czk: 100000,
          year: 2015,
          mileage_km: 50000,
          fuel: "petrol",
          image_urls: ["https://example.com/old-fabia.jpg"],
        },
      },
    });
    fakeDb = db;

    await runScrape({
      userFilter: "user-a",
      supabaseUrl: "https://fake.supabase.co",
      supabaseServiceRoleKey: "fake-key",
    });

    // Only sauto (search-a's source) was ever fetched — bazos is irrelevant
    // to user-a's searches and never gets called at all.
    expect(sautoSearch).toHaveBeenCalledTimes(1);
    expect(bazosSearch).not.toHaveBeenCalled();

    // scrape_runs: only one row, tagged with the triggering user.
    expect(scrapeRunsInserted).toEqual([{ source: "sauto", user_id: "user-a" }]);

    // Global maintenance steps are all skipped.
    expect(counters.goneCheck).toBe(0);
    expect(counters.cleanup).toBe(0);
    expect(counters.deletes).toBe(0);
    expect(sourcesUpdateCalls).toEqual([]);
    expect(checkSourceHealthAndAlert).not.toHaveBeenCalled();

    // Notifications: only user-a's digest/push fire...
    expect(sendMatchDigestEmail).toHaveBeenCalledTimes(1);
    expect((sendMatchDigestEmail as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toBe("user-a@example.com");
    expect(sendPushToUser).toHaveBeenCalledTimes(1);
    expect((sendPushToUser as ReturnType<typeof vi.fn>).mock.calls[0]?.[2]).toBe("user-a");

    // ...and user-b's pre-existing, leftover unnotified match is left alone.
    const leftover = matches.find((m) => m.id === "match-b-1");
    expect(leftover?.notified_at).toBeNull();
    expect(matchesUpdateCalls.flat()).not.toContain("match-b-1");
  });

  it("sanity check: a full (non-user-scoped) run still covers every user/source and runs maintenance", async () => {
    const { db, sourcesUpdateCalls, scrapeRunsInserted, counters } = makeFakeDb({
      searches: searches.map(toFullSearchRow),
      seedMatches: [],
      seedListings: {},
    });
    fakeDb = db;

    await runScrape({
      supabaseUrl: "https://fake.supabase.co",
      supabaseServiceRoleKey: "fake-key",
    });

    expect(sautoSearch).toHaveBeenCalledTimes(1);
    expect(bazosSearch).toHaveBeenCalledTimes(1);
    expect(scrapeRunsInserted).toEqual(
      expect.arrayContaining([
        { source: "sauto", user_id: null },
        { source: "bazos", user_id: null },
      ])
    );
    expect(counters.goneCheck).toBe(2);
    expect(counters.cleanup).toBe(1);
    expect(counters.deletes).toBe(1);
    expect(sourcesUpdateCalls).toHaveLength(2);
    expect(checkSourceHealthAndAlert).toHaveBeenCalledTimes(2);
  });
});
