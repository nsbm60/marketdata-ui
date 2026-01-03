/**
 * ChartCanvas - Core chart component using lightweight-charts.
 *
 * Renders candlestick chart with optional overlays (SMA, EMA, Ribbon)
 * and separate panes for RSI and MACD.
 */

import { useEffect, useRef, useMemo, useState } from "react";
import {
  createChart,
  IChartApi,
  ISeriesApi,
  CandlestickData,
  LineData,
  HistogramData,
  ColorType,
  CrosshairMode,
  LineStyle,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
} from "lightweight-charts";
import { Bar, barsToLightweightCandles } from "../../utils/barAggregation";
import {
  ChartMetricSettings,
  calculateSMA,
  calculateEMA,
  calculateRibbon,
  calculateRSI,
  calculateMACD,
  RIBBON_COLORS,
  TimeValue,
} from "../../utils/chartMetrics";

interface ChartCanvasProps {
  bars: Bar[];
  liveCandle?: Bar;
  settings: ChartMetricSettings;
  timeframe: string;
  session?: "extended" | "regular";
  width?: number;
  height?: number;
  /** Callback to load more historical data when scrolling left */
  onLoadMore?: () => void;
  /** Whether more historical data is available */
  hasMore?: boolean;
  /** Whether more data is currently being loaded */
  loadingMore?: boolean;
  /** Number of warmup bars needed for indicators (triggers earlier loading) */
  warmupBars?: number;
}

// Dark theme colors
const CHART_BG = "#1a1a2e";
const CHART_TEXT = "#d1d5db";
const CHART_GRID = "#2a2a3e";
const UP_COLOR = "#26a69a";
const DOWN_COLOR = "#ef5350";

// Target number of visible bars (for initial display)
const TARGET_VISIBLE_BARS = 200;
const LINE_COLORS = {
  sma: "#2196f3",
  ema: "#ff9800",
  rsi: "#9c27b0",
  macdLine: "#2196f3",
  macdSignal: "#ff9800",
  macdHistUp: "#26a69a",
  macdHistDown: "#ef5350",
};

// Timeframe categories for formatting
const isDailyOrLonger = (tf: string) => ["1d", "1w", "1M"].includes(tf);
const isWeeklyOrLonger = (tf: string) => ["1w", "1M"].includes(tf);

// Find first timestamp of each day (for day boundary labels on intraday charts)
function findDayBoundaryTimestamps(bars: Bar[]): Map<number, string> {
  const boundaries = new Map<number, string>(); // timestamp -> date label
  if (bars.length === 0) return boundaries;

  let prevDateStr = "";
  for (const bar of bars) {
    const date = new Date(bar.t);
    const dateStr = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    if (dateStr !== prevDateStr) {
      const timestamp = Math.floor(date.getTime() / 1000);
      const label = date.toLocaleString("en-US", { month: "short", day: "numeric" });
      boundaries.set(timestamp, label);
      prevDateStr = dateStr;
    }
  }
  return boundaries;
}

// Find first timestamp of each month (for monthly boundary labels on daily/weekly charts)
function findMonthBoundaryTimestamps(bars: Bar[]): Map<number, string> {
  const boundaries = new Map<number, string>();
  if (bars.length === 0) return boundaries;

  let prevMonthStr = "";
  for (const bar of bars) {
    const date = new Date(bar.t);
    const monthStr = `${date.getFullYear()}-${date.getMonth()}`;
    if (monthStr !== prevMonthStr) {
      const timestamp = Math.floor(date.getTime() / 1000);
      // For year boundaries, include the year
      const includeYear = prevMonthStr !== "" &&
        parseInt(prevMonthStr.split("-")[0]) !== date.getFullYear();
      const label = includeYear
        ? date.toLocaleString("en-US", { month: "short", year: "2-digit" })
        : date.toLocaleString("en-US", { month: "short" });
      boundaries.set(timestamp, label);
      prevMonthStr = monthStr;
    }
  }
  return boundaries;
}

