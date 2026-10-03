/**
 * Web Push notifications (VAPID), via the `web-push` npm package.
 *
 * VAPID keys are intentionally NOT an env var — the GitHub Actions job's
 * secret set is fixed (see README/task) and no new secrets may be added —
 * so they're read from `public.app_secrets` (a service-role-only table, see
 * supabase/migrations/20261003000200_web_push.sql) once per run and reused
 * for every push send in that run. If that table has no VAPID keys
 * configured yet, push is skipped silently everywhere (one log line, same
 * "missing config = no-op" shape as the e-mail notifier).
 */
import webpush from "web-push";
import type { DbClient } from "./db.js";

export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

export interface PushPayload {
  title: string;
  body: string;
  /** Opened (focused/navigated to) on notificationclick — see public/sw.js. */
  url?: string;
}

export interface PushSubscriptionRow {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** Minimal surface of the `web-push` package this module depends on — lets
 * tests inject a fake instead of hitting the network / doing real VAPID
 * crypto (see test/push.test.ts). */
export interface WebPushLike {
  setVapidDetails(subject: string, publicKey: string, privateKey: string): void;
  sendNotification(
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    payload: string
  ): Promise<unknown>;
}

/** Reads VAPID keys from `app_secrets`. Returns null (push disabled for this
 * run, one log line) if any of the three required keys is missing — e.g.
 * before the operator has run the one-time `insert into app_secrets ...`
 * (see README "Web Push"). */
export async function getVapidConfig(db: DbClient): Promise<VapidConfig | null> {
  const { data, error } = await db
    .from("app_secrets")
    .select("key, value")
    .in("key", ["vapid_public_key", "vapid_private_key", "vapid_subject"]);
  if (error) {
    console.warn("[push] failed to load app_secrets:", error.message);
    return null;
  }
  const byKey = new Map((data ?? []).map((r) => [r.key, r.value]));
  const publicKey = byKey.get("vapid_public_key");
  const privateKey = byKey.get("vapid_private_key");
  const subject = byKey.get("vapid_subject");
  if (!publicKey || !privateKey || !subject) {
    console.log("[push] app_secrets has no VAPID keys configured, skipping push silently");
    return null;
  }
  return { publicKey, privateKey, subject };
}

function isGoneStatusCode(err: unknown): boolean {
  const statusCode = (err as { statusCode?: number } | null | undefined)?.statusCode;
  return statusCode === 404 || statusCode === 410;
}

/** Sends one push notification to one subscription row. A 404/410 response
 * means the subscription is dead (unsubscribed, browser data cleared,
 * uninstalled, ...) — the row is deleted so it's never retried again. Any
 * other failure is logged and swallowed: a bad push must never abort the
 * run. Returns true on a successful send. */
export async function sendPushToSubscription(
  db: DbClient,
  subscription: PushSubscriptionRow,
  payload: PushPayload,
  webpushImpl: WebPushLike = webpush
): Promise<boolean> {
  try {
    await webpushImpl.sendNotification(
      { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
      JSON.stringify(payload)
    );
    return true;
  } catch (err) {
    if (isGoneStatusCode(err)) {
      const { error } = await db.from("push_subscriptions").delete().eq("id", subscription.id);
      if (error) {
        console.warn(`[push] failed to remove dead subscription ${subscription.id}:`, error.message);
      } else {
        console.log(`[push] removed dead subscription ${subscription.id} (404/410)`);
      }
    } else {
      console.warn(`[push] send failed for subscription ${subscription.id}:`, (err as Error).message);
    }
    return false;
  }
}

async function loadSubscriptions(db: DbClient, userId?: string): Promise<PushSubscriptionRow[]> {
  let query = db.from("push_subscriptions").select("id, user_id, endpoint, p256dh, auth");
  if (userId) query = query.eq("user_id", userId);
  const { data, error } = await query;
  if (error) {
    console.warn("[push] failed to load subscriptions:", error.message);
    return [];
  }
  return (data ?? []) as PushSubscriptionRow[];
}

/** Sends `payload` to every subscription owned by `userId` (e.g. a new
 * match for one of their searches, or a favourite's price drop/gone). No-op
 * if push isn't configured (`vapid` is null) or the user has no
 * subscriptions registered. */
export async function sendPushToUser(
  db: DbClient,
  vapid: VapidConfig | null,
  userId: string,
  payload: PushPayload,
  webpushImpl: WebPushLike = webpush
): Promise<void> {
  if (!vapid) return;
  webpushImpl.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
  const subs = await loadSubscriptions(db, userId);
  for (const sub of subs) {
    await sendPushToSubscription(db, sub, payload, webpushImpl);
  }
}

/** Sends `payload` to every registered subscription, regardless of owner —
 * used for source health alerts, which (like the e-mail digest's single
 * NOTIFY_EMAIL_TO) aren't scoped to one particular user. */
export async function sendPushToAllUsers(
  db: DbClient,
  vapid: VapidConfig | null,
  payload: PushPayload,
  webpushImpl: WebPushLike = webpush
): Promise<void> {
  if (!vapid) return;
  webpushImpl.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
  const subs = await loadSubscriptions(db);
  for (const sub of subs) {
    await sendPushToSubscription(db, sub, payload, webpushImpl);
  }
}
