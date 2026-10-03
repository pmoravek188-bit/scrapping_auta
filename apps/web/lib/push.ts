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

type SupabaseBrowserClient = SupabaseClient<Database>;

export type PushSubscriptionStatus = "loading" | "subscribed" | "unsubscribed" | "unsupported";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
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

export interface PushActionResult {
  ok: boolean;
  error?: string;
}

/** Requests Notification permission, subscribes via PushManager, and stores
 * the subscription in `push_subscriptions`. */
export async function subscribeToPush(supabase: SupabaseBrowserClient): Promise<PushActionResult> {
  if (!pushSupported()) return { ok: false, error: "Push notifikace nejsou v tomto prohlížeči podporované." };

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return { ok: false, error: "Povolení pro notifikace nebylo uděleno." };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Nejste přihlášeni." };

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
    });
    const json = subscription.toJSON();
    if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) {
      return { ok: false, error: "Neplatné přihlášení k odběru." };
    }

    const { error } = await supabase.from("push_subscriptions").upsert(
      {
        user_id: user.id,
        endpoint: json.endpoint,
        p256dh: json.keys.p256dh,
        auth: json.keys.auth,
        user_agent: navigator.userAgent,
      },
      { onConflict: "endpoint" }
    );
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
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
