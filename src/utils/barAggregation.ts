// src/utils/barAggregation.ts
// Aggregates candlestick bars for timeframes not directly supported by Alpaca
// (e.g., 10m from 5m bars, 20m from 5m bars)

export interface Bar {
  t: string; // ISO 8601 timestamp
  o: number; // open
  h: number; // high
  l: number; // low
  c: number; // close
  v: number; // volume
}

/**
 * Aggregate bars by a multiple factor.
 * For example, aggregateMultiple=2 combines every 2 bars into 1 (5m -> 10m).
 *
 * @param bars - Input bars sorted by time ascending
 * @param multiple - Number of bars to combine (e.g., 2 for 10m from 5m)
 * @returns Aggregated bars
 */
export function aggregateBars(bars: Bar[], multiple: number): Bar[] {
  if (multiple <= 1) return bars;
  if (bars.length === 0) return [];

  const result: Bar[] = [];

  for (let i = 0; i < bars.length; i += multiple) {
    const chunk = bars.slice(i, i + multiple);
    if (chunk.length === 0) continue;

    const aggregated: Bar = {
      t: chunk[0].t, // First bar's timestamp
      o: chunk[0].o, // First bar's open
      h: Math.max(...chunk.map((b) => b.h)), // Highest high
      l: Math.min(...chunk.map((b) => b.l)), // Lowest low
      c: chunk[chunk.length - 1].c, // Last bar's close
      v: chunk.reduce((sum, b) => sum + b.v, 0), // Sum of volumes
    };

    result.push(aggregated);
  }

  return result;
}

/**
 * Update the last aggregated bar with a new raw bar.
 * Used for live candle updates when aggregation is needed.
 *
 * @param aggregatedBars - Current aggregated bars (will be mutated)
 * @param rawBar - New raw bar to incorporate
 * @param multiple - Aggregation multiple
 * @param rawBarCount - Count of raw bars seen (to know position in aggregation cycle)
 * @returns Updated aggregated bars array
 */
export function updateAggregatedBar(
  aggregatedBars: Bar[],
  rawBar: Bar,
  multiple: number,
  rawBarCount: number
): Bar[] {
  if (multiple <= 1) {
    // No aggregation needed, just add or update last bar
    const lastIdx = aggregatedBars.length - 1;
    if (lastIdx >= 0 && aggregatedBars[lastIdx].t === rawBar.t) {
      aggregatedBars[lastIdx] = rawBar;
    } else {
      aggregatedBars.push(rawBar);
    }
    return aggregatedBars;
  }

  const positionInCycle = rawBarCount % multiple;

  if (positionInCycle === 1 || aggregatedBars.length === 0) {
    // Start of new aggregated bar
    aggregatedBars.push({
      t: rawBar.t,
      o: rawBar.o,
      h: rawBar.h,
      l: rawBar.l,
      c: rawBar.c,
      v: rawBar.v,
    });
  } else {
    // Update current aggregated bar
    const lastIdx = aggregatedBars.length - 1;
    const current = aggregatedBars[lastIdx];
    aggregatedBars[lastIdx] = {
      ...current,
      h: Math.max(current.h, rawBar.h),
      l: Math.min(current.l, rawBar.l),
      c: rawBar.c,
      v: current.v + rawBar.v,
    };
  }

  return aggregatedBars;
}

/**
 * Convert a Bar to lightweight-charts CandlestickData format.
 * lightweight-charts expects time as Unix timestamp in seconds.
 */
export function barToLightweightCandle(bar: Bar): {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
} {
  return {
    time: Math.floor(new Date(bar.t).getTime() / 1000),
    open: bar.o,
    high: bar.h,
    low: bar.l,
    close: bar.c,
  };
}

/**
 * Convert an array of Bars to lightweight-charts format.
 */
export function barsToLightweightCandles(
  bars: Bar[]
): Array<{
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}> {
  return bars.map(barToLightweightCandle);
}
