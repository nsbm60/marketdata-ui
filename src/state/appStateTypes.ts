/**
 * App State Types
 *
 * Central type definitions for the application state machine.
 * Handles connection state, market session, and data freshness.
 */

import { SessionState } from "../services/marketState";

// ─────────────────────────────────────────────────────────────
// App Status (State Machine States)
// ─────────────────────────────────────────────────────────────

export type AppStatus =
  | "DISCONNECTED"    // WebSocket not connected
  | "CONNECTING"      // WebSocket connecting
  | "WS_CONNECTED"    // WebSocket open, IB status unknown
  | "IB_CONNECTING"   // WS connected, waiting for IB status
  | "READY"           // WS + IB connected + initial data loaded
  | "STALE"           // Data may be outdated (reconnected, day changed, etc.)
  | "ERROR";          // Unrecoverable error

// ─────────────────────────────────────────────────────────────
// Stale Reason (Why data needs refresh)
// ─────────────────────────────────────────────────────────────

export type StaleReason =
  | "ws_reconnected"   // WebSocket reconnected after disconnect
  | "ib_reconnected"   // IB Gateway reconnected
  | "day_boundary"     // Trading day changed
  | "tab_restored"     // Tab became visible after being hidden
  | "manual_refresh"   // User requested refresh
  | null;

// ─────────────────────────────────────────────────────────────
// Connection State
// ─────────────────────────────────────────────────────────────

export type WebSocketState = "disconnected" | "connecting" | "connected";
export type IbGatewayState = "unknown" | "disconnected" | "connected";

export interface ConnectionState {
  websocket: WebSocketState;
  ibGateway: IbGatewayState;
}

// ─────────────────────────────────────────────────────────────
// Market Context
// ─────────────────────────────────────────────────────────────

export interface MarketContext {
  tradingDay: string;          // YYYY-MM-DD format
  session: SessionState;       // Pre/Regular/After/Closed
  prevTradingDay: string;      // Previous trading day for close prices
  lastSessionChange: number;   // Timestamp of last session change
}

// ─────────────────────────────────────────────────────────────
// App State (Complete State)
// ─────────────────────────────────────────────────────────────

export interface AppState {
  status: AppStatus;
  connection: ConnectionState;
  market: MarketContext;
  staleReason: StaleReason;
  lastRefresh: number;         // Timestamp of last successful data load
  error: string | null;
  initialized: boolean;        // True after first successful data load
}

// ─────────────────────────────────────────────────────────────
// App Events (State Machine Events)
// ─────────────────────────────────────────────────────────────

export type AppEvent =
  // Connection events
  | { type: "WS_CONNECT" }
  | { type: "WS_DISCONNECT" }
  | { type: "IB_CONNECT" }
  | { type: "IB_DISCONNECT" }

  // Data events
  | { type: "DATA_LOADED" }

  // Time-based events
  | { type: "DAY_BOUNDARY"; newDay: string; prevTradingDay: string }
  | { type: "SESSION_CHANGE"; session: SessionState }

  // User/visibility events
  | { type: "TAB_VISIBLE"; hiddenDuration: number }
  | { type: "REFRESH_REQUEST" }
  | { type: "STALE_ACK" }

  // Error events
  | { type: "ERROR_OCCURRED"; error: string }
  | { type: "RETRY" }

  // Market state update (from backend)
  | { type: "MARKET_STATE_UPDATE"; tradingDay: string; prevTradingDay: string; session: SessionState };

// ─────────────────────────────────────────────────────────────
// Initial State
// ─────────────────────────────────────────────────────────────

export const initialAppState: AppState = {
  status: "DISCONNECTED",
  connection: {
    websocket: "disconnected",
    ibGateway: "unknown",
  },
  market: {
    tradingDay: "",
    session: "Closed",
    prevTradingDay: "",
    lastSessionChange: 0,
  },
  staleReason: null,
  lastRefresh: 0,
  error: null,
  initialized: false,
};

// ─────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────

export const APP_STATE_CONFIG = {
  // How long tab can be hidden before data is considered stale
  staleThresholdMs: 5 * 60 * 1000, // 5 minutes

  // How often to check for day boundary
  dayBoundaryCheckIntervalMs: 60 * 1000, // 1 minute
};
