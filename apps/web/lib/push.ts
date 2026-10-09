/**
 * Web Push (VAPID) client helpers: subscribe/unsubscribe via PushManager and
 * store/remove the subscription in `public.push_subscriptions` (RLS: users
 * manage their own rows — see supabase/migrations/20261003000200_web_push.sql).
 *
 * The VAPID *public* key is, by design, safe to ship in client code (it's
 * only used by the browser to verify push messages really come from this
 * app's server — the private key never leaves the DB's app_secrets table,
 * read only by the scraper runner via the service-role key). See the task's
 * final report for both keys.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@scrapping-auta/core";

export const VAPID_PUBLIC_KEY =
  "BAP3T_HkjRonP2Bx5RY8WCQOSMxnecfX0EKQcX_27JsbNqazMHqFDCgO9GMfIBBUvwhwjHL70T1vAkPN2exJO3w";

/** How long we'll wait for `navigator.serviceWorker.ready` before giving up
 * with a clear error instead of hanging forever (e.g. the SW failed to
 * register/activate, or this load happened before registration finished). */
const SERVICE_WORKER_READY_TIMEOUT_MS = 8000;

type SupabaseBrowserClient = SupabaseClient<Database>;

export type PushSubscriptionStatus = "loading" | "subscribed" | "unsubscribed" | "unsupported";

export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/** Pure byte comparison, exported for testing `applicationServerKeyMatches`
 * without needing a real `PushSubscription`. */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function pushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window;
}

/** True on iOS/iPadOS Safari — push there only works once the app is added
 * to the home screen (iOS 16.4+), never in a regular Safari tab. */
export function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

/** True when the app is running as an installed PWA (standalone display mode). */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const navStandalone = (navigator as unknown as { standalone?: boolean }).standalone;
  return window.matchMedia("(display-mode: standalone)").matches || navStandalone === true;
}

/** True if `subscription` was created with the current `VAPID_PUBLIC_KEY`.
 * A mismatch means a previous VAPID key pair is baked into this browser's
 * subscription (e.g. the key was rotated, or this is leftover local state
 * from development) — pushes signed with the *current* private key will be
 * rejected by the push service for that subscription. Returns true (don't
 * force a resubscribe) if the browser doesn't expose `options` at all. */
export function applicationServerKeyMatches(subscription: PushSubscription): boolean {
  const key = subscription.options?.applicationServerKey;
  if (!key) return true;
  return bytesEqual(new Uint8Array(key), urlBase64ToUint8Array(VAPID_PUBLIC_KEY));
}

function withTimeout<T>(promise: Promise<T>, ms: number, timeoutMessage: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(timeoutMessage)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

/** Short, human label for a user agent string, e.g. "Safari na iPhone" —
 * shown after subscribing so the person can tell which device just
 * registered (see notifications-toggle.tsx). Deliberately coarse (just
 * enough to tell devices apart), not a real UA parser. */
export function shortUserAgent(ua: string): string {
  const browser = /edg\//i.test(ua)
    ? "Edge"
    : /crios/i.test(ua)
      ? "Chrome"
      : /fxios/i.test(ua)
        ? "Firefox"
        : /chrome/i.test(ua)
          ? "Chrome"
          : /firefox/i.test(ua)
            ? "Firefox"
            : /safari/i.test(ua)
              ? "Safari"
              : "Prohlížeč";
  const os = /iphone/i.test(ua)
    ? "iPhone"
    : /ipad/i.test(ua)
      ? "iPad"
      : /android/i.test(ua)
        ? "Android"
        : /mac os/i.test(ua)
          ? "Mac"
          : /windows/i.test(ua)
            ? "Windows"
            : /linux/i.test(ua)
              ? "Linux"
              : "";
  return os ? `${browser} na ${os}` : browser;
}

/** Reads the current subscription state without prompting for anything. */
export async function getPushSubscriptionStatus(): Promise<PushSubscriptionStatus> {
  if (!pushSupported()) return "unsupported";
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    return subscription ? "subscribed" : "unsubscribed";
  } catch {
    return "unsupported";
  }
}

async function upsertSubscription(
  supabase: SupabaseBrowserClient,
  userId: string,
  subscription: PushSubscription
): Promise<PushActionResult> {
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) {
    return { ok: false, error: "Neplatné přihlášení k odběru." };
  }
  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      user_id: userId,
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
      user_agent: navigator.userAgent,
    },
    { onConflict: "endpoint" }
  );
  if (error) return { ok: false, error: `Nepodařilo se uložit odběr do databáze: ${error.message}` };
  return { ok: true };
}

