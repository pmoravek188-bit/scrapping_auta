import { FALLBACK_EUR_CZK } from "@scrapping-auta/core";
import { fetchText } from "./http.js";

const CNB_URL =
  "https://www.cnb.cz/cs/financni-trhy/devizovy-trh/kurzy-devizoveho-trhu/kurzy-devizoveho-trhu/denni_kurz.txt";

/** Parses the CNB daily-rate .txt format and extracts the EUR->CZK rate. */
export function parseCnbEurRate(text: string): number | null {
  const lines = text.split("\n");
  for (const line of lines) {
    const parts = line.split("|");
    if (parts.length < 5) continue;
    const [country, currency, amountStr, code, rateStr] = parts;
    if (code?.trim().toUpperCase() !== "EUR" || !amountStr || !rateStr) continue;
    const amount = Number(amountStr.trim().replace(",", "."));
    const rate = Number(rateStr.trim().replace(",", "."));
    if (!amount || !rate) continue;
    void country;
    void currency;
    return rate / amount;
  }
  return null;
}

export interface FetchEurCzkRateDeps {
  fetchLastKnownRate?: () => Promise<number | null>;
}

/** Fetches today's ČNB EUR/CZK rate, falling back to the last known rate, then a hardcoded default. */
export async function fetchEurCzkRate(deps: FetchEurCzkRateDeps = {}): Promise<number> {
  try {
    const text = await fetchText(CNB_URL, { skipThrottle: true });
    const rate = parseCnbEurRate(text);
    if (rate) return rate;
  } catch (err) {
    console.warn("[exchange-rate] CNB fetch failed:", (err as Error).message);
  }
  if (deps.fetchLastKnownRate) {
    const last = await deps.fetchLastKnownRate();
    if (last) return last;
  }
  console.warn(`[exchange-rate] falling back to default rate ${FALLBACK_EUR_CZK}`);
  return FALLBACK_EUR_CZK;
}
