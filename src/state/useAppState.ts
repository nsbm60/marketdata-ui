/**
 * useAppState Hook
 *
 * Main hook for components to access application state.
 * Re-exports the context hook with a cleaner name.
 */

export { useAppStateContext as useAppState } from "./AppStateContext";

// Re-export types for convenience
export type {
  AppState,
  AppStatus,
  AppEvent,
  StaleReason,
  ConnectionState,
  MarketContext,
} from "./appStateTypes";
