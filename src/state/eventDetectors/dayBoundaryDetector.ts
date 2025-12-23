/**
 * Day Boundary Detector
 *
 * Detects when the trading day changes to trigger data refresh.
 * Works with the market state service to get accurate trading day info.
 */

import { getMarketState } from "../../services/marketState";

export interface DayBoundaryEvent {
  type: "DAY_BOUNDARY";
  newDay: string;         // YYYY-MM-DD
  prevTradingDay: string; // Previous trading day
  timestamp: number;
}

export type DayBoundaryHandler = (event: DayBoundaryEvent) => void;

/**
 * Creates a day boundary detector that periodically checks for day changes.
 *
 * @param onDayBoundary - Callback when day changes
 * @param checkIntervalMs - How often to check (default: 60 seconds)
 * @returns Cleanup function to stop checking
 *
 * @example
 * ```typescript
 * const cleanup = createDayBoundaryDetector(
 *   (event) => {
 *     console.log("Day changed to:", event.newDay);
 *     dispatch({ type: "DAY_BOUNDARY", ...event });
 *   },
 *   60 * 1000 // check every minute
 * );
 *
 * // Later:
 * cleanup();
 * ```
 */
export function createDayBoundaryDetector(
  onDayBoundary: DayBoundaryHandler,
  checkIntervalMs: number = 60 * 1000
): () => void {
  let lastKnownDay: string | null = null;

  const checkBoundary = () => {
    const marketState = getMarketState();
    if (!marketState) return;

    // Get current trading day from market state or compute from local time
    // Note: For accurate trading day detection, rely on backend market_state
    const currentDay = getCurrentTradingDay();

    if (lastKnownDay === null) {
      // First check - just record the day
      lastKnownDay = currentDay;
      return;
    }

    if (currentDay !== lastKnownDay) {
      // Day has changed
      const prevTradingDay = lastKnownDay;
      lastKnownDay = currentDay;

      onDayBoundary({
        type: "DAY_BOUNDARY",
        newDay: currentDay,
        prevTradingDay,
        timestamp: Date.now(),
      });
    }
  };

  // Initial check
  checkBoundary();

  // Periodic check
  const interval = setInterval(checkBoundary, checkIntervalMs);

  return () => {
    clearInterval(interval);
  };
}

/**
 * Get the current trading day in YYYY-MM-DD format.
 * Uses Eastern Time for US markets.
 */
export function getCurrentTradingDay(): string {
  const now = new Date();

  // Format in Eastern Time
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const parts = formatter.formatToParts(now);
  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;

  return `${year}-${month}-${day}`;
}

/**
 * Get the current hour in Eastern Time (0-23).
 * Useful for determining if we're past midnight.
 */
export function getCurrentEasternHour(): number {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    hour12: false,
  });

  return parseInt(formatter.format(now), 10);
}

/**
 * React hook for day boundary detection.
 */
import { useEffect, useRef } from "react";

export function useDayBoundaryDetector(
  onDayBoundary: (newDay: string, prevDay: string) => void,
  checkIntervalMs: number = 60 * 1000
): void {
  const onDayBoundaryRef = useRef(onDayBoundary);
  const lastKnownDayRef = useRef<string | null>(null);

  // Keep callback ref up to date
  useEffect(() => {
    onDayBoundaryRef.current = onDayBoundary;
  }, [onDayBoundary]);

  useEffect(() => {
    const checkBoundary = () => {
      const currentDay = getCurrentTradingDay();

      if (lastKnownDayRef.current === null) {
        lastKnownDayRef.current = currentDay;
        return;
      }

      if (currentDay !== lastKnownDayRef.current) {
        const prevDay = lastKnownDayRef.current;
        lastKnownDayRef.current = currentDay;
        onDayBoundaryRef.current(currentDay, prevDay);
      }
    };

    // Initial check
    checkBoundary();

    // Periodic check
    const interval = setInterval(checkBoundary, checkIntervalMs);

    return () => clearInterval(interval);
  }, [checkIntervalMs]);
}
