import type { RawListing, SearchQuery } from "@scrapping-auta/core";

export interface SourceContext {
  /** Current EUR->CZK rate, for adapters that need to reason about price in CZK client-side. */
  eurCzkRate: number;
  /** Max number of result pages to walk per search (default from http.ts MAX_RESULT_PAGES). */
  maxPages?: number;
}

export interface SourceAdapter {
  /** Stable id matching the `sources` table, e.g. "sauto". */
  id: string;
  /** True if this source requires a headless browser (not implemented in MVP). */
  needsBrowser?: boolean;
  /** Whether this adapter has been verified against the live site (see README). */
  verified: boolean;
  /** Fetches raw listings from the source matching the given query. */
  search(query: SearchQuery, ctx: SourceContext): Promise<RawListing[]>;
}
