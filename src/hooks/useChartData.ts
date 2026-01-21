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
import { aggregateBars, Bar } from "../utils/barAggregation";
import { useSubscription } from "./useSubscription";

// Indicator data point types
export interface AtrDataPoint {
  timestamp: number;
  atr: number;
}

export interface RsiDataPoint {
  timestamp: number;
  rsi: number;
}

export interface MacdDataPoint {
  timestamp: number;
  macd: number;
  signal: number;
  histogram: number;
}

// Response shape from CalcServer's get_chart_data
export interface ChartDataResponse {
  symbol: string;
  timeframe: string;
  reportTopic: string;
  aggregateMultiple: number;
  hasMore?: boolean;  // For pagination - true if more historical data is available
  bars: Bar[];
  // ATR
  atr?: AtrDataPoint[];
  atrPeriod?: number;
  atrReportTopic?: string;
  // RSI
  rsi?: RsiDataPoint[];
  rsiPeriod?: number;
  rsiReportTopic?: string;
  // MACD
  macd?: MacdDataPoint[];
  macdFast?: number;
  macdSlow?: number;
  macdSignal?: number;
  macdReportTopic?: string;
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
  /** RSI (Relative Strength Index) data points */
  rsiData: RsiDataPoint[];
  /** Current live RSI value */
  liveRsi: number | undefined;
  /** MACD data points */
  macdData: MacdDataPoint[];
  /** Current live MACD values */
  liveMacd: MacdDataPoint | undefined;
  /** Refresh data (re-fetch historical) */
  refresh: () => void;
  /** Load more historical data (prepend older bars) */
  loadMore: () => void;
}

