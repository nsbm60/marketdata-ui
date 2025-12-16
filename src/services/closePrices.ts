/**
 * Close prices service - fetches previous and current day close prices.
 *
 * - Calls close_prices RPC for batch symbol lookups
 * - Caches results per symbol
 * - Provides helper to calculate % change
 */

import { socketHub } from "../ws/SocketHub";

// ---- Types ----

export interface ClosePriceData {
  prevClose: number;          // Previous trading day's close
  todayClose?: number;        // Today's close (available after market close)
  todayOpen?: number;         // Today's open
  fetchedAt: number;          // Timestamp when fetched
}

// ---- Module state ----

const cache = new Map<string, ClosePriceData>();
const pendingFetches = new Map<string, Promise<ClosePriceData | null>>();

// Cache TTL: 5 minutes for active market, longer for closed
const CACHE_TTL_MS = 5 * 60 * 1000;

// ---- Public API ----

/**
 * Get close price data for a symbol (from cache or fetch).
 * Returns null if fetch fails or symbol not found.
 */
export async function getClosePrices(symbol: string): Promise<ClosePriceData | null> {
  const sym = symbol.toUpperCase();

  // Check cache
  const cached = cache.get(sym);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached;
  }

  // Check if already fetching
  const pending = pendingFetches.get(sym);
  if (pending) {
    return pending;
  }

  // Fetch
  const promise = fetchClosePrices([sym]).then(results => results.get(sym) ?? null);
  pendingFetches.set(sym, promise);

  try {
    return await promise;
  } finally {
    pendingFetches.delete(sym);
  }
}

/**
 * Batch fetch close prices for multiple symbols.
 * More efficient than individual calls.
 */
export async function fetchClosePrices(symbols: string[]): Promise<Map<string, ClosePriceData>> {
  const syms = symbols.map(s => s.toUpperCase()).filter(s => s.length > 0);
  if (syms.length === 0) return new Map();

  // Filter to only symbols not in cache or expired
  const now = Date.now();
  const toFetch = syms.filter(s => {
    const cached = cache.get(s);
    return !cached || (now - cached.fetchedAt >= CACHE_TTL_MS);
  });

  // Return cached if all valid
  if (toFetch.length === 0) {
    const result = new Map<string, ClosePriceData>();
    syms.forEach(s => {
      const cached = cache.get(s);
      if (cached) result.set(s, cached);
    });
    return result;
  }

  try {
    const ack = await socketHub.sendControl("close_prices", { symbols: toFetch }, { timeoutMs: 10000 });

    if (ack.ok && ack.data) {
      const data = (ack.data as any).data || ack.data;

      Object.entries(data).forEach(([symbol, prices]: [string, any]) => {
        if (prices && typeof prices.prevClose === "number") {
          const entry: ClosePriceData = {
            prevClose: prices.prevClose,
            todayClose: typeof prices.todayClose === "number" ? prices.todayClose : undefined,
            todayOpen: typeof prices.todayOpen === "number" ? prices.todayOpen : undefined,
            fetchedAt: now,
          };
          cache.set(symbol.toUpperCase(), entry);
        }
      });

      console.log(`[ClosePrices] Fetched ${Object.keys(data).length} symbols`);
    }
  } catch (err) {
    console.error("[ClosePrices] Fetch failed:", err);
  }

  // Return all requested symbols from cache
  const result = new Map<string, ClosePriceData>();
  syms.forEach(s => {
    const cached = cache.get(s);
    if (cached) result.set(s, cached);
  });
  return result;
}

/**
 * Calculate percentage change from previous close.
 *
 * @param currentPrice Current price
 * @param prevClose Previous close price
 * @returns Percentage change (e.g., 2.5 for +2.5%)
 */
export function calcPctChange(currentPrice: number, prevClose: number): number {
  if (prevClose === 0) return 0;
  return ((currentPrice - prevClose) / prevClose) * 100;
}

/**
 * Format percentage change for display.
 *
 * @param pctChange Percentage change value
 * @returns Formatted string like "+2.50%" or "-1.25%"
 */
export function formatPctChange(pctChange: number): string {
  const sign = pctChange >= 0 ? "+" : "";
  return `${sign}${pctChange.toFixed(2)}%`;
}

/**
 * Get cached close price data (no fetch, immediate return).
 * Returns null if not in cache.
 */
export function getCachedClosePrice(symbol: string): ClosePriceData | null {
  return cache.get(symbol.toUpperCase()) ?? null;
}

/**
 * Clear the cache (useful for testing or forced refresh).
 */
export function clearCache(): void {
  cache.clear();
}
