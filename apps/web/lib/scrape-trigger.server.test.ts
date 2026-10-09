import { describe, expect, it } from "vitest";
import {
  decideManualScrapeTrigger,
  computeNextAllowedAt,
  isRunActive,
  MANUAL_SCRAPE_COOLDOWN_HOURS,
  type WorkflowRunStatus,
} from "./scrape-trigger.server";

/**
 * Unit tests for the manual "Spustit scraping mých hledání" button's
 * server-side guard (decideManualScrapeTrigger) — the pure decision
 * function apps/web/app/api/scrape/route.ts's POST calls before ever
 * recording a manual_scrape_requests row or dispatching the workflow. Three
 * cases per the task: an already-running workflow refuses with 409; too
 * soon since the user's last manual trigger refuses with 429 and names the
 * time it'll next be allowed; otherwise it's allowed.
 */

function run(status: string): WorkflowRunStatus {
  return { status, conclusion: null, created_at: new Date().toISOString(), html_url: "https://example.com" };
}

describe("isRunActive", () => {
  it("is true for queued/in_progress, false otherwise (including null)", () => {
    expect(isRunActive(run("queued"))).toBe(true);
    expect(isRunActive(run("in_progress"))).toBe(true);
    expect(isRunActive(run("completed"))).toBe(false);
    expect(isRunActive(null)).toBe(false);
  });
});

describe("computeNextAllowedAt", () => {
  const now = new Date("2026-10-09T12:00:00Z");

  it("returns null when there's no previous request", () => {
    expect(computeNextAllowedAt(null, now)).toBeNull();
  });

  it("returns null once the cooldown has fully elapsed", () => {
    const longAgo = new Date(now.getTime() - (MANUAL_SCRAPE_COOLDOWN_HOURS + 1) * 60 * 60 * 1000).toISOString();
    expect(computeNextAllowedAt(longAgo, now)).toBeNull();
  });

  it("returns the cooldown's end time while still within the window", () => {
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
    const next = computeNextAllowedAt(oneHourAgo, now);
    expect(next).not.toBeNull();
    expect(new Date(next!).getTime()).toBe(
      new Date(oneHourAgo).getTime() + MANUAL_SCRAPE_COOLDOWN_HOURS * 60 * 60 * 1000
    );
  });

  it("treats the exact cooldown boundary as no-longer-limited (strictly greater, not >=)", () => {
    const exactlyCooldownAgo = new Date(
      now.getTime() - MANUAL_SCRAPE_COOLDOWN_HOURS * 60 * 60 * 1000
    ).toISOString();
    expect(computeNextAllowedAt(exactlyCooldownAgo, now)).toBeNull();
  });
});

describe("decideManualScrapeTrigger", () => {
  const now = new Date("2026-10-09T12:00:00Z"); // 14:00 Europe/Prague (summer-adjacent offset irrelevant to the test below)

  it("refuses with 409 when a workflow run is already queued", () => {
    const decision = decideManualScrapeTrigger({ latestRun: run("queued"), lastRequestAt: null, now });
    expect(decision).toEqual({
      allowed: false,
      status: 409,
      message: "Scraping už běží, počkej na dokončení.",
    });
  });

  it("refuses with 409 when a workflow run is already in_progress, even if the user is also outside any cooldown", () => {
    const decision = decideManualScrapeTrigger({ latestRun: run("in_progress"), lastRequestAt: null, now });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.status).toBe(409);
  });

  it("refuses with 429 and names the next-allowed time when triggered too recently", () => {
    const fortyMinutesAgo = new Date(now.getTime() - 40 * 60 * 1000).toISOString();
    const decision = decideManualScrapeTrigger({ latestRun: null, lastRequestAt: fortyMinutesAgo, now });
    expect(decision.allowed).toBe(false);
    if (decision.allowed) throw new Error("expected not allowed");
    expect(decision.status).toBe(429);
    expect(decision.message).toContain("Další ruční spuštění bude možné v");
    expect(decision.message).toMatch(/\d{2}:\d{2}/);
    expect(decision.nextAllowedAt).toBe(
      new Date(new Date(fortyMinutesAgo).getTime() + MANUAL_SCRAPE_COOLDOWN_HOURS * 60 * 60 * 1000).toISOString()
    );
  });

  it("the running-run check takes priority over the cooldown check (both would otherwise apply)", () => {
    const justNow = now.toISOString();
    const decision = decideManualScrapeTrigger({ latestRun: run("queued"), lastRequestAt: justNow, now });
    expect(decision.allowed).toBe(false);
    if (decision.allowed) throw new Error("expected not allowed");
    expect(decision.status).toBe(409);
  });

  it("allows the trigger when no run is active and the cooldown has elapsed", () => {
    const threeHoursAgo = new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString();
    expect(decideManualScrapeTrigger({ latestRun: run("completed"), lastRequestAt: threeHoursAgo, now })).toEqual({
      allowed: true,
    });
  });

  it("allows the trigger on a first-ever manual request (no lastRequestAt) with no run active", () => {
    expect(decideManualScrapeTrigger({ latestRun: null, lastRequestAt: null, now })).toEqual({ allowed: true });
  });
});