// Key trading hours for time labels (in local time)
const TRADING_HOURS_EXTENDED = [
  { hour: 4, minute: 0, label: "4a" },    // Pre-market open
  { hour: 9, minute: 30, label: "9:30" }, // Market open
  { hour: 12, minute: 0, label: "12p" },  // Noon
  { hour: 16, minute: 0, label: "4p" },   // Market close
];

const TRADING_HOURS_REGULAR = [
  { hour: 9, minute: 30, label: "9:30" }, // Market open
  { hour: 12, minute: 0, label: "12p" },  // Noon
  { hour: 16, minute: 0, label: "4p" },   // Market close
];

// Find timestamps for key trading hours in the data
function findTradingHourTimestamps(bars: Bar[], session: "extended" | "regular" = "extended"): Map<number, string> {
  const timestamps = new Map<number, string>();
  if (bars.length === 0) return timestamps;

  const tradingHours = session === "regular" ? TRADING_HOURS_REGULAR : TRADING_HOURS_EXTENDED;

  // Get all unique dates in data
  const dates = new Set<string>();
  for (const bar of bars) {
    const date = new Date(bar.t);
    dates.add(`${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`);
  }

  // For each date, find the closest bar to each trading hour
  for (const dateStr of dates) {
    const [year, month, day] = dateStr.split("-").map(Number);

    for (const th of tradingHours) {
      const targetTime = new Date(year, month - 1, day, th.hour, th.minute, 0);
      const targetTs = Math.floor(targetTime.getTime() / 1000);

      // Find the bar closest to this time (within 30 minutes)
      let closestBar: Bar | null = null;
      let closestDiff = Infinity;

      for (const bar of bars) {
        const barTs = Math.floor(new Date(bar.t).getTime() / 1000);
        const diff = Math.abs(barTs - targetTs);
        if (diff < closestDiff && diff < 1800) { // Within 30 min
          closestDiff = diff;
          closestBar = bar;
        }
      }

      if (closestBar) {
        const barTs = Math.floor(new Date(closestBar.t).getTime() / 1000);
        timestamps.set(barTs, th.label);
      }
    }
  }

  return timestamps;
}


