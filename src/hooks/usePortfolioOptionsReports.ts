/**
 * usePortfolioOptionsReports - Get Greeks for portfolio option positions via dedicated report.
 *
 * Uses the PortfolioOptionsReport on CalcServer which efficiently tracks only the
 * specific contracts in the portfolio (rather than full chains).
 */

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { socketHub } from "../ws/SocketHub";
import type { TickEnvelope } from "../ws/ws-types";
import { buildOsiSymbol } from "../utils/options";

// Change data for a specific timeframe
export interface TimeframeChange {
  pct: number;
  change: number;
}

// Greeks data for a single option (includes all report data)
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
  change?: number;      // 1d change
  changePct?: number;   // 1d % change
  changes?: Record<string, TimeframeChange>;  // Multi-timeframe changes (1d, 2d, 1w, 1m)
}

// Position info needed to build OSI symbols
export interface PortfolioOptionPosition {
  underlying: string;
  expiry: string;      // YYYY-MM-DD or YYYYMMDD
  strike: number;
  right: "C" | "P" | string;
}

// Report option data from server
interface ReportOption {
  symbol: string;      // OSI symbol
  last?: number;
  bid?: number;
  ask?: number;
  mid?: number;
  delta?: number;
  gamma?: number;
  theta?: number;
  vega?: number;
  iv?: number;
  change?: number;
  changePct?: number;
  changes?: Record<string, { pct: number; change: number }>;
}

// Report data structure
interface PortfolioOptionsReportData {
  clientId: string;
  asOf: number;
  contractCount: number;
  options: ReportOption[];
}

// Generate a stable client ID for this browser session
const clientId = `ui_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;

export interface UsePortfolioOptionsReportsResult {
  greeksMap: Map<string, OptionGreeks>;
  version: number;
  subscribedContracts: number;
}

export function usePortfolioOptionsReports(
  positions: PortfolioOptionPosition[],
  enabled: boolean = true
): UsePortfolioOptionsReportsResult {
  // Greeks lookup map keyed by OSI symbol
  const greeksMapRef = useRef<Map<string, OptionGreeks>>(new Map());
  const [version, setVersion] = useState(0);
  const reportStartedRef = useRef(false);

  // Build list of OSI symbols from positions
  const contracts = useMemo(() => {
    const symbols = new Set<string>();
    for (const pos of positions) {
      if (!pos.underlying || !pos.expiry) continue;
      const osi = buildOsiSymbol(pos.underlying, pos.expiry, pos.right, pos.strike);
      symbols.add(osi);
    }
    return Array.from(symbols);
  }, [positions]);

  // Tick handler for portfolio options report
  const handleTick = useCallback((tick: TickEnvelope) => {
    if (!tick.topic.startsWith("report.portfolio.options.")) return;

    // Check if this is our report
    const topicParts = tick.topic.split(".");
    const topicClientId = topicParts[3];
    if (topicClientId !== clientId.toLowerCase()) return;

    try {
      const payload = (tick.data as any)?.data ?? tick.data;
      if (!payload || !Array.isArray(payload.options)) {
        console.warn("[usePortfolioOptionsReports] Invalid report format:", payload);
        return;
      }

      const report = payload as PortfolioOptionsReportData;

      // Update Greeks map keyed by OSI symbol
      for (const opt of report.options) {
        if (!opt.symbol) continue;
        greeksMapRef.current.set(opt.symbol.toUpperCase(), {
          delta: opt.delta,
          gamma: opt.gamma,
          theta: opt.theta,
          vega: opt.vega,
          iv: opt.iv,
          last: opt.last,
          bid: opt.bid,
          ask: opt.ask,
          mid: opt.mid,
          change: opt.change,
          changePct: opt.changePct,
          changes: opt.changes,
        });
      }

      // Increment version to trigger re-renders
      setVersion(v => v + 1);
    } catch (e) {
      console.warn("[usePortfolioOptionsReports] Failed to parse report:", e);
    }
  }, []);

  // Register tick handler
  useEffect(() => {
    socketHub.onTick(handleTick);
    return () => {
      socketHub.offTick(handleTick);
    };
  }, [handleTick]);

  // Subscribe to the portfolio options report channel
  useEffect(() => {
    if (!enabled || contracts.length === 0) return;

    socketHub.send({
      type: "subscribe",
      channels: ["report.portfolio.options"],
      symbols: [clientId],
    });

    return () => {
      socketHub.send({
        type: "unsubscribe",
        channels: ["report.portfolio.options"],
        symbols: [clientId],
      });
    };
  }, [enabled, contracts.length > 0]);

  // Start/update the portfolio options report on the server
  useEffect(() => {
    if (!enabled || contracts.length === 0) {
      // Stop the report if no contracts
      if (reportStartedRef.current) {
        socketHub.sendControl("stop_portfolio_options_report", {
          target: "calc",
          clientId: clientId,
        }).catch(() => { /* ignore */ });
        reportStartedRef.current = false;
      }
      return;
    }

    // Validate OSI format before sending: SYMBOL + YYMMDD + C/P + 8 digits
    const osiPattern = /^[A-Z]{1,6}\d{6}[CP]\d{8}$/;
    const validContracts = contracts.filter(c => osiPattern.test(c));

    if (validContracts.length === 0) {
      return;
    }

    socketHub.sendControl("start_portfolio_options_report", {
      target: "calc",
      clientId: clientId,
      contracts: validContracts,
    }).then(ack => {
      if (!ack.ok) {
        console.error("[usePortfolioOptionsReports] Server rejected request:", ack.error);
      }
      reportStartedRef.current = true;
    }).catch(err => {
      console.error("[usePortfolioOptionsReports] Failed to start report:", err);
    });

    // Cleanup: stop the report when unmounting
    return () => {
      socketHub.sendControl("stop_portfolio_options_report", {
        target: "calc",
        clientId: clientId,
      }).catch(() => { /* ignore */ });
      reportStartedRef.current = false;
    };
  }, [enabled, contracts.join(",")]);

  return {
    greeksMap: greeksMapRef.current,
    version,
    subscribedContracts: contracts.length,
  };
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
