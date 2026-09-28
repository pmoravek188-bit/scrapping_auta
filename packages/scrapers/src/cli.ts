#!/usr/bin/env node
import type { SearchQuery } from "@scrapping-auta/core";
import { runScrape } from "./runner.js";

function parseArgs(argv: string[]): {
  dryRun: boolean;
  source?: string;
  query?: Partial<SearchQuery>;
} {
  const dryRun = argv.includes("--dry-run");
  const sourceArg = argv.find((a) => a.startsWith("--source="));
  const source = sourceArg ? sourceArg.split("=")[1] : undefined;

  const queryArg = argv.find((a) => a.startsWith("--query="));
  let query: Partial<SearchQuery> | undefined;
  if (queryArg) {
    const raw = queryArg.slice("--query=".length);
    try {
      query = JSON.parse(raw) as Partial<SearchQuery>;
    } catch (err) {
      console.error("[cli] --query must be valid JSON:", (err as Error).message);
      process.exit(1);
    }
  }

  return { dryRun, source, query };
}

const { dryRun, source, query } = parseArgs(process.argv.slice(2));

runScrape({ dryRun, sourceFilter: source, queryOverride: query }).catch((err) => {
  console.error("[cli] fatal error:", err);
  process.exitCode = 1;
});
