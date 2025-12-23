/**
 * App State Reducer
 *
 * State machine logic for application state transitions.
 * Handles connection events, market session changes, and data staleness.
 */

import {
  AppState,
  AppEvent,
  AppStatus,
  APP_STATE_CONFIG,
} from "./appStateTypes";

/**
 * State machine reducer for app state.
 *
 * State transitions:
 * - DISCONNECTED + WS_CONNECT → CONNECTING
 * - CONNECTING + WS_CONNECT → WS_CONNECTED
 * - WS_CONNECTED + IB_CONNECT → READY (if initialized) or IB_CONNECTING
 * - IB_CONNECTING + DATA_LOADED → READY
 * - READY + WS_DISCONNECT → STALE (ws_reconnected)
 * - READY + IB_DISCONNECT → STALE (ib_reconnected)
 * - READY + DAY_BOUNDARY → STALE (day_boundary)
 * - READY + TAB_VISIBLE (>threshold) → STALE (tab_restored)
 * - STALE + STALE_ACK + DATA_LOADED → READY
 * - Any + ERROR_OCCURRED → ERROR
 * - ERROR + RETRY → CONNECTING
 */
export function appStateReducer(state: AppState, event: AppEvent): AppState {
  switch (event.type) {
    // ─────────────────────────────────────────────────────────────
    // WebSocket Events
    // ─────────────────────────────────────────────────────────────

    case "WS_CONNECT": {
      // WebSocket connected
      return {
        ...state,
        connection: {
          ...state.connection,
          websocket: "connected",
        },
        status: determineStatus({
          ...state,
          connection: { ...state.connection, websocket: "connected" },
        }),
        error: null,
      };
    }

    case "WS_DISCONNECT": {
      // WebSocket disconnected - mark as stale if we were ready
      const wasReady = state.status === "READY";
      return {
        ...state,
        connection: {
          websocket: "disconnected",
          ibGateway: "unknown", // IB status unknown when WS down
        },
        status: "DISCONNECTED",
        staleReason: wasReady ? "ws_reconnected" : state.staleReason,
      };
    }

    // ─────────────────────────────────────────────────────────────
    // IB Gateway Events
    // ─────────────────────────────────────────────────────────────

    case "IB_CONNECT": {
      return {
        ...state,
        connection: {
          ...state.connection,
          ibGateway: "connected",
        },
        status: determineStatus({
          ...state,
          connection: { ...state.connection, ibGateway: "connected" },
        }),
      };
    }

    case "IB_DISCONNECT": {
      // IB disconnected - mark as stale if we were ready
      const wasReady = state.status === "READY";
      return {
        ...state,
        connection: {
          ...state.connection,
          ibGateway: "disconnected",
        },
        status: wasReady ? "STALE" : state.status,
        staleReason: wasReady ? "ib_reconnected" : state.staleReason,
      };
    }

    // ─────────────────────────────────────────────────────────────
    // Data Events
    // ─────────────────────────────────────────────────────────────

    case "DATA_LOADED": {
      // Data successfully loaded
      const now = Date.now();
      const isFullyConnected =
        state.connection.websocket === "connected" &&
        state.connection.ibGateway === "connected";

      if (isFullyConnected) {
        return {
          ...state,
          status: "READY",
          staleReason: null,
          lastRefresh: now,
          initialized: true,
          error: null,
        };
      }

      // Data loaded but not fully connected yet
      return {
        ...state,
        lastRefresh: now,
        initialized: true,
      };
    }

    // ─────────────────────────────────────────────────────────────
    // Time-Based Events
    // ─────────────────────────────────────────────────────────────

    case "DAY_BOUNDARY": {
      // Trading day changed - mark stale to trigger refresh
      return {
        ...state,
        market: {
          ...state.market,
          tradingDay: event.newDay,
          prevTradingDay: event.prevTradingDay,
        },
        status: state.status === "READY" ? "STALE" : state.status,
        staleReason: state.status === "READY" ? "day_boundary" : state.staleReason,
      };
    }

    case "SESSION_CHANGE": {
      // Market session changed (pre/regular/after/closed)
      return {
        ...state,
        market: {
          ...state.market,
          session: event.session,
          lastSessionChange: Date.now(),
        },
      };
    }

    // ─────────────────────────────────────────────────────────────
    // User/Visibility Events
    // ─────────────────────────────────────────────────────────────

    case "TAB_VISIBLE": {
      // Tab became visible after being hidden
      const wasHiddenTooLong =
        event.hiddenDuration > APP_STATE_CONFIG.staleThresholdMs;

      if (wasHiddenTooLong && state.status === "READY") {
        return {
          ...state,
          status: "STALE",
          staleReason: "tab_restored",
        };
      }

      return state;
    }

    case "REFRESH_REQUEST": {
      // User requested manual refresh
      if (state.status === "READY") {
        return {
          ...state,
          status: "STALE",
          staleReason: "manual_refresh",
        };
      }
      return state;
    }

    case "STALE_ACK": {
      // Stale state acknowledged, waiting for data reload
      // Status will move to READY when DATA_LOADED fires
      return {
        ...state,
        staleReason: null, // Clear reason, refresh is in progress
      };
    }

    // ─────────────────────────────────────────────────────────────
    // Error Events
    // ─────────────────────────────────────────────────────────────

    case "ERROR_OCCURRED": {
      return {
        ...state,
        status: "ERROR",
        error: event.error,
      };
    }

    case "RETRY": {
      // User wants to retry after error
      return {
        ...state,
        status: "CONNECTING",
        error: null,
        connection: {
          websocket: "connecting",
          ibGateway: "unknown",
        },
      };
    }

    // ─────────────────────────────────────────────────────────────
    // Market State Update (from backend)
    // ─────────────────────────────────────────────────────────────

    case "MARKET_STATE_UPDATE": {
      // Backend sent market state (tradingDay, prevTradingDay, session)
      const dayChanged =
        state.market.tradingDay !== "" &&
        state.market.tradingDay !== event.tradingDay;

      return {
        ...state,
        market: {
          tradingDay: event.tradingDay,
          prevTradingDay: event.prevTradingDay,
          session: event.session,
          lastSessionChange: Date.now(),
        },
        // If day changed and we were ready, go stale
        status: dayChanged && state.status === "READY" ? "STALE" : state.status,
        staleReason: dayChanged && state.status === "READY" ? "day_boundary" : state.staleReason,
      };
    }

    default: {
      // Exhaustiveness check
      const _exhaustive: never = event;
      return state;
    }
  }
}

