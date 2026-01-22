/**
 * useNotifications Hook
 *
 * Collects notifications from various sources across the app:
 * - Connection status (WebSocket, IB Gateway)
 * - Fidelity import staleness
 * - Market state
 * - Data quality warnings
 */

import { useMemo } from "react";
import { useAppState } from "../state/useAppState";
import { useMarketState } from "../services/marketState";

export type NotificationType = "info" | "warning" | "error" | "success";

export interface Notification {
  id: string;
  type: NotificationType;
  message: string;
  source: string;        // e.g., "fidelity", "ib", "websocket", "market"
  dismissible?: boolean; // Can user dismiss it?
  action?: {             // Optional action button
    label: string;
    onClick: () => void;
  };
}

interface NotificationsResult {
  notifications: Notification[];
  hasErrors: boolean;
  hasWarnings: boolean;
}

export function useNotifications(): NotificationsResult {
  const { state: appState, isConnected } = useAppState();
  const marketState = useMarketState();

  const notifications = useMemo(() => {
    const result: Notification[] = [];

    // WebSocket connection status
    if (appState.connection.websocket === "disconnected") {
      result.push({
        id: "ws-disconnected",
        type: "error",
        message: "WebSocket disconnected",
        source: "websocket",
      });
    } else if (appState.connection.websocket === "connecting") {
      result.push({
        id: "ws-connecting",
        type: "warning",
        message: "Connecting to server...",
        source: "websocket",
      });
    }

    // IB Gateway connection status
    if (appState.connection.ibGateway === "disconnected") {
      result.push({
        id: "ib-disconnected",
        type: "warning",
        message: "IB Gateway not connected",
        source: "ib",
      });
    }

    // Fidelity import staleness
    const fidelityReminder = getFidelityImportReminder(marketState?.state);
    if (fidelityReminder) {
      result.push({
        id: "fidelity-stale",
        type: "warning",
        message: fidelityReminder,
        source: "fidelity",
        dismissible: true,
      });
    }

    // Market session (info only)
    if (marketState?.state && marketState.state !== "RegularHours") {
      const sessionLabels: Record<string, string> = {
        PreMarket: "Pre-Market",
        AfterHours: "After Hours",
        Overnight: "Overnight",
        Closed: "Market Closed",
      };
      result.push({
        id: "market-session",
        type: "info",
        message: sessionLabels[marketState.state] || marketState.state,
        source: "market",
      });
    }

    return result;
  }, [
    appState.connection.websocket,
    appState.connection.ibGateway,
    marketState?.state,
  ]);

  const hasErrors = notifications.some((n) => n.type === "error");
  const hasWarnings = notifications.some((n) => n.type === "warning");

  return { notifications, hasErrors, hasWarnings };
}

/**
 * Get Fidelity import reminder message based on stored timestamp.
 */
function getFidelityImportReminder(marketSession: string | undefined): string | null {
  const downloadedAtStr = localStorage.getItem("fidelity.downloadedAt");
  const hasPositions = localStorage.getItem("fidelity.positions");

  // No reminder if no positions imported
  if (!hasPositions) return null;

  // No timestamp means legacy import without extracted timestamp
  if (!downloadedAtStr) return null;

  const downloadedAt = new Date(downloadedAtStr);
  const now = new Date();
  const today = now.toDateString();
  const importDay = downloadedAt.toDateString();
  const isToday = today === importDay;
  const importHour = downloadedAt.getHours();

  // If import is from a different day
  if (!isToday) {
    const daysDiff = Math.floor(
      (now.getTime() - downloadedAt.getTime()) / (1000 * 60 * 60 * 24)
    );
    if (daysDiff === 1) {
      return "Fidelity: last import was yesterday";
    }
    return `Fidelity: last import was ${daysDiff} days ago`;
  }

  // Import is from today - check timing vs market state
  if (marketSession === "PreMarket" && importHour >= 16) {
    return "Fidelity: import pre-market positions for accurate P&L";
  }

  if (marketSession === "AfterHours" && importHour < 16) {
    return "Fidelity: consider EOD import";
  }

  return null;
}
