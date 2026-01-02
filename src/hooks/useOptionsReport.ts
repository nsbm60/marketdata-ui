/**
 * useOptionsReport - Hook to consume pre-computed options chain reports from CalcServer.
 *
 * CalcServer publishes complete options chain snapshots at ~4Hz with pre-computed
 * Greeks and organized call/put pairs by strike. This hook provides a simpler
 * alternative to per-contract tick subscriptions.
 */

import { useState, useEffect, useRef, useMemo } from "react";
import { socketHub } from "../ws/SocketHub";
import type { TickEnvelope } from "../ws/ws-types";

// Option leg data (call or put)
export interface OptionsReportLeg {
  symbol: string;        // OSI symbol for order placement
  last?: number;
  bid?: number;
  ask?: number;
  mid?: number;
  volume?: number;
  delta?: number;
  gamma?: number;
  theta?: number;
  vega?: number;
  iv?: number;
}

// Row shape from CalcServer's OptionsReportBuilder
export interface OptionsReportRow {
  strike: number;
  call?: OptionsReportLeg;
  put?: OptionsReportLeg;
}

// Full report shape
export interface OptionsReport {
  underlying: string;
  spot: number;
  expiry: string;         // YYYY-MM-DD
  dte: number;            // Days to expiration
  asOf: number;           // Timestamp
  rowCount: number;
  atmStrike?: number;     // Closest strike to spot
  rows: OptionsReportRow[];
}

// Return type from the hook
export interface UseOptionsReportResult {
  /** Current report data, or undefined if not yet received */
  report: OptionsReport | undefined;
  /** Map of strike -> row for easy lookup */
  rowsByStrike: Map<number, OptionsReportRow>;
  /** Timestamp of last received report */
  lastUpdated: number | undefined;
  /** Whether we've received at least one report */
  loaded: boolean;
}

/**
 * Subscribe to options report updates from CalcServer.
 *
 * @param underlying - Underlying symbol (e.g., "NVDA")
 * @param expiry - Expiration date in YYYY-MM-DD format
 * @param enabled - Whether to subscribe (false = unsubscribe)
 * @returns Current report data and loading state
 *
 * @example
 * const { report, rowsByStrike, loaded } = useOptionsReport("NVDA", "2025-01-03");
 * if (loaded) {
 *   const row130 = rowsByStrike.get(130);
 *   console.log(row130?.call?.delta);
 * }
 */
export function useOptionsReport(
  underlying: string,
  expiry: string,
  enabled: boolean = true
): UseOptionsReportResult {
  const [report, setReport] = useState<OptionsReport | undefined>(undefined);
  const [lastUpdated, setLastUpdated] = useState<number | undefined>(undefined);
  const [loaded, setLoaded] = useState(false);

  // Stable references
  const underlyingRef = useRef(underlying);
  underlyingRef.current = underlying;
  const expiryRef = useRef(expiry);
  expiryRef.current = expiry;

  useEffect(() => {
    if (!enabled || !underlying || !expiry) {
      return;
    }

    // Reset state when subscription changes to avoid showing stale data
    setReport(undefined);
    setLoaded(false);
    setLastUpdated(undefined);

    // Subscribe to report.options channel for this underlying + expiry
    const channel = "report.options";
    // Symbol for subscription: underlying.expiry (e.g., "nvda.2025-01-03")
    const symbol = `${underlying.toLowerCase()}.${expiry}`;

    socketHub.send({
      type: "subscribe",
      channels: [channel],
      symbols: [symbol],
    });

    // Listen for tick envelopes
    const handleTick = (tick: TickEnvelope) => {
      // Topic format: report.options.{underlying}.{expiry}
      const expectedTopic = `report.options.${symbol}`;
      if (tick.topic !== expectedTopic) return;

      try {
        // tick.data is the report payload (may be nested in 'data' or direct)
        const payload = (tick.data as any)?.data ?? tick.data;

        if (payload && typeof payload === "object") {
          const reportData: OptionsReport = {
            underlying: payload.underlying || underlying,
            spot: payload.spot ?? 0,
            expiry: payload.expiry || expiry,
            dte: payload.dte ?? 0,
            asOf: payload.asOf || Date.now(),
            rowCount: payload.rowCount || 0,
            atmStrike: payload.atmStrike,
            rows: Array.isArray(payload.rows)
              ? payload.rows.map((r: any) => ({
                  strike: r.strike ?? 0,
                  call: r.call ? parseLeg(r.call) : undefined,
                  put: r.put ? parseLeg(r.put) : undefined,
                }))
              : [],
          };

          setReport(reportData);
          setLastUpdated(reportData.asOf);
          setLoaded(true);
        }
      } catch (e) {
        console.warn("[useOptionsReport] Failed to parse report:", e);
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
  }, [underlying, expiry, enabled]);

  // Build strike -> row map for convenience
  const rowsByStrike = useMemo(() => {
    const map = new Map<number, OptionsReportRow>();
    if (report?.rows) {
      for (const row of report.rows) {
        map.set(row.strike, row);
      }
    }
    return map;
  }, [report]);

  return {
    report,
    rowsByStrike,
    lastUpdated,
    loaded,
  };
}

// Helper to parse a leg (call or put) from the payload
function parseLeg(data: any): OptionsReportLeg {
  return {
    symbol: data.symbol || "",
    last: data.last,
    bid: data.bid,
    ask: data.ask,
    mid: data.mid,
    volume: data.volume,
    delta: data.delta,
    gamma: data.gamma,
    theta: data.theta,
    vega: data.vega,
    iv: data.iv,
  };
}

/**
 * Find the ATM (at-the-money) row from a report.
 * Returns the row with strike closest to spot price.
 */
export function findAtmRow(report: OptionsReport | undefined): OptionsReportRow | undefined {
  if (!report?.rows?.length || !report.spot) return undefined;

  let closest: OptionsReportRow | undefined;
  let minDiff = Infinity;

  for (const row of report.rows) {
    const diff = Math.abs(row.strike - report.spot);
    if (diff < minDiff) {
      minDiff = diff;
      closest = row;
    }
  }

  return closest;
}

/**
 * Filter rows to a range around ATM.
 * Useful for showing only strikes near the current price.
 *
 * @param report - The options report
 * @param strikesBelowAtm - Number of strikes to show below ATM
 * @param strikesAboveAtm - Number of strikes to show above ATM
 * @returns Filtered rows centered around ATM
 */
export function filterRowsAroundAtm(
  report: OptionsReport | undefined,
  strikesBelowAtm: number = 5,
  strikesAboveAtm: number = 5
): OptionsReportRow[] {
  if (!report?.rows?.length) return [];

  const atmStrike = report.atmStrike ?? report.spot;
  if (!atmStrike) return report.rows;

  // Find ATM index
  let atmIndex = 0;
  let minDiff = Infinity;
  for (let i = 0; i < report.rows.length; i++) {
    const diff = Math.abs(report.rows[i].strike - atmStrike);
    if (diff < minDiff) {
      minDiff = diff;
      atmIndex = i;
    }
  }

  const startIndex = Math.max(0, atmIndex - strikesBelowAtm);
  const endIndex = Math.min(report.rows.length, atmIndex + strikesAboveAtm + 1);

  return report.rows.slice(startIndex, endIndex);
}