export default function ChartCanvas({
  bars,
  liveCandle,
  settings,
  timeframe,
  session = "extended",
  width,
  height = 500,
  onLoadMore,
  hasMore = false,
  loadingMore = false,
  warmupBars = 0,
}: ChartCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const overlaySeriesRef = useRef<ISeriesApi<"Line">[]>([]);

  // Track if initial data has been loaded (to avoid fitContent on every update)
  const initialLoadDoneRef = useRef(false);
  // Track previous bar count to detect when new bars are prepended
  const prevBarCountRef = useRef(0);
  // Refs for indicator sub-charts (for time scale sync)
  const rsiChartRef = useRef<IChartApi | null>(null);
  const macdChartRef = useRef<IChartApi | null>(null);

  // Track day boundaries and trading hours for labels
  const dayBoundariesRef = useRef<Map<number, string>>(new Map());
  const tradingHoursRef = useRef<Map<number, string>>(new Map());
  const [dayMarkers, setDayMarkers] = useState<{ x: number; label: string }[]>([]);
  const [timeMarkers, setTimeMarkers] = useState<{ x: number; label: string }[]>([]);

  // Compute boundaries and trading hours when bars change
  useMemo(() => {
    if (isWeeklyOrLonger(timeframe)) {
      // Weekly/monthly: use month boundaries, no trading hours
      dayBoundariesRef.current = findMonthBoundaryTimestamps(bars);
      tradingHoursRef.current = new Map();
    } else if (isDailyOrLonger(timeframe)) {
      // Daily: use month boundaries, no trading hours
      dayBoundariesRef.current = findMonthBoundaryTimestamps(bars);
      tradingHoursRef.current = new Map();
    } else {
      // Intraday: use day boundaries and trading hours
      dayBoundariesRef.current = findDayBoundaryTimestamps(bars);
      tradingHoursRef.current = findTradingHourTimestamps(bars, session);
    }
  }, [bars, timeframe, session]);

  // Convert bars to candlestick data
  const candleData = useMemo(() => {
    const data = barsToLightweightCandles(bars);
    if (liveCandle) {
      const liveData = barsToLightweightCandles([liveCandle])[0];
      // Check if live candle is an update to last bar or a new bar
      if (data.length > 0 && data[data.length - 1].time === liveData.time) {
        data[data.length - 1] = liveData;
      } else if (liveData.time > (data[data.length - 1]?.time || 0)) {
        data.push(liveData);
      }
    }
    return data;
  }, [bars, liveCandle]);

  // Calculate all moving averages (SMAs and EMAs)
  const maData = useMemo(() => {
    if (bars.length === 0) return [];
    const result = settings.movingAverages.map((ma) => {
      const data = ma.type === "sma"
        ? calculateSMA(bars, ma.period)
        : calculateEMA(bars, ma.period);
      console.log(`[ChartCanvas] ${ma.type.toUpperCase()}(${ma.period}): ${bars.length} bars -> ${data.length} data points`);
      return { data, color: ma.color, period: ma.period, type: ma.type, id: ma.id };
    });
    return result;
  }, [bars, settings.movingAverages]);

  const ribbonData = useMemo(() => {
    if (!settings.ribbon.enabled || bars.length === 0) return [];
    return calculateRibbon(
      bars,
      settings.ribbon.count,
      settings.ribbon.base,
      settings.ribbon.step
    );
  }, [bars, settings.ribbon.enabled, settings.ribbon.count, settings.ribbon.base, settings.ribbon.step]);

  const rsiData = useMemo(() => {
    if (!settings.rsi.enabled || bars.length === 0) return [];
    return calculateRSI(bars, settings.rsi.period);
  }, [bars, settings.rsi.enabled, settings.rsi.period]);

  const macdData = useMemo(() => {
    if (!settings.macd.enabled || bars.length === 0)
      return { macdLine: [], signalLine: [], histogram: [] };
    return calculateMACD(
      bars,
      settings.macd.fast,
      settings.macd.slow,
      settings.macd.signal
    );
  }, [bars, settings.macd.enabled, settings.macd.fast, settings.macd.slow, settings.macd.signal]);

  // Calculate chart heights based on enabled indicators
  const { mainHeight, rsiHeight, macdHeight } = useMemo(() => {
    const hasRsi = settings.rsi.enabled;
    const hasMacd = settings.macd.enabled;
    const indicatorCount = (hasRsi ? 1 : 0) + (hasMacd ? 1 : 0);

    if (indicatorCount === 0) {
      return { mainHeight: height, rsiHeight: 0, macdHeight: 0 };
    }

    const indicatorHeight = 120;
    const mainH = height - indicatorCount * indicatorHeight;

    return {
      mainHeight: mainH,
      rsiHeight: hasRsi ? indicatorHeight : 0,
      macdHeight: hasMacd ? indicatorHeight : 0,
    };
  }, [height, settings.rsi.enabled, settings.macd.enabled]);

  // Initialize chart (only on mount or width change)
  useEffect(() => {
    if (!containerRef.current) return;

    // Create main chart
    const chart = createChart(containerRef.current, {
      width: width || containerRef.current.clientWidth,
      height: mainHeight,
      layout: {
        background: { type: ColorType.Solid, color: CHART_BG },
        textColor: CHART_TEXT,
        fontSize: 10,
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
      },
      grid: {
        vertLines: { color: CHART_GRID },
        horzLines: { color: CHART_GRID },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
      },
      rightPriceScale: {
        borderColor: CHART_GRID,
      },
      timeScale: {
        borderColor: CHART_GRID,
        timeVisible: true,
        secondsVisible: false,
        tickMarkFormatter: (time: number) => {
          if (isDailyOrLonger(timeframe)) {
            const date = new Date(time * 1000);
            return date.toLocaleString("en-US", {
              month: "short",
              day: "numeric",
            });
          }
          // Intraday: return space to keep axis height but hide ugly times
          return " ";
        },
      },
      localization: {
        timeFormatter: (time: number) => {
          const date = new Date(time * 1000);
          if (isDailyOrLonger(timeframe)) {
            return date.toLocaleString("en-US", {
              weekday: "short",
              month: "short",
              day: "numeric",
              year: "numeric",
            });
          }
          return date.toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
          });
        },
      },
    });

    chartRef.current = chart;

    // Add candlestick series (v5 API)
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: UP_COLOR,
      downColor: DOWN_COLOR,
      borderUpColor: UP_COLOR,
      borderDownColor: DOWN_COLOR,
      wickUpColor: UP_COLOR,
      wickDownColor: DOWN_COLOR,
    });
    candleSeriesRef.current = candleSeries;

    // Handle resize
    const handleResize = () => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: width || containerRef.current.clientWidth,
        });
      }
    };

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      overlaySeriesRef.current = [];
    };
  }, [width, timeframe]);

  // Update chart height when indicators are toggled
  useEffect(() => {
    if (chartRef.current) {
      chartRef.current.applyOptions({ height: mainHeight });
    }
  }, [mainHeight]);

  // Update candlestick data
  useEffect(() => {
    if (candleSeriesRef.current && candleData.length > 0) {
      const chart = chartRef.current;
      const prevCount = prevBarCountRef.current;
      const newCount = candleData.length;

      // Detect if bars were prepended (loadMore added older data)
      const barsPrepended = prevCount > 0 && newCount > prevCount;

      // Get current visible range before updating data
      let visibleRange: { from: number; to: number } | null = null;
      if (barsPrepended && chart) {
        const logicalRange = chart.timeScale().getVisibleLogicalRange();
        if (logicalRange) {
          visibleRange = { from: logicalRange.from, to: logicalRange.to };
        }
      }

      // Update data
      candleSeriesRef.current.setData(candleData as CandlestickData[]);

      if (!initialLoadDoneRef.current) {
        // First load: check if we have enough bars for indicators
        console.log(`[ChartCanvas] Initial load: ${newCount} bars, warmupBars=${warmupBars}`);

        // If we don't have enough bars for warmup and more data is available, load more
        if (warmupBars > 0 && newCount < warmupBars && hasMore && onLoadMore && !loadingMore) {
          console.log(`[ChartCanvas] Not enough bars (${newCount} < ${warmupBars}), auto-loading more...`);
          onLoadMore();
          // Don't mark as done yet - let the next load handle it
          return;
        }

        if (chart && newCount > 0) {
          // Show the most recent TARGET_VISIBLE_BARS bars
          // Keep warmup/historical bars off-screen to the left for scrolling
          const visibleEnd = newCount - 1;
          const visibleStart = Math.max(0, newCount - TARGET_VISIBLE_BARS);
          const range = { from: visibleStart, to: visibleEnd };
          console.log(`[ChartCanvas] Setting initial visible range: ${visibleStart} to ${visibleEnd} (${visibleEnd - visibleStart + 1} bars visible, ${visibleStart} bars available for scrolling left)`);
          chart.timeScale().setVisibleLogicalRange(range);
        } else {
          console.log(`[ChartCanvas] Using fitContent (newCount=${newCount})`);
          chart?.timeScale().fitContent();
        }
        initialLoadDoneRef.current = true;
      } else if (barsPrepended && visibleRange && chart) {
        // Bars prepended: shift visible range to maintain position
        const barsAdded = newCount - prevCount;
        chart.timeScale().setVisibleLogicalRange({
          from: visibleRange.from + barsAdded,
          to: visibleRange.to + barsAdded,
        });
      }
      // For live candle updates (same or +1 bar), don't change scroll position

      prevBarCountRef.current = newCount;
    }
  }, [candleData]);

  // Update day/month markers and time markers when visible range changes
  useEffect(() => {
    if (!chartRef.current) {
      setDayMarkers([]);
      setTimeMarkers([]);
      return;
    }

    const updateMarkers = () => {
      if (!chartRef.current) return;

      const timeScale = chartRef.current.timeScale();

      // Boundary markers (day boundaries for intraday, month boundaries for daily/weekly)
      const boundaryEntries = Array.from(dayBoundariesRef.current.entries());
      const boundaryM: { x: number; label: string }[] = [];
      // Skip first boundary unless it's daily/weekly (where we want all month labels)
      const startIdx = isDailyOrLonger(timeframe) ? 0 : 1;
      for (let i = startIdx; i < boundaryEntries.length; i++) {
        const [time, label] = boundaryEntries[i];
        const x = timeScale.timeToCoordinate(time as any);
        if (x !== null) {
          boundaryM.push({ x, label });
        }
      }
      setDayMarkers(boundaryM);

      // Time markers (trading hours - only for intraday)
      const timeEntries = Array.from(tradingHoursRef.current.entries());
      const timeM: { x: number; label: string }[] = [];
      for (const [time, label] of timeEntries) {
        const x = timeScale.timeToCoordinate(time as any);
        if (x !== null) {
          timeM.push({ x, label });
        }
      }
      setTimeMarkers(timeM);
    };

    // Update on visible range change
    chartRef.current.timeScale().subscribeVisibleLogicalRangeChange(updateMarkers);

    // Initial update after a short delay to ensure chart is rendered
    setTimeout(updateMarkers, 100);

    return () => {
      chartRef.current?.timeScale().unsubscribeVisibleLogicalRangeChange(updateMarkers);
    };
  }, [bars, timeframe, session]);

  // Auto-load more data when scrolling near left edge
  useEffect(() => {
    if (!chartRef.current || !onLoadMore || !hasMore || loadingMore) return;

    const handleRangeChange = () => {
      if (!chartRef.current || loadingMore) return;

      const logicalRange = chartRef.current.timeScale().getVisibleLogicalRange();
      if (!logicalRange) return;

      // Trigger loading when user scrolls within (warmupBars + buffer) of the data start
      // This ensures indicators have enough warmup data as user scrolls
      const loadThreshold = Math.max(20, warmupBars + 20);
      const scrolledNearStart = logicalRange.from < loadThreshold;

      if (scrolledNearStart && hasMore && !loadingMore) {
        console.log(`[ChartCanvas] Near left edge (from=${logicalRange.from.toFixed(0)}, threshold=${loadThreshold}), loading more data...`);
        onLoadMore();
      }
    };

    chartRef.current.timeScale().subscribeVisibleLogicalRangeChange(handleRangeChange);

    return () => {
      chartRef.current?.timeScale().unsubscribeVisibleLogicalRangeChange(handleRangeChange);
    };
  }, [onLoadMore, hasMore, loadingMore, warmupBars]);

  // Sync indicator charts' time scales with main chart
  useEffect(() => {
    if (!chartRef.current) return;

    const syncTimeScales = () => {
      const mainChart = chartRef.current;
      if (!mainChart) return;

      const logicalRange = mainChart.timeScale().getVisibleLogicalRange();
      if (!logicalRange) return;

      // Sync RSI chart
      if (rsiChartRef.current) {
        rsiChartRef.current.timeScale().setVisibleLogicalRange(logicalRange);
      }

      // Sync MACD chart
      if (macdChartRef.current) {
        macdChartRef.current.timeScale().setVisibleLogicalRange(logicalRange);
      }
    };

    chartRef.current.timeScale().subscribeVisibleLogicalRangeChange(syncTimeScales);

    return () => {
      chartRef.current?.timeScale().unsubscribeVisibleLogicalRangeChange(syncTimeScales);
    };
  }, [settings.rsi.enabled, settings.macd.enabled]);


  // Update overlay series (MAs, Ribbon)
  useEffect(() => {
    if (!chartRef.current) return;

    // Remove existing overlay series
    overlaySeriesRef.current.forEach((series) => {
      try {
        chartRef.current?.removeSeries(series);
      } catch {
        // Series may already be removed
      }
    });
    overlaySeriesRef.current = [];

    // Add all moving averages
    maData.forEach(({ data, color, period, type }) => {
      if (data.length > 0) {
        const maSeries = chartRef.current!.addSeries(LineSeries, {
          color: color,
          lineWidth: 2,
          title: `${type.toUpperCase()}(${period})`,
        });
        maSeries.setData(data as LineData[]);
        overlaySeriesRef.current.push(maSeries);
      }
    });

    // Add Ribbon (multiple EMA lines)
    if (settings.ribbon.enabled && ribbonData.length > 0) {
      ribbonData.forEach((lineData, idx) => {
        if (lineData.length > 0) {
          const period = settings.ribbon.base + idx * settings.ribbon.step;
          const ribbonSeries = chartRef.current!.addSeries(LineSeries, {
            color: RIBBON_COLORS[idx % RIBBON_COLORS.length],
            lineWidth: 1,
            title: `R${period}`,
          });
          ribbonSeries.setData(lineData as LineData[]);
          overlaySeriesRef.current.push(ribbonSeries);
        }
      });
    }
  }, [settings, maData, ribbonData]);

  // Render component
  return (
    <div style={{ backgroundColor: CHART_BG }}>
      {/* Main candlestick chart with overlay container */}
      <div style={{ position: "relative", width: "100%", height: mainHeight }}>
        <div ref={containerRef} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} />
        {/* Overlay layer for vertical lines and date labels */}
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, pointerEvents: "none", zIndex: 10 }}>
          {/* Vertical lines and date labels at day boundaries */}
          {/* Day boundary markers */}
          {dayMarkers.map(({ x, label }, i) => (
            <div key={`day-${i}`}>
              {/* Vertical line */}
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  left: x,
                  width: 1,
                  height: "100%",
                  backgroundColor: "rgba(100, 120, 160, 0.3)",
                }}
              />
              {/* Date label at top */}
              <div
                style={{
                  position: "absolute",
                  top: 4,
                  left: x,
                  transform: "translateX(-50%)",
                  fontSize: 10,
                  fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
                  color: "#d1d5db",
                  backgroundColor: "rgba(26, 26, 46, 0.85)",
                  padding: "2px 6px",
                  borderRadius: 3,
                  whiteSpace: "nowrap",
                }}
              >
                {label}
              </div>
            </div>
          ))}
          {/* Time markers at bottom */}
          {timeMarkers.map(({ x, label }, i) => (
            <div
              key={`time-${i}`}
              style={{
                position: "absolute",
                bottom: 4,
                left: x,
                transform: "translateX(-50%)",
                fontSize: 10,
                fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
                color: "#9ca3af",
                whiteSpace: "nowrap",
              }}
            >
              {label}
            </div>
          ))}
        </div>
      </div>

      {/* RSI pane */}
      {settings.rsi.enabled && (
        <RsiPane
          data={rsiData}
          height={rsiHeight}
          width={width}
          period={settings.rsi.period}
          chartRefOut={rsiChartRef}
        />
      )}

      {/* MACD pane */}
      {settings.macd.enabled && (
        <MacdPane
          macdLine={macdData.macdLine}
          signalLine={macdData.signalLine}
          histogram={macdData.histogram}
          height={macdHeight}
          width={width}
          fast={settings.macd.fast}
          slow={settings.macd.slow}
          signal={settings.macd.signal}
          chartRefOut={macdChartRef}
        />
      )}
    </div>
  );
}

