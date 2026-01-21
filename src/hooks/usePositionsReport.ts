/**
 * usePositionsReport - Subscribe to server-computed positions report.
 *
 * The PositionsReport on CalcServer provides:
 * - Combined IB + Fidelity positions
 * - Server-computed P&L (current value, entry value, unrealized P&L)
 * - Option metrics: delta equivalent, theta daily, intrinsic/time value
 * - Cash balances from all sources
 * - Summary aggregations
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { socketHub } from "../ws/SocketHub";
import type { TickEnvelope } from "../ws/ws-types";

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
  source: "ib" | "fidelity";
  currency: string;
  amount: number;
}

// Summary data
export interface ReportSummary {
  totalPositionValue: number;
  totalCash: number;
  totalUnrealizedPnl: number;
  netDelta: number;
  totalThetaDaily: number;
  ibPositionCount: number;
  fidelityPositionCount: number;
}

// Full report structure from server
export interface PositionsReportData {
  clientId: string;
  asOf: number;
  positions: ReportPosition[];
  cash: ReportCash[];
  summary: ReportSummary;
  // Reference dates for each timeframe (e.g., { "1d": "2026-01-08", "1w": "2026-01-02" })
  referenceDates?: Record<string, string>;
}

// Hook return type
export interface UsePositionsReportResult {
  report: PositionsReportData | null;
  positions: ReportPosition[];
  ibPositions: ReportPosition[];
  fidelityPositions: ReportPosition[];
  cash: ReportCash[];
  summary: ReportSummary | null;
  referenceDates: Record<string, string>;  // Timeframe -> date mapping
  loading: boolean;
  error: string | null;
  version: number;               // Increments on each update (for re-render triggers)
  clientId: string;
  refresh: () => void;           // Force refresh positions
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

export function usePositionsReport(enabled: boolean = true): UsePositionsReportResult {
  const [report, setReport] = useState<PositionsReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const reportStartedRef = useRef(false);

  // Handle incoming report ticks
  const handleTick = useCallback((tick: TickEnvelope) => {
    if (!tick.topic.startsWith("report.positions.")) return;

    // Check if this is our report
    const topicParts = tick.topic.split(".");
    const topicClientId = topicParts[2];
    if (topicClientId !== clientId.toLowerCase()) return;

    try {
      const payload = (tick.data as any)?.data ?? tick.data;
      if (!payload || !Array.isArray(payload.positions)) {
        console.warn("[usePositionsReport] Invalid report format:", payload);
        return;
      }

      const reportData = payload as PositionsReportData;
      setReport(reportData);
      setLoading(false);
      setError(null);
      setVersion(v => v + 1);
    } catch (e) {
      console.warn("[usePositionsReport] Failed to parse report:", e);
      setError(e instanceof Error ? e.message : "Failed to parse report");
    }
  }, []);

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
        channels: ["report.positions"],
        symbols: [clientId],
      });
    };

    // Subscribe now
    subscribe();

    // Resubscribe on WebSocket reconnect
    socketHub.onConnect(subscribe);

    return () => {
      socketHub.offConnect(subscribe);
      socketHub.send({
        type: "unsubscribe",
        channels: ["report.positions"],
        symbols: [clientId],
      });
    };
  }, [enabled]);

  // Start the positions report on the server
  useEffect(() => {
    if (!enabled) {
      // Stop the report if disabled
      if (reportStartedRef.current) {
        socketHub.sendControl("stop_positions_report", {
          target: "calc",
          clientId: clientId,
        }).catch(() => { /* ignore */ });
        reportStartedRef.current = false;
      }
      return;
    }

    // Start the report
    setLoading(true);

    socketHub.sendControl("start_positions_report", {
      target: "calc",
      clientId: clientId,
    }).then(() => {
      reportStartedRef.current = true;
    }).catch(err => {
      console.error("[usePositionsReport] Failed to start report:", err);
      setError(err instanceof Error ? err.message : "Failed to start positions report");
      setLoading(false);
    });

    // Cleanup: stop the report when unmounting
    return () => {
      if (reportStartedRef.current) {
        socketHub.sendControl("stop_positions_report", {
          target: "calc",
          clientId: clientId,
        }).catch(() => { /* ignore */ });
        reportStartedRef.current = false;
      }
    };
  }, [enabled]);

  // Force refresh positions
  const refresh = useCallback(() => {
    if (!reportStartedRef.current) return;

    socketHub.sendControl("refresh_positions", {
      target: "calc",
      clientId: clientId,
    }).catch(err => console.warn("[usePositionsReport] Failed to refresh positions:", err));
  }, []);

  // Derived data
  const positions = report?.positions ?? [];
  const ibPositions = positions.filter(p => p.source === "ib");
  const fidelityPositions = positions.filter(p => p.source === "fidelity");
  const cash = report?.cash ?? [];
  const summary = report?.summary ?? null;
  const referenceDates = report?.referenceDates ?? {};

  return {
    report,
    positions,
    ibPositions,
    fidelityPositions,
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
