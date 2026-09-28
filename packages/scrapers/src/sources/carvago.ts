/**
 * Carvago.com adapter — UNVERIFIED (best-guess; sandbox cannot reach
 * carvago.com). Carvago's frontend is a JS SPA known to be backed by a JSON
 * search API. Exact host/path are unconfirmed, so this is written against a
 * plausible `POST /v2/vehicles/search`-style endpoint and parsed
 * defensively; the request will likely need adjusting after the first live
 * GitHub Actions run (see README "Ověřené vs. neověřené zdroje").
 */
import { z } from "zod";
import type { RawListing, SearchQuery } from "@scrapping-auta/core";
import { fetchJson, MAX_RESULT_PAGES } from "../http.js";
import type { SourceAdapter, SourceContext } from "../adapter.js";

const SEARCH_ENDPOINT = "https://api.carvago.com/v2/vehicles/search";
const PAGE_SIZE = 24;

export function buildCarvagoRequestBody(
  query: SearchQuery,
  page: number
): Record<string, unknown> {
  const filter: Record<string, unknown> = {};
  if (query.make) filter.make = [query.make];
  if (query.model) filter.model = [query.model];
  if (query.yearFrom || query.yearTo) {
    filter.firstRegistrationYear = { from: query.yearFrom ?? undefined, to: query.yearTo ?? undefined };
  }
  if (query.priceFrom || query.priceTo) {
    filter.price = { from: query.priceFrom ?? undefined, to: query.priceTo ?? undefined };
  }
  if (query.mileageMax) filter.mileage = { to: query.mileageMax };
  return {
    filter,
    page,
    pageSize: PAGE_SIZE,
    locale: "cs",
    country: "CZ",
  };
}

const CarvagoItemSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  slug: z.string().optional(),
  make: z.object({ name: z.string().optional() }).optional(),
  model: z.object({ name: z.string().optional() }).optional(),
  variant: z.string().optional(),
  firstRegistration: z.union([z.string(), z.number()]).optional(),
  mileage: z.number().optional(),
  price: z
    .object({ amount: z.number().optional(), currency: z.string().optional() })
    .optional(),
  fuelType: z.string().optional(),
  transmissionType: z.string().optional(),
  power: z.object({ kw: z.number().optional() }).optional(),
  bodyType: z.string().optional(),
  color: z.string().optional(),
  country: z.string().optional(),
  vin: z.string().optional(),
  images: z.array(z.string()).optional(),
});

export interface CarvagoResponse {
  items?: unknown[];
  data?: unknown[];
  totalCount?: number;
}

export function parseCarvagoResponse(json: unknown): RawListing[] {
  const parsed = json as CarvagoResponse;
  const items = parsed?.items ?? parsed?.data ?? [];
  const out: RawListing[] = [];
  for (const item of items) {
    const r = CarvagoItemSchema.safeParse(item);
    if (!r.success) continue;
    const v = r.data;
    if (v.id == null || !v.slug) continue;
    const yearRaw = v.firstRegistration;
    const year =
      typeof yearRaw === "number"
        ? yearRaw
        : typeof yearRaw === "string" && /^\d{4}/.test(yearRaw)
          ? Number(yearRaw.slice(0, 4))
          : null;
    out.push({
      sourceId: String(v.id),
      url: `https://www.carvago.com/cz/car/${v.slug}`,
      title: [v.make?.name, v.model?.name, v.variant].filter(Boolean).join(" "),
      make: v.make?.name ?? null,
      model: v.model?.name ?? null,
      variant: v.variant ?? null,
      year,
      mileageKm: v.mileage ?? null,
      price: v.price?.amount ?? null,
      currency: v.price?.currency ?? "EUR",
      fuel: v.fuelType ?? null,
      transmission: v.transmissionType ?? null,
      powerKw: v.power?.kw ?? null,
      body: v.bodyType ?? null,
      color: v.color ?? null,
      location: null,
      country: v.country ?? "EU",
      sellerType: "dealer",
      vin: v.vin ?? null,
      imageUrls: v.images ?? [],
    });
  }
  return out;
}

export const carvagoAdapter: SourceAdapter = {
  id: "carvago",
  verified: false,
  async search(query: SearchQuery, ctx: SourceContext): Promise<RawListing[]> {
    const maxPages = ctx.maxPages ?? MAX_RESULT_PAGES;
    const out: RawListing[] = [];
    for (let page = 0; page < maxPages; page++) {
      let json: unknown;
      try {
        json = await fetchJson(SEARCH_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildCarvagoRequestBody(query, page)),
        });
      } catch (err) {
        console.warn(`[carvago] request failed on page ${page}:`, (err as Error).message);
        break;
      }
      const items = parseCarvagoResponse(json);
      out.push(...items);
      if (items.length < PAGE_SIZE) break;
    }
    console.log(`[carvago] fetched ${out.length} listings`);
    return out;
  },
};
