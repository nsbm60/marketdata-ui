/**
 * Position snapshots service - fetches historical position data from CalcServer.
 *
 * - Calls position_snapshots RPC to CalcServer
 * - Caches results per account + timeframe
 * - Used for P&L calculation against historical positions
 */

import { socketHub } from "../ws/SocketHub";

// ---- Types ----

export interface PositionSnapshot {
  symbol: string;
  sec_type: string;         // "STK" or "OPT"
  quantity: number;
  close_price: number;
  market_value: number;
  // Option fields (only present for options)
  strike?: number;
  expiry?: string;          // "YYYY-MM-DD"
  right?: string;           // "C" or "P"
}

export interface PositionSnapshotResponse {
  account: string;
  snapshot_date: string;    // "YYYY-MM-DD"
  positions: PositionSnapshot[];
}

// ---- Module state ----

// Cache key: `${account}:${timeframe}`
const cache = new Map<string, { data: PositionSnapshotResponse; fetchedAt: number }>();
const pendingFetches = new Map<string, Promise<PositionSnapshotResponse | null>>();

// Cache TTL: 5 minutes
const CACHE_TTL_MS = 5 * 60 * 1000;

// ---- Public API ----

/**
 * Fetch position snapshots for an account at a given timeframe.
 *
 * @param account IB account ID (e.g., "DU123456")
 * @param timeframe Timeframe: "1D", "1W", "1M", "3M", "YTD", or ISO date "YYYY-MM-DD"
 */
export async function fetchPositionSnapshots(
  account: string,
  timeframe: string
): Promise<PositionSnapshotResponse | null> {
  const cacheKey = `${account}:${timeframe}`;

  // Check cache
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.data;
  }

  // Check if already fetching
  const pending = pendingFetches.get(cacheKey);
  if (pending) {
    return pending;
  }

  // Fetch from CalcServer
  const promise = doFetch(account, timeframe);
  pendingFetches.set(cacheKey, promise);

  try {
    const result = await promise;
    if (result) {
      cache.set(cacheKey, { data: result, fetchedAt: Date.now() });
    }
    return result;
  } finally {
    pendingFetches.delete(cacheKey);
  }
}

async function doFetch(account: string, timeframe: string): Promise<PositionSnapshotResponse | null> {
  try {
    const ack = await socketHub.sendControl(
      "position_snapshots",
      {
        target: "calc",
        account,
        timeframe,
      },
      { timeoutMs: 10000 }
    );

    if (ack.ok && ack.data) {
      const data = ack.data as PositionSnapshotResponse;
      console.log(`[PositionSnapshots] Fetched ${data.positions?.length ?? 0} positions for ${account} @ ${timeframe} (date: ${data.snapshot_date})`);
      return data;
    } else {
      console.warn(`[PositionSnapshots] Fetch failed:`, (ack as any).error || "unknown error");
      return null;
    }
  } catch (err) {
    console.error("[PositionSnapshots] Fetch error:", err);
    return null;
  }
}

/**
 * Get cached snapshot (no fetch, immediate return).
 */
export function getCachedSnapshots(account: string, timeframe: string): PositionSnapshotResponse | null {
  const cached = cache.get(`${account}:${timeframe}`);
  return cached?.data ?? null;
}

/**
 * Clear the cache (useful for testing or forced refresh).
 */
export function clearCache(): void {
  cache.clear();
}

/**
 * Build a lookup key for a position (for matching current positions to snapshots).
 * For stocks: just the symbol
 * For options: symbol + strike + expiry + right
 */
export function buildPositionKey(
  symbol: string,
  secType: string,
  strike?: number,
  expiry?: string,
  right?: string
): string {
  if (secType === "OPT" && strike !== undefined && expiry && right) {
    return `${symbol}:${strike}:${expiry}:${right}`;
  }
  return symbol;
}
