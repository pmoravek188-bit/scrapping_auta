import { describe, expect, it } from "vitest";
import type { DbClient } from "../src/db.js";
import {
  getVapidConfig,
  sendPushToAdmins,
  sendPushToSubscription,
  sendPushToUser,
  type PushSubscriptionRow,
  type WebPushLike,
} from "../src/push.js";

/** Minimal fake Supabase client covering `app_secrets` (select+in),
 * `push_subscriptions` (select, optionally `.eq("user_id", ...)`, and
 * `delete().eq("id", ...)`). Thenable, same pattern as the rest of the
 * test suite's fake DB builders. */
function makeFakeDb(opts: {
  secrets?: { key: string; value: string }[];
  subscriptions?: PushSubscriptionRow[];
  admins?: string[];
}) {
  const secrets = opts.secrets ?? [];
  const admins = opts.admins ?? [];
  const subscriptions = [...(opts.subscriptions ?? [])];
  const deletedIds: string[] = [];

  function from(table: string) {
    if (table === "app_secrets") {
      const obj = {
        select() {
          return obj;
        },
        in(_col: string, _keys: string[]) {
          return obj;
        },
        then(resolve: (v: { data: unknown; error: null }) => void) {
          resolve({ data: secrets, error: null });
        },
      };
      return obj;
    }
    if (table === "app_admins") {
      const obj = {
        select() {
          return obj;
        },
        then(resolve: (v: { data: unknown; error: null }) => void) {
          resolve({ data: admins.map((user_id) => ({ user_id })), error: null });
        },
      };
      return obj;
    }
    if (table === "push_subscriptions") {
      const obj = {
        _mode: null as "select" | "delete" | null,
        _userId: undefined as string | undefined,
        _id: undefined as string | undefined,
        select() {
          obj._mode = "select";
          return obj;
        },
        delete() {
          obj._mode = "delete";
          return obj;
        },
        eq(col: string, val: unknown) {
          if (col === "user_id") obj._userId = val as string;
          if (col === "id") obj._id = val as string;
          return obj;
        },
        then(resolve: (v: { data: unknown; error: null }) => void) {
          if (obj._mode === "delete") {
            const idx = subscriptions.findIndex((s) => s.id === obj._id);
            if (idx >= 0) subscriptions.splice(idx, 1);
            deletedIds.push(obj._id!);
            resolve({ data: null, error: null });
            return;
          }
          const filtered = obj._userId ? subscriptions.filter((s) => s.user_id === obj._userId) : subscriptions;
          resolve({ data: filtered, error: null });
        },
      };
      return obj;
    }
    throw new Error(`unexpected table in test fake: ${table}`);
  }

  return { db: { from } as unknown as DbClient, deletedIds, subscriptions };
}

const vapid = { publicKey: "pub", privateKey: "priv", subject: "mailto:x@example.com" };

describe("getVapidConfig", () => {
  it("returns null when app_secrets has no VAPID keys configured", async () => {
    const { db } = makeFakeDb({ secrets: [] });
    expect(await getVapidConfig(db)).toBeNull();
  });

  it("returns null when only some of the three keys are present", async () => {
    const { db } = makeFakeDb({ secrets: [{ key: "vapid_public_key", value: "pub" }] });
    expect(await getVapidConfig(db)).toBeNull();
  });

  it("returns the config when all three keys are present", async () => {
    const { db } = makeFakeDb({
      secrets: [
        { key: "vapid_public_key", value: "pub" },
        { key: "vapid_private_key", value: "priv" },
        { key: "vapid_subject", value: "mailto:x@example.com" },
      ],
    });
    expect(await getVapidConfig(db)).toEqual({
      publicKey: "pub",
      privateKey: "priv",
      subject: "mailto:x@example.com",
    });
  });
});

