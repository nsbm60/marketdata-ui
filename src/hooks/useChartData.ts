/**
 * useChartData - Hook to fetch historical bars and subscribe to live candle updates.
 *
 * Flow:
 * 1. Sends get_chart_data control request to CalcServer
 * 2. Receives historical bars + starts streaming candle report
 * 3. Aggregates bars for 10m/20m timeframes
 * 4. Updates live candle from streaming updates
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { socketHub } from "../ws/SocketHub";
import type { TickEnvelope } from "../ws/ws-types";
import { aggregateBars, Bar } from "../utils/barAggregation";

// ATR data point
export interface AtrDataPoint {
  timestamp: number;
  atr: number;
}

// Response shape from CalcServer's get_chart_data
export interface ChartDataResponse {
  symbol: string;
  timeframe: string;
  reportTopic: string;
  aggregateMultiple: number;
  hasMore?: boolean;  // For pagination - true if more historical data is available
  bars: Bar[];
  atr?: AtrDataPoint[];  // ATR values if atrPeriod was requested
  atrPeriod?: number;
  atrReportTopic?: string;
}

// Live candle update shape from CandleReportBuilder
export interface LiveCandleUpdate {
  symbol: string;
  timeframe: string;
  asOf: number;
  barType: "live" | "completed" | "empty";
  timestamp?: number;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  volume?: number;
  complete?: boolean;
}

export interface UseChartDataResult {
  /** Historical bars (aggregated if needed) */
  bars: Bar[];
  /** Current live candle (may be partial) */
  liveCandle: Bar | undefined;
  /** Whether initial data is loading */
  loading: boolean;
  /** Whether more historical data is being loaded */
  loadingMore: boolean;
  /** Error message if fetch failed */
  error: string | undefined;
  /** Aggregation multiple (1 for no aggregation, 2 for 10m, 4 for 20m) */
  aggregateMultiple: number;
  /** Whether more historical data is available */
  hasMore: boolean;
  /** ATR (Average True Range) data points */
  atrData: AtrDataPoint[];
  /** Current live ATR value */
  liveAtr: number | undefined;
  /** Refresh data (re-fetch historical) */
  refresh: () => void;
  /** Load more historical data (prepend older bars) */
  loadMore: () => void;
}

/**
 * Fetch chart data and subscribe to live updates.
 *
 * @param symbol - Equity symbol (e.g., "NVDA")
 * @param timeframe - Bar timeframe (e.g., "5m", "10m", "1d")
 * @param barCount - Number of visible bars to display (default: 200)
 * @param enabled - Whether to fetch and subscribe (false = disabled)
 * @param session - Market session: "extended" (default) or "regular"
 * @param warmupBars - Extra bars to load for indicator warm-up (default: 0)
 * @param atrPeriod - ATR period to calculate (undefined = no ATR)
 */
