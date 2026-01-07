/**
 * ChartPanel - Main panel for candlestick charting with technical indicators.
 *
 * Features:
 * - Symbol selection (prefilled from Watchlist selection)
 * - Timeframe selector (1m, 5m, 10m, 15m, 20m, 30m, 60m, 1d, 1w)
 * - Technical indicators: SMA, EMA, Ribbon, RSI, MACD
 * - Settings persistence to localStorage
 */

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useChartData } from "./hooks/useChartData";
import ChartCanvas from "./components/chart/ChartCanvas";
import MetricToolbar from "./components/chart/MetricToolbar";
import { ChartMetricSettings, DEFAULT_METRIC_SETTINGS, calculateWarmupBars } from "./utils/chartMetrics";
import { dark, semantic } from "./theme";

// Timeframe options
const TIMEFRAMES = [
  { value: "1m", label: "1m" },
  { value: "5m", label: "5m" },
  { value: "10m", label: "10m" },
  { value: "15m", label: "15m" },
  { value: "20m", label: "20m" },
  { value: "30m", label: "30m" },
  { value: "60m", label: "1h" },
  { value: "1d", label: "1D" },
  { value: "1w", label: "1W" },
];

// Session options
type SessionType = "extended" | "regular";
const SESSIONS: { value: SessionType; label: string }[] = [
  { value: "extended", label: "Extended" },
  { value: "regular", label: "Regular" },
];

// LocalStorage keys
const STORAGE_KEY_SETTINGS = "chart.settings";
const STORAGE_KEY_TIMEFRAME = "chart.timeframe";
const STORAGE_KEY_SESSION = "chart.session";

interface ChartPanelProps {
  /** Symbol selected from watchlist (can be overridden) */
  selected?: string;
}