export interface PushActionResult {
  ok: boolean;
  error?: string;
}

/**
 * On page load: if the browser already holds a PushManager subscription for
 * this app, (re)upsert it into `push_subscriptions` — idempotent, keyed on
 * the unique `endpoint` column. This is the fix for the toggle showing
 * "subscribed" forever while the DB has zero rows: `getPushSubscriptionStatus`
 * only ever looked at the browser, so a failed/lost upsert (or a row deleted
 * server-side after a 404/410) was never retried. If the existing
 * subscription was made with an old/rotated VAPID key, it's dropped and
 * recreated with the current one first.
 *
 * Resubscribing here happens without a user gesture (this runs from a
 * `useEffect`, not a click), which iOS Safari can refuse even though
 * permission was already granted. That failure is caught and reported back
 * as `unsubscribed` with an explanatory error — the toggle button then lets
 * the person resubscribe by hand, which *is* a gesture.
 */
export async function syncPushSubscription(
  supabase: SupabaseBrowserClient
): Promise<{ status: PushSubscriptionStatus; error?: string }> {
  if (!pushSupported()) return { status: "unsupported" };

  let registration: ServiceWorkerRegistration | undefined;
  try {
    registration = await navigator.serviceWorker.getRegistration();
  } catch (err) {
    return { status: "unsupported", error: (err as Error).message };
  }
  if (!registration) return { status: "unsubscribed" };

  let subscription: PushSubscription | null;
  try {
    subscription = await registration.pushManager.getSubscription();
  } catch (err) {
    return { status: "unsubscribed", error: (err as Error).message };
  }
  if (!subscription) return { status: "unsubscribed" };

  if (!applicationServerKeyMatches(subscription)) {
    try {
      await subscription.unsubscribe();
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
      });
    } catch (err) {
      return {
        status: "unsubscribed",
        error: `Starý klíč pro notifikace už neplatí a nepodařilo se ho automaticky obnovit (${(err as Error).message}). Zkus zapnout notifikace znovu tlačítkem.`,
      };
    }
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: "subscribed" };

  const result = await upsertSubscription(supabase, user.id, subscription);
  if (!result.ok) return { status: "subscribed", error: result.error };
  return { status: "subscribed" };
}

/**
 * Requests Notification permission, subscribes via PushManager, and stores
 * the subscription in `push_subscriptions`.
 *
 * Order matters on iOS Safari: `Notification.requestPermission()` and
 * `PushManager.subscribe()` both need to ride the same user-gesture
 * "activation" from the click that triggered this call, and that activation
 * can be consumed/expire if something slow (like a network round trip)
 * happens in between. So `subscribe()` is called as soon as possible after
 * permission is granted — the slower Supabase work (reading the signed-in
 * user, upserting the row) happens only afterwards, once the subscription
 * itself is safely created.
 */
export async function subscribeToPush(supabase: SupabaseBrowserClient): Promise<PushActionResult> {
  if (!pushSupported()) return { ok: false, error: "Push notifikace nejsou v tomto prohlížeči podporované." };

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return { ok: false, error: "Povolení pro notifikace nebylo uděleno." };
  }

  let registration: ServiceWorkerRegistration;
  try {
    registration = await withTimeout(
      navigator.serviceWorker.ready,
      SERVICE_WORKER_READY_TIMEOUT_MS,
      "Service worker není aktivní, obnov stránku."
    );
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }

  let subscription: PushSubscription;
  try {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
    });
  } catch (err) {
    return { ok: false, error: `Přihlášení k odběru selhalo: ${(err as Error).message}` };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Nejste přihlášeni." };

  return upsertSubscription(supabase, user.id, subscription);
}

/** Unsubscribes from PushManager and removes the stored subscription row. */
export async function unsubscribeFromPush(supabase: SupabaseBrowserClient): Promise<PushActionResult> {
  if (!pushSupported()) return { ok: true };
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    if (subscription) {
      await supabase.from("push_subscriptions").delete().eq("endpoint", subscription.endpoint);
      await subscription.unsubscribe();
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** Number of push subscription rows stored for the signed-in user — shown in
 * the toggle as a sanity check that a subscribe actually reached the
 * database (see task: production DB had zero rows while the toggle claimed
 * "subscribed"). Returns null if there's no session or the read fails. */
export async function countUserPushSubscriptions(supabase: SupabaseBrowserClient): Promise<number | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { count, error } = await supabase
    .from("push_subscriptions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id);
  if (error) return null;
  return count ?? 0;
}