export function useChartData(
  symbol: string | undefined,
  timeframe: string,
  barCount: number = 200,
  enabled: boolean = true,
  session: "extended" | "regular" = "extended",
  warmupBars: number = 0,
  atrPeriod?: number
): UseChartDataResult {
  const [bars, setBars] = useState<Bar[]>([]);
  const [liveCandle, setLiveCandle] = useState<Bar | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [aggregateMultiple, setAggregateMultiple] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [atrData, setAtrData] = useState<AtrDataPoint[]>([]);
  const [liveAtr, setLiveAtr] = useState<number | undefined>(undefined);

  // Track current report topic for cleanup
  const reportTopicRef = useRef<string | undefined>(undefined);
  const atrReportTopicRef = useRef<string | undefined>(undefined);
  const symbolRef = useRef<string | undefined>(undefined);
  const timeframeRef = useRef<string>(timeframe);
  const atrPeriodRef = useRef<number | undefined>(atrPeriod);

  // Update refs
  symbolRef.current = symbol;
  timeframeRef.current = timeframe;
  atrPeriodRef.current = atrPeriod;

  // Fetch data function
  const fetchData = useCallback(async () => {
    if (!symbol || !enabled) {
      setBars([]);
      setLiveCandle(undefined);
      setAtrData([]);
      setLiveAtr(undefined);
      setError(undefined);
      return;
    }

    setLoading(true);
    setError(undefined);

    try {
      // Request extra bars for indicator warm-up
      const totalBars = barCount + warmupBars;
      console.log(`[useChartData] Fetching chart data for ${symbol} @ ${timeframe} (${barCount} visible + ${warmupBars} warmup = ${totalBars} total)${atrPeriod ? ` with ATR(${atrPeriod})` : ''}`);

      const requestPayload: Record<string, unknown> = {
        target: "calc",
        symbol: symbol.toUpperCase(),
        timeframe,
        barCount: totalBars,
        session,
      };
      if (atrPeriod !== undefined && atrPeriod > 0) {
        requestPayload.atrPeriod = atrPeriod;
      }

      const ack = await socketHub.sendControl(
        "get_chart_data",
        requestPayload,
        { timeoutMs: 15000 }
      );

      if (!ack.ok) {
        throw new Error((ack as any).error || "Failed to fetch chart data");
      }

      // Extract response data (may be nested under ack.data.data)
      const responseData: ChartDataResponse =
        (ack.data as any)?.data || (ack.data as ChartDataResponse);

      console.log(
        `[useChartData] Received ${responseData.bars?.length || 0} bars, topic: ${responseData.reportTopic}, aggregate: ${responseData.aggregateMultiple}, hasMore: ${responseData.hasMore}`
      );

      setAggregateMultiple(responseData.aggregateMultiple || 1);
      setHasMore(responseData.hasMore !== false); // Default to true if not specified

      // Aggregate bars if needed
      let processedBars = responseData.bars || [];
      if (responseData.aggregateMultiple > 1) {
        processedBars = aggregateBars(processedBars, responseData.aggregateMultiple);
        console.log(`[useChartData] Aggregated to ${processedBars.length} bars`);
      }

      setBars(processedBars);
      setLiveCandle(undefined); // Reset live candle
      reportTopicRef.current = responseData.reportTopic;

      // Handle ATR data if present
      if (responseData.atr && responseData.atr.length > 0) {
        console.log(`[useChartData] Received ${responseData.atr.length} ATR data points`);
        setAtrData(responseData.atr);
        atrReportTopicRef.current = responseData.atrReportTopic;
      } else {
        setAtrData([]);
        atrReportTopicRef.current = undefined;
      }
      setLiveAtr(undefined);

      setLoading(false);
    } catch (err) {
      console.error("[useChartData] Fetch error:", err);
      setError(err instanceof Error ? err.message : "Unknown error");
      setLoading(false);
    }
  }, [symbol, timeframe, barCount, enabled, session, warmupBars, atrPeriod]);

  // Fetch on mount and when dependencies change
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Subscribe to live candle updates
  useEffect(() => {
    if (!symbol || !enabled || !reportTopicRef.current) {
      return;
    }

    const topic = reportTopicRef.current;

    // Subscribe to report.candle channel
    // Topic format: report.candle.{symbol}.{timeframe}
    // Subscription key is "{symbol}.{timeframe}" (everything after "report.candle.")
    const channel = "report.candle";
    const prefix = "report.candle.";
    const subscriptionKey = topic.startsWith(prefix)
      ? topic.substring(prefix.length)
      : `${symbol.toLowerCase()}.${timeframeRef.current}`;

    socketHub.send({
      type: "subscribe",
      channels: [channel],
      symbols: [subscriptionKey],
    });

    const handleTick = (tick: TickEnvelope) => {
      // Check if this is our candle report
      if (!tick.topic.startsWith("report.candle.")) return;

      // Extract symbol from topic: report.candle.NVDA.5m
      const tickParts = tick.topic.split(".");
      if (tickParts.length < 4) return;

      const tickSymbol = tickParts[2];
      const tickTimeframe = tickParts[3];

      // Match current symbol and timeframe
      if (
        tickSymbol.toUpperCase() !== symbolRef.current?.toUpperCase() ||
        tickTimeframe.toLowerCase() !== timeframeRef.current.toLowerCase()
      ) {
        return;
      }

      try {
        // Parse candle update
        const payload = (tick.data as any)?.data ?? tick.data;
        const update = payload as LiveCandleUpdate;

        console.log(`[useChartData] Candle update: ${update.barType}, ts=${update.timestamp}, close=${update.close}`);

        if (update.barType === "empty") {
          // No data yet
          return;
        }

        if (update.barType === "completed" && update.timestamp !== undefined) {
          // A bar just completed - add it to bars and clear live candle
          const completedBar: Bar = {
            t: new Date(update.timestamp).toISOString(),
            o: update.open || 0,
            h: update.high || 0,
            l: update.low || 0,
            c: update.close || 0,
            v: update.volume || 0,
          };

          setBars((prev) => {
            // Avoid duplicates - check if last bar has same timestamp
            const last = prev[prev.length - 1];
            if (last && new Date(last.t).getTime() === update.timestamp) {
              // Update last bar
              return [...prev.slice(0, -1), completedBar];
            }
            // Append new bar
            return [...prev, completedBar];
          });
          setLiveCandle(undefined);
        } else if (update.barType === "live" && update.timestamp !== undefined) {
          // Update live candle
          setLiveCandle({
            t: new Date(update.timestamp).toISOString(),
            o: update.open || 0,
            h: update.high || 0,
            l: update.low || 0,
            c: update.close || 0,
            v: update.volume || 0,
          });
        }
      } catch (e) {
        console.warn("[useChartData] Failed to parse candle update:", e);
      }
    };

    socketHub.onTick(handleTick);

    return () => {
      socketHub.offTick(handleTick);
      socketHub.send({
        type: "unsubscribe",
        channels: [channel],
        symbols: [subscriptionKey],
      });
    };
  }, [symbol, timeframe, enabled, bars.length]); // Re-subscribe when symbol, timeframe, or bars change

  // Stop candle report on unmount or symbol/timeframe change
  // Only send stop request if we actually started a report (reportTopicRef is set)
  useEffect(() => {
    return () => {
      if (reportTopicRef.current && symbolRef.current && timeframeRef.current) {
        // Send stop request (fire and forget)
        socketHub.send({
          type: "control",
          target: "calc",
          op: "stop_candle_report",
          id: `stop_candle_${Date.now()}`,
          symbol: symbolRef.current,
          timeframe: timeframeRef.current,
        });
        reportTopicRef.current = undefined;
      }
    };
  }, [symbol, timeframe]);

  // Subscribe to live ATR updates
  useEffect(() => {
    if (!symbol || !enabled || !atrReportTopicRef.current || !atrPeriod) {
      return;
    }

    const topic = atrReportTopicRef.current;
    const channel = "report.atr";
    const prefix = "report.atr.";
    const subscriptionKey = topic.startsWith(prefix)
      ? topic.substring(prefix.length)
      : `${symbol.toLowerCase()}.${timeframeRef.current}`;

    socketHub.send({
      type: "subscribe",
      channels: [channel],
      symbols: [subscriptionKey],
    });

    const handleAtrTick = (tick: TickEnvelope) => {
      if (!tick.topic.startsWith("report.atr.")) return;

      const tickParts = tick.topic.split(".");
      if (tickParts.length < 4) return;

      const tickSymbol = tickParts[2];
      const tickTimeframe = tickParts[3];

      if (
        tickSymbol.toUpperCase() !== symbolRef.current?.toUpperCase() ||
        tickTimeframe.toLowerCase() !== timeframeRef.current.toLowerCase()
      ) {
        return;
      }

      try {
        const payload = (tick.data as any)?.data ?? tick.data;
        const atrValue = payload.atr as number;
        const timestamp = payload.timestamp as number;

        if (atrValue !== undefined) {
          setLiveAtr(atrValue);

          // Also update atrData with the new point
          setAtrData((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.timestamp === timestamp) {
              // Update existing point
              return [...prev.slice(0, -1), { timestamp, atr: atrValue }];
            }
            // Append new point
            return [...prev, { timestamp, atr: atrValue }];
          });
        }
      } catch (e) {
        console.warn("[useChartData] Failed to parse ATR update:", e);
      }
    };

    socketHub.onTick(handleAtrTick);

    return () => {
      socketHub.offTick(handleAtrTick);
      socketHub.send({
        type: "unsubscribe",
        channels: [channel],
        symbols: [subscriptionKey],
      });
    };
  }, [symbol, timeframe, enabled, atrPeriod, atrData.length]);

  // Stop ATR report on unmount or when ATR is disabled
  useEffect(() => {
    return () => {
      if (atrReportTopicRef.current && symbolRef.current && timeframeRef.current && atrPeriodRef.current) {
        socketHub.send({
          type: "control",
          target: "calc",
          op: "stop_atr",
          id: `stop_atr_${Date.now()}`,
          symbol: symbolRef.current,
          timeframe: timeframeRef.current,
          period: atrPeriodRef.current,
        });
        atrReportTopicRef.current = undefined;
      }
    };
  }, [symbol, timeframe, atrPeriod]);

  // Load more historical data (older bars)
  const loadMore = useCallback(async () => {
    if (!symbol || !enabled || bars.length === 0 || loadingMore || !hasMore) {
      return;
    }

    // Get the oldest bar's timestamp for pagination
    const oldestBar = bars[0];
    const endBefore = oldestBar.t;

    setLoadingMore(true);

    try {
      console.log(`[useChartData] Loading more bars before ${endBefore}`);

      const ack = await socketHub.sendControl(
        "get_chart_data",
        {
          target: "calc",
          symbol: symbol.toUpperCase(),
          timeframe,
          barCount: barCount + warmupBars,
          session,
          endBefore, // Pagination: fetch bars before this timestamp
        },
        { timeoutMs: 15000 }
      );

      if (!ack.ok) {
        throw new Error((ack as any).error || "Failed to load more chart data");
      }

      const responseData: ChartDataResponse =
        (ack.data as any)?.data || (ack.data as ChartDataResponse);

      console.log(
        `[useChartData] Loaded ${responseData.bars?.length || 0} more bars, hasMore: ${responseData.hasMore}`
      );

      setHasMore(responseData.hasMore !== false);

      // Aggregate if needed
      let newBars = responseData.bars || [];
      if (responseData.aggregateMultiple > 1) {
        newBars = aggregateBars(newBars, responseData.aggregateMultiple);
      }

      // Prepend new bars to existing bars (older data goes first)
      if (newBars.length > 0) {
        setBars((prev) => {
          // Avoid duplicates: filter out any bars that already exist
          const existingTimestamps = new Set(prev.map((b) => b.t));
          const uniqueNewBars = newBars.filter((b) => !existingTimestamps.has(b.t));
          return [...uniqueNewBars, ...prev];
        });
      }

      setLoadingMore(false);
    } catch (err) {
      console.error("[useChartData] Load more error:", err);
      setLoadingMore(false);
    }
  }, [symbol, timeframe, barCount, enabled, session, warmupBars, bars, loadingMore, hasMore]);

  return {
    bars,
    liveCandle,
    loading,
    loadingMore,
    error,
    aggregateMultiple,
    hasMore,
    atrData,
    liveAtr,
    refresh: fetchData,
    loadMore,
  };
}
