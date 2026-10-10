/**
 * Favourites alerts: notify a favourite's owner when it either drops in
 * price or becomes gone (sold/removed from its source) — see
 * supabase/migrations/20261003000100_favorites_notify_tracking.sql and
 * .../20261010000000_real_price_changes.sql for the tracking columns this
 * relies on:
 *
 *   - `favorites.last_notified_price_orig`: the ORIGINAL-currency price
 *     (`listings.price_orig`) this favourite was last notified about (or
 *     just seen at, if never notified). This — NOT the CZK price — is what
 *     the drop/rise decision is actually made on: for a EUR-priced listing
 *     (autoscout24/carvago/autobazar), price_czk gets re-derived from the
 *     day's EUR/CZK rate on every run even when the seller never touched
 *     the price (see packages/core/src/price-changes.ts's doc comment for
 *     the full story) — comparing price_czk directly would false-alert on
 *     pure FX wobble. Comparing price_orig is immune to that entirely,
 *     since it's in the same currency the seller actually set. For a
 *     CZK-native listing, price_orig IS price_czk, so this is exactly the
 *     old CZK-based behaviour.
 *     A fresh favourite has this null — it's seeded to the current
 *     price_orig on first sight WITHOUT alerting (nothing to compare yet).
 *     After that, a current price_orig strictly below this value is a drop
 *     (alert + update to the new, lower value, so the same drop never
 *     re-alerts); strictly above it just updates the tracked value (no
 *     alert) so a later drop is measured from the most recent known price,
 *     not the price at the moment it was favourited.
 *   - `favorites.last_notified_price`: the CZK price at the same moment —
 *     kept only for display (the push/e-mail still shows Kč amounts) and as
 *     a fallback for the rare row where `price_orig` is unexpectedly null.
 *   - `favorites.last_notified_gone_at`: set once a gone listing has been
 *     alerted on. Reset to null if the listing is active again (so a later
 *     re-confirmed "gone" can alert again) — a listing's `gone_at` itself is
 *     already only set once by checkGoneListings() (see runner.ts), so this
 *     is really just "have we told the user about THIS gone_at yet".
 */
import webpush from "web-push";
import type { DbClient } from "./db.js";
import { sendPushToUser, type VapidConfig, type WebPushLike } from "./push.js";
import type { NotifyFavoriteChange } from "./notify/email.js";

interface FavoriteRow {
  user_id: string;
  listing_id: string;
  last_notified_price: number | null;
  last_notified_price_orig: number | null;
  last_notified_gone_at: string | null;
  listings: {
    id: string;
    title: string;
    url: string;
    source: string;
    price_czk: number | null;
    price_orig: number | null;
    currency_orig: string | null;
    year: number | null;
    mileage_km: number | null;
    fuel: string | null;
    image_urls: string[];
    gone_at: string | null;
  } | null;
}

export interface FavoriteChangeEvent {
  userId: string;
  change: NotifyFavoriteChange;
}

/**
 * Scans every favourite for a price drop or a newly-gone listing, updates
 * the tracking columns accordingly, and returns the events worth notifying
 * about (for the caller to push + include in the e-mail digest). Never
 * throws on a per-row DB write failure — logs and moves on, same philosophy
 * as the rest of the runner.
 */
