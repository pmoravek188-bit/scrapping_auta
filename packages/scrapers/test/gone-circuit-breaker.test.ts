import { describe, expect, it, vi, beforeEach } from "vitest";
import type { DbClient } from "../src/runner.js";

/**
 * Minimal fake Supabase client covering exactly the calls
 * checkGoneListings() makes: an initial `listings` select (returns the
 * candidate rows), a `favorites` existence check per confirmed-gone
 * candidate, and `listings` update/delete for the outcome. Each returned
 * "query" is a thenable object (like the real supabase-js builder), so
 * `await db.from(...).select(...)....` works the same way it does against
 * the real client.
 */
function makeFakeDb(
  listingsRows: { id: string; source_id: string; url: string }[],
  favoriteListingIds: Set<string>
) {
  const updates: { id: string; patch: Record<string, unknown> }[] = [];
  const deletes: string[] = [];

  function from(table: string) {
    if (table === "listings") {
      const obj = {
        _mode: null as "select" | "update" | "delete" | null,
        _patch: undefined as Record<string, unknown> | undefined,
        _id: undefined as string | undefined,
        select() {
          obj._mode = "select";
          return obj;
        },
        update(patch: Record<string, unknown>) {
          obj._mode = "update";
          obj._patch = patch;
          return obj;
        },
        delete() {
          obj._mode = "delete";
          return obj;
        },
        eq(_col: string, val: unknown) {
          obj._id = val as string;
          return obj;
        },
        is() {
          return obj;
        },
        then(resolve: (v: { data: unknown; error: null }) => void) {
          if (obj._mode === "update") {
            updates.push({ id: obj._id!, patch: obj._patch! });
          } else if (obj._mode === "delete") {
            deletes.push(obj._id!);
          }
          resolve({ data: obj._mode === "select" ? listingsRows : null, error: null });
        },
      };
      return obj;
    }
    if (table === "favorites") {
      const obj = {
        _listingId: undefined as string | undefined,
        select() {
          return obj;
        },
        eq(_col: string, val: unknown) {
          obj._listingId = val as string;
          return obj;
        },
        limit() {
          return obj;
        },
        then(resolve: (v: { data: unknown; error: null }) => void) {
          const has = favoriteListingIds.has(obj._listingId!);
          resolve({ data: has ? [{ user_id: "u1" }] : [], error: null });
        },
      };
      return obj;
    }
    throw new Error(`unexpected table in fake db: ${table}`);
  }

  return { fake: { from } as unknown as DbClient, updates, deletes };
}

function candidates(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `listing-${i}`,
    source_id: `src-${i}`,
    url: `https://x.test/detail/${i}`,
  }));
}

