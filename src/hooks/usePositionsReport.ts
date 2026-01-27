/**
 * usePositionsReport - Subscribe to a per-broker server-computed positions report.
 *
 * Each broker (IB, Fidelity) has its own independent report instance on CalcServer,
 * publishing to its own topic. This hook subscribes to one broker's report.
 *
 * The report provides:
 * - Positions with server-computed P&L (current value, entry value, unrealized P&L)
 * - Price changes from close for multiple timeframes
 * - Option metrics: delta equivalent, theta daily, intrinsic/time value
 * - Per-underlying groups with per-expiry subtotals
 * - Cash balances
 * - Summary aggregations
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { socketHub } from "../ws/SocketHub";
import type { TickEnvelope } from "../ws/ws-types";
import { buildOsiSymbol } from "../utils/options";

// Price change for a specific timeframe
export interface TimeframeChange {
  change: number;                // Dollar change from close
  pct: number;                   // Percentage change from close
}

// Position data from the server report
export interface ReportPosition {
  key: string;                    // Unique key: "ib:AAPL" or "fidelity:NVDA250117C00140000"
  source: "ib" | "fidelity";
  symbol: string;                 // Ticker symbol (underlying for options)
  secType: "STK" | "OPT" | "CASH";
  quantity: number;
  avgCost: number;
  accountNumber?: string;
  accountName?: string;
  underlying?: string;

  // Pricing (when available)
  currentPrice?: number;
  currentValue?: number;
  entryValue?: number;
  unrealizedPnl?: number;
  unrealizedPnlPct?: number;

  // Price changes from close (computed server-side)
  // Keys are timeframe IDs: "0d", "1d", "2d", "1w", "1m"
  changes?: Record<string, TimeframeChange>;

  // Option-specific fields
  osiSymbol?: string;
  strike?: number;
  expiry?: string;               // YYYYMMDD
  right?: string;                // "C" or "P"

  // Option Greeks & derived metrics (computed server-side)
  delta?: number;
  gamma?: number;
  theta?: number;
  vega?: number;
  iv?: number;
  deltaEquivalent?: number;      // quantity * 100 * delta
  thetaDaily?: number;           // theta * quantity * 100
  intrinsicValue?: number;
  timeValue?: number;
  exerciseShares?: number;
  exerciseCash?: number;
  isITM?: boolean;
}

// Cash balance entry
export interface ReportCash {
  currency: string;
  amount: number;
}

// Per-broker summary data
export interface ReportSummary {
  totalPositionValue: number;
  totalCash: number;
  totalUnrealizedPnl: number;
  netDelta: number;
  totalThetaDaily: number;
  positionCount: number;
}

// Per-expiry subtotals (computed server-side)
export interface ExpirySubtotal {
  expiry: string;                // YYYYMMDD
  deltaEquivalent: number;
  thetaDaily: number;
  intrinsicValue: number;
  timeValue: number;
  exerciseShares: number;
  exerciseCash: number;
}

// Per-underlying group with nested per-expiry subtotals (computed server-side)
export interface UnderlyingGroupSubtotal {
  underlying: string;
  underlyingPrice?: number;
  equityShares: number;
  totalDeltaEquivalent: number;
  totalThetaDaily: number;
  totalIntrinsicValue: number;
  totalTimeValue: number;
  totalExerciseShares: number;
  totalExerciseCash: number;
  expirySubtotals: ExpirySubtotal[];
}

// Full report structure from server (per-broker, flat)
export interface PositionsReportData {
  clientId: string;
  asOf: number;
  positions: ReportPosition[];
  underlyingGroups: UnderlyingGroupSubtotal[];
  cash: ReportCash[];
  summary: ReportSummary;
  // Reference dates for each timeframe (e.g., { "1d": "2026-01-08", "1w": "2026-01-02" })
  referenceDates?: Record<string, string>;
}

// Hook return type
export interface UsePositionsReportResult {
  report: PositionsReportData | null;
  positions: ReportPosition[];
  underlyingGroups: UnderlyingGroupSubtotal[];
  cash: ReportCash[];
  summary: ReportSummary | null;
  referenceDates: Record<string, string>;  // Timeframe -> date mapping
  loading: boolean;
  error: string | null;
  version: number;               // Increments on each update (for re-render triggers)
  clientId: string;
  refresh: () => void;           // Force refresh positions
}

// Greeks data for a single option position
export interface OptionGreeks {
  delta?: number;
  gamma?: number;
  theta?: number;
  vega?: number;
  iv?: number;
  theo?: number;
  last?: number;
  bid?: number;
  ask?: number;
  mid?: number;
  change?: number;
  changePct?: number;
  changes?: Record<string, TimeframeChange>;
}

/**
 * Look up Greeks for a position by OSI symbol.
 */
export function getGreeksForPosition(
  greeksMap: Map<string, OptionGreeks>,
  underlying: string,
  expiry: string,
  right: string,
  strike: number
): OptionGreeks | undefined {
  const osi = buildOsiSymbol(underlying, expiry, right, strike);
  return greeksMap.get(osi);
}

/**
 * Build a Greeks map from ReportPosition array.
 * Each option gets entries under BOTH key formats:
 * - Colon key: "UNDERLYING:YYYYMMDD:C/P:STRIKE" (used by position tables)
 * - OSI key: "NVDA260117C00140000" (used by ExpiryScenarioAnalysis)
 */
