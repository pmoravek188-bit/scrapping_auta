import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RawListing } from "@scrapping-auta/core";
import type { SourceAdapter } from "../src/adapter.js";
import type { DbClient } from "../src/db.js";
import { runScrape } from "../src/runner.js";
import { fetchEurCzkRate } from "../src/exchange-rate.js";

/**
 * Tests for the runner's price_history WRITE decision (see
 * supabase/migrations/20261010000000_real_price_changes.sql and
 * packages/core/src/price-changes.ts for the full story): a new row is only
 * written when the ORIGINAL price (price_orig/currency_orig) changed, not
 * merely when price_czk moved because the day's EUR/CZK rate did. Exercised
 * end-to-end through `runScrape` across several runs against one persistent
 * fake DB, same fake-query-builder pattern as runner-user-scoping.test.ts.
 */

const search = vi.fn<SourceAdapter["search"]>();

vi.mock("../src/registry.js", () => ({
  getAdapter: (id: string) => (id === "autoscout24" ? { id: "autoscout24", verified: true, search } : undefined),
}));

vi.mock("../src/exchange-rate.js", () => ({
  fetchEurCzkRate: vi.fn(),
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

function rawListing(priceEur: number): RawListing {
  return {
    sourceId: "as24-1",
    url: "https://example.com/as24-1",
    title: "Listing as24-1",
    make: null,
    model: null,
    year: 2018,
    mileageKm: 90000,
    price: priceEur,
    currency: "EUR",
    imageUrls: ["https://example.com/as24-1.jpg"],
  };
}

/** One persistent fake DB, reused across several `runScrape` calls so the
 * second/third run see the first run's upserted listing as "existing" —
 * same minimal thenable query-builder pattern as runner-user-scoping.test.ts,
 * trimmed to the single source/search this test needs. */
function makeFakeDb() {
  const sourceRow = { id: "autoscout24", enabled: true, name: "AutoScout24", last_alert_at: null };
  const searchRow = {
    id: "search-1",
    user_id: "user-1",
    name: "Vse",
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
    sources: [],
    drive: [],
    features: [],
    notify: false,
    enabled: true,
  };

  const listingsRows = new Map<string, Record<string, unknown>>();
  const priceHistoryInserted: { listing_id: string; price_czk: number | null; price_orig: number | null; currency_orig: string | null }[] = [];
  const matches: { id: string; search_id: string; listing_id: string; notified_at: string | null }[] = [];

  function sourcesTable() {
    const obj = {
      select() {
        return obj;
      },
      eq() {
        return obj;
      },
      update() {
        return obj;
      },
      then(resolve: (v: { data: unknown; error: null }) => void) {
        resolve({ data: [sourceRow], error: null });
      },
    };
    return obj;
  }

  function searchesTable() {
    const obj = {
      select() {
        return obj;
      },
      eq() {
        return obj;
      },
      then(resolve: (v: { data: unknown; error: null }) => void) {
        resolve({ data: [searchRow], error: null });
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
      is(): typeof obj;
      in(): typeof obj;
      not(): typeof obj;
      lt(): typeof obj;
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
      is() {
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
          resolve({
            data: { id, price_czk: row.price_czk, price_orig: row.price_orig, currency_orig: row.currency_orig },
            error: null,
          });
          return;
        }
        if (obj._mode === "delete") {
          resolve({ data: [], error: null });
          return;
        }
        switch (obj._selectCols) {
          case "id, price_czk, price_orig, currency_orig, group_id": {
            const id = `${obj._eq.source}:${obj._eq.source_id}`;
            const row = listingsRows.get(id);
            resolve({
              data: row
                ? {
                    id: row.id,
                    price_czk: row.price_czk,
                    price_orig: row.price_orig ?? null,
                    currency_orig: row.currency_orig ?? null,
                    group_id: row.group_id ?? null,
                  }
                : null,
              error: null,
            });
            return;
          }
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
      _row: { search_id: string; listing_id: string } | undefined;
      select(): typeof obj;
      eq(): typeof obj;
      is(): typeof obj;
      upsert(row: { search_id: string; listing_id: string }): typeof obj;
      update(): typeof obj;
      maybeSingle(): typeof obj;
      then(resolve: (v: { data: unknown; error: null }) => void): void;
    } = {
      _mode: null,
      _row: undefined,
      select() {
        if (!obj._mode) obj._mode = "select";
        return obj;
      },
      eq() {
        return obj;
      },
      is() {
        return obj;
      },
      upsert(row) {
        obj._mode = "upsert";
        obj._row = row;
        return obj;
      },
      update() {
        obj._mode = "update";
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
          const created = { id: `${row.search_id}:${row.listing_id}`, search_id: row.search_id, listing_id: row.listing_id, notified_at: null };
          matches.push(created);
          resolve({ data: { id: created.id }, error: null });
          return;
        }
        resolve({ data: [], error: null });
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
        return { insert: () => Promise.resolve({ data: null, error: null }) };
      case "price_history":
        return {
          insert: (row: { listing_id: string; price_czk: number | null; price_orig: number | null; currency_orig: string | null }) => {
            priceHistoryInserted.push(row);
            return Promise.resolve({ data: null, error: null });
          },
        };
      case "exchange_rates":
        return {
          upsert: () => Promise.resolve({ data: null, error: null }),
          select() {
            return this;
          },
          order() {
            return this;
          },
          limit() {
            return this;
          },
          maybeSingle() {
            return Promise.resolve({ data: null, error: null });
          },
        };
      default:
        throw new Error(`unexpected table in test fake: ${table}`);
    }
  }

  const db = {
    from,
    auth: { admin: { getUserById: async () => ({ data: { user: { email: "user-1@example.com" } }, error: null }) } },
  } as unknown as DbClient;

  return { db, priceHistoryInserted };
}

describe("runScrape price_history write decision (real price change vs FX-only noise)", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      headers: { get: () => "image/jpeg" },
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it("writes price_history on first sight, skips it on an FX-only wobble, writes it again on a real EUR price change", async () => {
    const { db, priceHistoryInserted } = makeFakeDb();
    fakeDb = db;

    // Run 1: brand new listing, 20,000 EUR @ rate 25 -> 500,000 Kc.
    search.mockResolvedValue([rawListing(20_000)]);
    vi.mocked(fetchEurCzkRate).mockResolvedValueOnce(25);
    await runScrape({ supabaseUrl: "https://fake.supabase.co", supabaseServiceRoleKey: "fake-key" });

    expect(priceHistoryInserted).toHaveLength(1);
    expect(priceHistoryInserted[0]).toMatchObject({ price_czk: 500_000, price_orig: 20_000, currency_orig: "EUR" });

    // Run 2: SAME 20,000 EUR price, but the rate moved to 25.3 -> 506,000 Kc.
    // Purely FX -- must NOT write a new price_history row.
    search.mockResolvedValue([rawListing(20_000)]);
    vi.mocked(fetchEurCzkRate).mockResolvedValueOnce(25.3);
    await runScrape({ supabaseUrl: "https://fake.supabase.co", supabaseServiceRoleKey: "fake-key" });

    expect(priceHistoryInserted).toHaveLength(1); // unchanged

    // Run 3: the seller actually drops the EUR price to 19,000 -> real change,
    // regardless of what the CZK figure happens to do.
    search.mockResolvedValue([rawListing(19_000)]);
    vi.mocked(fetchEurCzkRate).mockResolvedValueOnce(25.3);
    await runScrape({ supabaseUrl: "https://fake.supabase.co", supabaseServiceRoleKey: "fake-key" });

    expect(priceHistoryInserted).toHaveLength(2);
    expect(priceHistoryInserted[1]).toMatchObject({ price_orig: 19_000, currency_orig: "EUR" });
  });
});