describe("checkGoneListings circuit breaker", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("skips deletions and returns a warning when the gone ratio is too high", async () => {
    const rows = candidates(10);
    // First 4 confirmed gone (404), rest alive (200) -> 4/10 = 40% > 30% threshold.
    vi.doMock("../src/http.js", async () => {
      const actual = await vi.importActual<typeof import("../src/http.js")>("../src/http.js");
      return {
        ...actual,
        fetchForGoneCheck: vi.fn(async (url: string) => {
          const i = Number(url.split("/").pop());
          return i < 4
            ? { status: 404, finalUrl: url, html: "" }
            : { status: 200, finalUrl: url, html: "<html>alive</html>" };
        }),
      };
    });
    const { checkGoneListings } = await import("../src/runner.js");
    const { fake, updates, deletes } = makeFakeDb(rows, new Set());

    const warning = await checkGoneListings(fake, "test-source", new Set());

    expect(warning).toContain("suspicious gone ratio");
    expect(warning).toContain("4/10");
    expect(updates).toHaveLength(0);
    expect(deletes).toHaveLength(0);
  });

  it("proceeds with deletions when the gone ratio is within bounds", async () => {
    const rows = candidates(10);
    // Only 2/10 = 20% gone -> below the 30% threshold, proceeds normally.
    vi.doMock("../src/http.js", async () => {
      const actual = await vi.importActual<typeof import("../src/http.js")>("../src/http.js");
      return {
        ...actual,
        fetchForGoneCheck: vi.fn(async (url: string) => {
          const i = Number(url.split("/").pop());
          return i < 2
            ? { status: 404, finalUrl: url, html: "" }
            : { status: 200, finalUrl: url, html: "<html>alive</html>" };
        }),
      };
    });
    const { checkGoneListings } = await import("../src/runner.js");
    const { fake, updates, deletes } = makeFakeDb(rows, new Set());

    const warning = await checkGoneListings(fake, "test-source", new Set());

    expect(warning).toBeNull();
    expect(deletes).toEqual(["listing-0", "listing-1"]);
    expect(updates).toHaveLength(0);
  });

  it("keeps (deactivates) a confirmed-gone favourited listing instead of deleting it", async () => {
    const rows = candidates(10);
    vi.doMock("../src/http.js", async () => {
      const actual = await vi.importActual<typeof import("../src/http.js")>("../src/http.js");
      return {
        ...actual,
        fetchForGoneCheck: vi.fn(async (url: string) => {
          const i = Number(url.split("/").pop());
          return i === 0
            ? { status: 404, finalUrl: url, html: "" }
            : { status: 200, finalUrl: url, html: "<html>alive</html>" };
        }),
      };
    });
    const { checkGoneListings } = await import("../src/runner.js");
    const { fake, updates, deletes } = makeFakeDb(rows, new Set(["listing-0"]));

    const warning = await checkGoneListings(fake, "test-source", new Set());

    expect(warning).toBeNull();
    expect(deletes).toEqual([]);
    expect(updates).toEqual([
      { id: "listing-0", patch: expect.objectContaining({ is_active: false }) },
    ]);
  });

  it("does not trip the breaker below the minimum-checked floor, even at a 100% gone ratio", async () => {
    const rows = candidates(3);
    vi.doMock("../src/http.js", async () => {
      const actual = await vi.importActual<typeof import("../src/http.js")>("../src/http.js");
      return {
        ...actual,
        fetchForGoneCheck: vi.fn(async (url: string) => ({ status: 404, finalUrl: url, html: "" })),
      };
    });
    const { checkGoneListings } = await import("../src/runner.js");
    const { fake, deletes } = makeFakeDb(rows, new Set());

    const warning = await checkGoneListings(fake, "test-source", new Set());

    expect(warning).toBeNull();
    expect(deletes).toHaveLength(3);
  });

  it("trips at the absolute cap of 20+ confirmed-gone in one run", async () => {
    // MAX_GONE_CHECKS_PER_SOURCE caps a single run at 50 checks, so the
    // absolute-count guard (>=20 gone) can't be exercised in isolation from
    // the ratio guard within one run's cap (20/50 = 40%, already over the
    // 30% ratio threshold too) — both fire together here, which is fine:
    // the point is that a batch this bad never reaches the delete/update
    // calls below, for whichever reason.
    const rows = candidates(50);
    vi.doMock("../src/http.js", async () => {
      const actual = await vi.importActual<typeof import("../src/http.js")>("../src/http.js");
      return {
        ...actual,
        fetchForGoneCheck: vi.fn(async (url: string) => {
          const i = Number(url.split("/").pop());
          return i < 20
            ? { status: 404, finalUrl: url, html: "" }
            : { status: 200, finalUrl: url, html: "<html>alive</html>" };
        }),
      };
    });
    const { checkGoneListings } = await import("../src/runner.js");
    const { fake, updates, deletes } = makeFakeDb(rows, new Set());

    const warning = await checkGoneListings(fake, "test-source", new Set());

    expect(warning).toContain("suspicious gone ratio");
    expect(updates).toHaveLength(0);
    expect(deletes).toHaveLength(0);
  });
});