/** Indicator settings for useChartData */
export interface ChartIndicatorSettings {
  atrPeriod?: number;
  rsiPeriod?: number;
  macdFast?: number;
  macdSlow?: number;
  macdSignal?: number;
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
 * @param indicators - Optional indicator settings (ATR, RSI, MACD)
 */
export function useChartData(
  symbol: string | undefined,
  timeframe: string,
  barCount: number = 200,
  enabled: boolean = true,
  session: "extended" | "regular" = "extended",
  warmupBars: number = 0,
  indicators?: ChartIndicatorSettings
): UseChartDataResult {
  const { atrPeriod, rsiPeriod, macdFast, macdSlow, macdSignal } = indicators || {};
  const [bars, setBars] = useState<Bar[]>([]);
  const [liveCandle, setLiveCandle] = useState<Bar | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [aggregateMultiple, setAggregateMultiple] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [atrData, setAtrData] = useState<AtrDataPoint[]>([]);
  const [liveAtr, setLiveAtr] = useState<number | undefined>(undefined);
  const [rsiData, setRsiData] = useState<RsiDataPoint[]>([]);
  const [liveRsi, setLiveRsi] = useState<number | undefined>(undefined);
  const [macdData, setMacdData] = useState<MacdDataPoint[]>([]);
  const [liveMacd, setLiveMacd] = useState<MacdDataPoint | undefined>(undefined);

  // Subscription keys (set when reports start, cleared on symbol/timeframe change)
  // Format: "{symbol}.{timeframe}" for candles, or specific topic suffix for indicators
  const [candleSubKey, setCandleSubKey] = useState<string>("");
  const [atrSubKey, setAtrSubKey] = useState<string>("");
  const [rsiSubKey, setRsiSubKey] = useState<string>("");
  const [macdSubKey, setMacdSubKey] = useState<string>("");

  // Track current report topic for cleanup (still need ref for stop requests)
  const reportTopicRef = useRef<string | undefined>(undefined);
  const atrReportTopicRef = useRef<string | undefined>(undefined);
  const rsiReportTopicRef = useRef<string | undefined>(undefined);
  const macdReportTopicRef = useRef<string | undefined>(undefined);
  const symbolRef = useRef<string | undefined>(undefined);
  const timeframeRef = useRef<string>(timeframe);
  const atrPeriodRef = useRef<number | undefined>(atrPeriod);
  const rsiPeriodRef = useRef<number | undefined>(rsiPeriod);
  const macdSettingsRef = useRef<{ fast?: number; slow?: number; signal?: number }>({});

  // Update refs
  symbolRef.current = symbol;
  timeframeRef.current = timeframe;
  atrPeriodRef.current = atrPeriod;
  rsiPeriodRef.current = rsiPeriod;
  macdSettingsRef.current = { fast: macdFast, slow: macdSlow, signal: macdSignal };

  // Fetch data function
  const fetchData = useCallback(async () => {
    if (!symbol || !enabled) {
      setBars([]);
      setLiveCandle(undefined);
      setAtrData([]);
      setLiveAtr(undefined);
      setRsiData([]);
      setLiveRsi(undefined);
      setMacdData([]);
      setLiveMacd(undefined);
      setError(undefined);
      return;
    }

    setLoading(true);
    setError(undefined);

    try {
      // Request extra bars for indicator warm-up
      const totalBars = barCount + warmupBars;
      const indicatorDesc = [
        atrPeriod ? `ATR(${atrPeriod})` : null,
        rsiPeriod ? `RSI(${rsiPeriod})` : null,
        macdFast && macdSlow && macdSignal ? `MACD(${macdFast},${macdSlow},${macdSignal})` : null,
      ].filter(Boolean).join(', ');
      console.log(`[useChartData] Fetching chart data for ${symbol} @ ${timeframe} (${barCount} visible + ${warmupBars} warmup = ${totalBars} total)${indicatorDesc ? ` with ${indicatorDesc}` : ''}`);

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
      if (rsiPeriod !== undefined && rsiPeriod > 0) {
        requestPayload.rsiPeriod = rsiPeriod;
      }
      if (macdFast !== undefined && macdSlow !== undefined && macdSignal !== undefined) {
        requestPayload.macdFast = macdFast;
        requestPayload.macdSlow = macdSlow;
        requestPayload.macdSignal = macdSignal;
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

      // Set candle subscription key (extract from topic: "report.candle.nvda.5m" -> "nvda.5m")
      const candlePrefix = "report.candle.";
      const candleKey = responseData.reportTopic?.startsWith(candlePrefix)
        ? responseData.reportTopic.substring(candlePrefix.length)
        : "";
      setCandleSubKey(candleKey);

      // Handle ATR data if present
      if (responseData.atr && responseData.atr.length > 0) {
        console.log(`[useChartData] Received ${responseData.atr.length} ATR data points`);
        setAtrData(responseData.atr);
        atrReportTopicRef.current = responseData.atrReportTopic;
        const atrPrefix = "report.atr.";
        setAtrSubKey(responseData.atrReportTopic?.startsWith(atrPrefix)
          ? responseData.atrReportTopic.substring(atrPrefix.length) : "");
      } else {
        setAtrData([]);
        atrReportTopicRef.current = undefined;
        setAtrSubKey("");
      }
      setLiveAtr(undefined);

      // Handle RSI data if present
      if (responseData.rsi && responseData.rsi.length > 0) {
        console.log(`[useChartData] Received ${responseData.rsi.length} RSI data points`);
        setRsiData(responseData.rsi);
        rsiReportTopicRef.current = responseData.rsiReportTopic;
        const rsiPrefix = "report.rsi.";
        setRsiSubKey(responseData.rsiReportTopic?.startsWith(rsiPrefix)
          ? responseData.rsiReportTopic.substring(rsiPrefix.length) : "");
      } else {
        setRsiData([]);
        rsiReportTopicRef.current = undefined;
        setRsiSubKey("");
      }
      setLiveRsi(undefined);

      // Handle MACD data if present
      if (responseData.macd && responseData.macd.length > 0) {
        console.log(`[useChartData] Received ${responseData.macd.length} MACD data points`);
        setMacdData(responseData.macd);
        macdReportTopicRef.current = responseData.macdReportTopic;
        const macdPrefix = "report.macd.";
        setMacdSubKey(responseData.macdReportTopic?.startsWith(macdPrefix)
          ? responseData.macdReportTopic.substring(macdPrefix.length) : "");
      } else {
        setMacdData([]);
        macdReportTopicRef.current = undefined;
        setMacdSubKey("");
      }
      setLiveMacd(undefined);

      setLoading(false);
    } catch (err) {
      console.error("[useChartData] Fetch error:", err);
      setError(err instanceof Error ? err.message : "Unknown error");
      setLoading(false);
    }
  }, [symbol, timeframe, barCount, enabled, session, warmupBars, atrPeriod, rsiPeriod, macdFast, macdSlow, macdSignal]);

  // Fetch on mount and when dependencies change
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Subscribe to live candle updates using centralized subscription hook
  useSubscription({
    channel: "report.candle",
    symbol: candleSubKey,
    enabled: enabled && !!candleSubKey,
    onMessage: (tick) => {
      try {
        const payload = (tick.data as any)?.data ?? tick.data;
        const update = payload as LiveCandleUpdate;

        console.log(`[useChartData] Candle update: ${update.barType}, ts=${update.timestamp}, close=${update.close}`);

        if (update.barType === "empty") return;

        if (update.barType === "completed" && update.timestamp !== undefined) {
          const completedBar: Bar = {
            t: new Date(update.timestamp).toISOString(),
            o: update.open || 0,
            h: update.high || 0,
            l: update.low || 0,
            c: update.close || 0,
            v: update.volume || 0,
          };

          setBars((prev) => {
            const last = prev[prev.length - 1];
            if (last && new Date(last.t).getTime() === update.timestamp) {
              return [...prev.slice(0, -1), completedBar];
            }
            return [...prev, completedBar];
          });
          setLiveCandle(undefined);
        } else if (update.barType === "live" && update.timestamp !== undefined) {
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
    },
  });

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

  // Subscribe to live ATR updates using centralized subscription hook
  useSubscription({
    channel: "report.atr",
    symbol: atrSubKey,
    enabled: enabled && !!atrSubKey && !!atrPeriod,
    onMessage: (tick) => {
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
              return [...prev.slice(0, -1), { timestamp, atr: atrValue }];
            }
            return [...prev, { timestamp, atr: atrValue }];
          });
        }
      } catch (e) {
        console.warn("[useChartData] Failed to parse ATR update:", e);
      }
    },
  });

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

  // Subscribe to live RSI updates using centralized subscription hook
  useSubscription({
    channel: "report.rsi",
    symbol: rsiSubKey,
    enabled: enabled && !!rsiSubKey && !!rsiPeriod,
    onMessage: (tick) => {
      try {
        const payload = (tick.data as any)?.data ?? tick.data;
        const rsiValue = payload.rsi as number;
        const timestamp = payload.timestamp as number;

        if (rsiValue !== undefined) {
          setLiveRsi(rsiValue);

          // Also update rsiData with the new point
          setRsiData((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.timestamp === timestamp) {
              return [...prev.slice(0, -1), { timestamp, rsi: rsiValue }];
            }
            return [...prev, { timestamp, rsi: rsiValue }];
          });
        }
      } catch (e) {
        console.warn("[useChartData] Failed to parse RSI update:", e);
      }
    },
  });

  // Stop RSI report on unmount or when RSI is disabled
  useEffect(() => {
    return () => {
      if (rsiReportTopicRef.current && symbolRef.current && timeframeRef.current && rsiPeriodRef.current) {
        socketHub.send({
          type: "control",
          target: "calc",
          op: "stop_rsi",
          id: `stop_rsi_${Date.now()}`,
          symbol: symbolRef.current,
          timeframe: timeframeRef.current,
          period: rsiPeriodRef.current,
        });
        rsiReportTopicRef.current = undefined;
      }
    };
  }, [symbol, timeframe, rsiPeriod]);

  // Subscribe to live MACD updates using centralized subscription hook
  useSubscription({
    channel: "report.macd",
    symbol: macdSubKey,
    enabled: enabled && !!macdSubKey && !!macdFast && !!macdSlow && !!macdSignal,
    onMessage: (tick) => {
      try {
        const payload = (tick.data as any)?.data ?? tick.data;
        const macdValue = payload.macd as number;
        const signalValue = payload.signalLine as number;
        const histogramValue = payload.histogram as number;
        const timestamp = payload.timestamp as number;

        if (macdValue !== undefined && signalValue !== undefined && histogramValue !== undefined) {
          const newPoint: MacdDataPoint = {
            timestamp,
            macd: macdValue,
            signal: signalValue,
            histogram: histogramValue,
          };
          setLiveMacd(newPoint);

          // Also update macdData with the new point
          setMacdData((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.timestamp === timestamp) {
              return [...prev.slice(0, -1), newPoint];
            }
            return [...prev, newPoint];
          });
        }
      } catch (e) {
        console.warn("[useChartData] Failed to parse MACD update:", e);
      }
    },
  });

  // Stop MACD report on unmount or when MACD is disabled
  useEffect(() => {
    return () => {
      if (macdReportTopicRef.current && symbolRef.current && timeframeRef.current && macdSettingsRef.current.fast) {
        socketHub.send({
          type: "control",
          target: "calc",
          op: "stop_macd",
          id: `stop_macd_${Date.now()}`,
          symbol: symbolRef.current,
          timeframe: timeframeRef.current,
          fast: macdSettingsRef.current.fast,
          slow: macdSettingsRef.current.slow,
          signal: macdSettingsRef.current.signal,
        });
        macdReportTopicRef.current = undefined;
      }
    };
  }, [symbol, timeframe, macdFast, macdSlow, macdSignal]);

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
    rsiData,
    liveRsi,
    macdData,
    liveMacd,
    refresh: fetchData,
    loadMore,
  };
}
