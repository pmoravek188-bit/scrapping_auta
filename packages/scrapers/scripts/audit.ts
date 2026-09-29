#!/usr/bin/env tsx
/**
 * Coverage audit: for a fixed list of representative saved-search-shaped
 * queries, runs every adapter live and reports, per source:
 *   - fetched:  how many listings the adapter's search() returned
 *   - matched:  how many of those pass `matchesSearch` for that query
 *   - top rejection reasons: a count per failing `explainMatch` criterion,
 *     for the listings that did NOT match
 *   - a sample of raw `model` strings for listings rejected specifically on
 *     "model", so a model-alias gap is visible directly in the output
 *
 * This is the tool asked for in the "verify nothing falls through" task: run
 * it before a fix to see where listings are being silently dropped, and
 * after to confirm they now come through. NOT part of CI (network-dependent,
 * slow, and intentionally noisy about live site behavior) — run manually via
 * `pnpm audit:sources` (see package.json).
 *
 * Usage:
 *   pnpm audit:sources                      # all queries, all sources
 *   pnpm audit:sources -- --source=sauto     # one source only
 *   pnpm audit:sources -- --query=bmw-3-series   # one query only (see QUERIES below)
 *   pnpm audit:sources -- --maxPages=1       # bound each adapter call (default 2)
 *   pnpm audit:sources -- --make=hyundai --model=i30 --yearFrom=2018
 *     # ad hoc probe query instead of the QUERIES table — handy for sweeping
 *     # every make/model in the catalog without hand-writing a NamedQuery for
 *     # each one. --yearFrom/--source/--maxPages combine with it as usual.
 *
 * Every live network call is bounded: each adapter call is capped at
 * `maxPages` result pages (small by default) and wrapped in a hard 60s
 * per-(source,query) timeout, so one slow/hanging source can't stall the
 * whole audit — it's just reported as a timeout and the script moves on.
 */
import {
  explainMatch,
  normalizeListing,
  normalizeMake,
  normalizeModel,
  type Listing,
  type MatchFailureReason,
  type SearchQuery,
} from "@scrapping-auta/core";
import { ADAPTERS } from "../src/registry.js";
import { fetchEurCzkRate } from "../src/exchange-rate.js";

interface NamedQuery {
  id: string;
  label: string;
  partial: Partial<SearchQuery>;
}

/** The 4 saved searches from the bug report, the BMW loose query that
 * reproduces the "0 matches" complaint most starkly, and two sanity-check
 * queries for makes/models not otherwise covered (Škoda Octavia, VW Golf). */
const QUERIES: NamedQuery[] = [
  {
    id: "bmw-3-series-loose",
    label: "BMW 3-series, loose (year/price/mileage only)",
    partial: {
      make: "bmw",
      model: "3-series",
      yearFrom: 2022,
      priceFrom: 700_000,
      priceTo: 900_000,
      mileageMax: 100_000,
    },
  },
  {
    id: "bmw-3-series-full",
    label: "BMW 3-series (the actual saved search)",
    partial: {
      make: "bmw",
      model: "3-series",
      yearFrom: 2022,
      priceFrom: 700_000,
      priceTo: 900_000,
      mileageMax: 100_000,
      fuel: ["diesel"],
      transmission: "automatic",
      drive: ["awd"],
      powerMinKw: 130,
    },
  },
  {
    id: "ford-tourneo-custom",
    label: "Ford Tourneo Custom, 2024+, automatic AWD, prodloužená, power>=100kW",
    partial: {
      make: "ford",
      model: "tourneo-custom",
      yearFrom: 2024,
      priceTo: 1_500_000,
      mileageMax: 100_000,
      transmission: "automatic",
      drive: ["awd"],
      features: ["prodlouzena"],
      powerMinKw: 100,
    },
  },
  {
    id: "vw-multivan",
    label: "VW Multivan, 2022+, automatic, prodloužená",
    partial: {
      make: "volkswagen",
      model: "multivan",
      yearFrom: 2022,
      priceTo: 1_200_000,
      mileageMax: 100_000,
      transmission: "automatic",
      features: ["prodlouzena"],
    },
  },
  {
    id: "citroen-spacetourer",
    label: "Citroën SpaceTourer, diesel automatic, prodloužená, power>=100kW",
    partial: {
      make: "citroen",
      model: "spacetourer",
      priceTo: 1_200_000,
      mileageMax: 100_000,
      fuel: ["diesel"],
      transmission: "automatic",
      features: ["prodlouzena"],
      powerMinKw: 100,
    },
  },
  {
    id: "skoda-octavia",
    label: "Škoda Octavia, 2020+",
    partial: { make: "skoda", model: "octavia", yearFrom: 2020 },
  },
  {
    id: "vw-golf",
    label: "VW Golf, 2019+",
    partial: { make: "volkswagen", model: "golf", yearFrom: 2019 },
  },
];

function toQuery(partial: Partial<SearchQuery>): SearchQuery {
  const make = normalizeMake(partial.make ?? null);
  return {
    make,
    model: normalizeModel(partial.model ?? null, make),
    yearFrom: partial.yearFrom ?? null,
    yearTo: partial.yearTo ?? null,
    priceFrom: partial.priceFrom ?? null,
    priceTo: partial.priceTo ?? null,
    mileageMax: partial.mileageMax ?? null,
    fuel: partial.fuel ?? [],
    transmission: partial.transmission ?? null,
    body: partial.body ?? [],
    powerMinKw: partial.powerMinKw ?? null,
    keywords: partial.keywords ?? [],
    excludeKeywords: partial.excludeKeywords ?? [],
    sources: partial.sources ?? [],
    drive: partial.drive ?? [],
    features: partial.features ?? [],
  };
}

