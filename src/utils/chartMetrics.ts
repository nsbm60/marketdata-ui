// src/utils/chartMetrics.ts
// Pure functions for computing technical indicators on price bars
// All functions return arrays of { time, value } for lightweight-charts LineSeries

export interface TimeValue {
  time: number; // Unix timestamp in seconds
  value: number;
}

export interface Bar {
  t: string; // ISO 8601 timestamp
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

/**
 * Calculate Simple Moving Average (SMA).
 *
 * @param bars - Price bars sorted by time ascending
 * @param period - Number of periods for the average (default: 20)
 * @returns Array of { time, value } for each bar where SMA can be calculated
 */
export function calculateSMA(bars: Bar[], period: number = 20): TimeValue[] {
  if (bars.length < period) return [];

  const result: TimeValue[] = [];

  for (let i = period - 1; i < bars.length; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) {
      sum += bars[i - j].c;
    }
    result.push({
      time: Math.floor(new Date(bars[i].t).getTime() / 1000),
      value: sum / period,
    });
  }

  return result;
}

/**
 * Calculate Exponential Moving Average (EMA).
 *
 * @param bars - Price bars sorted by time ascending
 * @param period - Number of periods for the average (default: 9)
 * @returns Array of { time, value }
 */
export function calculateEMA(bars: Bar[], period: number = 9): TimeValue[] {
  if (bars.length < period) return [];

  const result: TimeValue[] = [];
  const multiplier = 2 / (period + 1);

  // Start with SMA for first value
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += bars[i].c;
  }
  let ema = sum / period;

  result.push({
    time: Math.floor(new Date(bars[period - 1].t).getTime() / 1000),
    value: ema,
  });

  // Calculate EMA for remaining bars
  for (let i = period; i < bars.length; i++) {
    ema = (bars[i].c - ema) * multiplier + ema;
    result.push({
      time: Math.floor(new Date(bars[i].t).getTime() / 1000),
      value: ema,
    });
  }

  return result;
}

/**
 * Calculate EMA Ribbon (multiple EMAs with increasing periods).
 *
 * @param bars - Price bars sorted by time ascending
 * @param count - Number of EMAs in ribbon (default: 3)
 * @param basePeriod - Starting period (default: 9)
 * @param step - Period increment between EMAs (default: 3)
 * @returns Array of arrays, each containing { time, value } for one EMA line
 */
export function calculateRibbon(
  bars: Bar[],
  count: number = 3,
  basePeriod: number = 9,
  step: number = 3
): TimeValue[][] {
  const result: TimeValue[][] = [];

  for (let i = 0; i < count; i++) {
    const period = basePeriod + i * step;
    result.push(calculateEMA(bars, period));
  }

  return result;
}

/**
 * Calculate Relative Strength Index (RSI).
 *
 * @param bars - Price bars sorted by time ascending
 * @param period - Number of periods (default: 14)
 * @returns Array of { time, value } where value is RSI (0-100)
 */
export function calculateRSI(bars: Bar[], period: number = 14): TimeValue[] {
  if (bars.length < period + 1) return [];

  const result: TimeValue[] = [];

  // Calculate price changes
  const changes: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    changes.push(bars[i].c - bars[i - 1].c);
  }

  // Initialize average gain/loss with SMA
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < period; i++) {
    if (changes[i] > 0) avgGain += changes[i];
    else avgLoss -= changes[i];
  }
  avgGain /= period;
  avgLoss /= period;

  // First RSI value
  const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  const rsi = 100 - 100 / (1 + rs);
  result.push({
    time: Math.floor(new Date(bars[period].t).getTime() / 1000),
    value: rsi,
  });

  // Calculate remaining RSI values using smoothed averages
  for (let i = period; i < changes.length; i++) {
    const change = changes[i];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    const rsi = 100 - 100 / (1 + rs);
    result.push({
      time: Math.floor(new Date(bars[i + 1].t).getTime() / 1000),
      value: rsi,
    });
  }

  return result;
}

/**
 * Calculate MACD (Moving Average Convergence Divergence).
 *
 * @param bars - Price bars sorted by time ascending
 * @param fastPeriod - Fast EMA period (default: 12)
 * @param slowPeriod - Slow EMA period (default: 26)
 * @param signalPeriod - Signal line EMA period (default: 9)
 * @returns Object with macdLine, signalLine, and histogram arrays
 */
