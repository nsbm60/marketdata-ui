/**
 * useWatchlistReport - Hook to consume pre-computed watchlist reports from CalcServer.
 *
 * CalcServer publishes complete watchlist snapshots at ~4Hz with pre-computed
 * change and pctChange values. This hook provides a simpler alternative to
 * useThrottledMarketPrices + fetchClosePrices by receiving ready-to-render data.
 */

import { useState, useEffect, useRef, useMemo } from "react";
import { socketHub } from "../ws/SocketHub";
import type { TickEnvelope } from "../ws/ws-types";

// Row shape from CalcServer's WatchlistReportBuilder
export interface WatchlistReportRow {
  symbol: string;
  last: number;
  change: number;
  pctChange: number;
  bid?: number;
  ask?: number;
  volume?: number;
  timestamp: number;
}

// Full report shape
export interface WatchlistReport {
  name: string;
  asOf: number;
  referenceDate?: string;
  rowCount: number;
  rows: WatchlistReportRow[];
}

// Return type from the hook
export interface UseWatchlistReportResult {
  /** Current report data, or undefined if not yet received */
  report: WatchlistReport | undefined;
  /** Map of symbol -> row for easy lookup (same data as report.rows) */
  rowsBySymbol: Map<string, WatchlistReportRow>;
  /** Timestamp of last received report */
  lastUpdated: number | undefined;
  /** Whether we've received at least one report */
  loaded: boolean;
}

/**
 * Subscribe to watchlist report updates from CalcServer.
 *
 * @param watchlistName - Name of the watchlist to subscribe to (e.g., "default")
 * @param enabled - Whether to subscribe (false = unsubscribe)
 * @returns Current report data and loading state
 *
 * @example
 * const { report, rowsBySymbol, loaded } = useWatchlistReport("default");
 * if (loaded) {
 *   const nvdaRow = rowsBySymbol.get("NVDA");
 *   console.log(nvdaRow?.pctChange);
 * }
 */
export function useWatchlistReport(
  watchlistName: string,
  enabled: boolean = true
): UseWatchlistReportResult {
  const [report, setReport] = useState<WatchlistReport | undefined>(undefined);
  const [lastUpdated, setLastUpdated] = useState<number | undefined>(undefined);
  const [loaded, setLoaded] = useState(false);

  // Stable reference for name
  const nameRef = useRef(watchlistName);
  nameRef.current = watchlistName;

  useEffect(() => {
    if (!enabled || !watchlistName) {
      return;
    }

    // Subscribe to report.watchlist channel for this watchlist
    const channel = "report.watchlist";
    const symbol = watchlistName.toLowerCase();

    socketHub.send({
      type: "subscribe",
      channels: [channel],
      symbols: [symbol],
    });

    // Listen for tick envelopes
    const handleTick = (tick: TickEnvelope) => {
      // Topic format: report.watchlist.{name}
      const expectedTopic = `report.watchlist.${symbol}`;
      if (tick.topic !== expectedTopic) return;

      try {
        // tick.data is the report payload (may be nested in 'data' or direct)
        const payload = (tick.data as any)?.data ?? tick.data;

        if (payload && typeof payload === "object") {
          const reportData: WatchlistReport = {
            name: payload.name || watchlistName,
            asOf: payload.asOf || Date.now(),
            referenceDate: payload.referenceDate,
            rowCount: payload.rowCount || 0,
            rows: Array.isArray(payload.rows)
              ? payload.rows.map((r: any) => ({
                  symbol: r.symbol || "",
                  last: r.last ?? 0,
                  change: r.change ?? 0,
                  pctChange: r.pctChange ?? 0,
                  bid: r.bid,
                  ask: r.ask,
                  volume: r.volume,
                  timestamp: r.timestamp || 0,
                }))
              : [],
          };

          setReport(reportData);
          setLastUpdated(reportData.asOf);
          setLoaded(true);
        }
      } catch (e) {
        console.warn("[useWatchlistReport] Failed to parse report:", e);
      }
    };

    socketHub.onTick(handleTick);

    return () => {
      socketHub.offTick(handleTick);
      socketHub.send({
        type: "unsubscribe",
        channels: [channel],
        symbols: [symbol],
      });
    };
  }, [watchlistName, enabled]);

  // Build symbol -> row map for convenience
  const rowsBySymbol = useMemo(() => {
    const map = new Map<string, WatchlistReportRow>();
    if (report?.rows) {
      for (const row of report.rows) {
        map.set(row.symbol, row);
      }
    }
    return map;
  }, [report]);

  return {
    report,
    rowsBySymbol,
    lastUpdated,
    loaded,
  };
}

/**
 * Get price data from a report row in a format compatible with useThrottledMarketPrices.
 * Useful for gradual migration from tick-based to report-based data.
 */
export function reportRowToPriceData(row: WatchlistReportRow | undefined): {
  last?: number;
  bid?: number;
  ask?: number;
  timestamp?: number;
} | undefined {
  if (!row) return undefined;
  return {
    last: row.last || undefined,
    bid: row.bid,
    ask: row.ask,
    timestamp: row.timestamp || undefined,
  };
}
