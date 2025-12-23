/**
 * App State Context
 *
 * React context provider that manages the application state machine.
 * Wires up WebSocket events, visibility detection, and day boundary detection.
 */

import React, {
  createContext,
  useContext,
  useReducer,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from "react";
import { socketHub } from "../ws/SocketHub";
import { useMarketState, type MarketState } from "../services/marketState";
import { clearCache as clearClosePricesCache } from "../services/closePrices";
import {
  AppState,
  AppEvent,
  initialAppState,
  APP_STATE_CONFIG,
} from "./appStateTypes";
import {
  appStateReducer,
  isConnected,
  isReady,
  isStale,
  getStatusMessage,
} from "./appStateReducer";
import { createVisibilityDetector } from "./eventDetectors/visibilityDetector";
import { getCurrentTradingDay } from "./eventDetectors/dayBoundaryDetector";

// ─────────────────────────────────────────────────────────────
// Context Type
// ─────────────────────────────────────────────────────────────

interface AppStateContextValue {
  state: AppState;
  dispatch: React.Dispatch<AppEvent>;

  // Convenience accessors
  isConnected: boolean;
  isReady: boolean;
  isStale: boolean;
  statusMessage: string;

  // Actions
  acknowledgeStale: () => void;
  requestRefresh: () => void;
  markDataLoaded: () => void;
  reportError: (error: string) => void;
  retry: () => void;

  // IB Connection actions (called by PortfolioPanel when it gets IB status)
  setIbConnected: (connected: boolean) => void;
}

const AppStateContext = createContext<AppStateContextValue | null>(null);

// ─────────────────────────────────────────────────────────────
// Provider Component
// ─────────────────────────────────────────────────────────────

interface AppStateProviderProps {
  children: React.ReactNode;
}

export function AppStateProvider({ children }: AppStateProviderProps) {
  const [state, dispatch] = useReducer(appStateReducer, initialAppState);

  // Get market state from the service
  const marketState = useMarketState();

  // Debug logging for state changes
  useEffect(() => {
    console.log("[AppState]", state.status, {
      ws: state.connection.websocket,
      ib: state.connection.ibGateway,
      staleReason: state.staleReason,
      tradingDay: state.market.tradingDay,
      session: state.market.session,
    });
  }, [state.status, state.connection, state.staleReason, state.market.tradingDay, state.market.session]);

  // ─────────────────────────────────────────────────────────────
  // WebSocket Event Handlers
  // ─────────────────────────────────────────────────────────────

  useEffect(() => {
    const handleConnect = () => {
      dispatch({ type: "WS_CONNECT" });
    };

    const handleDisconnect = () => {
      dispatch({ type: "WS_DISCONNECT" });
    };

    // Set initial state based on current connection
    if (socketHub.isConnected()) {
      dispatch({ type: "WS_CONNECT" });
    }

    socketHub.onConnect(handleConnect);
    socketHub.onDisconnect(handleDisconnect);

    return () => {
      socketHub.offConnect(handleConnect);
      socketHub.offDisconnect(handleDisconnect);
    };
  }, []);

  // ─────────────────────────────────────────────────────────────
  // Visibility Detection
  // ─────────────────────────────────────────────────────────────

  useEffect(() => {
    return createVisibilityDetector((event) => {
      if (
        event.type === "TAB_VISIBLE" &&
        event.hiddenDuration > APP_STATE_CONFIG.staleThresholdMs
      ) {
        console.log(
          "[AppState] Tab visible after",
          Math.round(event.hiddenDuration / 1000),
          "seconds"
        );
        dispatch({ type: "TAB_VISIBLE", hiddenDuration: event.hiddenDuration });
      }
    });
  }, []);

  // ─────────────────────────────────────────────────────────────
  // Day Boundary Detection
  // ─────────────────────────────────────────────────────────────

  useEffect(() => {
    // Check for day boundary periodically using Eastern Time
    const checkDayBoundary = () => {
      const today = getCurrentTradingDay();

      if (
        state.market.tradingDay !== "" &&
        state.market.tradingDay !== today
      ) {
        // Day has changed
        console.log("[AppState] Day boundary detected:", state.market.tradingDay, "->", today);
        const prevTradingDay = state.market.tradingDay;
        dispatch({
          type: "DAY_BOUNDARY",
          newDay: today,
          prevTradingDay,
        });
      }
    };

    const interval = setInterval(
      checkDayBoundary,
      APP_STATE_CONFIG.dayBoundaryCheckIntervalMs
    );

    return () => clearInterval(interval);
  }, [state.market.tradingDay]);

  // ─────────────────────────────────────────────────────────────
  // Cache Invalidation on Day Boundary or Stale
  // ─────────────────────────────────────────────────────────────

  // Clear close prices cache when entering STALE due to day boundary
  useEffect(() => {
    if (state.staleReason === "day_boundary") {
      console.log("[AppState] Clearing close prices cache due to day boundary");
      clearClosePricesCache();
    }
  }, [state.staleReason]);

  // ─────────────────────────────────────────────────────────────
  // Market State Integration
  // ─────────────────────────────────────────────────────────────

  // Track previous market state for comparison
  const prevMarketStateRef = useRef<MarketState | null>(null);

  useEffect(() => {
    if (!marketState) return;

    const prev = prevMarketStateRef.current;
    prevMarketStateRef.current = marketState;

    // If this is the first market state, initialize our market context
    if (!prev) {
      dispatch({
        type: "MARKET_STATE_UPDATE",
        tradingDay: getCurrentTradingDay(),
        prevTradingDay: marketState.prevTradingDay,
        session: marketState.state,
      });
      return;
    }

    // Check if session changed
    if (prev.state !== marketState.state) {
      console.log("[AppState] Session changed:", prev.state, "->", marketState.state);
      dispatch({ type: "SESSION_CHANGE", session: marketState.state });
    }

    // Check if prevTradingDay changed (day boundary detected by backend)
    if (prev.prevTradingDay !== marketState.prevTradingDay && marketState.prevTradingDay) {
      console.log("[AppState] Backend day change detected, prevTradingDay:", marketState.prevTradingDay);
      dispatch({
        type: "MARKET_STATE_UPDATE",
        tradingDay: getCurrentTradingDay(),
        prevTradingDay: marketState.prevTradingDay,
        session: marketState.state,
      });
    }
  }, [marketState]);

  // ─────────────────────────────────────────────────────────────
  // Action Helpers
  // ─────────────────────────────────────────────────────────────

  const acknowledgeStale = useCallback(() => {
    dispatch({ type: "STALE_ACK" });
  }, []);

  const requestRefresh = useCallback(() => {
    dispatch({ type: "REFRESH_REQUEST" });
  }, []);

  const markDataLoaded = useCallback(() => {
    dispatch({ type: "DATA_LOADED" });
  }, []);

  const reportError = useCallback((error: string) => {
    dispatch({ type: "ERROR_OCCURRED", error });
  }, []);

  const retry = useCallback(() => {
    dispatch({ type: "RETRY" });
    socketHub.connect();
  }, []);

  const setIbConnected = useCallback((connected: boolean) => {
    dispatch({ type: connected ? "IB_CONNECT" : "IB_DISCONNECT" });
  }, []);

  // ─────────────────────────────────────────────────────────────
  // Context Value
  // ─────────────────────────────────────────────────────────────

  const value = useMemo<AppStateContextValue>(
    () => ({
      state,
      dispatch,
      isConnected: isConnected(state),
      isReady: isReady(state),
      isStale: isStale(state),
      statusMessage: getStatusMessage(state),
      acknowledgeStale,
      requestRefresh,
      markDataLoaded,
      reportError,
      retry,
      setIbConnected,
    }),
    [state, acknowledgeStale, requestRefresh, markDataLoaded, reportError, retry, setIbConnected]
  );

  return (
    <AppStateContext.Provider value={value}>
      {children}
    </AppStateContext.Provider>
  );
}

// ─────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────

export function useAppStateContext(): AppStateContextValue {
  const context = useContext(AppStateContext);
  if (context === null) {
    throw new Error("useAppStateContext must be used within AppStateProvider");
  }
  return context;
}