/**
 * Determine the appropriate status based on connection state.
 * Used when connection state changes to compute derived status.
 */
function determineStatus(state: AppState): AppStatus {
  const { websocket, ibGateway } = state.connection;

  if (websocket === "disconnected") {
    return "DISCONNECTED";
  }

  if (websocket === "connecting") {
    return "CONNECTING";
  }

  // websocket === "connected"
  if (ibGateway === "unknown") {
    return "WS_CONNECTED";
  }

  if (ibGateway === "disconnected") {
    return "IB_CONNECTING";
  }

  // ibGateway === "connected"
  if (state.initialized) {
    // Check if we have a pending stale reason
    if (state.staleReason) {
      return "STALE";
    }
    return "READY";
  }

  return "IB_CONNECTING";
}

/**
 * Helper to check if the app is in a connected state.
 */
export function isConnected(state: AppState): boolean {
  return (
    state.connection.websocket === "connected" &&
    state.connection.ibGateway === "connected"
  );
}

/**
 * Helper to check if the app is ready for user interaction.
 */
export function isReady(state: AppState): boolean {
  return state.status === "READY";
}

/**
 * Helper to check if data is stale and needs refresh.
 */
export function isStale(state: AppState): boolean {
  return state.status === "STALE";
}

/**
 * Helper to get a user-friendly status message.
 */
export function getStatusMessage(state: AppState): string {
  switch (state.status) {
    case "DISCONNECTED":
      return "Disconnected";
    case "CONNECTING":
      return "Connecting...";
    case "WS_CONNECTED":
      return "Connected, checking IB...";
    case "IB_CONNECTING":
      return "Connecting to IB Gateway...";
    case "READY":
      return "Ready";
    case "STALE":
      return getStaleMessage(state.staleReason);
    case "ERROR":
      return state.error || "Error";
    default:
      return "Unknown";
  }
}

function getStaleMessage(reason: AppState["staleReason"]): string {
  switch (reason) {
    case "ws_reconnected":
      return "Reconnected - refreshing data...";
    case "ib_reconnected":
      return "IB reconnected - refreshing data...";
    case "day_boundary":
      return "New trading day - refreshing data...";
    case "tab_restored":
      return "Tab restored - refreshing data...";
    case "manual_refresh":
      return "Refreshing...";
    default:
      return "Data may be stale - refreshing...";
  }
}
