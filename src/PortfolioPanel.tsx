// src/PortfolioPanel.tsx
import { useEffect, useState, useMemo } from "react";
import { socketHub } from "./ws/SocketHub";
import TradeTicket from "./components/TradeTicket";
import OptionTradeTicket from "./components/OptionTradeTicket";
import {
  CashBalances,
  OpenOrdersTable,
  OrderHistoryTable,
  CancelOrderModal,
  ModifyOrderModal,
  OptionsAnalysisTable,
} from "./components/portfolio";
import ConnectionStatus from "./components/shared/ConnectionStatus";
import { fetchClosePrices, ClosePriceData, calcPctChange, formatPctChange, getPrevCloseDateFromCache, formatCloseDateShort } from "./services/closePrices";
import { useMarketState, TimeframeOption } from "./services/marketState";
import { useThrottledMarketPrices, useChannelUpdates, getChannelPrices } from "./hooks/useMarketData";
import { buildOsiSymbol, formatExpiryYYYYMMDD } from "./utils/options";
import {
  IbPosition,
  IbExecution,
  IbOpenOrder,
  IbOrderHistory,
  IbAccountState,
} from "./types/portfolio";

export default function PortfolioPanel() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [accountState, setAccountState] = useState<IbAccountState | null>(null);
  const [ibConnected, setIbConnected] = useState<boolean | null>(null);

  // Trade ticket
  const [showTradeTicket, setShowTradeTicket] = useState(false);
  const [ticketSymbol, setTicketSymbol] = useState("");
  const [ticketAccount, setTicketAccount] = useState("");
  const [ticketSide, setTicketSide] = useState<"BUY" | "SELL">("BUY");
  const [ticketSecType, setTicketSecType] = useState<"STK" | "OPT">("STK");
  const [ticketMarketData, setTicketMarketData] = useState<{
    last?: number; bid?: number; ask?: number; mid?: number;
    delta?: number; gamma?: number; theta?: number; vega?: number; iv?: number;
  }>({});
  
  // Option-specific ticket data
  const [ticketOptionData, setTicketOptionData] = useState<{
    underlying: string;
    strike: number;
    expiry: string;
    right: "C" | "P";
  } | null>(null);

  // Modify order modal state
  const [modifyingOrder, setModifyingOrder] = useState<IbOpenOrder | null>(null);

  // Cancel confirmation modal state
  const [cancellingOrder, setCancellingOrder] = useState<IbOpenOrder | null>(null);

  // Order history (cancelled/filled orders)
  const [orderHistory, setOrderHistory] = useState<IbOrderHistory[]>([]);

  // Tab for positions view: "positions" or "analysis"
  const [positionsTab, setPositionsTab] = useState<"positions" | "analysis">("positions");

  // Market state for prevTradingDay and timeframes
  const marketState = useMarketState();
  const [timeframe, setTimeframe] = useState(() => localStorage.getItem("portfolio.timeframe") ?? "1d");

  // Persist timeframe selection
  useEffect(() => { localStorage.setItem("portfolio.timeframe", timeframe); }, [timeframe]);

  // Get current timeframe info for display
  const currentTimeframeInfo = useMemo(() => {
    return marketState?.timeframes?.find(t => t.id === timeframe);
  }, [marketState?.timeframes, timeframe]);

  // Build list of equity symbols for market data subscription
  // Include both STK positions AND underlying symbols from options
  const equitySymbols = useMemo(() => {
    if (!accountState?.positions) return [];
    const symbols = new Set<string>();
    accountState.positions.forEach(p => {
      // Add equity positions
      if (p.secType === "STK") {
        symbols.add(p.symbol.toUpperCase());
      }
      // Also add underlying symbols from options (for Options Analysis)
      if (p.secType === "OPT") {
        symbols.add(p.symbol.toUpperCase());
      }
    });
    return Array.from(symbols);
  }, [accountState?.positions]);

  // Subscribe to equity market data via MarketDataBus
  // Throttle to 250ms (4 updates/sec) for readability
  const equityPrices = useThrottledMarketPrices(equitySymbols, "equity", 250);

  // Debug: log when equity symbols change
  useEffect(() => {
    if (equitySymbols.length > 0) {
      console.log("[PortfolioPanel] Equity symbols for subscription:", equitySymbols);
    }
  }, [equitySymbols.join(",")]);

  // Listen to option channel updates (backend manages option subscriptions)
  // Throttle to 250ms for consistency
  const optionVersion = useChannelUpdates("option", 250);

  // Close prices for % change display (equities)
  const [closePrices, setClosePrices] = useState<Map<string, ClosePriceData>>(new Map());

  // Option close prices for % change display
  type OptionPriceData = { prevClose: number; todayClose?: number };
  const [optionClosePrices, setOptionClosePrices] = useState<Map<string, OptionPriceData>>(new Map());

  // Fetch close prices for equity positions
  useEffect(() => {
    if (!accountState?.positions) return;
    const equitySymbols = accountState.positions
      .filter(p => p.secType === "STK")
      .map(p => p.symbol);
    if (equitySymbols.length > 0) {
      // Pass timeframe for date calculation
      fetchClosePrices(equitySymbols, timeframe).then(setClosePrices);
    }
  }, [accountState?.positions, timeframe]);

  // Fetch close prices for option positions
  useEffect(() => {
    if (!accountState?.positions || !marketState?.timeframes) return;

    // Find the date for the selected timeframe
    const tfInfo = marketState.timeframes.find(t => t.id === timeframe);
    const closeDate = tfInfo?.date || marketState.prevTradingDay;
    if (!closeDate) return;

    const optionPositions = accountState.positions.filter(p =>
      p.secType === "OPT" && p.strike !== undefined && p.expiry !== undefined && p.right !== undefined
    );

    if (optionPositions.length === 0) return;

    // Build OSI symbols for options
    const osiSymbols = optionPositions.map(p =>
      buildOsiSymbol(p.symbol, p.expiry!, p.right!, p.strike!)
    );

    // Fetch option close prices for the selected timeframe
    socketHub.sendControl("option_close_prices", {
      symbols: osiSymbols,
      prev_trading_day: closeDate,
    }, { timeoutMs: 10000 }).then(ack => {
      if (ack.ok && ack.data) {
        const data = (ack.data as any).data || ack.data;
        const newMap = new Map<string, OptionPriceData>();
        Object.entries(data).forEach(([symbol, prices]: [string, any]) => {
          if (prices && typeof prices.prevClose === "number") {
            newMap.set(symbol.toUpperCase(), {
              prevClose: prices.prevClose,
              todayClose: typeof prices.todayClose === "number" ? prices.todayClose : undefined,
            });
          }
        });
        setOptionClosePrices(newMap);
      }
    }).catch(err => {
      console.error("[PortfolioPanel] Failed to fetch option close prices:", err);
    });
  }, [accountState?.positions, marketState?.timeframes, timeframe]);

  const openTradeTicket = (
    symbol: string,
    account: string,
    side: "BUY" | "SELL",
    secType: string,
    optionDetails?: { strike: number; expiry: string; right: string },
    marketData?: {
      last?: number; bid?: number; ask?: number; mid?: number;
      delta?: number; gamma?: number; theta?: number; vega?: number; iv?: number;
    }
  ) => {
    setTicketSymbol(symbol);
    setTicketAccount(account);
    setTicketSide(side);
    setTicketMarketData(marketData || {});
    
    if (secType === "OPT" && optionDetails) {
      // Use provided option details
      setTicketSecType("OPT");
      const rightChar = optionDetails.right === "Call" || optionDetails.right === "C" ? "C" : "P";
      // Convert YYYYMMDD to YYYY-MM-DD
      const expiry = optionDetails.expiry.length === 8
        ? `${optionDetails.expiry.substring(0, 4)}-${optionDetails.expiry.substring(4, 6)}-${optionDetails.expiry.substring(6, 8)}`
        : optionDetails.expiry;
      
      setTicketOptionData({
        underlying: symbol,
        strike: optionDetails.strike,
        expiry: expiry,
        right: rightChar as "C" | "P",
      });
    } else {
      setTicketSecType("STK");
      setTicketOptionData(null);
    }
    
    setShowTradeTicket(true);
  };

  // Build OSI symbols for option positions (for backend subscription)
  const optionOsiSymbols = useMemo(() => {
    if (!accountState?.positions) return [];
    return accountState.positions
      .filter(p => p.secType === "OPT" && p.strike !== undefined && p.expiry !== undefined && p.right !== undefined)
      .map(p => buildOsiSymbol(p.symbol, p.expiry!, p.right!, p.strike!));
  }, [accountState?.positions]);

  // Tell backend to subscribe to portfolio option contracts AND register interest with UI bridge
  useEffect(() => {
    console.log("[PortfolioPanel] optionOsiSymbols changed:", optionOsiSymbols.length, "symbols");
    if (optionOsiSymbols.length > 0) {
      console.log("[PortfolioPanel] Subscribing to option contracts:", optionOsiSymbols);
      // 1. Register interest with UI bridge so it forwards option messages to this client
      socketHub.send({
        type: "subscribe",
        channels: ["md.option.quote", "md.option.trade", "md.option.greeks"],
        symbols: optionOsiSymbols,
      });

      // 2. Tell backend to subscribe to Alpaca streaming for these contracts
      socketHub.send({
        type: "control",
        target: "marketData",
        op: "subscribe_portfolio_contracts",
        contracts: optionOsiSymbols,
      });
    }

    // Cleanup: unsubscribe when component unmounts or symbols change
    return () => {
      if (optionOsiSymbols.length > 0) {
        console.log("[PortfolioPanel] Cleanup: unsubscribing from option contracts:", optionOsiSymbols);
        socketHub.send({
          type: "unsubscribe",
          channels: ["md.option.quote", "md.option.trade", "md.option.greeks"],
          symbols: optionOsiSymbols,
        });
      }
    };
  }, [optionOsiSymbols]);

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
        console.log("[PortfolioPanel] IB message received:", snapshot.topic);
      }

      // Initial snapshot
      if (snapshot.type === "control.ack" && snapshot.op === "account_state") {
        if (!snapshot.ok) {
          setError(snapshot.error || "Error");
          setIbConnected(false);  // Mark as disconnected on error
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
          // Option fields (if present)
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
          // Option fields (if present)
          strike: e.strike !== undefined ? Number(e.strike) : undefined,
          expiry: e.expiry !== undefined ? String(e.expiry) : undefined,
          right: e.right !== undefined ? String(e.right) : undefined,
        }));

        // Parse open orders from account_state response
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
            // Option fields (if present)
            strike: o.strike !== undefined ? Number(o.strike) : undefined,
            expiry: o.expiry !== undefined ? String(o.expiry) : undefined,
            right: o.right !== undefined ? String(o.right) : undefined,
          }))
          // Only show active orders (Submitted/PreSubmitted)
          .filter((o: IbOpenOrder) => o.status === "Submitted" || o.status === "PreSubmitted");

        console.log("[PortfolioPanel] account_state received:", {
          positionCount: positions.length,
          equityPositions: positions.filter((p: any) => p.secType === "STK").map((p: any) => p.symbol),
          optionPositions: positions.filter((p: any) => p.secType === "OPT").length,
          ibConnected: raw.ib_connected,
        });
        setAccountState({ positions, cash, executions, openOrders });

        // Build a map of executions by permId for looking up fill data (orderId is 0 in completed orders)
        const execByPermId = new Map<number, { quantity: number; price: number }>();
        executions.forEach((e) => {
          if (e.permId === 0) return; // Skip if no permId
          const existing = execByPermId.get(e.permId);
          if (existing) {
            // Aggregate multiple fills for the same order
            const prevTotal = existing.quantity;
            existing.quantity += e.quantity;
            // Use weighted average price
            existing.price = (existing.price * prevTotal + e.price * e.quantity) / existing.quantity;
          } else {
            execByPermId.set(e.permId, { quantity: e.quantity, price: e.price });
          }
        });

        // Populate order history from completed_orders_raw (filled + cancelled from IB)
        const completedOrders: IbOrderHistory[] = (raw.completed_orders_raw || []).map((o: any) => {
          // Parse IB's completedTime format, fallback to ts (ISO from Instant)
          const tsRaw = o.completedTime || o.ts || "";
          const tsParsed = parseIBTimestamp(tsRaw);

          const orderId = Number(o.orderId ?? 0);
          const permId = Number(o.permId ?? 0);
          const status = String(o.status ?? "");
          let quantity = String(o.quantity ?? "0");
          let price = o.lmtPrice !== undefined ? Number(o.lmtPrice) : undefined;

          // For filled orders, ALWAYS use execution data (completed_orders_raw quantity is unreliable)
          // Match by permId since orderId is always 0 in completed orders
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
        setOrderHistory(completedOrders.slice(0, 50));

        setError(null);
        setLoading(false);
        setLastUpdated(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
        return;
      }

      // Handle ib.openOrder messages
      if (snapshot?.topic === "ib.openOrder") {
        console.log("[PortfolioPanel] Received ib.openOrder:", snapshot.data);
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

          // Only show Submitted/PreSubmitted orders
          if (order.status !== "Submitted" && order.status !== "PreSubmitted") {
            // Find the order before removing
            const orderToMove = prev.openOrders.find(o => o.orderId === order.orderId);

            // Add to history if found and status is terminal
            if (orderToMove && (order.status === "Filled" || order.status === "Cancelled" || order.status === "Inactive")) {
              console.log("[PortfolioPanel] openOrder terminal status, adding to history:", order.status, order.orderId);
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
                return [historyEntry, ...h].slice(0, 50);
              });
            }

            // Remove from list
            return {
              ...prev,
              openOrders: prev.openOrders.filter(o => o.orderId !== order.orderId)
            };
          }

          // Update or add order
          const existing = prev.openOrders.findIndex(o => o.orderId === order.orderId);
          if (existing >= 0) {
            const updated = [...prev.openOrders];
            updated[existing] = order;
            return { ...prev, openOrders: updated };
          } else {
            return { ...prev, openOrders: [...prev.openOrders, order] };
          }
        });

        // Auto-refresh on Filled status from openOrder (IB sometimes sends Filled here instead of orderStatus)
        if (order.status === "Filled") {
          console.log("[PortfolioPanel] openOrder Filled, triggering account state refresh...");
          setTimeout(() => {
            socketHub.send({ type: "control", target: "ibAccount", op: "account_state" });
          }, 500);
        }
        return;
      }

      // Handle ib.order (order status) messages - for cancel/fill updates
      if (snapshot?.topic === "ib.order") {
        console.log("[PortfolioPanel] Received ib.order:", snapshot.data);
        const d = snapshot.data;
        if (!d || d.kind !== "order_status") return;

        const orderId = Number(d.orderId ?? 0);
        const status = String(d.status ?? "");

        // Remove order from UI if cancelled or filled, and add to history
        if (status === "Cancelled" || status === "Filled" || status === "Inactive") {
          setAccountState((prev) => {
            if (!prev) return prev;

            // Find the order to move to history
            const orderToMove = prev.openOrders.find(o => o.orderId === orderId);
            if (orderToMove) {
              // Add to order history with deduplication check
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
                // Check if this order is already in history (deduplication)
                if (h.some(existing => existing.orderId === orderId)) {
                  return h; // Already in history, don't add duplicate
                }
                return [historyEntry, ...h].slice(0, 50); // Keep last 50
              });
            }

            return {
              ...prev,
              openOrders: prev.openOrders.filter(o => o.orderId !== orderId)
            };
          });

          // Auto-refresh account state on Filled to catch positions when execDetails wasn't called
          if (status === "Filled") {
            console.log("[PortfolioPanel] Order filled, triggering account state refresh...");
            setTimeout(() => {
              socketHub.send({ type: "control", target: "ibAccount", op: "account_state" });
            }, 500); // Small delay to let IB settle
          }
        }
        return;
      }

      // Handle ib.accountSummary messages - real-time cash balance updates
      if (snapshot?.topic === "ib.accountSummary") {
        const d = snapshot.data;
        if (!d || d.kind !== "account_summary") return;

        const account = String(d.account ?? "");
        const tag = String(d.tag ?? "");
        const value = parseFloat(d.value ?? "0");
        const currency = String(d.currency ?? "USD");
        const ts = String(d.ts ?? new Date().toISOString());

        // Only update for cash-related tags
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
              // Add new cash entry if not found
              cash.push({ account, currency, amount: value, lastUpdated: ts });
            }

            return { ...prev, cash };
          });

          setLastUpdated(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
        }
        return;
      }

      // Live execution — updates positions
      if (snapshot?.topic === "ib.executions" || snapshot?.topic === "ib.execution") {
        console.log("[PortfolioPanel] Received ib.executions:", snapshot.data);
        const d = snapshot.data;
        if (!d) return;
        const exec = d.execution || d;

        // Debug: log option executions to help diagnose position update issues
        if (exec.secType === "OPT") {
          console.log("[PortfolioPanel] Option execution received:", {
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
          // Option fields
          strike: exec.strike !== undefined ? Number(exec.strike) : undefined,
          expiry: exec.expiry !== undefined ? String(exec.expiry) : undefined,
          right: exec.right !== undefined ? String(exec.right) : undefined,
        };

        setAccountState((prev) => {
          if (!prev) return prev;
          if (prev.executions.some((e) => e.execId === newExec.execId)) return prev;

          const newExecs = [newExec, ...prev.executions].slice(0, 50);

          // Normalize right field for comparison ("Call" -> "C", "Put" -> "P")
          const normalizeRight = (r: string | undefined): string | undefined => {
            if (!r) return undefined;
            if (r === "Call" || r === "C") return "C";
            if (r === "Put" || r === "P") return "P";
            return r;
          };

          // Normalize expiry for comparison (remove dashes for YYYYMMDD format)
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
              // For options, also match on strike/expiry/right (normalized)
              (newExec.secType !== "OPT" || (
                p.strike === newExec.strike &&
                normalizeExpiry(p.expiry) === execExpiry &&
                normalizeRight(p.right) === execRight
              ))
          );

          // Debug: log position matching result for options
          if (newExec.secType === "OPT") {
            console.log("[PortfolioPanel] Option position match:", {
              found: idx >= 0,
              execFields: { strike: newExec.strike, expiry: newExec.expiry, right: newExec.right, execExpiry, execRight },
              existingPositions: positions
                .filter(p => p.secType === "OPT" && p.symbol === newExec.symbol)
                .map(p => ({
                  strike: p.strike,
                  expiry: p.expiry,
                  right: p.right,
                  normalizedExpiry: normalizeExpiry(p.expiry),
                  normalizedRight: normalizeRight(p.right),
                })),
            });
          }

          const qtyDelta = isBuy ? newExec.quantity : -newExec.quantity;

          if (idx >= 0) {
            const pos = positions[idx];
            const newQty = pos.quantity + qtyDelta;
            let newAvg = pos.avgCost;

            if (isBuy && qtyDelta > 0) {
              // For options, execution price is per-share but avgCost is per-contract
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
            // For options, IB reports avgCost as cost per contract (price * 100)
            // Execution price is per-share, so multiply by 100 for options
            const avgCost = newExec.secType === "OPT" ? newExec.price * 100 : newExec.price;
            positions.push({
              account: newExec.account,
              symbol: newExec.symbol,
              secType: newExec.secType,
              currency: newExec.currency,
              quantity: newExec.quantity,
              avgCost,
              lastUpdated: newExec.ts,
              // Include option fields if present
              strike: newExec.strike,
              expiry: newExec.expiry,
              right: newExec.right,
            });
          }

          // Cash balance will be updated via ib.accountSummary stream from IB
          return { ...prev, positions, executions: newExecs };
        });

        // Also add to order history as "Filled"
        // Note: Don't add here - the ib.order or ib.openOrder callback will add to history
        // Adding from both execution AND orderStatus causes duplicates

        setLastUpdated(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
      }
    };

    socketHub.onMessage(handler);
    socketHub.onTick(handler);  // Option messages come through onTick
    socketHub.send({ type: "control", target: "ibAccount", op: "account_state" });

    // Refresh account state on reconnect
    const onReconnect = () => {
      console.log("[PortfolioPanel] WebSocket reconnected, refreshing account state...");
      setLoading(true);
      setError(null);  // Clear previous error
      setIbConnected(null);  // Reset IB status until we get fresh data
      socketHub.send({ type: "control", target: "ibAccount", op: "account_state" });
    };
    socketHub.onConnect(onReconnect);

    return () => {
      socketHub.offMessage(handler);
      socketHub.offTick(handler);
      socketHub.offConnect(onReconnect);
    };
  }, []);

  return (
    <div style={shell}>
      <div style={header}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ fontWeight: 600, fontSize: 15 }}>Portfolio</div>
          {/* IB Gateway Connection Status */}
          {ibConnected !== null && (
            <ConnectionStatus connected={ibConnected} label="IB Gateway" />
          )}
        </div>
        <div style={{ fontSize: 12, color: "#666" }}>
          {loading && !accountState && "Loading…"}
          {error && <span style={{ color: "#dc2626" }}>{error}</span>}
          {lastUpdated && <>Updated <b>{lastUpdated}</b></>}
        </div>
      </div>

      <div style={body}>
        {accountState ? (
          <>
            <div style={summary}>
              {(() => {
                // Calculate total market value
                let totalMktValue = 0;
                accountState.positions.forEach((p) => {
                  let priceKey = p.symbol.toUpperCase();
                  let priceData;
                  if (p.secType === "OPT" && p.strike !== undefined && p.expiry !== undefined && p.right !== undefined) {
                    priceKey = buildOsiSymbol(p.symbol, p.expiry, p.right, p.strike);
                    priceData = getChannelPrices("option").get(priceKey);
                  } else {
                    priceData = equityPrices.get(priceKey);
                  }
                  const lastPrice = priceData?.last || 0;
                  // Fallback to close prices if no live price
                  let displayPrice = lastPrice;
                  if (lastPrice === 0) {
                    if (p.secType === "OPT") {
                      const optPriceData = optionClosePrices.get(priceKey);
                      if (optPriceData?.todayClose) displayPrice = optPriceData.todayClose;
                    } else if (p.secType === "STK") {
                      const equityCloseData = closePrices.get(p.symbol);
                      if (equityCloseData?.todayClose) displayPrice = equityCloseData.todayClose;
                    }
                  }
                  const contractMultiplier = p.secType === "OPT" ? 100 : 1;
                  totalMktValue += p.quantity * displayPrice * contractMultiplier;
                });
                // Get total cash
                const totalCash = accountState.cash.reduce((sum, c) => sum + c.amount, 0);
                const totalPortfolio = totalMktValue + totalCash;
                return (
                  <>
                    <span style={{ marginRight: 20, fontWeight: 700, fontSize: 13 }}>
                      Portfolio: ${totalPortfolio.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                    <span style={{ marginRight: 16, fontWeight: 600 }}>
                      Mkt Value: ${totalMktValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                    <span style={{ marginRight: 16, fontWeight: 600 }}>
                      Cash: ${totalCash.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                    <span style={{ color: "#666", fontWeight: 500 }}>
                      ({accountState.positions.length} positions)
                    </span>
                  </>
                );
              })()}
            </div>

            <div style={gridWrap}>
              {/* Left Column: Positions + Cash */}
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* Positions with BUY/SELL buttons */}
              <section style={section}>
                <div style={{ ...title, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  {/* Tabs */}
                  <div style={{ display: "flex", gap: 0 }}>
                    <button
                      onClick={() => setPositionsTab("positions")}
                      style={{
                        padding: "4px 12px",
                        border: "1px solid #d1d5db",
                        borderRight: "none",
                        borderRadius: "4px 0 0 4px",
                        background: positionsTab === "positions" ? "#2563eb" : "white",
                        color: positionsTab === "positions" ? "white" : "#374151",
                        fontSize: 11,
                        fontWeight: 500,
                        cursor: "pointer",
                      }}
                    >
                      Positions
                    </button>
                    <button
                      onClick={() => setPositionsTab("analysis")}
                      style={{
                        padding: "4px 12px",
                        border: "1px solid #d1d5db",
                        borderRadius: "0 4px 4px 0",
                        background: positionsTab === "analysis" ? "#2563eb" : "white",
                        color: positionsTab === "analysis" ? "white" : "#374151",
                        fontSize: 11,
                        fontWeight: 500,
                        cursor: "pointer",
                      }}
                    >
                      Options Analysis
                    </button>
                  </div>
                  {/* Timeframe selector - only show for positions tab */}
                  {positionsTab === "positions" && (
                    <span style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 400, fontSize: 11 }}>
                      <span>vs:</span>
                      <select
                        value={timeframe}
                        onChange={(e) => setTimeframe(e.target.value)}
                        style={{
                          padding: "4px 20px 4px 8px",
                          fontSize: 11,
                          lineHeight: 1.2,
                          border: "1px solid #d1d5db",
                          borderRadius: 4,
                          background: "white url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8' viewBox='0 0 8 8'%3E%3Cpath fill='%23666' d='M0 2l4 4 4-4z'/%3E%3C/svg%3E\") no-repeat right 6px center",
                          color: "#111",
                          appearance: "none",
                          cursor: "pointer",
                        }}
                      >
                        {(marketState?.timeframes ?? []).map((tf) => (
                          <option key={tf.id} value={tf.id}>
                            {formatCloseDateShort(tf.date)}{tf.label ? ` (${tf.label})` : ""}
                          </option>
                        ))}
                      </select>
                    </span>
                  )}
                </div>

                {/* Positions Table */}
                {positionsTab === "positions" && (
                <div style={table}>
                  <div style={{ ...hdr, gridTemplateColumns: "75px 140px 36px 36px 65px 80px 65px 65px 100px 80px 130px" }}>
                    <div style={hdrCell}>Account</div>
                    <div style={hdrCell}>Symbol</div>
                    <div style={hdrCell}>Type</div>
                    <div style={hdrCellCenter}>CCY</div>
                    <div style={hdrCellRight}>Qty</div>
                    <div style={hdrCellRight}>Last</div>
                    <div style={{ ...hdrCellCenter, gridColumn: "span 2" }}>
                      {currentTimeframeInfo
                        ? `Chg (${formatCloseDateShort(currentTimeframeInfo.date)})`
                        : "Change"}
                    </div>
                    <div style={hdrCellRight}>Mkt Value</div>
                    <div style={hdrCellRight}>Avg Cost</div>
                    <div style={{ textAlign: "right" as const }}>Trade</div>
                  </div>

                  {accountState.positions
                    .slice()
                    .sort((a, b) => {
                      // Sort by symbol, then by secType (STK before OPT)
                      if (a.symbol !== b.symbol) return a.symbol.localeCompare(b.symbol);
                      if (a.secType !== b.secType) return a.secType === "STK" ? -1 : 1;
                      // For options: sort by expiry, then Call/Put (calls first), then strike
                      if (a.secType === "OPT" && b.secType === "OPT") {
                        // Expiry (YYYYMMDD format, so string comparison works)
                        const expiryA = a.expiry || "";
                        const expiryB = b.expiry || "";
                        if (expiryA !== expiryB) return expiryA.localeCompare(expiryB);
                        // Call before Put (C < P alphabetically, or normalize)
                        const rightA = (a.right === "Call" || a.right === "C") ? "C" : "P";
                        const rightB = (b.right === "Call" || b.right === "C") ? "C" : "P";
                        if (rightA !== rightB) return rightA.localeCompare(rightB);
                        // Then by strike
                        if (a.strike !== b.strike) return (a.strike || 0) - (b.strike || 0);
                      }
                      return 0;
                    })
                    .map((p, i) => {
                    // Build the proper symbol for price lookup
                    let priceKey = p.symbol.toUpperCase();
                    let priceData;
                    if (p.secType === "OPT" && p.strike !== undefined && p.expiry !== undefined && p.right !== undefined) {
                      priceKey = buildOsiSymbol(p.symbol, p.expiry, p.right, p.strike);
                      priceData = getChannelPrices("option").get(priceKey);
                    } else {
                      priceData = equityPrices.get(priceKey);
                    }

                    const lastPrice = priceData?.last || 0;

                    // Use todayClose as fallback when no live price (after market close / no post-market trades)
                    const optPriceData = p.secType === "OPT" ? optionClosePrices.get(priceKey) : undefined;
                    const equityCloseData = p.secType === "STK" ? closePrices.get(p.symbol) : undefined;
                    let displayPrice = lastPrice;
                    if (lastPrice === 0) {
                      if (p.secType === "OPT" && optPriceData?.todayClose) {
                        displayPrice = optPriceData.todayClose;
                      } else if (p.secType === "STK" && equityCloseData?.todayClose) {
                        displayPrice = equityCloseData.todayClose;
                      }
                    }

                    // For options, multiply by contract size (100)
                    const contractMultiplier = p.secType === "OPT" ? 100 : 1;
                    const mktValue = p.quantity * displayPrice * contractMultiplier;

                    const mktValueDisplay = displayPrice > 0
                      ? (mktValue < 0
                          ? `(${Math.abs(mktValue).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`
                          : mktValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
                      : "—";

                    // For options, display avg cost per share (divide by 100)
                    const displayAvgCost = p.secType === "OPT" ? p.avgCost / 100 : p.avgCost;

                    // Calculate % and $ change for equities and options
                    let pctChange: number | undefined;
                    let dollarChange: number | undefined;
                    if (p.secType === "STK") {
                      if (displayPrice > 0 && equityCloseData?.prevClose && equityCloseData.prevClose > 0) {
                        pctChange = calcPctChange(displayPrice, equityCloseData.prevClose);
                        dollarChange = displayPrice - equityCloseData.prevClose;
                      }
                    } else if (p.secType === "OPT") {
                      if (displayPrice > 0 && optPriceData?.prevClose && optPriceData.prevClose > 0) {
                        pctChange = calcPctChange(displayPrice, optPriceData.prevClose);
                        dollarChange = displayPrice - optPriceData.prevClose;
                      }
                    }
                    const changeColor = pctChange !== undefined
                      ? (pctChange >= 0 ? "#16a34a" : "#dc2626")
                      : undefined;

                    // Format symbol display based on secType
                    let symbolDisplay: React.ReactNode;
                    if (p.secType === "OPT" && p.strike !== undefined && p.expiry !== undefined && p.right !== undefined) {
                      // Use the fields directly from the backend
                      const rightLabel = p.right === "C" || p.right === "Call" ? "Call" : "Put";
                      const formattedExpiry = formatExpiryYYYYMMDD(p.expiry);
                      symbolDisplay = (
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 11 }}>
                            {p.symbol} {p.strike % 1 === 0 ? p.strike.toFixed(0) : p.strike} {rightLabel}
                          </div>
                          <div style={{ fontSize: 9, color: "#666" }}>
                            {formattedExpiry}
                          </div>
                        </div>
                      );
                    } else {
                      // Equity or incomplete option data
                      symbolDisplay = <div style={{ fontWeight: 600 }}>{p.symbol}</div>;
                    }

                    return (
                      <div
                        key={i}
                        style={{
                          ...rowStyle,
                          gridTemplateColumns: "75px 140px 36px 36px 65px 80px 65px 65px 100px 80px 130px",
                        }}
                      >
                        <div style={cellEllipsis}>{p.account}</div>
                        <div>{symbolDisplay}</div>
                        <div style={gray10}>{p.secType}</div>
                        <div style={centerBold}>{p.currency}</div>
                        <div style={rightMono}>
                          {p.quantity.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                        </div>
                        <div style={rightMono}>
                          {displayPrice > 0 ? displayPrice.toFixed(4) : "—"}
                        </div>
                        <div style={rightMono}>
                          {pctChange !== undefined ? (
                            <span style={{ color: changeColor, fontWeight: 600 }}>
                              {pctChange >= 0 ? "▲" : "▼"} {formatPctChange(pctChange)}
                            </span>
                          ) : "—"}
                        </div>
                        <div style={rightMono}>
                          {dollarChange !== undefined ? (
                            <span style={{ color: changeColor, fontWeight: 600 }}>
                              {dollarChange >= 0 ? "+" : ""}{dollarChange.toFixed(2)}
                            </span>
                          ) : "—"}
                        </div>
                        <div style={rightMono}>
                          {mktValueDisplay}
                        </div>
                        <div style={rightMono}>{displayAvgCost.toFixed(4)}</div>
                        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, paddingRight: 12 }}>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              const optionDetails = p.secType === "OPT" && p.strike !== undefined && p.expiry !== undefined && p.right !== undefined
                                ? { strike: p.strike, expiry: p.expiry, right: p.right }
                                : undefined;
                              // Get fresh price data at click time (not closure-captured render-time value)
                              const freshPriceData = p.secType === "OPT" && p.strike !== undefined && p.expiry !== undefined && p.right !== undefined
                                ? getChannelPrices("option").get(buildOsiSymbol(p.symbol, p.expiry, p.right, p.strike))
                                : equityPrices.get(p.symbol.toUpperCase());
                              // Calculate mid if we have bid and ask
                              const marketData = freshPriceData ? {
                                ...freshPriceData,
                                mid: (freshPriceData.bid !== undefined && freshPriceData.ask !== undefined)
                                  ? (freshPriceData.bid + freshPriceData.ask) / 2
                                  : undefined
                              } : undefined;
                              openTradeTicket(p.symbol, p.account, "BUY", p.secType, optionDetails, marketData);
                            }}
                            style={{ ...iconBtn, background: "#dcfce7", color: "#166534" }}
                          >
                            BUY
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              const optionDetails = p.secType === "OPT" && p.strike !== undefined && p.expiry !== undefined && p.right !== undefined
                                ? { strike: p.strike, expiry: p.expiry, right: p.right }
                                : undefined;
                              // Get fresh price data at click time (not closure-captured render-time value)
                              const freshPriceData = p.secType === "OPT" && p.strike !== undefined && p.expiry !== undefined && p.right !== undefined
                                ? getChannelPrices("option").get(buildOsiSymbol(p.symbol, p.expiry, p.right, p.strike))
                                : equityPrices.get(p.symbol.toUpperCase());
                              // Calculate mid if we have bid and ask
                              const marketData = freshPriceData ? {
                                ...freshPriceData,
                                mid: (freshPriceData.bid !== undefined && freshPriceData.ask !== undefined)
                                  ? (freshPriceData.bid + freshPriceData.ask) / 2
                                  : undefined
                              } : undefined;
                              openTradeTicket(p.symbol, p.account, "SELL", p.secType, optionDetails, marketData);
                            }}
                            style={{ ...iconBtn, background: "#fce7f3", color: "#831843" }}
                          >
                            SELL
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
                )}

                {/* Options Analysis Table */}
                {positionsTab === "analysis" && (
                  <OptionsAnalysisTable
                    positions={accountState.positions}
                    equityPrices={equityPrices}
                  />
                )}
              </section>

              {/* Cash */}
              <CashBalances cash={accountState.cash} />
              </div>

              {/* Right Column: Open Orders + Order History */}
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* Open Orders */}
              <OpenOrdersTable
                orders={accountState.openOrders}
                onModify={(o) => setModifyingOrder(o)}
                onCancel={(o) => setCancellingOrder(o)}
              />

              {/* Order History (Fills + Cancellations) - sorted newest first */}
              <OrderHistoryTable orders={[...orderHistory].sort((a, b) => {
                // Sort by timestamp descending (newest first)
                const tsA = a.ts || "";
                const tsB = b.ts || "";
                return tsB.localeCompare(tsA);
              })} />
              </div>

            </div>
          </>
        ) : (
          <div style={empty}>{loading ? "Waiting for data…" : error || "No data"}</div>
        )}

        {/* Floating Trade Ticket */}
        {showTradeTicket && (
          <div style={{ position: "fixed", bottom: 24, right: 24, zIndex: 1000 }}>
            {ticketSecType === "STK" ? (
              <TradeTicket
                symbol={ticketSymbol}
                account={ticketAccount}
                defaultSide={ticketSide}
                last={ticketMarketData.last}
                bid={ticketMarketData.bid}
                ask={ticketMarketData.ask}
                onClose={() => setShowTradeTicket(false)}
              />
            ) : ticketOptionData ? (
              <OptionTradeTicket
                underlying={ticketOptionData.underlying}
                strike={ticketOptionData.strike}
                expiry={ticketOptionData.expiry}
                right={ticketOptionData.right}
                account={ticketAccount}
                defaultSide={ticketSide}
                last={ticketMarketData.last}
                bid={ticketMarketData.bid}
                ask={ticketMarketData.ask}
                mid={ticketMarketData.mid}
                delta={ticketMarketData.delta}
                gamma={ticketMarketData.gamma}
                theta={ticketMarketData.theta}
                vega={ticketMarketData.vega}
                iv={ticketMarketData.iv}
                onClose={() => setShowTradeTicket(false)}
              />
            ) : null}
          </div>
        )}

        {/* Cancel Confirmation Modal */}
        {cancellingOrder && (
          <CancelOrderModal
            order={cancellingOrder}
            onClose={() => setCancellingOrder(null)}
          />
        )}

        {/* Modify Order Modal */}
        {modifyingOrder && (
          <ModifyOrderModal
            order={modifyingOrder}
            onClose={() => setModifyingOrder(null)}
          />
        )}
      </div>
    </div>
  );
}

