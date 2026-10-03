"use client";

import { useEffect, useState } from "react";
import { Bell, BellOff } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  getPushSubscriptionStatus,
  isIos,
  isStandalone,
  subscribeToPush,
  unsubscribeFromPush,
  type PushSubscriptionStatus,
} from "@/lib/push";

/**
 * "Notifikace" toggle: subscribes/unsubscribes this browser/device to Web
 * Push (see lib/push.ts + public/sw.js's `push`/`notificationclick`
 * handlers). On iOS, push only works once the app is added to the home
 * screen (iOS 16.4+) — shown as a hint rather than blocking the button,
 * since detecting that precisely isn't reliable everywhere.
 */
export function NotificationsToggle() {
  const [status, setStatus] = useState<PushSubscriptionStatus>("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getPushSubscriptionStatus().then(setStatus);
  }, []);

  async function toggle() {
    const supabase = createSupabaseBrowserClient();
    if (!supabase || busy) return;
    setBusy(true);
    setError(null);
    if (status === "subscribed") {
      const res = await unsubscribeFromPush(supabase);
      setStatus(res.ok ? "unsubscribed" : status);
      if (!res.ok) setError(res.error ?? "Nepodařilo se vypnout notifikace.");
    } else {
      const res = await subscribeToPush(supabase);
      if (res.ok) {
        setStatus("subscribed");
      } else {
        setError(res.error ?? "Nepodařilo se zapnout notifikace.");
      }
    }
    setBusy(false);
  }

  if (status === "unsupported") {
    return (
      <p className="text-sm text-gray-500">
        Push notifikace nejsou v tomto prohlížeči podporované.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={toggle}
        disabled={busy || status === "loading"}
        className="btn-secondary inline-flex items-center gap-2"
      >
        {status === "subscribed" ? (
          <BellOff className="h-4 w-4" aria-hidden />
        ) : (
          <Bell className="h-4 w-4" aria-hidden />
        )}
        {status === "subscribed" ? "Vypnout notifikace" : "Zapnout notifikace"}
      </button>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {isIos() && !isStandalone() && (
        <p className="text-xs text-gray-500">
          Na iPhonu/iPadu fungují notifikace jen po přidání appky na plochu (Sdílet → Přidat na
          plochu).
        </p>
      )}
    </div>
  );
}
