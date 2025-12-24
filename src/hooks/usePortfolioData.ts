/**
 * usePortfolioData Hook
 *
 * Manages portfolio data fetching and real-time updates:
 * - Account state (positions, cash, executions, open orders)
 * - Order history
 * - IB connection status
 * - IB errors
 *
 * Handles WebSocket messages for:
 * - account_state (initial load)
 * - ib.openOrder (order updates)
 * - ib.order (order status)
 * - ib.accountSummary (cash updates)
 * - ib.error (errors and warnings)
 * - ib.executions (fills)
 * - ib.status (IB Gateway connection state changes)
 */

import { useEffect, useState, useRef, useCallback } from "react";
import { socketHub } from "../ws/SocketHub";
import { useAppState } from "../state/useAppState";
import {
  IbPosition,
  IbExecution,
  IbOpenOrder,
  IbOrderHistory,
  IbAccountState,
} from "../types/portfolio";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface IbError {
  id: number;
  code: number;
  message: string;
  severity: "error" | "warning";
  ts: string;
}

export interface UsePortfolioDataResult {
  // Data
  accountState: IbAccountState | null;
  orderHistory: IbOrderHistory[];
  ibErrors: IbError[];

  // Status
  loading: boolean;
  error: string | null;
  lastUpdated: string | null;
  ibConnected: boolean | null;

  // Error panel
  showErrors: boolean;
  setShowErrors: (show: boolean) => void;
  clearErrors: () => void;

  // Actions
  refresh: () => void;
}

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

const MAX_ERRORS = 50;
const MAX_ORDER_HISTORY = 50;
const MAX_EXECUTIONS = 50;

// ─────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────