/**
 * Parse IB's completedTime format "YYYYMMDD HH:MM:SS" or "YYYYMMDD-HH:MM:SS" to ISO string.
 * Falls back to the input if parsing fails.
 */
function parseIBTimestamp(ibTime: string): string {
  if (!ibTime) return "";
  try {
    // IB format: "20231215 14:30:00" or "20231215-14:30:00" possibly with timezone
    // Remove timezone suffix if present (e.g., " US/Eastern")
    const cleaned = ibTime.split(" ").slice(0, 2).join(" ");

    // Match "YYYYMMDD HH:MM:SS" or "YYYYMMDD-HH:MM:SS"
    const match = /^(\d{4})(\d{2})(\d{2})[\s-](\d{2}):(\d{2}):(\d{2})/.exec(cleaned);
    if (match) {
      const [, y, mo, d, h, mi, s] = match;
      return new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)).toISOString();
    }

    // Try parsing as-is (might already be ISO)
    const parsed = new Date(ibTime);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }

    return ibTime;
  } catch {
    return ibTime;
  }
}

/* Styles */
const shell = { display: "flex", flexDirection: "column" as const, height: "100%", color: "#111", background: "#fff" };
const header = { padding: "10px 14px", borderBottom: "1px solid #e5e7eb", background: "#fff" };
const body = { flex: 1, overflow: "auto", padding: "12px 14px", background: "#f9fafb" };
const summary = { fontSize: 11, color: "#4b5563", marginBottom: 10 };
const gridWrap = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 };
const section = { background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, overflow: "hidden" };
const title = { fontSize: 12, fontWeight: 600, padding: "8px 10px", background: "#f1f5f9", borderBottom: "1px solid #e5e7eb" };
const table = { display: "flex", flexDirection: "column" as const };
const hdr = { display: "grid", fontWeight: 600, fontSize: 10.5, color: "#374151", padding: "0 10px", background: "#f8fafc", height: 26, alignItems: "center", borderBottom: "1px solid #e5e7eb" };
const hdrCell = { borderRight: "1px solid #ddd", paddingRight: 4 };
const hdrCellRight = { ...hdrCell, textAlign: "right" as const };
const hdrCellCenter = { ...hdrCell, textAlign: "center" as const };
const rowStyle = { display: "grid", fontSize: 11, minHeight: 32, alignItems: "center", padding: "0 10px", borderBottom: "1px solid #f3f4f6" };

// Cell border for column dividers
const cellBorder = { borderRight: "1px solid #eee", paddingRight: 4, paddingLeft: 2 };
const cellEllipsis = { ...cellBorder, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const, fontFamily: "ui-monospace, monospace", fontSize: 10 };
const right = { ...cellBorder, textAlign: "right" as const };
const rightMono = { ...right, fontFamily: "ui-monospace, monospace" };
const center = { ...cellBorder, textAlign: "center" as const };
const centerBold = { ...center, fontWeight: 600 };
const gray10 = { ...cellBorder, fontSize: 10, color: "#666" };

const empty = { padding: 40, textAlign: "center" as const, color: "#666", fontSize: 14 };

const iconBtn = {
  padding: "4px 10px",
  border: "1px solid #ccc",
  borderRadius: "6px",
  background: "white",
  fontSize: "12px",
  fontWeight: 600,
  cursor: "pointer",
};