// RSI Pane component
function RsiPane({
  data,
  height,
  width,
  period,
  chartRefOut,
}: {
  data: TimeValue[];
  height: number;
  width?: number;
  period: number;
  chartRefOut?: React.MutableRefObject<IChartApi | null>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Line"> | null>(null);

  useEffect(() => {
    if (!containerRef.current || height === 0) return;

    const chart = createChart(containerRef.current, {
      width: width || containerRef.current.clientWidth,
      height,
      layout: {
        background: { type: ColorType.Solid, color: CHART_BG },
        textColor: CHART_TEXT,
      },
      grid: {
        vertLines: { color: CHART_GRID },
        horzLines: { color: CHART_GRID },
      },
      rightPriceScale: {
        borderColor: CHART_GRID,
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      timeScale: {
        visible: false,
      },
    });

    chartRef.current = chart;
    if (chartRefOut) chartRefOut.current = chart;

    // Add RSI line (v5 API)
    const series = chart.addSeries(LineSeries, {
      color: LINE_COLORS.rsi,
      lineWidth: 2,
      title: `RSI(${period})`,
      priceScaleId: "right",
    });
    seriesRef.current = series;

    // Add horizontal lines at 30 and 70
    series.createPriceLine({
      price: 70,
      color: "#ef5350",
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
    });
    series.createPriceLine({
      price: 30,
      color: "#26a69a",
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
    });

    const handleResize = () => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: width || containerRef.current.clientWidth,
        });
      }
    };

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      if (chartRefOut) chartRefOut.current = null;
      chart.remove();
    };
  }, [height, width, period, chartRefOut]);

  useEffect(() => {
    if (seriesRef.current && data.length > 0) {
      seriesRef.current.setData(data as LineData[]);
    }
  }, [data]);

  return <div ref={containerRef} style={{ width: "100%", borderTop: `1px solid ${CHART_GRID}` }} />;
}

