import { z } from "zod";
import { BODY_TYPES, DRIVE_TYPES, FUEL_TYPES, SELLER_TYPES, TRANSMISSION_TYPES } from "./enums.js";

/** A listing as scraped from a source, before normalization. Kept loose on purpose. */
export const RawListingSchema = z.object({
  sourceId: z.string().min(1),
  url: z.string().min(1),
  title: z.string().min(1).optional().default(""),
  make: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  variant: z.string().nullable().optional(),
  year: z.number().int().nullable().optional(),
  mileageKm: z.number().int().nullable().optional(),
  price: z.number().nullable().optional(),
  currency: z.string().nullable().optional().default("CZK"),
  fuel: z.string().nullable().optional(),
  transmission: z.string().nullable().optional(),
  powerKw: z.number().int().nullable().optional(),
  body: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  country: z.string().nullable().optional().default("CZ"),
  sellerType: z.string().nullable().optional(),
  vin: z.string().nullable().optional(),
  imageUrls: z.array(z.string()).optional().default([]),
  /** Structured drive-type value from the source, if it exposes one (e.g.
   * carvago's `DRIVE_4X4` catalog feature) — free text is fine too, it goes
   * through `parseDriveType`'s alias table just like fuel/transmission. */
  drive: z.string().nullable().optional(),
  /** Free-text equipment/feature list, for sources that expose one cheaply
   * (e.g. carvago's `catalog_features` labels) — used only to improve
   * "Výbava" feature-chip matching, not stored as its own filter dimension.
   * No `.default([])` here on purpose (unlike `imageUrls`): most adapters
   * don't set this field at all, and a default would make it a required key
   * in every adapter's object-literal `RawListing` (TS excess/missing
   * property checks) — `normalizeListing` falls back to `[]` itself. */
  equipment: z.array(z.string()).nullable().optional(),
});
export type RawListing = z.infer<typeof RawListingSchema>;

/** Normalized, canonical listing shape stored in the `listings` table. */
export const ListingSchema = z.object({
  source: z.string(),
  sourceId: z.string(),
  url: z.string(),
  title: z.string(),
  make: z.string().nullable(),
  model: z.string().nullable(),
  variant: z.string().nullable(),
  year: z.number().int().nullable(),
  mileageKm: z.number().int().nullable(),
  priceCzk: z.number().int().nullable(),
  priceOrig: z.number().nullable(),
  currencyOrig: z.string(),
  fuel: z.enum(FUEL_TYPES).nullable(),
  transmission: z.enum(TRANSMISSION_TYPES).nullable(),
  powerKw: z.number().int().nullable(),
  body: z.enum(BODY_TYPES).nullable(),
  color: z.string().nullable(),
  location: z.string().nullable(),
  country: z.string(),
  sellerType: z.enum(SELLER_TYPES),
  vin: z.string().nullable(),
  imageUrls: z.array(z.string()),
  fingerprint: z.string(),
  drive: z.enum(DRIVE_TYPES).nullable(),
  equipment: z.array(z.string()),
  /** Feature-group ids (see core/src/features.ts) confirmed present on this
   * listing's DETAIL page (description/equipment/wheelbase text), as opposed
   * to `equipment` (free text from the list page only). Populated by the
   * scraper runner's near-match detail-enrichment pass (see
   * packages/scrapers/src/runner.ts and the `detail_text_cache` table) for
   * listings that fail matching ONLY on a feature the source's list page
   * doesn't expose (e.g. "prodloužená verze"/long-wheelbase, often only
   * mentioned in the description). `hasAllFeatures` treats an id present
   * here as satisfied without re-scanning free text — see features.ts.
   * Empty for every listing the enrichment pass never looked at (the
   * overwhelming majority), never re-derived client-side. */
  detailFeatures: z.array(z.string()).optional().default([]),
});
export type Listing = z.infer<typeof ListingSchema>;

/** Saved search criteria (mirrors the `searches` table). */
export const SearchQuerySchema = z.object({
  id: z.string().optional(),
  make: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  yearFrom: z.number().int().nullable().optional(),
  yearTo: z.number().int().nullable().optional(),
  priceFrom: z.number().int().nullable().optional(),
  priceTo: z.number().int().nullable().optional(),
  mileageMax: z.number().int().nullable().optional(),
  fuel: z.array(z.enum(FUEL_TYPES)).optional().default([]),
  transmission: z.enum(TRANSMISSION_TYPES).nullable().optional(),
  body: z.array(z.enum(BODY_TYPES)).optional().default([]),
  powerMinKw: z.number().int().nullable().optional(),
  keywords: z.array(z.string()).optional().default([]),
  excludeKeywords: z.array(z.string()).optional().default([]),
  sources: z.array(z.string()).optional().default([]),
  /** Drive type chips ("Pohon"): 4x4/AWD, přední (FWD), zadní (RWD). Empty = any. */
  drive: z.array(z.enum(DRIVE_TYPES)).optional().default([]),
  /** Equipment + "Verze" (wheelbase/length) chip ids, see `features.ts`. Empty = any. */
  features: z.array(z.string()).optional().default([]),
});
export type SearchQuery = z.infer<typeof SearchQuerySchema>;
