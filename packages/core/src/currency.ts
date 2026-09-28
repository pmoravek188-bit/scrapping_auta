/** Fallback EUR->CZK rate used when no exchange_rates row is available at all. */
export const FALLBACK_EUR_CZK = 25.0;

export function convertToCzk(
  amount: number,
  currency: string,
  eurCzkRate: number = FALLBACK_EUR_CZK
): number {
  const cur = currency.toUpperCase();
  if (cur === "CZK") return Math.round(amount);
  if (cur === "EUR") return Math.round(amount * eurCzkRate);
  // Unknown currency: return as-is, rounded, so we never silently corrupt data.
  return Math.round(amount);
}
