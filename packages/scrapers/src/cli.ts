#!/usr/bin/env node
import { runScrape } from "./runner.js";

function parseArgs(argv: string[]): { dryRun: boolean; source?: string } {
  const dryRun = argv.includes("--dry-run");
  const sourceArg = argv.find((a) => a.startsWith("--source="));
  const source = sourceArg ? sourceArg.split("=")[1] : undefined;
  return { dryRun, source };
}

const { dryRun, source } = parseArgs(process.argv.slice(2));

runScrape({ dryRun, sourceFilter: source }).catch((err) => {
  console.error("[cli] fatal error:", err);
  process.exitCode = 1;
});