// MACD Pane component
function MacdPane({
  macdLine,
  signalLine,
  histogram,
  height,
  width,
  fast,
  slow,
  signal,
  chartRefOut,
}: {
  macdLine: TimeValue[];
  signalLine: TimeValue[];
  histogram: TimeValue[];
  height: number;
  width?: number;
  fast: number;
  slow: number;
  signal: number;
  chartRefOut?: React.MutableRefObject<IChartApi | null>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!containerRef.current || height === 0) return;

    const chart = createChart(containerRef.current, {
      width: width || containerRef.current.clientWidth,
      height,
      layout: {
        background: { type: ColorType.Solid, color: CHART_BG },
        textColor: CHART_TEXT,
      },
      grid: {
        vertLines: { color: CHART_GRID },
        horzLines: { color: CHART_GRID },
      },
      rightPriceScale: {
        borderColor: CHART_GRID,
      },
      timeScale: {
        visible: false,
      },
    });

    chartRef.current = chart;
    if (chartRefOut) chartRefOut.current = chart;

    // Add histogram (v5 API)
    const histSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "price", precision: 4 },
      priceScaleId: "right",
    });

    // Color histogram bars based on value
    const coloredHistData = histogram.map((h) => ({
      ...h,
      color: h.value >= 0 ? LINE_COLORS.macdHistUp : LINE_COLORS.macdHistDown,
    }));
    histSeries.setData(coloredHistData as HistogramData[]);

    // Add MACD line (v5 API)
    const macdSeries = chart.addSeries(LineSeries, {
      color: LINE_COLORS.macdLine,
      lineWidth: 2,
      title: `MACD(${fast},${slow},${signal})`,
      priceScaleId: "right",
    });
    macdSeries.setData(macdLine as LineData[]);

    // Add signal line (v5 API)
    const signalSeries = chart.addSeries(LineSeries, {
      color: LINE_COLORS.macdSignal,
      lineWidth: 2,
      title: "Signal",
      priceScaleId: "right",
    });
    signalSeries.setData(signalLine as LineData[]);

    const handleResize = () => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: width || containerRef.current.clientWidth,
        });
      }
    };

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      if (chartRefOut) chartRefOut.current = null;
      chart.remove();
    };
  }, [height, width, fast, slow, signal, macdLine, signalLine, histogram, chartRefOut]);

  return <div ref={containerRef} style={{ width: "100%", borderTop: `1px solid ${CHART_GRID}` }} />;
}