interface SourceResult {
  fetched: number;
  matched: number;
  reasonCounts: Partial<Record<MatchFailureReason, number>>;
  rejectedModelSamples: string[];
  error: string | null;
  timedOut: boolean;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms: ${label}`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

async function auditOne(
  sourceId: string,
  query: SearchQuery,
  eurCzkRate: number,
  maxPages: number,
  perCallTimeoutMs: number
): Promise<SourceResult> {
  const adapter = ADAPTERS[sourceId];
  if (!adapter) {
    return { fetched: 0, matched: 0, reasonCounts: {}, rejectedModelSamples: [], error: "no adapter", timedOut: false };
  }
  try {
    const raw = await withTimeout(
      adapter.search(query, { eurCzkRate, maxPages }),
      perCallTimeoutMs,
      `${sourceId} search`
    );
    const listings: Listing[] = raw.map((r) => normalizeListing(r, { source: sourceId, eurCzkRate }));
    const reasonCounts: Partial<Record<MatchFailureReason, number>> = {};
    const rejectedModelSamples: string[] = [];
    let matched = 0;
    for (const listing of listings) {
      const reason = explainMatch(listing, query);
      if (reason == null) {
        matched++;
        continue;
      }
      reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;
      if (reason === "model" && rejectedModelSamples.length < 5) {
        rejectedModelSamples.push(`${listing.make ?? "?"}/${listing.model ?? "?"} (title: "${listing.title}")`);
      }
    }
    return { fetched: listings.length, matched, reasonCounts, rejectedModelSamples, error: null, timedOut: false };
  } catch (err) {
    const message = (err as Error).message;
    return {
      fetched: 0,
      matched: 0,
      reasonCounts: {},
      rejectedModelSamples: [],
      error: message,
      timedOut: message.startsWith("timeout after"),
    };
  }
}

function formatReasonCounts(counts: Partial<Record<MatchFailureReason, number>>): string {
  const entries = Object.entries(counts).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0));
  if (entries.length === 0) return "-";
  return entries.map(([reason, n]) => `${reason}:${n}`).join(", ");
}

function parseArgs(argv: string[]) {
  const sourceArg = argv.find((a) => a.startsWith("--source="));
  const queryArg = argv.find((a) => a.startsWith("--query="));
  const maxPagesArg = argv.find((a) => a.startsWith("--maxPages="));
  const makeArg = argv.find((a) => a.startsWith("--make="));
  const modelArg = argv.find((a) => a.startsWith("--model="));
  const yearFromArg = argv.find((a) => a.startsWith("--yearFrom="));
  return {
    source: sourceArg?.split("=")[1],
    query: queryArg?.split("=")[1],
    maxPages: maxPagesArg ? Number(maxPagesArg.split("=")[1]) : 2,
    make: makeArg?.split("=")[1],
    model: modelArg?.split("=")[1],
    yearFrom: yearFromArg ? Number(yearFromArg.split("=")[1]) : undefined,
  };
}

async function main() {
  const { source, query, maxPages, make, model, yearFrom } = parseArgs(process.argv.slice(2));
  const sourceIds = source ? [source] : Object.keys(ADAPTERS);

  let queries: NamedQuery[];
  if (make) {
    // Ad hoc single probe query (--make/--model), used to sweep the whole
    // catalog make-by-make without a hand-written NamedQuery for each one.
    queries = [
      {
        id: `adhoc-${make}-${model ?? "any"}`,
        label: `${make}${model ? ` ${model}` : ""}, loose (ad hoc probe)`,
        partial: { make, model: model ?? null, yearFrom: yearFrom ?? 2018 },
      },
    ];
  } else {
    queries = query ? QUERIES.filter((q) => q.id === query) : QUERIES;
  }
  if (queries.length === 0) {
    console.error(`No query matches id "${query}". Known ids: ${QUERIES.map((q) => q.id).join(", ")}`);
    process.exit(1);
  }

  const eurCzkRate = await fetchEurCzkRate({});
  console.log(`[audit] EUR/CZK rate: ${eurCzkRate}, maxPages=${maxPages}\n`);

  for (const nq of queries) {
    const sq = toQuery(nq.partial);
    console.log(`=== ${nq.label} (make=${sq.make ?? "-"} model=${sq.model ?? "-"}) ===`);
    console.log(
      "source".padEnd(14) + "fetched".padEnd(9) + "matched".padEnd(9) + "top rejection reasons"
    );
    for (const sourceId of sourceIds) {
      // Run one (source, query) pair at a time, with its own hard timeout,
      // rather than Promise.all-ing everything — keeps one hung source from
      // blocking the whole audit and keeps output streaming/readable.
      const result = await auditOne(sourceId, sq, eurCzkRate, maxPages, 60_000);
      const status = result.error
        ? `ERROR: ${result.error}`
        : formatReasonCounts(result.reasonCounts);
      console.log(
        sourceId.padEnd(14) + String(result.fetched).padEnd(9) + String(result.matched).padEnd(9) + status
      );
      if (result.rejectedModelSamples.length > 0) {
        for (const sample of result.rejectedModelSamples) {
          console.log(`    rejected-by-model: ${sample}`);
        }
      }
    }
    console.log("");
  }
}

main().catch((err) => {
  console.error("[audit] fatal error:", err);
  process.exitCode = 1;
});
