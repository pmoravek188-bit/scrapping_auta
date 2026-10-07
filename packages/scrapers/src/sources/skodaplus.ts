/**
 * Škoda Plus (skodaplus.cz) adapter — VERIFIED live 2026-09-28.
 *
 * The old guess (`GET /vyhledavani?page=1`) 404s. skodaplus.cz is a
 * statically-exported Next.js app (`/list` ships with an empty
 * `__NEXT_DATA__` — no server-rendered results) that hydrates from a
 * same-origin GraphQL endpoint with NO auth required:
 *
 *   POST https://www.skodaplus.cz/graphql
 *   { "query": "query Cars($first: Int, $after: String, $filter: CarFilterInput) { cars(first: $first, after: $after, filter: $filter) { pageInfo { hasNextPage endCursor } edges { node { ... } } } }" }
 *
 * Found by noticing `GET /graphql` returns 405 (Method Not Allowed, i.e.
 * the route exists) and that introspection is enabled — confirmed live
 * with a real `cars(filter: {})` query returning real Car nodes (id,
 * prettyUrl, model, price, mileage, manufactureYear, firstRegistration,
 * fuel, transmission, enginePower, vin, color, bodyType, dealer, images).
 *
 * Detail URL: `https://www.skodaplus.cz/Car/<numericId>/<prettyUrl>`
 * (confirmed 200 — note capital `Car`; found via the site's `_buildManifest`
 * listing a `/Car/[id]/[prettyUrl]` page route, and the numeric id is the
 * GraphQL `id` field with its `Car-` prefix stripped).
 *
 * `carMakes { id name }` (confirmed live) maps brand names to the `ID`
 * values `CarFilterInput.make` expects (e.g. Škoda -> `brand_32`); fetched
 * once per process and cached, since the id numbering isn't a stable slug
 * we can hardcode reliably.
 *
 * FOLLOW-UP FIX (2026-09-28): despite the "Škoda Plus" branding this is a
 * shared VW-Group-certified-used-cars platform, NOT Škoda-only — confirmed
 * live by filtering `make: "brand_1"` (Audi) and getting real Audi A4/Q5/A3
 * results. The previous version hardcoded `make: "Škoda"` and `title` to
 * just the bare model name (e.g. "Superb") — both wrong. Fixed by querying
 * `model.carMake.name` for the real make and `modelType` (confirmed live,
 * e.g. "2.0 TDI 110 kW A7F Selection") for the variant/engine string used
 * in both `variant` and the composed `title`.
 */
import type { RawListing, SearchQuery } from "@scrapping-auta/core";
import { fetchJson, MAX_RESULT_PAGES } from "../http.js";
import type { SourceAdapter, SourceContext } from "../adapter.js";
import { guessFuel, guessTransmission } from "./_util-b.js";

const BASE_URL = "https://www.skodaplus.cz";
const GRAPHQL_URL = `${BASE_URL}/graphql`;
const PAGE_SIZE = 20;

const CARS_QUERY = `
query Cars($first: Int, $after: String, $filter: CarFilterInput) {
  cars(first: $first, after: $after, filter: $filter) {
    pageInfo { hasNextPage endCursor }
    edges {
      node {
        id
        prettyUrl
        model { modelName carMake { name } }
        modelType
        price { value }
        mileage
        manufactureYear
        firstRegistration
        fuel { value }
        transmission { value }
        enginePower
        vin
        dealer { name }
        images { normalUrl }
      }
    }
  }
}`;

const MAKES_QUERY = `query { carMakes { id name } }`;

interface GraphQlResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

interface CarsQueryData {
  cars?: {
    pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
    edges?: Array<{
      node?: {
        id?: string;
        prettyUrl?: string | null;
        model?: { modelName?: string | null; carMake?: { name?: string | null } | null } | null;
        modelType?: string | null;
        price?: { value?: number | null } | null;
        mileage?: number | null;
        manufactureYear?: number | null;
        firstRegistration?: string | null;
        fuel?: { value?: string | null } | null;
        transmission?: { value?: string | null } | null;
        enginePower?: number | null;
        vin?: string | null;
        dealer?: { name?: string | null } | null;
        images?: Array<{ normalUrl?: string | null }> | null;
      };
    }>;
  };
}

interface MakesQueryData {
  carMakes?: Array<{ id?: string; name?: string }>;
}

let makeIdCache: Map<string, string> | null = null;

async function getMakeId(make: string): Promise<string | null> {
  if (!makeIdCache) {
    makeIdCache = new Map();
    try {
      const res = await fetchJson<GraphQlResponse<MakesQueryData>>(GRAPHQL_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: MAKES_QUERY }),
      });
      for (const m of res.data?.carMakes ?? []) {
        if (m.id && m.name) makeIdCache.set(m.name.toLowerCase(), m.id);
      }
    } catch (err) {
      console.warn("[skodaplus] failed to fetch carMakes:", (err as Error).message);
    }
  }
  const key = make.toLowerCase();
  for (const [name, id] of makeIdCache) {
    if (name === key || name.includes(key) || key.includes(name)) return id;
  }
  return null;
}

function yearFromDate(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const m = /^(\d{4})/.exec(dateStr);
  return m ? Number(m[1]) : null;
}

