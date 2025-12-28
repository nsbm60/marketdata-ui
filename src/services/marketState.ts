/**
 * Market state management - tracks current session state from the server.
 *
 * - Queries market_state RPC on first use
 * - Listens for cal.market.open/close events for real-time transitions
 * - Provides useMarketState() hook for components
 */

import { useEffect, useState } from "react";
import { socketHub } from "../ws/SocketHub";
import type { TickEnvelope } from "../ws/ws-types";

// ---- Types ----

export type SessionState = "PreMarket" | "RegularHours" | "AfterHours" | "Closed";

export interface MarketSession {
  name: string;   // "pre-market", "regular", "after-hours"
  start: string;  // "04:00", "09:30", "16:00"
  end: string;    // "09:30", "16:00", "20:00"
}

export interface TimeframeOption {
  id: string;     // "1d", "2d", "1w", "1m"
  date: string;   // "2025-12-16" - the actual date for this timeframe
  label: string;  // "" (for 1d), "-1d", "-1w", "-1m"
}

// Alias for backwards compatibility
export type TimeframeInfo = TimeframeOption;

export interface MarketState {
  state: SessionState;
  isTradingDay: boolean;
  prevTradingDay: string;           // "2025-12-13" - for close price lookups
  regularOpen?: string;             // ISO timestamp
  regularClose?: string;            // ISO timestamp
  sessions: MarketSession[];
  timeframes: TimeframeOption[];    // Available timeframe options with dates
  lastUpdated: number;              // timestamp of last update
}

// ---- Module state ----

let currentState: MarketState | null = null;
let initialized = false;
let initializing = false;
const listeners = new Set<(s: MarketState) => void>();

function notify() {
  if (currentState) {
    listeners.forEach((fn) => {
      try { fn(currentState!); } catch { /* no-op */ }
    });
  }
}

// ---- Initialization ----

async function initialize() {
  if (initialized || initializing) return;
  initializing = true;

  // Listen for calendar events (cal.market.open, cal.market.close)
  socketHub.onTick(handleCalendarEvent);

  // Refresh on WebSocket reconnect
  socketHub.onConnect(() => {
    console.log("[MarketState] WebSocket reconnected, refreshing...");
    refetchMarketState();
  });

  // Refresh when page becomes visible (e.g., after sleeping overnight)
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && initialized) {
      console.log("[MarketState] Page visible, refreshing...");
      refetchMarketState();
    }
  });

  // Periodic refresh every 5 minutes to catch session transitions
  // (backup in case cal.market.* events are missed)
  setInterval(() => {
    if (initialized) {
      console.log("[MarketState] Periodic refresh...");
      refetchMarketState();
    }
  }, 5 * 60 * 1000);

  // Query current state
  try {
    const ack = await socketHub.sendControl("market_state", {}, { timeoutMs: 5000 });
    if (ack.ok && ack.data) {
      const d = (ack.data as any).data || ack.data;
      currentState = {
        state: d.state as SessionState,
        isTradingDay: d.isTradingDay ?? true,
        prevTradingDay: d.prevTradingDay ?? "",
        regularOpen: d.regularOpen,
        regularClose: d.regularClose,
        sessions: d.sessions ?? [],
        timeframes: d.timeframes ?? [],
        lastUpdated: Date.now(),
      };
      console.log("[MarketState] Initialized:", currentState.state,
        "prevTradingDay:", currentState.prevTradingDay,
        "timeframes:", currentState.timeframes.map((t: TimeframeOption) => `${t.id}=${t.date}`).join(", "));
      notify();
    }
  } catch (err) {
    console.error("[MarketState] Failed to fetch market_state:", err);
  }

  initialized = true;
  initializing = false;
}

function handleCalendarEvent(tick: TickEnvelope) {
  const { topic, data } = tick;

  // Only handle cal.market.* topics
  if (!topic.startsWith("cal.market.")) return;

  console.log("[MarketState] Calendar event:", topic, data);

  if (topic === "cal.market.open" || topic === "cal.market.close") {
    // Re-fetch full market_state to get updated timeframes
    // (e.g., "0d" option appears when transitioning to after-hours)
    refetchMarketState();
  }
}

async function refetchMarketState() {
  console.log("[MarketState] Re-fetching market state after session transition...");
  try {
    const ack = await socketHub.sendControl("market_state", {}, { timeoutMs: 5000 });
    if (ack.ok && ack.data) {
      const d = (ack.data as any).data || ack.data;
      currentState = {
        state: d.state as SessionState,
        isTradingDay: d.isTradingDay ?? true,
        prevTradingDay: d.prevTradingDay ?? "",
        regularOpen: d.regularOpen,
        regularClose: d.regularClose,
        sessions: d.sessions ?? [],
        timeframes: d.timeframes ?? [],
        lastUpdated: Date.now(),
      };
      console.log("[MarketState] Updated:", currentState.state,
        "timeframes:", currentState.timeframes.map((t: TimeframeOption) => `${t.id}=${t.date}`).join(", "));
      notify();
    }
  } catch (err) {
    console.error("[MarketState] Failed to re-fetch market_state:", err);
  }
}

// ---- Public API ----

/** Get current market state (may be null if not yet initialized). */
export function getMarketState(): MarketState | null {
  if (!initialized && !initializing) {
    initialize();
  }
  return currentState;
}

/** React hook to subscribe to market state changes. */
export function useMarketState(): MarketState | null {
  const [state, setState] = useState<MarketState | null>(currentState);

  useEffect(() => {
    // Ensure initialization
    if (!initialized && !initializing) {
      initialize();
    }

    // If already have state, update local
    if (currentState && !state) {
      setState(currentState);
    }

    // Subscribe to changes
    const handler = (s: MarketState) => setState(s);
    listeners.add(handler);

    return () => {
      listeners.delete(handler);
    };
  }, []);

  return state;
}

/** Check if currently in regular trading hours. */
export function isRegularHours(): boolean {
  return currentState?.state === "RegularHours";
}

/** Check if currently in extended hours (pre-market or after-hours). */
export function isExtendedHours(): boolean {
  const s = currentState?.state;
  return s === "PreMarket" || s === "AfterHours";
}

/** Get the previous trading day (for close price lookups). */
export function getPrevTradingDay(): string | null {
  return currentState?.prevTradingDay ?? null;
}

/** Force refresh market state from server. */
export function refreshMarketState(): void {
  refetchMarketState();
}
