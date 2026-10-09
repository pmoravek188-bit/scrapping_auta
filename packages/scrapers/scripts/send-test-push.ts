#!/usr/bin/env tsx
/**
 * Manual verification tool for Web Push (see src/push.ts, README "Web
 * Push"): sends one test notification to every subscription a given user
 * has registered. NOT wired into CI, NOT imported by any other module —
 * run it by hand after fixing/checking push to confirm a device actually
 * receives something, without waiting for a real scrape run to find a
 * match.
 *
 * Two ways to run it:
 *
 * 1. Against the real DB (reads VAPID keys from `app_secrets` and the
 *    user's rows from `push_subscriptions`, same as the runner):
 *
 *      SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *        pnpm send-test-push -- <user-id>
 *
 * 2. Fully offline/no DB (bypasses Supabase entirely — useful for testing
 *    one subscription you already have, e.g. copy-pasted from a browser's
 *    devtools, without touching the database at all):
 *
 *      VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT='mailto:you@example.com' \
 *        SUBSCRIPTION_JSON='{"endpoint":"...","keys":{"p256dh":"...","auth":"..."}}' \
 *        pnpm send-test-push
 *
 * Either way, the test notification uses the same payload shape the runner
 * sends in production ({title, body, url} — see PushPayload in src/push.ts
 * and the `push` handler in apps/web/public/sw.js), so a successful run
 * here means the full chain (payload shape, SW handler, OS notification)
 * is exercised, not just the network call.
 */
import webpush from "web-push";
import { createSupabaseClient } from "../src/db.js";
import { getVapidConfig, sendPushToUser, type PushPayload, type VapidConfig } from "../src/push.js";

const TEST_PAYLOAD: PushPayload = {
  title: "Scrapping cars – testovací notifikace",
  body: "Pokud tohle vidíš, push notifikace fungují až do tvého zařízení.",
  url: "/sources",
};

async function sendViaDirectSubscription(): Promise<void> {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  const subscriptionJson = process.env.SUBSCRIPTION_JSON;
  if (!publicKey || !privateKey || !subject || !subscriptionJson) {
    throw new Error(
      "Missing env vars. Set either (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY) with a user id argument, " +
        "or (VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY + VAPID_SUBJECT + SUBSCRIPTION_JSON) to send directly. See this file's header comment."
    );
  }
  const subscription = JSON.parse(subscriptionJson) as { endpoint: string; keys: { p256dh: string; auth: string } };
  webpush.setVapidDetails(subject, publicKey, privateKey);
  await webpush.sendNotification(subscription, JSON.stringify(TEST_PAYLOAD));
  console.log(`[send-test-push] sent directly to endpoint ${subscription.endpoint}`);
}

async function sendViaDb(userId: string): Promise<void> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set to send via the database.");
  }
  const db = createSupabaseClient(supabaseUrl, serviceRoleKey);

  const vapid: VapidConfig | null = await getVapidConfig(db);
  if (!vapid) {
    throw new Error(
      "No VAPID keys found in app_secrets (vapid_public_key/vapid_private_key/vapid_subject) — " +
        "see README 'Web Push' for the one-time insert."
    );
  }

  const { count, error } = await db
    .from("push_subscriptions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  if (error) throw new Error(`Failed to read push_subscriptions for user ${userId}: ${error.message}`);
  if (!count) {
    console.warn(
      `[send-test-push] user ${userId} has 0 rows in push_subscriptions — nothing will be sent. ` +
        "Open /sources in the app and turn on notifications first."
    );
    return;
  }

  console.log(`[send-test-push] sending to ${count} subscription(s) for user ${userId}...`);
  await sendPushToUser(db, vapid, userId, TEST_PAYLOAD);
  console.log("[send-test-push] done (any dead 404/410 subscriptions were removed, same as a real run).");
}

async function main() {
  const userId = process.argv[2];
  if (process.env.SUBSCRIPTION_JSON) {
    await sendViaDirectSubscription();
    return;
  }
  if (!userId) {
    throw new Error("Usage: pnpm send-test-push -- <user-id>  (or set SUBSCRIPTION_JSON for the no-DB mode)");
  }
  await sendViaDb(userId);
}

main().catch((err) => {
  console.error(`[send-test-push] failed: ${(err as Error).message}`);
  process.exitCode = 1;
});