export function parseSkodaPlusEdges(data: CarsQueryData): RawListing[] {
  const out: RawListing[] = [];
  for (const edge of data.cars?.edges ?? []) {
    const node = edge.node;
    if (!node?.id || !node.prettyUrl) continue;
    const numericId = node.id.replace(/^Car-/, "");
    const fuelText = node.fuel?.value ?? "";
    const transmissionText = node.transmission?.value ?? "";
    const make = node.model?.carMake?.name ?? null;
    const model = node.model?.modelName ?? null;
    const variant = node.modelType ?? null;

    out.push({
      sourceId: numericId,
      url: `${BASE_URL}/Car/${numericId}/${node.prettyUrl}`,
      title: [make, model, variant].filter(Boolean).join(" "),
      make,
      model,
      variant,
      year: node.manufactureYear ?? yearFromDate(node.firstRegistration),
      mileageKm: typeof node.mileage === "number" ? node.mileage : null,
      price: typeof node.price?.value === "number" ? node.price.value : null,
      currency: "CZK",
      fuel: guessFuel(fuelText),
      transmission: guessTransmission(transmissionText),
      powerKw: typeof node.enginePower === "number" ? node.enginePower : null,
      body: null,
      color: null,
      location: null,
      country: "CZ",
      sellerType: "dealer",
      vin: node.vin ?? null,
      imageUrls: (node.images ?? [])
        .map((i) => i.normalUrl)
        .filter((u): u is string => Boolean(u))
        .map((u) => (u.startsWith("http") ? u : `${BASE_URL}${u}`)),
    });
  }
  return out;
}

const CAR_DETAIL_QUERY = `
query CarDetail($id: ID!) {
  car(id: $id) {
    note
    length
    equipmentItems { name }
  }
}`;

interface CarDetailQueryData {
  car?: {
    note?: string | null;
    length?: number | null;
    equipmentItems?: Array<{ name?: string | null }> | null;
  } | null;
}

/** Parses the `car(id)` detail query response into one free-text blob: the
 * dealer's free-text `note` + every equipment item name + the structured
 * `length` (mm, when present) rendered as "<n> mm" so the shared
 * length-based "prodlouzena" fallback (core's `detectLengthBasedProdlouzena`)
 * can pick it up alongside the textual synonyms. Confirmed live (2026-09-30)
 * via GraphQL introspection: `Car.length`/`note`/`equipmentItems` are real
 * fields (`car(id: "Car-<numericId>")`); `length` was null on every sampled
 * listing so far (not populated for most cars), included anyway since the
 * schema clearly intends it as a real dimension. Exported for unit testing
 * without a live call. */
export function parseSkodaPlusDetailText(data: CarDetailQueryData): string | null {
  const car = data.car;
  if (!car) return null;
  const equipmentNames = (car.equipmentItems ?? [])
    .map((e) => e.name)
    .filter((n): n is string => Boolean(n));
  const parts = [car.note, car.length != null ? `${car.length} mm` : null, ...equipmentNames].filter(
    (p): p is string => Boolean(p)
  );
  return parts.length > 0 ? parts.join(" ") : null;
}

export const skodaplusAdapter: SourceAdapter = {
  id: "skodaplus",
  verified: true,
  async fetchDetailText(listing: { url: string; sourceId: string }): Promise<string | null> {
    try {
      const res = await fetchJson<GraphQlResponse<CarDetailQueryData>>(GRAPHQL_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: CAR_DETAIL_QUERY,
          // The GraphQL `id` is the numeric sourceId prefixed with "Car-"
          // (see parseSkodaPlusEdges, which strips this same prefix off the
          // OTHER direction when deriving sourceId from the search query).
          variables: { id: `Car-${listing.sourceId}` },
        }),
      });
      if (res.errors?.length) {
        console.warn(`[skodaplus] fetchDetailText GraphQL error for ${listing.sourceId}:`, res.errors[0]?.message);
        return null;
      }
      return parseSkodaPlusDetailText(res.data ?? {});
    } catch (err) {
      console.warn(`[skodaplus] fetchDetailText failed for ${listing.sourceId}:`, (err as Error).message);
      return null;
    }
  },
  async search(query: SearchQuery, ctx: SourceContext): Promise<RawListing[]> {
    const maxPages = ctx.maxPages ?? MAX_RESULT_PAGES;
    const out: RawListing[] = [];

    const filter: Record<string, unknown> = {};
    if (query.make) {
      const makeId = await getMakeId(query.make);
      if (makeId) filter.make = makeId;
    }
    if (query.priceFrom || query.priceTo) {
      filter.priceRange = { min: query.priceFrom ?? undefined, max: query.priceTo ?? undefined };
    }
    if (query.mileageMax) {
      filter.mileageRange = { max: query.mileageMax };
    }
    if (query.yearFrom || query.yearTo) {
      filter.firstRegistration = {
        min: query.yearFrom ?? undefined,
        max: query.yearTo ?? undefined,
      };
    }

    let after: string | null = null;
    let hitCap = false;
    for (let page = 0; page < maxPages; page++) {
      let res: GraphQlResponse<CarsQueryData>;
      try {
        res = await fetchJson<GraphQlResponse<CarsQueryData>>(GRAPHQL_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: CARS_QUERY,
            variables: { first: PAGE_SIZE, after, filter },
          }),
        });
      } catch (err) {
        console.warn(`[skodaplus] request failed on page ${page}:`, (err as Error).message);
        break;
      }
      if (res.errors?.length) {
        console.warn(`[skodaplus] GraphQL errors on page ${page}:`, res.errors[0]?.message);
        break;
      }
      const items = parseSkodaPlusEdges(res.data ?? {});
      out.push(...items);
      const pageInfo = res.data?.cars?.pageInfo;
      // Unlike most adapters (which infer "more pages?" from a short page),
      // the API tells us directly via `hasNextPage` — so a cap-hit here is
      // unambiguous: the API itself says there's more, we just stopped.
      if (!pageInfo?.hasNextPage || !pageInfo.endCursor) break;
      if (page === maxPages - 1) hitCap = true;
      after = pageInfo.endCursor;
    }
    if (hitCap) ctx.onPageCapHit?.();

    console.log(`[skodaplus] fetched ${out.length} listings`);
    return out;
  },
};