export async function checkFavoritesAlerts(db: DbClient): Promise<FavoriteChangeEvent[]> {
  const { data, error } = await db
    .from("favorites")
    .select("user_id, listing_id, last_notified_price, last_notified_price_orig, last_notified_gone_at, listings(*)");
  if (error) {
    console.warn("[favorites-alert] failed to load favorites:", error.message);
    return [];
  }

  const rows = (data ?? []) as unknown as FavoriteRow[];
  const events: FavoriteChangeEvent[] = [];

  for (const row of rows) {
    const listing = row.listings;
    if (!listing) continue;

    const patch: {
      last_notified_price?: number | null;
      last_notified_price_orig?: number | null;
      last_notified_gone_at?: string | null;
    } = {};

    // --- gone detection ---
    if (listing.gone_at != null && row.last_notified_gone_at == null) {
      events.push({
        userId: row.user_id,
        change: {
          kind: "gone",
          title: listing.title,
          url: listing.url,
          source: listing.source,
          priceCzk: listing.price_czk,
          previousPriceCzk: null,
          year: listing.year,
          mileageKm: listing.mileage_km,
          fuel: listing.fuel,
          imageUrl: listing.image_urls?.[0] ?? null,
        },
      });
      patch.last_notified_gone_at = new Date().toISOString();
    } else if (listing.gone_at == null && row.last_notified_gone_at != null) {
      // Came back active again — clear so a future gone_at can alert again.
      patch.last_notified_gone_at = null;
    }

    // --- price drop detection ---
    // Decided on the ORIGINAL-currency price (immune to EUR/CZK conversion
    // noise) whenever we have one; a listing with no price_orig at all
    // (shouldn't normally happen — normalize.ts always sets it — but
    // handled defensively) falls back to the old CZK-based comparison.
    const currentOrig = listing.price_orig;
    if (currentOrig != null) {
      if (row.last_notified_price_orig == null) {
        // Seed only, no alert — nothing to compare against yet.
        patch.last_notified_price_orig = currentOrig;
        patch.last_notified_price = listing.price_czk;
      } else if (currentOrig < row.last_notified_price_orig) {
        events.push({
          userId: row.user_id,
          change: {
            kind: "price_drop",
            title: listing.title,
            url: listing.url,
            source: listing.source,
            priceCzk: listing.price_czk,
            previousPriceCzk: row.last_notified_price,
            year: listing.year,
            mileageKm: listing.mileage_km,
            fuel: listing.fuel,
            imageUrl: listing.image_urls?.[0] ?? null,
          },
        });
        patch.last_notified_price_orig = currentOrig;
        patch.last_notified_price = listing.price_czk;
      } else if (currentOrig > row.last_notified_price_orig) {
        // Track the latest value (including the CZK figure, purely for
        // display) — no alert for a rise.
        patch.last_notified_price_orig = currentOrig;
        patch.last_notified_price = listing.price_czk;
      }
    } else if (listing.price_czk != null) {
      if (row.last_notified_price == null) {
        patch.last_notified_price = listing.price_czk; // seed only, no alert
      } else if (listing.price_czk < row.last_notified_price) {
        events.push({
          userId: row.user_id,
          change: {
            kind: "price_drop",
            title: listing.title,
            url: listing.url,
            source: listing.source,
            priceCzk: listing.price_czk,
            previousPriceCzk: row.last_notified_price,
            year: listing.year,
            mileageKm: listing.mileage_km,
            fuel: listing.fuel,
            imageUrl: listing.image_urls?.[0] ?? null,
          },
        });
        patch.last_notified_price = listing.price_czk;
      } else if (listing.price_czk > row.last_notified_price) {
        patch.last_notified_price = listing.price_czk; // track latest, no alert
      }
    }

    if (Object.keys(patch).length > 0) {
      const { error: updateError } = await db
        .from("favorites")
        .update(patch)
        .eq("user_id", row.user_id)
        .eq("listing_id", row.listing_id);
      if (updateError) {
        console.warn(
          `[favorites-alert] failed to update tracking for ${row.user_id}/${row.listing_id}:`,
          updateError.message
        );
      }
    }
  }

  if (events.length > 0) {
    console.log(`[favorites-alert] ${events.length} favourite change(s) to notify`);
  }
  return events;
}

/** Sends one push notification per favourites-change event to its owner.
 * `webpushImpl` is injectable for tests (see test/favorites-alert.test.ts) —
 * defaults to the real `web-push` package. */
export async function sendFavoritesAlertPush(
  db: DbClient,
  vapid: VapidConfig | null,
  events: FavoriteChangeEvent[],
  webpushImpl: WebPushLike = webpush
): Promise<void> {
  for (const { userId, change } of events) {
    const title =
      change.kind === "gone" ? `Prodáno/nedostupné: ${change.title}` : `Zlevnění: ${change.title}`;
    const body =
      change.kind === "gone"
        ? "Inzerát zmizel ze zdroje."
        : `${change.priceCzk?.toLocaleString("cs-CZ") ?? "?"} Kč (dřív ${change.previousPriceCzk?.toLocaleString("cs-CZ") ?? "?"} Kč)`;
    try {
      await sendPushToUser(db, vapid, userId, { title, body, url: "/favorites" }, webpushImpl);
    } catch (err) {
      console.warn(`[favorites-alert] push failed for user ${userId}:`, (err as Error).message);
    }
  }
}
