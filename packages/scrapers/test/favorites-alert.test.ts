import { describe, expect, it } from "vitest";
import type { DbClient } from "../src/db.js";
import { checkFavoritesAlerts, sendFavoritesAlertPush } from "../src/favorites-alert.js";
import type { WebPushLike } from "../src/push.js";

interface FavoriteSeedRow {
  user_id: string;
  listing_id: string;
  last_notified_price: number | null;
  last_notified_gone_at: string | null;
  listings: {
    id: string;
    title: string;
    url: string;
    source: string;
    price_czk: number | null;
    year: number | null;
    mileage_km: number | null;
    fuel: string | null;
    image_urls: string[];
    gone_at: string | null;
  } | null;
}

/** Minimal fake `favorites` table: a `select("...listings(*)")` returning
 * the seeded rows, and an `update(patch).eq().eq()` that records what was
 * written (thenable, like the real supabase-js query builder — see
 * gone-circuit-breaker.test.ts / runner-enrichment.test.ts for the same
 * pattern against other tables). */
function makeFakeDb(rows: FavoriteSeedRow[]) {
  const updates: { user_id: string; listing_id: string; patch: Record<string, unknown> }[] = [];

  function from(table: string) {
    if (table !== "favorites") {
      throw new Error(`unexpected table in test fake: ${table}`);
    }
    const obj = {
      _mode: null as "select" | "update" | null,
      _patch: undefined as Record<string, unknown> | undefined,
      _userId: undefined as string | undefined,
      _listingId: undefined as string | undefined,
      select() {
        obj._mode = "select";
        return obj;
      },
      update(patch: Record<string, unknown>) {
        obj._mode = "update";
        obj._patch = patch;
        return obj;
      },
      eq(col: string, val: unknown) {
        if (col === "user_id") obj._userId = val as string;
        if (col === "listing_id") obj._listingId = val as string;
        return obj;
      },
      then(resolve: (v: { data: unknown; error: null }) => void) {
        if (obj._mode === "select") {
          resolve({ data: rows, error: null });
        } else if (obj._mode === "update") {
          updates.push({ user_id: obj._userId!, listing_id: obj._listingId!, patch: obj._patch! });
          resolve({ data: null, error: null });
        } else {
          resolve({ data: null, error: null });
        }
      },
    };
    return obj;
  }

  return { db: { from } as unknown as DbClient, updates };
}

function row(overrides: Partial<FavoriteSeedRow> = {}): FavoriteSeedRow {
  return {
    user_id: "user-1",
    listing_id: "listing-1",
    last_notified_price: null,
    last_notified_gone_at: null,
    listings: {
      id: "listing-1",
      title: "Škoda Fabia",
      url: "https://example.com/fabia",
      source: "sauto",
      price_czk: 200000,
      year: 2018,
      mileage_km: 90000,
      fuel: "petrol",
      image_urls: [],
      gone_at: null,
    },
    ...overrides,
  };
}