export function buildGreeksMap(positions: ReportPosition[]): Map<string, OptionGreeks> {
  const map = new Map<string, OptionGreeks>();

  for (const p of positions) {
    if (p.secType !== "OPT" || !p.expiry || !p.right || p.strike === undefined) continue;

    const greeks: OptionGreeks = {
      delta: p.delta,
      gamma: p.gamma,
      theta: p.theta,
      vega: p.vega,
      iv: p.iv,
      last: p.currentPrice,
      changes: p.changes,
    };

    // Colon key format: "NVDA:20260117:C:140"
    const colonKey = `${p.symbol.toUpperCase()}:${p.expiry}:${p.right}:${p.strike}`;
    map.set(colonKey, greeks);

    // OSI key format: "NVDA260117C00140000"
    if (p.osiSymbol) {
      map.set(p.osiSymbol.toUpperCase(), greeks);
    } else {
      const osi = buildOsiSymbol(p.symbol, p.expiry, p.right, p.strike);
      map.set(osi, greeks);
    }
  }

  return map;
}

// Generate a stable client ID for this browser session
const getClientId = (): string => {
  const storageKey = "positions_report_client_id";
  let id = sessionStorage.getItem(storageKey);
  if (!id) {
    id = `ui_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
    sessionStorage.setItem(storageKey, id);
  }
  return id;
};

const clientId = getClientId();

export type Broker = "ib" | "fidelity";

export function usePositionsReport(broker: Broker, enabled: boolean = true): UsePositionsReportResult {
  const [report, setReport] = useState<PositionsReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const reportStartedRef = useRef(false);

  const channel = `report.positions.${broker}`;
  const topicPrefix = `report.positions.${broker}.`;

  // Handle incoming report ticks
  const handleTick = useCallback((tick: TickEnvelope) => {
    if (!tick.topic.startsWith(topicPrefix)) return;

    // Check if this is our report (clientId is at index 3: report.positions.<broker>.<clientId>)
    const topicParts = tick.topic.split(".");
    const topicClientId = topicParts[3];
    if (topicClientId !== clientId.toLowerCase()) return;

    try {
      const payload = (tick.data as any)?.data ?? tick.data;
      if (!payload || !Array.isArray(payload.positions)) {
        console.warn(`[usePositionsReport:${broker}] Invalid report format:`, payload);
        return;
      }

      const reportData = payload as PositionsReportData;
      setReport(reportData);
      setLoading(false);
      setError(null);
      setVersion(v => v + 1);
    } catch (e) {
      console.warn(`[usePositionsReport:${broker}] Failed to parse report:`, e);
      setError(e instanceof Error ? e.message : "Failed to parse report");
    }
  }, [broker, topicPrefix]);

  // Register tick handler
  useEffect(() => {
    socketHub.onTick(handleTick);
    return () => {
      socketHub.offTick(handleTick);
    };
  }, [handleTick]);

  // Subscribe to the positions report channel
  useEffect(() => {
    if (!enabled) return;

    const subscribe = () => {
      socketHub.send({
        type: "subscribe",
        channels: [channel],
        symbols: [clientId],
      });
    };

    subscribe();
    socketHub.onConnect(subscribe);

    return () => {
      socketHub.offConnect(subscribe);
      socketHub.send({
        type: "unsubscribe",
        channels: [channel],
        symbols: [clientId],
      });
    };
  }, [enabled, channel]);

  // Start the positions report on the server
  useEffect(() => {
    if (!enabled) {
      if (reportStartedRef.current) {
        socketHub.sendControl("stop_positions_report", {
          target: "calc",
          clientId: clientId,
          broker: broker,
        }).catch(() => { /* ignore */ });
        reportStartedRef.current = false;
      }
      return;
    }

    setLoading(true);

    socketHub.sendControl("start_positions_report", {
      target: "calc",
      clientId: clientId,
      broker: broker,
    }).then(() => {
      reportStartedRef.current = true;
    }).catch(err => {
      console.error(`[usePositionsReport:${broker}] Failed to start report:`, err);
      setError(err instanceof Error ? err.message : "Failed to start positions report");
      setLoading(false);
    });

    return () => {
      if (reportStartedRef.current) {
        socketHub.sendControl("stop_positions_report", {
          target: "calc",
          clientId: clientId,
          broker: broker,
        }).catch(() => { /* ignore */ });
        reportStartedRef.current = false;
      }
    };
  }, [enabled, broker]);

  // Force refresh positions
  const refresh = useCallback(() => {
    if (!reportStartedRef.current) return;

    socketHub.sendControl("refresh_positions", {
      target: "calc",
      clientId: clientId,
    }).catch(err => console.warn(`[usePositionsReport:${broker}] Failed to refresh positions:`, err));
  }, [broker]);

  // Direct access — no filtering needed, the report is already broker-specific
  const positions = report?.positions ?? [];
  const underlyingGroups = report?.underlyingGroups ?? [];
  const cash = report?.cash ?? [];
  const summary = report?.summary ?? null;
  const referenceDates = report?.referenceDates ?? {};

  return {
    report,
    positions,
    underlyingGroups,
    cash,
    summary,
    referenceDates,
    loading,
    error,
    version,
    clientId,
    refresh,
  };
}

// Export the clientId for use by other hooks (e.g., Fidelity upload)
export { clientId as positionsReportClientId };