export function usePortfolioData(): UsePortfolioDataResult {
  // Core state
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [accountState, setAccountState] = useState<IbAccountState | null>(null);
  const [ibConnectedLocal, setIbConnectedLocal] = useState<boolean | null>(null);
  const [orderHistory, setOrderHistory] = useState<IbOrderHistory[]>([]);

  // IB errors
  const [ibErrors, setIbErrors] = useState<IbError[]>([]);
  const [showErrors, setShowErrors] = useState(false);

  // App state integration
  const { setIbConnected: setIbConnectedGlobal, isStale, acknowledgeStale, markDataLoaded } = useAppState();

  // Track if we've loaded data at least once
  const dataLoadedRef = useRef(false);

  // Sync local IB connection state with global app state
  const setIbConnected = useCallback((connected: boolean | null) => {
    setIbConnectedLocal(connected);
    if (connected !== null) {
      setIbConnectedGlobal(connected);
    }
  }, [setIbConnectedGlobal]);

  // Clear errors
  const clearErrors = useCallback(() => {
    setIbErrors([]);
  }, []);

  // Refresh account state
  const refresh = useCallback(() => {
    setLoading(true);
    setError(null);
    socketHub.send({ type: "control", target: "ibAccount", op: "account_state" });
  }, []);

  // ─────────────────────────────────────────────────────────────
  // Main message handler effect
  // ─────────────────────────────────────────────────────────────

  useEffect(() => {
    const handler = (m: any) => {
      if (!m) return;

      let snapshot: any;
      try {
        snapshot = JSON.parse(JSON.stringify(m));
      } catch {
        snapshot = m;
      }

      // Log all ib.* messages to trace what's arriving
      if (snapshot?.topic?.startsWith("ib.")) {
        console.log("[usePortfolioData] IB message received:", snapshot.topic);
      }

      // Initial snapshot
      if (snapshot.type === "control.ack" && snapshot.op === "account_state") {
        handleAccountState(snapshot);
        return;
      }

      // Handle ib.openOrder messages
      if (snapshot?.topic === "ib.openOrder") {
        handleOpenOrder(snapshot);
        return;
      }

      // Handle ib.order (order status) messages
      if (snapshot?.topic === "ib.order") {
        handleOrderStatus(snapshot);
        return;
      }

      // Handle ib.accountSummary messages
      if (snapshot?.topic === "ib.accountSummary") {
        handleAccountSummary(snapshot);
        return;
      }

      // Handle ib.error messages
      if (snapshot?.topic === "ib.error") {
        handleIbError(snapshot);
        return;
      }

      // Handle ib.status messages (connection state changes)
      if (snapshot?.topic === "ib.status") {
        handleIbStatus(snapshot);
        return;
      }

      // Handle ib.executions messages
      if (snapshot?.topic === "ib.executions" || snapshot?.topic === "ib.execution") {
        handleExecution(snapshot);
        return;
      }
    };

    // ─────────────────────────────────────────────────────────────
    // Message Handlers
    // ─────────────────────────────────────────────────────────────

    function handleAccountState(snapshot: any) {
      if (!snapshot.ok) {
        setError(snapshot.error || "Error");
        setIbConnected(false);
        setLoading(false);
        return;
      }

      const raw = snapshot.data?.data || snapshot.data || {};

      // Parse IB Gateway connection status
      if (typeof raw.ib_connected === "boolean") {
        setIbConnected(raw.ib_connected);
      }

      const positions = (raw.positions_raw || []).map((p: any) => ({
        account: String(p.account ?? ""),
        symbol: String(p.symbol ?? ""),
        secType: String(p.secType ?? ""),
        currency: String(p.currency ?? ""),
        quantity: Number(p.quantity ?? 0),
        avgCost: Number(p.avgCost ?? 0),
        lastUpdated: String(p.lastUpdated ?? ""),
        strike: p.strike !== undefined ? Number(p.strike) : undefined,
        expiry: p.expiry !== undefined ? String(p.expiry) : undefined,
        right: p.right !== undefined ? String(p.right) : undefined,
      }));

      const cash = (raw.cash_raw || []).map((c: any) => ({
        account: String(c.account ?? ""),
        currency: String(c.currency ?? ""),
        amount: Number(c.amount ?? 0),
        lastUpdated: String(c.lastUpdated ?? ""),
      }));

      const executions: IbExecution[] = (raw.executions_raw || []).map((e: any) => ({
        account: String(e.account ?? ""),
        symbol: String(e.symbol ?? ""),
        secType: String(e.secType ?? ""),
        currency: String(e.currency ?? ""),
        side: String(e.side ?? "").toUpperCase(),
        quantity: Number(e.shares ?? e.quantity ?? 0),
        price: Number(e.price ?? 0),
        execId: String(e.execId ?? ""),
        orderId: Number(e.orderId ?? 0),
        permId: Number(e.permId ?? 0),
        ts: String(e.ts ?? ""),
        strike: e.strike !== undefined ? Number(e.strike) : undefined,
        expiry: e.expiry !== undefined ? String(e.expiry) : undefined,
        right: e.right !== undefined ? String(e.right) : undefined,
      }));

      const openOrders = (raw.open_orders_raw || [])
        .map((o: any) => ({
          orderId: Number(o.orderId ?? 0),
          symbol: String(o.symbol ?? ""),
          secType: String(o.secType ?? "STK"),
          side: String(o.side ?? ""),
          quantity: String(o.quantity ?? "0"),
          orderType: String(o.orderType ?? ""),
          lmtPrice: o.lmtPrice !== undefined ? Number(o.lmtPrice) : undefined,
          auxPrice: o.auxPrice !== undefined ? Number(o.auxPrice) : undefined,
          status: String(o.status ?? ""),
          ts: String(o.ts ?? ""),
          strike: o.strike !== undefined ? Number(o.strike) : undefined,
          expiry: o.expiry !== undefined ? String(o.expiry) : undefined,
          right: o.right !== undefined ? String(o.right) : undefined,
        }))
        .filter((o: IbOpenOrder) => o.status === "Submitted" || o.status === "PreSubmitted");

      console.log("[usePortfolioData] account_state received:", {
        positionCount: positions.length,
        equityPositions: positions.filter((p: any) => p.secType === "STK").map((p: any) => p.symbol),
        optionPositions: positions.filter((p: any) => p.secType === "OPT").length,
        ibConnected: raw.ib_connected,
      });

      setAccountState({ positions, cash, executions, openOrders });

      // Build execution map for order history
      const execByPermId = new Map<number, { quantity: number; price: number }>();
      executions.forEach((e) => {
        if (e.permId === 0) return;
        const existing = execByPermId.get(e.permId);
        if (existing) {
          const prevTotal = existing.quantity;
          existing.quantity += e.quantity;
          existing.price = (existing.price * prevTotal + e.price * e.quantity) / existing.quantity;
        } else {
          execByPermId.set(e.permId, { quantity: e.quantity, price: e.price });
        }
      });

      // Populate order history from completed_orders_raw
      const completedOrders: IbOrderHistory[] = (raw.completed_orders_raw || []).map((o: any) => {
        const tsRaw = o.completedTime || o.ts || "";
        const tsParsed = parseIBTimestamp(tsRaw);
        const orderId = Number(o.orderId ?? 0);
        const permId = Number(o.permId ?? 0);
        const status = String(o.status ?? "");
        let quantity = String(o.quantity ?? "0");
        let price = o.lmtPrice !== undefined ? Number(o.lmtPrice) : undefined;

        if (status === "Filled" && permId > 0) {
          const execData = execByPermId.get(permId);
          if (execData) {
            quantity = String(execData.quantity);
            price = execData.price;
          }
        }

        return {
          orderId,
          symbol: String(o.symbol ?? ""),
          secType: String(o.secType ?? "STK"),
          side: String(o.side ?? ""),
          quantity,
          orderType: o.orderType !== undefined ? String(o.orderType) : undefined,
          lmtPrice: o.lmtPrice !== undefined ? Number(o.lmtPrice) : undefined,
          price,
          status,
          ts: tsParsed,
          strike: o.strike !== undefined ? Number(o.strike) : undefined,
          expiry: o.expiry !== undefined ? String(o.expiry) : undefined,
          right: o.right !== undefined ? String(o.right) : undefined,
        };
      });
      setOrderHistory(completedOrders.slice(0, MAX_ORDER_HISTORY));

      setError(null);
      setLoading(false);
      setLastUpdated(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }));

      if (!dataLoadedRef.current) {
        dataLoadedRef.current = true;
        markDataLoaded();
      }
    }

    function handleOpenOrder(snapshot: any) {
      console.log("[usePortfolioData] Received ib.openOrder:", snapshot.data);
      const d = snapshot.data;
      if (!d || d.kind !== "open_order") return;

      const order: IbOpenOrder = {
        orderId: Number(d.orderId ?? 0),
        symbol: String(d.symbol ?? ""),
        secType: String(d.secType ?? "STK"),
        side: String(d.side ?? ""),
        quantity: String(d.quantity ?? "0"),
        orderType: String(d.orderType ?? ""),
        lmtPrice: d.lmtPrice !== undefined ? Number(d.lmtPrice) : undefined,
        auxPrice: d.auxPrice !== undefined ? Number(d.auxPrice) : undefined,
        status: String(d.status ?? ""),
        ts: String(d.ts ?? ""),
        strike: d.strike !== undefined ? Number(d.strike) : undefined,
        expiry: d.expiry !== undefined ? String(d.expiry) : undefined,
        right: d.right !== undefined ? String(d.right) : undefined,
      };

      setAccountState((prev) => {
        if (!prev) return prev;

        if (order.status !== "Submitted" && order.status !== "PreSubmitted") {
          const orderToMove = prev.openOrders.find(o => o.orderId === order.orderId);

          if (orderToMove && (order.status === "Filled" || order.status === "Cancelled" || order.status === "Inactive")) {
            console.log("[usePortfolioData] openOrder terminal status, adding to history:", order.status, order.orderId);
            const historyEntry: IbOrderHistory = {
              orderId: orderToMove.orderId,
              symbol: orderToMove.symbol,
              secType: orderToMove.secType,
              side: orderToMove.side,
              quantity: orderToMove.quantity,
              orderType: orderToMove.orderType,
              lmtPrice: orderToMove.lmtPrice,
              status: order.status,
              ts: new Date().toISOString(),
              strike: orderToMove.strike,
              expiry: orderToMove.expiry,
              right: orderToMove.right,
            };
            setOrderHistory(h => {
              if (h.some(existing => existing.orderId === order.orderId)) {
                return h;
              }
              return [historyEntry, ...h].slice(0, MAX_ORDER_HISTORY);
            });
          }

          return {
            ...prev,
            openOrders: prev.openOrders.filter(o => o.orderId !== order.orderId)
          };
        }

        const existing = prev.openOrders.findIndex(o => o.orderId === order.orderId);
        if (existing >= 0) {
          const updated = [...prev.openOrders];
          updated[existing] = order;
          return { ...prev, openOrders: updated };
        } else {
          return { ...prev, openOrders: [...prev.openOrders, order] };
        }
      });

      if (order.status === "Filled") {
        console.log("[usePortfolioData] openOrder Filled, triggering account state refresh...");
        setTimeout(() => {
          socketHub.send({ type: "control", target: "ibAccount", op: "account_state" });
        }, 500);
      }
    }

    function handleOrderStatus(snapshot: any) {
      console.log("[usePortfolioData] Received ib.order:", snapshot.data);
      const d = snapshot.data;
      if (!d || d.kind !== "order_status") return;

      const orderId = Number(d.orderId ?? 0);
      const status = String(d.status ?? "");

      if (status === "Cancelled" || status === "Filled" || status === "Inactive") {
        setAccountState((prev) => {
          if (!prev) return prev;

          const orderToMove = prev.openOrders.find(o => o.orderId === orderId);
          if (orderToMove) {
            const historyEntry: IbOrderHistory = {
              orderId: orderToMove.orderId,
              symbol: orderToMove.symbol,
              secType: orderToMove.secType,
              side: orderToMove.side,
              quantity: orderToMove.quantity,
              orderType: orderToMove.orderType,
              lmtPrice: orderToMove.lmtPrice,
              status: status,
              ts: new Date().toISOString(),
              strike: orderToMove.strike,
              expiry: orderToMove.expiry,
              right: orderToMove.right,
            };
            setOrderHistory(h => {
              if (h.some(existing => existing.orderId === orderId)) {
                return h;
              }
              return [historyEntry, ...h].slice(0, MAX_ORDER_HISTORY);
            });
          }

          return {
            ...prev,
            openOrders: prev.openOrders.filter(o => o.orderId !== orderId)
          };
        });

        if (status === "Filled") {
          console.log("[usePortfolioData] Order filled, triggering account state refresh...");
          setTimeout(() => {
            socketHub.send({ type: "control", target: "ibAccount", op: "account_state" });
          }, 500);
        }
      }
    }

    function handleAccountSummary(snapshot: any) {
      const d = snapshot.data;
      if (!d || d.kind !== "account_summary") return;

      const account = String(d.account ?? "");
      const tag = String(d.tag ?? "");
      const value = parseFloat(d.value ?? "0");
      const currency = String(d.currency ?? "USD");
      const ts = String(d.ts ?? new Date().toISOString());

      if (tag === "TotalCashValue" || tag === "CashBalance") {
        setAccountState((prev) => {
          if (!prev) return prev;

          const cash = [...prev.cash];
          const idx = cash.findIndex(
            (c) => c.account === account && c.currency === currency
          );

          if (idx >= 0) {
            cash[idx] = { ...cash[idx], amount: value, lastUpdated: ts };
          } else {
            cash.push({ account, currency, amount: value, lastUpdated: ts });
          }

          return { ...prev, cash };
        });

        setLastUpdated(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
      }
    }

    function handleIbError(snapshot: any) {
      console.log("[usePortfolioData] Received ib.error:", snapshot.data);
      const d = snapshot.data;
      if (!d || d.kind !== "error") return;

      const newError: IbError = {
        id: Number(d.id ?? -1),
        code: Number(d.code ?? 0),
        message: String(d.message ?? "Unknown error"),
        severity: d.severity === "error" ? "error" : "warning",
        ts: String(d.ts ?? new Date().toISOString()),
      };

      setIbErrors((prev) => [newError, ...prev].slice(0, MAX_ERRORS));

      if (d.severity === "error") {
        setShowErrors(true);
      }
    }

    function handleIbStatus(snapshot: any) {
      console.log("[usePortfolioData] Received ib.status:", snapshot.data);
      const d = snapshot.data;
      if (!d || d.kind !== "status") return;

      const connected = Boolean(d.connected);
      setIbConnected(connected);

      // If we just reconnected, refresh account state
      if (connected) {
        console.log("[usePortfolioData] IB Gateway reconnected, refreshing account state...");
        refresh();
      }
    }

    function handleExecution(snapshot: any) {
      console.log("[usePortfolioData] Received ib.executions:", snapshot.data);
      const d = snapshot.data;
      if (!d) return;
      const exec = d.execution || d;

      if (exec.secType === "OPT") {
        console.log("[usePortfolioData] Option execution received:", {
          symbol: exec.symbol,
          secType: exec.secType,
          side: exec.side,
          shares: exec.shares ?? exec.quantity,
          strike: exec.strike,
          expiry: exec.expiry,
          right: exec.right,
        });
      }

      const sideRaw = String(exec.side ?? "").toUpperCase();
      const isBuy = sideRaw === "BOT" || sideRaw === "BUY";

      const newExec: IbExecution = {
        account: String(exec.account ?? ""),
        symbol: String(exec.symbol ?? ""),
        secType: String(exec.secType ?? "STK"),
        currency: String(exec.currency ?? "USD"),
        side: isBuy ? "BUY" : "SELL",
        quantity: Number(exec.shares ?? exec.quantity ?? 0),
        price: Number(exec.price ?? 0),
        execId: String(exec.execId ?? ""),
        orderId: Number(exec.orderId ?? 0),
        permId: Number(exec.permId ?? 0),
        ts: String(exec.ts ?? new Date().toISOString()),
        strike: exec.strike !== undefined ? Number(exec.strike) : undefined,
        expiry: exec.expiry !== undefined ? String(exec.expiry) : undefined,
        right: exec.right !== undefined ? String(exec.right) : undefined,
      };

      setAccountState((prev) => {
        if (!prev) return prev;
        if (prev.executions.some((e) => e.execId === newExec.execId)) return prev;

        const newExecs = [newExec, ...prev.executions].slice(0, MAX_EXECUTIONS);

        const normalizeRight = (r: string | undefined): string | undefined => {
          if (!r) return undefined;
          if (r === "Call" || r === "C") return "C";
          if (r === "Put" || r === "P") return "P";
          return r;
        };

        const normalizeExpiry = (e: string | undefined): string | undefined => {
          if (!e) return undefined;
          return e.replace(/-/g, "");
        };

        const positions = [...prev.positions];
        const execRight = normalizeRight(newExec.right);
        const execExpiry = normalizeExpiry(newExec.expiry);

        const idx = positions.findIndex(
          (p) =>
            p.account === newExec.account &&
            p.symbol === newExec.symbol &&
            p.secType === newExec.secType &&
            p.currency === newExec.currency &&
            (newExec.secType !== "OPT" || (
              p.strike === newExec.strike &&
              normalizeExpiry(p.expiry) === execExpiry &&
              normalizeRight(p.right) === execRight
            ))
        );

        if (newExec.secType === "OPT") {
          console.log("[usePortfolioData] Option position match:", {
            found: idx >= 0,
            execFields: { strike: newExec.strike, expiry: newExec.expiry, right: newExec.right, execExpiry, execRight },
          });
        }

        const qtyDelta = isBuy ? newExec.quantity : -newExec.quantity;

        if (idx >= 0) {
          const pos = positions[idx];
          const newQty = pos.quantity + qtyDelta;
          let newAvg = pos.avgCost;

          if (isBuy && qtyDelta > 0) {
            const execCost = newExec.secType === "OPT" ? newExec.price * 100 : newExec.price;
            newAvg = newQty > 0
              ? (pos.quantity * pos.avgCost + qtyDelta * execCost) / newQty
              : 0;
          }

          if (newQty === 0) {
            positions.splice(idx, 1);
          } else {
            positions[idx] = { ...pos, quantity: newQty, avgCost: newAvg, lastUpdated: newExec.ts };
          }
        } else if (isBuy) {
          const avgCost = newExec.secType === "OPT" ? newExec.price * 100 : newExec.price;
          positions.push({
            account: newExec.account,
            symbol: newExec.symbol,
            secType: newExec.secType,
            currency: newExec.currency,
            quantity: newExec.quantity,
            avgCost,
            lastUpdated: newExec.ts,
            strike: newExec.strike,
            expiry: newExec.expiry,
            right: newExec.right,
          });
        }

        return { ...prev, positions, executions: newExecs };
      });

      setLastUpdated(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    }

    // Wire up handlers
    socketHub.onMessage(handler);
    socketHub.onTick(handler);
    socketHub.send({ type: "control", target: "ibAccount", op: "account_state" });

    // Reconnect handler
    const onReconnect = () => {
      console.log("[usePortfolioData] WebSocket reconnected, refreshing account state...");
      setLoading(true);
      setError(null);
      setIbConnected(null);
      socketHub.send({ type: "control", target: "ibAccount", op: "account_state" });
    };
    socketHub.onConnect(onReconnect);

    return () => {
      socketHub.offMessage(handler);
      socketHub.offTick(handler);
      socketHub.offConnect(onReconnect);
    };
  }, [setIbConnected, markDataLoaded]);

  // ─────────────────────────────────────────────────────────────
  // Stale state handling
  // ─────────────────────────────────────────────────────────────

  useEffect(() => {
    if (isStale) {
      console.log("[usePortfolioData] Stale state detected, refreshing data...");
      setLoading(true);
      setError(null);
      socketHub.send({ type: "control", target: "ibAccount", op: "account_state" });
      acknowledgeStale();
    }
  }, [isStale, acknowledgeStale]);

  return {
    accountState,
    orderHistory,
    ibErrors,
    loading,
    error,
    lastUpdated,
    ibConnected: ibConnectedLocal,
    showErrors,
    setShowErrors,
    clearErrors,
    refresh,
  };
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function parseIBTimestamp(ibTime: string): string {
  if (!ibTime) return "";
  try {
    const cleaned = ibTime.split(" ").slice(0, 2).join(" ");
    const match = /^(\d{4})(\d{2})(\d{2})[\s-](\d{2}):(\d{2}):(\d{2})/.exec(cleaned);
    if (match) {
      const [, y, mo, d, h, mi, s] = match;
      return new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)).toISOString();
    }
    const parsed = new Date(ibTime);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
    return ibTime;
  } catch {
    return ibTime;
  }
}
