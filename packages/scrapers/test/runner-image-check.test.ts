import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeListing, type Listing } from "@scrapping-auta/core";
import {
  filterListingsWithLoadableImages,
  MAX_IMAGE_CHECKS_PER_SOURCE_PER_RUN,
  type DbClient,
} from "../src/runner.js";

/**
 * Minimal fake `listings` table covering exactly the call
 * `filterListingsWithLoadableImages` makes: a
 * `select("source_id, image_urls").eq("source", ...).in("source_id", ...)`
 * lookup. Thenable, like the real supabase-js query builder — see
 * runner-enrichment.test.ts for the same pattern against a different table.
 */
function makeFakeDb(existingRows: { source_id: string; image_urls: string[] }[]) {
  function from(table: string) {
    if (table !== "listings") throw new Error(`unexpected table in test fake: ${table}`);
    const obj = {
      _idsFilter: undefined as string[] | undefined,
      select() {
        return obj;
      },
      eq() {
        return obj;
      },
      in(col: string, vals: unknown[]) {
        if (col === "source_id") obj._idsFilter = vals as string[];
        return obj;
      },
      then(resolve: (v: { data: unknown; error: null }) => void) {
        const matched = existingRows.filter(
          (r) => obj._idsFilter == null || obj._idsFilter.includes(r.source_id)
        );
        resolve({ data: matched, error: null });
      },
    };
    return obj;
  }
  return { from } as unknown as DbClient;
}

function listing(overrides: Partial<Parameters<typeof normalizeListing>[0]> = {}): Listing {
  return normalizeListing(
    {
      sourceId: overrides.sourceId ?? "1",
      url: overrides.url ?? "https://example.com/1",
      title: "Škoda Octavia",
      make: "Skoda",
      model: "Octavia",
      year: 2018,
      mileageKm: 90000,
      price: 350000,
      currency: "CZK",
      imageUrls: overrides.imageUrls ?? ["https://example.com/1.jpg"],
      ...overrides,
    },
    { source: "sauto" }
  );
}

function okImageFetch() {
  return vi
    .fn()
    .mockResolvedValue({ status: 200, ok: true, headers: { get: () => "image/jpeg" } }) as unknown as typeof fetch;
}

function brokenImageFetch() {
  return vi
    .fn()
    .mockResolvedValue({ status: 404, ok: false, headers: { get: () => null } }) as unknown as typeof fetch;
}

describe("filterListingsWithLoadableImages", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("drops a listing with no image URLs at all, without any network call", async () => {
    global.fetch = vi.fn() as unknown as typeof fetch;
    const l = listing({ imageUrls: [] });
    const result = await filterListingsWithLoadableImages(null, "sauto", [l]);
    expect(result).toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("dry-run (db=null): checks every listing as 'new' and keeps only ones with a loadable image", async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      const ok = url.includes("good");
      return Promise.resolve({ status: ok ? 200 : 404, ok, headers: { get: () => (ok ? "image/jpeg" : null) } });
    }) as unknown as typeof fetch;

    const good = listing({ sourceId: "1", imageUrls: ["https://example.com/good.jpg"] });
    const bad = listing({ sourceId: "2", imageUrls: ["https://example.com/bad.jpg"] });
    const result = await filterListingsWithLoadableImages(null, "sauto", [good, bad]);
    expect(result.map((l) => l.sourceId)).toEqual(["1"]);
  });

  it("a brand-new listing (not in DB) gets checked, and is dropped if its image doesn't load", async () => {
    global.fetch = brokenImageFetch();
    const db = makeFakeDb([]); // nothing in DB yet
    const l = listing({ sourceId: "new-1" });
    const result = await filterListingsWithLoadableImages(db, "sauto", [l]);
    expect(result).toEqual([]);
  });

  it("a brand-new listing with a loadable image is kept", async () => {
    global.fetch = okImageFetch();
    const db = makeFakeDb([]);
    const l = listing({ sourceId: "new-1" });
    const result = await filterListingsWithLoadableImages(db, "sauto", [l]);
    expect(result).toHaveLength(1);
  });

  it("an existing listing with UNCHANGED image_urls is never re-checked (kept without a network call)", async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    const l = listing({ sourceId: "existing-1", imageUrls: ["https://example.com/same.jpg"] });
    const db = makeFakeDb([{ source_id: "existing-1", image_urls: ["https://example.com/same.jpg"] }]);
    const result = await filterListingsWithLoadableImages(db, "sauto", [l]);
    expect(result).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("an existing listing whose image_urls CHANGED is re-checked, and dropped if the new image fails", async () => {
    global.fetch = brokenImageFetch();
    const l = listing({ sourceId: "existing-1", imageUrls: ["https://example.com/new-photo.jpg"] });
    const db = makeFakeDb([{ source_id: "existing-1", image_urls: ["https://example.com/old-photo.jpg"] }]);
    const result = await filterListingsWithLoadableImages(db, "sauto", [l]);
    expect(result).toEqual([]);
  });

  it("checks up to the per-run cap and drops every one that fails", async () => {
    global.fetch = brokenImageFetch();
    const listings = Array.from({ length: MAX_IMAGE_CHECKS_PER_SOURCE_PER_RUN }, (_, i) =>
      listing({ sourceId: `new-${i}`, imageUrls: [`https://example.com/${i}.jpg`] })
    );
    const db = makeFakeDb([]);
    const result = await filterListingsWithLoadableImages(db, "sauto", listings);
    expect(result).toEqual([]);
  });

  it("fails open past the cap: listings beyond MAX_IMAGE_CHECKS_PER_SOURCE_PER_RUN are kept unchecked", async () => {
    const fetchMock = brokenImageFetch();
    global.fetch = fetchMock;
    // Every one of these is "new" (not in the fake DB) so every one "needs"
    // a check -- but only the cap's worth should actually hit the network.
    // Every check that DOES run fails (brokenImageFetch), so if the cap
    // weren't applied, every listing would be dropped; finding survivors
    // proves the cap kept the overflow un-checked instead.
    const overCapBy = 10;
    const listings = Array.from({ length: MAX_IMAGE_CHECKS_PER_SOURCE_PER_RUN + overCapBy }, (_, i) =>
      listing({ sourceId: `new-${i}`, imageUrls: [`https://example.com/${i}.jpg`] })
    );
    const db = makeFakeDb([]);
    const result = await filterListingsWithLoadableImages(db, "sauto", listings);
    expect(result).toHaveLength(overCapBy);
    // Exactly the cap's worth of checks actually hit the network (one GET
    // per check here, since a plain 404 doesn't trigger the HEAD fallback).
    expect(fetchMock).toHaveBeenCalledTimes(MAX_IMAGE_CHECKS_PER_SOURCE_PER_RUN);
  });
});
