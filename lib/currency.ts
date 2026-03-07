/**
 * Live currency conversion to USD using frankfurter.dev (free, no API key).
 * Rates are cached in memory for 1 hour to avoid excessive requests.
 */

let rateCache: { rates: Record<string, number>; fetchedAt: number } | null = null;
const CACHE_TTL = 3600_000; // 1 hour

/**
 * Fetch latest exchange rates with USD as base.
 * Returns a map of currency code → rate (how many units of that currency per 1 USD).
 * Returns null on failure (graceful degradation).
 */
async function fetchRates(): Promise<Record<string, number> | null> {
  if (rateCache && Date.now() - rateCache.fetchedAt < CACHE_TTL) {
    return rateCache.rates;
  }

  try {
    const res = await fetch('https://api.frankfurter.dev/v1/latest?base=USD');
    if (!res.ok) return rateCache?.rates ?? null;
    const data = await res.json() as { rates: Record<string, number> };
    const rates = { USD: 1, ...data.rates };
    rateCache = { rates, fetchedAt: Date.now() };
    return rates;
  } catch {
    return rateCache?.rates ?? null;
  }
}

/**
 * Convert an amount from a given currency to USD.
 * Returns null if rates are unavailable or currency is unknown.
 */
export async function convertToUSD(amount: number, fromCurrency: string): Promise<number | null> {
  if (fromCurrency.toUpperCase() === 'USD') return amount;
  const rates = await fetchRates();
  if (!rates) return null;
  const rate = rates[fromCurrency.toUpperCase()];
  if (!rate) return null;
  // rates are "X units of currency per 1 USD", so USD = amount / rate
  return amount / rate;
}

/**
 * Format a number as USD string (e.g. "$630.80").
 */
export function formatUSD(amount: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}
