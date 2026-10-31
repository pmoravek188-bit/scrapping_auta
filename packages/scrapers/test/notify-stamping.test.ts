import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DbClient } from "../src/db.js";
import { notifyNewMatches } from "../src/runner.js";
import { sendMatchDigestEmail } from "../src/notify/email.js";

/**
 * Regression tests for the "same ~1000 cars e-mailed as new every run" bug:
 * a large digest's `notified_at` update used to go out as ONE request with
 * every match id in the URL, which failed (silently) once the backlog grew —
 * so nothing was ever stamped and every run re-sent the same cars, many of
 * them long since sold.
 */

vi.mock("../src/notify/email.js", () => ({
  loadEmailSenderConfig: vi.fn().mockResolvedValue(null),
  sendMatchDigestEmail: vi.fn().mockResolvedValue(true),
}));

vi.mock("../src/push.js", () => ({
  sendPushToUser: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../src/favorites-alert.js", () => ({
  checkFavoritesAlerts: vi.fn().mockResolvedValue([]),
  sendFavoritesAlertPush: vi.fn().mockResolvedValue(undefined),
}));

interface PendingRow {
  id: string;
  search_id: string;
  listing_id: string;
  searches: { name: string; notify: boolean; user_id: string };
  listings: Record<string, unknown>;
}

function makeDb(pending: PendingRow[]) {
  const updateChunks: string[][] = [];
  const matchesTable = () => {
    const obj = {
      _update: false,
      select: () => obj,
      is: () => obj,
      eq: () => obj,
      update: () => {
        obj._update = true;
        return obj;
      },
      in: (_col: string, ids: string[]) => {
        if (obj._update) updateChunks.push(ids);
        return obj;
      },
      then: (resolve: (v: { data: unknown; error: null }) => void) =>
        resolve({ data: obj._update ? null : pending, error: null }),
    };
    return obj;
  };
  const db = {
    from: (table: string) => {
      if (table !== "matches") throw new Error(`unexpected table ${table}`);
      return matchesTable();
    },
    auth: { admin: { getUserById: async () => ({ data: { user: { email: "u@example.com" } }, error: null }) } },
  } as unknown as DbClient;
  return { db, updateChunks };
}

function row(i: number, listing: Record<string, unknown>): PendingRow {
  return {
    id: `m${i}`,
    search_id: "s1",
    listing_id: `l${i}`,
    searches: { name: "BMW", notify: true, user_id: "u1" },
    listings: {
      title: `Car ${i}`,
      url: `https://example.com/${i}`,
      source: "sauto",
      price_czk: 1,
      year: 2020,
      mileage_km: 1,
      fuel: null,
      image_urls: [],
      ...listing,
    },
  };
}

describe("notifyNewMatches stamping", () => {
  beforeEach(() => vi.clearAllMocks());

  it("stamps a large digest in small chunks covering every match", async () => {
    const fresh = new Date().toISOString();
    const pending = Array.from({ length: 250 }, (_, i) => row(i, { first_seen: fresh }));
    const { db, updateChunks } = makeDb(pending);

    await notifyNewMatches(db, null);

    expect(updateChunks.every((c) => c.length <= 100)).toBe(true);
    expect(updateChunks.flat().sort()).toEqual(pending.map((p) => p.id).sort());
  });

  it("does not e-mail gone or old listings, but stamps them so they stop piling up", async () => {
    const old = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const fresh = new Date().toISOString();
    const { db, updateChunks } = makeDb([
      row(1, { first_seen: old }),
      row(2, { first_seen: fresh, gone_at: fresh }),
      row(3, { first_seen: fresh }),
    ]);

    await notifyNewMatches(db, null);

    const groups = vi.mocked(sendMatchDigestEmail).mock.calls[0]![1];
    expect(groups.flatMap((g) => g.listings.map((l) => l.title))).toEqual(["Car 3"]);
    expect(updateChunks.flat().sort()).toEqual(["m1", "m2", "m3"]);
  });

  it("shows a car listed on several sources once, naming the others, and links to the search's results", async () => {
    const fresh = new Date().toISOString();
    const { db, updateChunks } = makeDb([
      row(1, { first_seen: fresh, group_id: "g1", source: "sauto" }),
      row(2, { first_seen: fresh, group_id: "g1", source: "bazos" }),
      row(3, { first_seen: fresh, group_id: "g2", source: "sauto" }),
    ]);

    await notifyNewMatches(db, null);

    const groups = vi.mocked(sendMatchDigestEmail).mock.calls[0]![1];
    expect(groups[0]!.listings.map((l) => [l.title, l.alsoOn ?? []])).toEqual([
      ["Car 1", ["bazos"]],
      ["Car 3", []],
    ]);
    expect(groups[0]!.resultsUrl).toMatch(/\/results\?search=s1$/);
    expect(updateChunks.flat().sort()).toEqual(["m1", "m2", "m3"]);
  });
});