export default function ChartPanel({ selected }: ChartPanelProps) {
  // Symbol input (initialized from selected prop)
  const [symbolInput, setSymbolInput] = useState(selected || "");
  const [activeSymbol, setActiveSymbol] = useState<string | undefined>(selected);

  // Container ref for measuring available height
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const [containerHeight, setContainerHeight] = useState(500);

  // Timeframe
  const [timeframe, setTimeframe] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY_TIMEFRAME);
    return saved || "5m";
  });

  // Session (extended vs regular hours)
  const [session, setSession] = useState<SessionType>(() => {
    const saved = localStorage.getItem(STORAGE_KEY_SESSION);
    return (saved as SessionType) || "extended";
  });

  // Metric settings
  const [settings, setSettings] = useState<ChartMetricSettings>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_SETTINGS);
      if (saved) {
        return { ...DEFAULT_METRIC_SETTINGS, ...JSON.parse(saved) };
      }
    } catch {
      // Ignore parse errors
    }
    return DEFAULT_METRIC_SETTINGS;
  });

  // Calculate warm-up bars needed for indicators
  // Double the warmup to ensure indicators are valid across the visible range AND provide
  // buffer for scrolling before more data loads
  const warmupBars = useMemo(() => calculateWarmupBars(settings) * 2, [settings]);

  // Number of visible bars to display
  const visibleBars = 200;

  // Chart data (session filtering happens server-side)
  // Load extra bars for indicator warm-up so indicators have valid values from first visible bar
  const { bars, liveCandle, loading, loadingMore, error, hasMore, refresh, loadMore } = useChartData(
    activeSymbol,
    timeframe,
    visibleBars,
    !!activeSymbol,
    session,
    warmupBars
  );

  // Update symbol input when selected prop changes, but don't auto-load
  // (user must click Load or switch to Chart tab first)
  useEffect(() => {
    if (selected && selected !== symbolInput) {
      setSymbolInput(selected);
      // Don't auto-set activeSymbol - require explicit Load action
    }
  }, [selected]);

  // Measure container height with ResizeObserver
  useEffect(() => {
    const container = chartContainerRef.current;
    if (!container) return;

    const updateHeight = () => {
      const height = container.clientHeight;
      if (height > 0) {
        setContainerHeight(height);
      }
    };

    // Initial measurement
    updateHeight();

    // Watch for resizes
    const resizeObserver = new ResizeObserver(updateHeight);
    resizeObserver.observe(container);

    return () => resizeObserver.disconnect();
  }, []);

  // Persist settings
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(settings));
  }, [settings]);

  // Persist timeframe
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_TIMEFRAME, timeframe);
  }, [timeframe]);

  // Persist session
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_SESSION, session);
  }, [session]);

  // Check if intraday for UI display
  const isIntraday = !["1d", "1w"].includes(timeframe);

  // Handle symbol form submit
  const handleSymbolSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const sym = symbolInput.trim().toUpperCase();
      if (sym) {
        setActiveSymbol(sym);
      }
    },
    [symbolInput]
  );

  // Handle timeframe change
  const handleTimeframeChange = useCallback((tf: string) => {
    setTimeframe(tf);
  }, []);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        backgroundColor: dark.bg.primary,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          padding: "12px 16px",
          borderBottom: `1px solid ${dark.border.muted}`,
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        {/* Symbol input */}
        <form onSubmit={handleSymbolSubmit} style={{ display: "flex", gap: 8 }}>
          <input
            type="text"
            value={symbolInput}
            onChange={(e) => setSymbolInput(e.target.value.toUpperCase())}
            placeholder="Symbol"
            style={{
              width: 100,
              padding: "6px 10px",
              backgroundColor: dark.bg.secondary,
              border: `1px solid ${dark.border.primary}`,
              borderRadius: 4,
              color: dark.text.primary,
              fontSize: 14,
              fontWeight: 600,
            }}
          />
          <button
            type="submit"
            style={{
              padding: "6px 12px",
              backgroundColor: dark.accent.primary,
              border: "none",
              borderRadius: 4,
              color: "#fff",
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            Load
          </button>
        </form>

        {/* Timeframe selector */}
        <div style={{ display: "flex", gap: 4 }}>
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf.value}
              onClick={() => handleTimeframeChange(tf.value)}
              style={{
                padding: "6px 10px",
                borderRadius: 4,
                border: `1px solid ${timeframe === tf.value ? dark.accent.primary : dark.border.primary}`,
                backgroundColor: timeframe === tf.value ? dark.accent.dark : "transparent",
                color: timeframe === tf.value ? dark.accent.light : dark.text.secondary,
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 500,
              }}
            >
              {tf.label}
            </button>
          ))}
        </div>

        {/* Session selector (disabled for daily/weekly) */}
        <select
          value={session}
          onChange={(e) => setSession(e.target.value as SessionType)}
          disabled={!isIntraday}
          title={!isIntraday ? "Session filtering only applies to intraday timeframes" : undefined}
          style={{
            padding: "6px 10px",
            backgroundColor: isIntraday ? dark.bg.secondary : dark.bg.tertiary,
            border: `1px solid ${isIntraday ? dark.border.primary : dark.border.secondary}`,
            borderRadius: 4,
            color: isIntraday ? dark.text.primary : dark.text.disabled,
            fontSize: 12,
            cursor: isIntraday ? "pointer" : "not-allowed",
          }}
        >
          {SESSIONS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>

        {/* Status / refresh */}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
          {(loading || loadingMore) && (
            <span style={{ fontSize: 12, color: dark.text.muted }}>
              {loadingMore ? "Loading more..." : "Loading..."}
            </span>
          )}
          {error && (
            <span style={{ fontSize: 12, color: semantic.error.text }}>{error}</span>
          )}
          {activeSymbol && !loading && (
            <span style={{ fontSize: 12, color: dark.text.muted }}>
              {bars.length} bars{loadingMore ? " (loading...)" : ""}
            </span>
          )}
          <button
            onClick={refresh}
            disabled={!activeSymbol || loading || loadingMore}
            style={{
              padding: "4px 8px",
              borderRadius: 4,
              border: `1px solid ${dark.border.primary}`,
              backgroundColor: "transparent",
              color: dark.text.secondary,
              cursor: activeSymbol && !loading && !loadingMore ? "pointer" : "not-allowed",
              fontSize: 12,
              opacity: activeSymbol && !loading && !loadingMore ? 1 : 0.5,
            }}
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Metric toolbar */}
      <MetricToolbar settings={settings} onSettingsChange={setSettings} />

      {/* Chart area */}
      <div ref={chartContainerRef} style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
        {!activeSymbol ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              color: dark.text.muted,
              fontSize: 14,
            }}
          >
            Enter a symbol to view chart
          </div>
        ) : bars.length === 0 && !loading ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              color: dark.text.muted,
              fontSize: 14,
            }}
          >
            No data available
          </div>
        ) : (
          <ChartCanvas
            key={`${activeSymbol}-${timeframe}-${session}`}
            bars={bars}
            liveCandle={liveCandle}
            settings={settings}
            timeframe={timeframe}
            session={session}
            height={containerHeight}
            onLoadMore={loadMore}
            hasMore={hasMore}
            loadingMore={loadingMore}
            warmupBars={warmupBars}
          />
        )}
      </div>
    </div>
  );
}