export function calculateMACD(
  bars: Bar[],
  fastPeriod: number = 12,
  slowPeriod: number = 26,
  signalPeriod: number = 9
): { macdLine: TimeValue[]; signalLine: TimeValue[]; histogram: TimeValue[] } {
  if (bars.length < slowPeriod) {
    return { macdLine: [], signalLine: [], histogram: [] };
  }

  const fastEMA = calculateEMA(bars, fastPeriod);
  const slowEMA = calculateEMA(bars, slowPeriod);

  // MACD line = Fast EMA - Slow EMA
  // Align by timestamp since EMAs start at different points
  const macdLine: TimeValue[] = [];
  const slowEMAMap = new Map(slowEMA.map((d) => [d.time, d.value]));

  for (const fast of fastEMA) {
    const slow = slowEMAMap.get(fast.time);
    if (slow !== undefined) {
      macdLine.push({ time: fast.time, value: fast.value - slow });
    }
  }

  if (macdLine.length < signalPeriod) {
    return { macdLine, signalLine: [], histogram: [] };
  }

  // Signal line = EMA of MACD line
  const signalLine: TimeValue[] = [];
  const multiplier = 2 / (signalPeriod + 1);

  // Start with SMA
  let sum = 0;
  for (let i = 0; i < signalPeriod; i++) {
    sum += macdLine[i].value;
  }
  let signal = sum / signalPeriod;
  signalLine.push({ time: macdLine[signalPeriod - 1].time, value: signal });

  for (let i = signalPeriod; i < macdLine.length; i++) {
    signal = (macdLine[i].value - signal) * multiplier + signal;
    signalLine.push({ time: macdLine[i].time, value: signal });
  }

  // Histogram = MACD line - Signal line
  const histogram: TimeValue[] = [];
  const signalMap = new Map(signalLine.map((d) => [d.time, d.value]));

  for (const macd of macdLine) {
    const sig = signalMap.get(macd.time);
    if (sig !== undefined) {
      histogram.push({ time: macd.time, value: macd.value - sig });
    }
  }

  return { macdLine, signalLine, histogram };
}

// Individual moving average setting
export interface MovingAverageSetting {
  id: string;      // Unique ID for React keys
  type: "sma" | "ema";
  period: number;
  color: string;
}

// Chart settings interface - dynamic list of MAs
export interface ChartMetricSettings {
  movingAverages: MovingAverageSetting[];  // Dynamic list of SMAs and EMAs
  ribbon: { enabled: boolean; count: number; base: number; step: number };
  rsi: { enabled: boolean; period: number };
  macd: { enabled: boolean; fast: number; slow: number; signal: number };
  atr: { enabled: boolean; period: number };  // ATR (Average True Range) - server-side calculation
}

// Color palette for moving averages (cycles through)
export const MA_COLORS = [
  "#2196f3",  // Blue
  "#4caf50",  // Green
  "#ff9800",  // Orange
  "#e91e63",  // Pink
  "#9c27b0",  // Purple
  "#00bcd4",  // Cyan
  "#ffeb3b",  // Yellow
  "#ff5722",  // Deep Orange
];

export const DEFAULT_METRIC_SETTINGS: ChartMetricSettings = {
  movingAverages: [],  // Start empty - user adds what they want
  ribbon: { enabled: false, count: 3, base: 9, step: 3 },
  rsi: { enabled: false, period: 14 },
  macd: { enabled: false, fast: 12, slow: 26, signal: 9 },
  atr: { enabled: false, period: 14 },  // ATR computed server-side
};

// Helper to generate unique ID
export const generateMAId = () => `ma-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

/**
 * Calculate the number of warm-up bars needed for indicators to produce valid output
 * from the first visible bar. This ensures indicators are "primed" before the visible range.
 */
export function calculateWarmupBars(settings: ChartMetricSettings): number {
  let maxWarmup = 0;

  // Moving averages: need `period` bars
  for (const ma of settings.movingAverages) {
    maxWarmup = Math.max(maxWarmup, ma.period);
  }

  // Ribbon: largest period is base + (count-1) * step
  if (settings.ribbon.enabled) {
    const maxRibbonPeriod = settings.ribbon.base + (settings.ribbon.count - 1) * settings.ribbon.step;
    maxWarmup = Math.max(maxWarmup, maxRibbonPeriod);
  }

  // RSI: needs period + 1 bars
  if (settings.rsi.enabled) {
    maxWarmup = Math.max(maxWarmup, settings.rsi.period + 1);
  }

  // MACD: needs slowPeriod + signalPeriod - 1 bars
  if (settings.macd.enabled) {
    const macdWarmup = settings.macd.slow + settings.macd.signal - 1;
    maxWarmup = Math.max(maxWarmup, macdWarmup);
  }

  return maxWarmup;
}

// Color palette for ribbon lines
export const RIBBON_COLORS = [
  "#2962FF", // Blue
  "#00BCD4", // Cyan
  "#4CAF50", // Green
  "#8BC34A", // Light Green
  "#CDDC39", // Lime
  "#FFEB3B", // Yellow
  "#FFC107", // Amber
  "#FF9800", // Orange
];