describe("sendPushToSubscription", () => {
  const sub: PushSubscriptionRow = {
    id: "sub-1",
    user_id: "user-1",
    endpoint: "https://push.test/1",
    p256dh: "p256dh-key",
    auth: "auth-key",
  };

  it("sends the payload as JSON to the subscription's endpoint/keys", async () => {
    const { db } = makeFakeDb({ subscriptions: [sub] });
    const calls: unknown[] = [];
    const fake: WebPushLike = {
      setVapidDetails: () => {},
      sendNotification: async (subscription, payload) => {
        calls.push({ subscription, payload });
      },
    };
    const ok = await sendPushToSubscription(db, sub, { title: "t", body: "b" }, fake);
    expect(ok).toBe(true);
    expect(calls).toEqual([
      {
        subscription: { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload: JSON.stringify({ title: "t", body: "b" }),
      },
    ]);
  });

  it("deletes the subscription row on a 404 response", async () => {
    const { db, deletedIds } = makeFakeDb({ subscriptions: [sub] });
    const fake: WebPushLike = {
      setVapidDetails: () => {},
      sendNotification: async () => {
        const err = Object.assign(new Error("Gone"), { statusCode: 404 });
        throw err;
      },
    };
    const ok = await sendPushToSubscription(db, sub, { title: "t", body: "b" }, fake);
    expect(ok).toBe(false);
    expect(deletedIds).toEqual(["sub-1"]);
  });

  it("deletes the subscription row on a 410 response", async () => {
    const { db, deletedIds } = makeFakeDb({ subscriptions: [sub] });
    const fake: WebPushLike = {
      setVapidDetails: () => {},
      sendNotification: async () => {
        const err = Object.assign(new Error("Gone"), { statusCode: 410 });
        throw err;
      },
    };
    await sendPushToSubscription(db, sub, { title: "t", body: "b" }, fake);
    expect(deletedIds).toEqual(["sub-1"]);
  });

  it("keeps the subscription and just logs on any other failure (e.g. a 500 or network error)", async () => {
    const { db, deletedIds } = makeFakeDb({ subscriptions: [sub] });
    const fake: WebPushLike = {
      setVapidDetails: () => {},
      sendNotification: async () => {
        throw new Error("network boom");
      },
    };
    const ok = await sendPushToSubscription(db, sub, { title: "t", body: "b" }, fake);
    expect(ok).toBe(false);
    expect(deletedIds).toEqual([]);
  });
});

describe("sendPushToUser", () => {
  it("is a no-op when vapid is null (push not configured)", async () => {
    const { db } = makeFakeDb({ subscriptions: [] });
    const fake: WebPushLike = {
      setVapidDetails: () => {
        throw new Error("should not be called");
      },
      sendNotification: async () => {
        throw new Error("should not be called");
      },
    };
    await expect(sendPushToUser(db, null, "user-1", { title: "t", body: "b" }, fake)).resolves.toBeUndefined();
  });

  it("sends only to the given user's subscriptions, not other users'", async () => {
    const subs: PushSubscriptionRow[] = [
      { id: "s1", user_id: "user-1", endpoint: "e1", p256dh: "p", auth: "a" },
      { id: "s2", user_id: "user-2", endpoint: "e2", p256dh: "p", auth: "a" },
    ];
    const { db } = makeFakeDb({ subscriptions: subs });
    const sentTo: string[] = [];
    const fake: WebPushLike = {
      setVapidDetails: () => {},
      sendNotification: async (subscription) => {
        sentTo.push(subscription.endpoint);
      },
    };
    await sendPushToUser(db, vapid, "user-1", { title: "t", body: "b" }, fake);
    expect(sentTo).toEqual(["e1"]);
  });

  it("removes dead subscriptions encountered while sending to a user", async () => {
    const subs: PushSubscriptionRow[] = [
      { id: "s1", user_id: "user-1", endpoint: "e1", p256dh: "p", auth: "a" },
      { id: "s2", user_id: "user-1", endpoint: "e2", p256dh: "p", auth: "a" },
    ];
    const { db, deletedIds } = makeFakeDb({ subscriptions: subs });
    const fake: WebPushLike = {
      setVapidDetails: () => {},
      sendNotification: async (subscription) => {
        if (subscription.endpoint === "e2") {
          throw Object.assign(new Error("gone"), { statusCode: 410 });
        }
      },
    };
    await sendPushToUser(db, vapid, "user-1", { title: "t", body: "b" }, fake);
    expect(deletedIds).toEqual(["s2"]);
  });
});

describe("sendPushToAdmins", () => {
  it("sends only to subscriptions owned by admins", async () => {
    const subs: PushSubscriptionRow[] = [
      { id: "s1", user_id: "user-1", endpoint: "e1", p256dh: "p", auth: "a" },
      { id: "s2", user_id: "user-2", endpoint: "e2", p256dh: "p", auth: "a" },
      { id: "s3", user_id: "user-1", endpoint: "e3", p256dh: "p", auth: "a" },
    ];
    const { db } = makeFakeDb({ subscriptions: subs, admins: ["user-1"] });
    const sentTo: string[] = [];
    const fake: WebPushLike = {
      setVapidDetails: () => {},
      sendNotification: async (subscription) => {
        sentTo.push(subscription.endpoint);
      },
    };
    await sendPushToAdmins(db, vapid, { title: "t", body: "b" }, fake);
    expect(sentTo.sort()).toEqual(["e1", "e3"]);
  });

  it("is a no-op when vapid is null", async () => {
    const { db } = makeFakeDb({ subscriptions: [{ id: "s1", user_id: "u", endpoint: "e", p256dh: "p", auth: "a" }] });
    const fake: WebPushLike = {
      setVapidDetails: () => {
        throw new Error("should not be called");
      },
      sendNotification: async () => {
        throw new Error("should not be called");
      },
    };
    await expect(sendPushToAdmins(db, null, { title: "t", body: "b" }, fake)).resolves.toBeUndefined();
  });
});