describe("checkFavoritesAlerts", () => {
  it("seeds last_notified_price on a fresh favourite without alerting", async () => {
    const { db, updates } = makeFakeDb([row({ last_notified_price: null })]);
    const events = await checkFavoritesAlerts(db);
    expect(events).toHaveLength(0);
    expect(updates).toEqual([
      { user_id: "user-1", listing_id: "listing-1", patch: { last_notified_price: 200000 } },
    ]);
  });

  it("alerts on a price drop and updates the tracked price to the new lower value", async () => {
    const { db, updates } = makeFakeDb([
      row({ last_notified_price: 250000, listings: { ...row().listings!, price_czk: 200000 } }),
    ]);
    const events = await checkFavoritesAlerts(db);
    expect(events).toHaveLength(1);
    expect(events[0]!.change.kind).toBe("price_drop");
    expect(events[0]!.change.priceCzk).toBe(200000);
    expect(events[0]!.change.previousPriceCzk).toBe(250000);
    expect(updates).toEqual([
      { user_id: "user-1", listing_id: "listing-1", patch: { last_notified_price: 200000 } },
    ]);
  });

  it("does not alert when the price goes up, but does update the tracked value", async () => {
    const { db, updates } = makeFakeDb([
      row({ last_notified_price: 180000, listings: { ...row().listings!, price_czk: 200000 } }),
    ]);
    const events = await checkFavoritesAlerts(db);
    expect(events).toHaveLength(0);
    expect(updates).toEqual([
      { user_id: "user-1", listing_id: "listing-1", patch: { last_notified_price: 200000 } },
    ]);
  });

  it("does not alert or update when the price is unchanged", async () => {
    const { db, updates } = makeFakeDb([
      row({ last_notified_price: 200000, listings: { ...row().listings!, price_czk: 200000 } }),
    ]);
    const events = await checkFavoritesAlerts(db);
    expect(events).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });

  it("never re-alerts the same drop twice (second run sees the already-updated tracked price)", async () => {
    // First run: drop from 250000 -> 200000 notifies and updates the tracker.
    const { db: db1 } = makeFakeDb([
      row({ last_notified_price: 250000, listings: { ...row().listings!, price_czk: 200000 } }),
    ]);
    const firstEvents = await checkFavoritesAlerts(db1);
    expect(firstEvents).toHaveLength(1);

    // Second run: price is still 200000, tracked value is now 200000 too (as
    // the runner would have persisted) -> no new alert.
    const { db: db2 } = makeFakeDb([
      row({ last_notified_price: 200000, listings: { ...row().listings!, price_czk: 200000 } }),
    ]);
    const secondEvents = await checkFavoritesAlerts(db2);
    expect(secondEvents).toHaveLength(0);
  });

  it("alerts once when a listing becomes gone, and does not re-alert on a later run", async () => {
    const goneAt = new Date().toISOString();
    const { db, updates } = makeFakeDb([
      row({
        last_notified_price: 200000, // matches current price, so no price patch happens too
        last_notified_gone_at: null,
        listings: { ...row().listings!, gone_at: goneAt },
      }),
    ]);
    const events = await checkFavoritesAlerts(db);
    expect(events).toHaveLength(1);
    expect(events[0]!.change.kind).toBe("gone");
    expect(updates).toEqual([
      {
        user_id: "user-1",
        listing_id: "listing-1",
        patch: { last_notified_gone_at: expect.any(String) },
      },
    ]);

    // Simulate the already-notified state on a later run: no new alert.
    const { db: db2, updates: updates2 } = makeFakeDb([
      row({
        last_notified_price: 200000,
        last_notified_gone_at: goneAt,
        listings: { ...row().listings!, gone_at: goneAt },
      }),
    ]);
    const events2 = await checkFavoritesAlerts(db2);
    expect(events2).toHaveLength(0);
    expect(updates2).toHaveLength(0);
  });

  it("clears last_notified_gone_at when a previously-gone listing becomes active again", async () => {
    const { db, updates } = makeFakeDb([
      row({
        last_notified_price: 200000, // matches current price, so no price patch happens too
        last_notified_gone_at: new Date().toISOString(),
        listings: { ...row().listings!, gone_at: null },
      }),
    ]);
    const events = await checkFavoritesAlerts(db);
    expect(events).toHaveLength(0);
    expect(updates).toEqual([
      { user_id: "user-1", listing_id: "listing-1", patch: { last_notified_gone_at: null } },
    ]);
  });

  it("skips a favourite row whose listing was deleted (null embed)", async () => {
    const { db, updates } = makeFakeDb([row({ listings: null })]);
    const events = await checkFavoritesAlerts(db);
    expect(events).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });
});

describe("sendFavoritesAlertPush", () => {
  it("sends one push per event, worded by kind, to that event's owner", async () => {
    const { db } = makeFakeDb([]);
    const sent: { endpoint: string; payload: string }[] = [];
    const fakeWebPush: WebPushLike = {
      setVapidDetails: () => {},
      sendNotification: async (sub, payload) => {
        sent.push({ endpoint: sub.endpoint, payload });
      },
    };
    const vapid = { publicKey: "pub", privateKey: "priv", subject: "mailto:x@example.com" };

    // sendPushToUser loads subscriptions via db.from("push_subscriptions") —
    // extend the fake to answer that too.
    const dbWithSubs = {
      from(table: string) {
        if (table === "push_subscriptions") {
          return {
            select() {
              return this;
            },
            eq() {
              return this;
            },
            then(resolve: (v: { data: unknown; error: null }) => void) {
              resolve({
                data: [{ id: "sub-1", user_id: "user-1", endpoint: "https://push.test/1", p256dh: "p", auth: "a" }],
                error: null,
              });
            },
          };
        }
        return (db as unknown as { from(t: string): unknown }).from(table);
      },
    } as unknown as DbClient;

    await sendFavoritesAlertPush(
      dbWithSubs,
      vapid,
      [
        {
          userId: "user-1",
          change: {
            kind: "gone",
            title: "Škoda Fabia",
            url: "https://example.com/fabia",
            source: "sauto",
            priceCzk: null,
            previousPriceCzk: null,
            year: 2018,
            mileageKm: null,
            fuel: null,
            imageUrl: null,
          },
        },
      ],
      fakeWebPush
    );

    expect(sent).toHaveLength(1);
    const payload = JSON.parse(sent[0]!.payload);
    expect(payload.title).toContain("Škoda Fabia");
  });

  it("is a no-op when vapid is not configured", async () => {
    const { db } = makeFakeDb([]);
    await expect(
      sendFavoritesAlertPush(db, null, [
        {
          userId: "user-1",
          change: {
            kind: "gone",
            title: "x",
            url: "https://example.com/x",
            source: "sauto",
            priceCzk: null,
            previousPriceCzk: null,
            year: null,
            mileageKm: null,
            fuel: null,
            imageUrl: null,
          },
        },
      ])
    ).resolves.toBeUndefined();
  });
});
