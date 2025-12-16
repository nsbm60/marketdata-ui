// src/PortfolioPanel.tsx
import { useEffect, useRef, useState, useMemo } from "react";
import { socketHub } from "./ws/SocketHub";
import TradeTicket from "./components/TradeTicket";
import OptionTradeTicket from "./components/OptionTradeTicket";

const CHANNELS = ["md.equity.quote", "md.equity.trade"];

type IbPosition = {
  account: string;
  symbol: string;
  secType: string;
  currency: string;
  quantity: number;
  avgCost: number;
  lastUpdated: string;
  // Option fields (optional)
  strike?: number;
  expiry?: string;  // YYYYMMDD format
  right?: string;   // "Call" or "Put"
};

type IbCash = {
  account: string;
  currency: string;
  amount: number;
  lastUpdated: string;
};

type IbExecution = {
  account: string;
  symbol: string;
  secType: string;
  currency: string;
  side: string;
  quantity: number;
  price: number;
  execId: string;
  orderId: number;
  ts: string;
  // Option fields (optional)
  strike?: number;
  expiry?: string;  // YYYYMMDD format
  right?: string;   // "Call" or "Put"
};

type IbOpenOrder = {
  orderId: number;
  symbol: string;
  secType: string;
  side: string;
  quantity: string;
  orderType: string;
  lmtPrice?: number;
  auxPrice?: number;
  status: string;
  ts: string;
  // Option fields
  strike?: number;
  expiry?: string;
  right?: string;
};

type IbAccountState = {
  positions: IbPosition[];
  cash: IbCash[];
  executions: IbExecution[];
  openOrders: IbOpenOrder[];
};

const DEBUG_MAX = 300;

export default function PortfolioPanel() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [accountState, setAccountState] = useState<IbAccountState | null>(null);

  // Trade ticket
  const [showTradeTicket, setShowTradeTicket] = useState(false);
  const [ticketSymbol, setTicketSymbol] = useState("");
  const [ticketAccount, setTicketAccount] = useState("");
  const [ticketSide, setTicketSide] = useState<"BUY" | "SELL">("BUY");
  const [ticketSecType, setTicketSecType] = useState<"STK" | "OPT">("STK");
  const [ticketMarketData, setTicketMarketData] = useState<{ last?: number; bid?: number; ask?: number }>({});
  
  // Option-specific ticket data
  const [ticketOptionData, setTicketOptionData] = useState<{
    underlying: string;
    strike: number;
    expiry: string;
    right: "C" | "P";
  } | null>(null);

  // Debug — immortal + filtered + frozen
  const [allDebugMsgs, setAllDebugMsgs] = useState<any[]>([]);
  const [frozenDebug, setFrozenDebug] = useState<any[]>([]);
  const [showControl, setShowControl] = useState(true);
  const [showMdAll, setShowMdAll] = useState(false);
  const [showIbAll, setShowIbAll] = useState(true);

  const debugRef = useRef<HTMLDivElement>(null);
  const cacheRef = useRef<Map<string, any>>(new Map());
  const subsSetRef = useRef<Set<string>>(new Set());
  const [priceUpdateTrigger, setPriceUpdateTrigger] = useState(0);

  const openTradeTicket = (
    symbol: string, 
    account: string, 
    side: "BUY" | "SELL", 
    secType: string,
    optionDetails?: { strike: number; expiry: string; right: string },
    marketData?: { last?: number; bid?: number; ask?: number }
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

  // Get stable symbol list for dependency tracking
  const positionSymbolsKey = useMemo(() => {
    if (!accountState?.positions) return "";
    return accountState.positions.map(p => p.symbol.toUpperCase()).sort().join(",");
  }, [accountState?.positions]);

  // Subscribe to market data for position symbols
  useEffect(() => {
    if (!positionSymbolsKey) return;

    const positionSymbols = positionSymbolsKey.split(",").filter(Boolean);
    const prev = subsSetRef.current;
    const next = new Set(positionSymbols);

    const toAdd: string[] = [];
    const toDel: string[] = [];

    next.forEach((s) => { if (!prev.has(s)) toAdd.push(s); });
    prev.forEach((s) => { if (!next.has(s)) toDel.push(s); });

    if (toAdd.length) {
      console.log("[PortfolioPanel] Subscribing to market data:", toAdd);
      socketHub.send({ type: "subscribe", channels: CHANNELS, symbols: toAdd });
    }
    if (toDel.length) {
      console.log("[PortfolioPanel] Unsubscribing from market data:", toDel);
      socketHub.send({ type: "unsubscribe", channels: CHANNELS, symbols: toDel });
    }

    subsSetRef.current = next;
  }, [positionSymbolsKey]);

  // Subscribe to option market data for option positions
  useEffect(() => {
    if (!accountState?.positions) return;

    // Build OSI symbols for option positions
    const osiSymbols: string[] = [];
    
    accountState.positions.forEach(p => {
      if (p.secType === "OPT" && p.strike !== undefined && p.expiry !== undefined && p.right !== undefined) {
        // Build OSI format: SYMBOL + YYMMDD + C/P + STRIKE (8 digits, strike * 1000)
        const yy = p.expiry.substring(2, 4);
        const mm = p.expiry.substring(4, 6);
        const dd = p.expiry.substring(6, 8);
        const rightChar = p.right === "Call" || p.right === "C" ? "C" : "P";
        const strikeFormatted = String(Math.round(p.strike * 1000)).padStart(8, "0");
        const osiSymbol = `${p.symbol}${yy}${mm}${dd}${rightChar}${strikeFormatted}`;
        osiSymbols.push(osiSymbol);
      }
    });

    if (osiSymbols.length > 0) {
      // Subscribe via control message (backend Alpaca subscription + snapshot poller)
      console.log(`[PortfolioPanel] Backend: Subscribing to ${osiSymbols.length} portfolio option contracts`);
      socketHub.send({
        type: "control",
        target: "marketData",
        op: "subscribe_portfolio_contracts",
        contracts: osiSymbols,
      });

      // Also subscribe via WebSocket channels (frontend message routing)
      console.log(`[PortfolioPanel] Frontend: Subscribing to option channels for ${osiSymbols.length} symbols`);
      socketHub.send({
        type: "subscribe",
        channels: ["md.option.quote", "md.option.trade"],
        symbols: osiSymbols,
      });
    }
  }, [accountState?.positions]);

  useEffect(() => {
    const handler = (m: any) => {
      if (!m) return;

      let snapshot: any;
      try {
        snapshot = JSON.parse(JSON.stringify(m));
      } catch {
        snapshot = m;
      }

      // Live market data — update price cache
      if (snapshot?.topic && typeof snapshot.topic === "string") {
        const topic = snapshot.topic;
        
        // Handle md.equity.quote.SYMBOL and md.equity.trade.SYMBOL format
        if (topic.startsWith("md.equity.")) {
          const parts = topic.split(".");
          const topicSymbol = parts.length >= 4 ? parts.slice(3).join(".").toUpperCase() : "";
          
          const d = snapshot.data?.data || snapshot.data || {};
          
          // Extract price data
          const bid = d.bidPrice ?? d.bp ?? d.bid;
          const ask = d.askPrice ?? d.ap ?? d.ask;
          const last = d.lastPrice ?? d.last ?? d.price ?? d.p ?? d.lp;
          
          if (topicSymbol && (bid !== undefined || ask !== undefined || last !== undefined)) {
            const current = cacheRef.current.get(topicSymbol) || {};
            cacheRef.current.set(topicSymbol, {
              ...current,
              ...(last !== undefined && { last: Number(last) }),
              ...(bid !== undefined && { bid: Number(bid) }),
              ...(ask !== undefined && { ask: Number(ask) }),
            });
            
            // Force re-render to update market values
            setPriceUpdateTrigger(prev => prev + 1);
          }
        }
        
        // Handle md.option.quote.SYMBOL and md.option.trade.SYMBOL format
        if (topic.startsWith("md.option.")) {
          const parts = topic.split(".");
          const topicSymbol = parts.length >= 4 ? parts.slice(3).join(".").toUpperCase() : "";
          
          const d = snapshot.data?.data || snapshot.data || {};
          
          // Extract price data
          const bid = d.bidPrice ?? d.bp ?? d.bid;
          const ask = d.askPrice ?? d.ap ?? d.ask;
          const last = d.lastPrice ?? d.last ?? d.price ?? d.p ?? d.lp;
          
          if (topicSymbol && (bid !== undefined || ask !== undefined || last !== undefined)) {
            const current = cacheRef.current.get(topicSymbol) || {};
            cacheRef.current.set(topicSymbol, {
              ...current,
              ...(last !== undefined && { last: Number(last) }),
              ...(bid !== undefined && { bid: Number(bid) }),
              ...(ask !== undefined && { ask: Number(ask) }),
            });
            
            // Force re-render to update market values
            setPriceUpdateTrigger(prev => prev + 1);
          }
        }
      }

      // Initial snapshot
      if (snapshot.type === "control.ack" && snapshot.op === "account_state") {
        if (!snapshot.ok) {
          setError(snapshot.error || "Error");
          setLoading(false);
          return;
        }

        const raw = snapshot.data?.data || snapshot.data || {};

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

        const executions = (raw.executions_raw || []).map((e: any) => ({
          account: String(e.account ?? ""),
          symbol: String(e.symbol ?? ""),
          secType: String(e.secType ?? ""),
          currency: String(e.currency ?? ""),
          side: String(e.side ?? "").toUpperCase(),
          quantity: Number(e.shares ?? e.quantity ?? 0),
          price: Number(e.price ?? 0),
          execId: String(e.execId ?? ""),
          orderId: Number(e.orderId ?? 0),
          ts: String(e.ts ?? ""),
          // Option fields (if present)
          strike: e.strike !== undefined ? Number(e.strike) : undefined,
          expiry: e.expiry !== undefined ? String(e.expiry) : undefined,
          right: e.right !== undefined ? String(e.right) : undefined,
        }));

        setAccountState({ positions, cash, executions, openOrders: [] });
        setError(null);
        setLoading(false);
        setLastUpdated(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
        return;
      }

      // Handle ib.openOrder messages
      if (snapshot?.topic === "ib.openOrder") {
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
            // Remove from list if status changed to Filled/Cancelled
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
        return;
      }

      // Live execution — updates positions
      if (snapshot?.topic === "ib.executions" || snapshot?.topic === "ib.execution") {
        const d = snapshot.data;
        if (!d) return;
        const exec = d.execution || d;

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

          const positions = [...prev.positions];
          const idx = positions.findIndex(
            (p) =>
              p.account === newExec.account &&
              p.symbol === newExec.symbol &&
              p.secType === newExec.secType &&
              p.currency === newExec.currency
          );

          const qtyDelta = isBuy ? newExec.quantity : -newExec.quantity;

          if (idx >= 0) {
            const pos = positions[idx];
            const newQty = pos.quantity + qtyDelta;
            let newAvg = pos.avgCost;

            if (isBuy && qtyDelta > 0) {
              newAvg = newQty > 0
                ? (pos.quantity * pos.avgCost + qtyDelta * newExec.price) / newQty
                : 0;
            }

            if (newQty === 0) {
              positions.splice(idx, 1);
            } else {
              positions[idx] = { ...pos, quantity: newQty, avgCost: newAvg, lastUpdated: newExec.ts };
            }
          } else if (isBuy) {
            positions.push({
              account: newExec.account,
              symbol: newExec.symbol,
              secType: newExec.secType,
              currency: newExec.currency,
              quantity: newExec.quantity,
              avgCost: newExec.price,
              lastUpdated: newExec.ts,
            });
          }

          return { ...prev, positions, executions: newExecs };
        });

        setLastUpdated(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
      }
    };

    socketHub.onMessage(handler);
    socketHub.onTick(handler);  // Option messages come through onTick
    socketHub.send({ type: "control", target: "ibAccount", op: "account_state" });
    
    // Cleanup: unsubscribe from all market data and remove handler
    return () => {
      socketHub.offMessage(handler);
      socketHub.offTick(handler);
      const symbols = Array.from(subsSetRef.current);
      if (symbols.length > 0) {
        console.log("[PortfolioPanel] Cleanup: Unsubscribing from all symbols:", symbols);
        socketHub.send({ type: "unsubscribe", channels: CHANNELS, symbols });
        subsSetRef.current.clear();
      }
    };
  }, []);

  // IMMORTAL DEBUG — freezes when all filters off
  const anyFilterOn = showControl || showMdAll || showIbAll;

  const filteredDebug = anyFilterOn
    ? allDebugMsgs.filter(
        (m) =>
          (m?.type?.startsWith("control") && showControl) ||
          (m?.topic?.startsWith("md.") && showMdAll) ||
          (m?.topic?.startsWith("ib.") && showIbAll)
      )
    : frozenDebug;

  // Update frozen state whenever filters are on
  useEffect(() => {
    if (anyFilterOn) {
      const filtered = allDebugMsgs.filter(
        (m) =>
          (m?.type?.startsWith("control") && showControl) ||
          (m?.topic?.startsWith("md.") && showMdAll) ||
          (m?.topic?.startsWith("ib.") && showIbAll)
      );
      setFrozenDebug(filtered);
    }
  }, [allDebugMsgs, showControl, showMdAll, showIbAll, anyFilterOn]);

useEffect(() => {
  if (debugRef.current) {
    const { scrollTop, scrollHeight, clientHeight } = debugRef.current;
    const isAtBottom = scrollTop + clientHeight >= scrollHeight - 10;
    if (isAtBottom) {
      debugRef.current.scrollTop = scrollHeight;
    }
  }
}, [filteredDebug]);

  return (
    <div style={shell}>
      <div style={header}>
        <div style={{ fontWeight: 600, fontSize: 15 }}>Portfolio</div>
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
              positions: {accountState.positions.length} · cash: {accountState.cash.length} · execs: {accountState.executions.length}
              {subsSetRef.current.size > 0 && <> · subscribed: {subsSetRef.current.size}</>}
            </div>

            <div style={gridWrap}>
              {/* Positions with BUY/SELL buttons */}
              <section style={section}>
                <div style={title}>Positions</div>
                <div style={table}>
                  <div style={{ ...hdr, gridTemplateColumns: "75px 140px 36px 36px 65px 80px 100px 80px 130px" }}>
                    <div>Account</div>
                    <div>Symbol</div>
                    <div>Type</div>
                    <div style={center}>CCY</div>
                    <div style={right}>Qty</div>
                    <div style={right}>Last</div>
                    <div style={right}>Mkt Value</div>
                    <div style={right}>Avg Cost</div>
                    <div style={right}>Trade</div>
                  </div>

                  {accountState.positions
                    .slice()
                    .sort((a, b) => {
                      // Sort by symbol, then by secType (STK before OPT), then by strike
                      if (a.symbol !== b.symbol) return a.symbol.localeCompare(b.symbol);
                      if (a.secType !== b.secType) return a.secType === "STK" ? -1 : 1;
                      if (a.strike !== b.strike) return (a.strike || 0) - (b.strike || 0);
                      return 0;
                    })
                    .map((p, i) => {
                    // Build the proper symbol for cache lookup
                    let cacheKey = p.symbol;
                    if (p.secType === "OPT" && p.strike !== undefined && p.expiry !== undefined && p.right !== undefined) {
                      // Build OSI format: SYMBOL + YYMMDD + C/P + STRIKE (8 digits, strike * 1000)
                      const yy = p.expiry.substring(2, 4);
                      const mm = p.expiry.substring(4, 6);
                      const dd = p.expiry.substring(6, 8);
                      const rightChar = p.right === "Call" || p.right === "C" ? "C" : "P";
                      const strikeFormatted = String(Math.round(p.strike * 1000)).padStart(8, "0");
                      cacheKey = `${p.symbol}${yy}${mm}${dd}${rightChar}${strikeFormatted}`;
                    }
                    
                    const lastPrice = cacheRef.current.get(cacheKey)?.last || 0;
                    
                    // For options, multiply by contract size (100)
                    const contractMultiplier = p.secType === "OPT" ? 100 : 1;
                    const mktValue = p.quantity * lastPrice * contractMultiplier;
                    
                    const mktValueDisplay = lastPrice > 0
                      ? (mktValue < 0
                          ? `(${Math.abs(mktValue).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`
                          : mktValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
                      : "—";

                    // For options, display avg cost per share (divide by 100)
                    const displayAvgCost = p.secType === "OPT" ? p.avgCost / 100 : p.avgCost;

                    // Format symbol display based on secType
                    let symbolDisplay: React.ReactNode;
                    if (p.secType === "OPT" && p.strike !== undefined && p.expiry !== undefined && p.right !== undefined) {
                      // Use the fields directly from the backend
                      const rightLabel = p.right === "C" || p.right === "Call" ? "Call" : "Put";
                      const formattedExpiry = formatExpiryFromYYYYMMDD(p.expiry);
                      symbolDisplay = (
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 11 }}>
                            {p.symbol} {p.strike.toFixed(0)} {rightLabel}
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
                          gridTemplateColumns: "75px 140px 36px 36px 65px 80px 100px 80px 130px",
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
                          {lastPrice > 0 ? lastPrice.toFixed(4) : "—"}
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
                              
                              // Calculate cache key for this position
                              let lookupKey = p.symbol.toUpperCase().trim();
                              if (p.secType === "OPT" && p.strike !== undefined && p.expiry !== undefined && p.right !== undefined) {
                                const yy = p.expiry.substring(2, 4);
                                const mm = p.expiry.substring(4, 6);
                                const dd = p.expiry.substring(6, 8);
                                const rightChar = p.right === "Call" || p.right === "C" ? "C" : "P";
                                const strikeFormatted = String(Math.round(p.strike * 1000)).padStart(8, "0");
                                lookupKey = `${p.symbol}${yy}${mm}${dd}${rightChar}${strikeFormatted}`;
                              }
                              
                              const marketData = cacheRef.current.get(lookupKey);
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
                              
                              // Calculate cache key for this position
                              let lookupKey = p.symbol.toUpperCase().trim();
                              if (p.secType === "OPT" && p.strike !== undefined && p.expiry !== undefined && p.right !== undefined) {
                                const yy = p.expiry.substring(2, 4);
                                const mm = p.expiry.substring(4, 6);
                                const dd = p.expiry.substring(6, 8);
                                const rightChar = p.right === "Call" || p.right === "C" ? "C" : "P";
                                const strikeFormatted = String(Math.round(p.strike * 1000)).padStart(8, "0");
                                lookupKey = `${p.symbol}${yy}${mm}${dd}${rightChar}${strikeFormatted}`;
                              }
                              
                              const marketData = cacheRef.current.get(lookupKey);
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
              </section>

              {/* Cash */}
              <section style={section}>
                <div style={title}>Cash Balances</div>
                <div style={table}>
                  <div style={{ ...hdr, gridTemplateColumns: "120px 40px 98px 72px" }}>
                    <div>Account</div>
                    <div>CCY</div>
                    <div style={right}>Amount</div>
                    <div style={timeHeader}>Time</div>
                  </div>
                  {accountState.cash.map((c, i) => (
                    <div key={i} style={{ ...rowStyle, gridTemplateColumns: "120px 40px 98px 72px" }}>
                      <div style={cellEllipsis}>{c.account}</div>
                      <div style={centerBold}>{c.currency}</div>
                      <div style={rightMonoBold}>
                        {c.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                      <div style={timeCell}>
                        {new Date(c.lastUpdated).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {/* Open Orders */}
              <section style={section}>
                <div style={title}>Open Orders ({accountState.openOrders.length})</div>
                {accountState.openOrders.length === 0 ? (
                  <div style={emptyRow}>No open orders</div>
                ) : (
                  <div style={table}>
                    <div style={{ ...hdr, gridTemplateColumns: "78px 160px 50px 60px 80px 95px 95px" }}>
                      <div style={timeHeader}>Time</div>
                      <div>Symbol</div>
                      <div>Side</div>
                      <div style={right}>Qty</div>
                      <div>Type</div>
                      <div style={right}>Price</div>
                      <div>Status</div>
                    </div>
                    {accountState.openOrders.map((o) => {
                      let symbolDisplay: React.ReactNode;
                      if (o.secType === "OPT" && o.strike !== undefined && o.expiry !== undefined && o.right !== undefined) {
                        const rightLabel = o.right === "C" || o.right === "Call" ? "Call" : "Put";
                        const formattedExpiry = formatExpiryFromYYYYMMDD(o.expiry);
                        symbolDisplay = (
                          <div>
                            <div style={{ fontWeight: 600, fontSize: 11 }}>
                              {o.symbol} {o.strike.toFixed(0)} {rightLabel}
                            </div>
                            <div style={{ fontSize: 9, color: "#666" }}>
                              {formattedExpiry}
                            </div>
                          </div>
                        );
                      } else {
                        symbolDisplay = <div style={{ fontWeight: 600 }}>{o.symbol}</div>;
                      }

                      return (
                        <div key={o.orderId} style={{ ...rowStyle, gridTemplateColumns: "78px 160px 50px 60px 80px 95px 95px" }}>
                          <div style={timeCell}>
                            {new Date(o.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </div>
                          <div>{symbolDisplay}</div>
                          <div style={{ ...centerBold, color: o.side === "BUY" ? "#166534" : "#991b1b" }}>
                            {o.side}
                          </div>
                          <div style={{ ...right, fontWeight: 600 }}>{o.quantity}</div>
                          <div style={{ fontSize: 11 }}>{o.orderType}</div>
                          <div style={rightMonoBold}>
                            {o.lmtPrice !== undefined ? `$${o.lmtPrice.toFixed(2)}` : "—"}
                          </div>
                          <div style={{ fontSize: 10, color: "#666" }}>{o.status}</div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              {/* Recent Executions */}
              <section style={section}>
                <div style={title}>Recent Executions ({accountState.executions.length})</div>
                {accountState.executions.length === 0 ? (
                  <div style={emptyRow}>No executions yet</div>
                ) : (
                  <div style={table}>
                    <div style={{ ...hdr, gridTemplateColumns: "78px 98px 140px 48px 68px 100px 110px" }}>
                      <div style={timeHeader}>Time</div>
                      <div>Account</div>
                      <div>Symbol</div>
                      <div>Side</div>
                      <div style={right}>Qty</div>
                      <div style={right}>Price</div>
                      <div style={right}>ID</div>
                    </div>
                    {accountState.executions.map((e, i) => {
                      // Format symbol display based on secType
                      let symbolDisplay: React.ReactNode;
                      if (e.secType === "OPT" && e.strike !== undefined && e.expiry !== undefined && e.right !== undefined) {
                        // Use the fields directly from the backend
                        const rightLabel = e.right === "C" || e.right === "Call" ? "Call" : "Put";
                        const formattedExpiry = formatExpiryFromYYYYMMDD(e.expiry);
                        symbolDisplay = (
                          <div>
                            <div style={{ fontWeight: 600, fontSize: 11 }}>
                              {e.symbol} {e.strike.toFixed(0)} {rightLabel}
                            </div>
                            <div style={{ fontSize: 9, color: "#666" }}>
                              {formattedExpiry}
                            </div>
                          </div>
                        );
                      } else {
                        // Equity or incomplete option data
                        symbolDisplay = <div style={{ fontWeight: 600 }}>{e.symbol}</div>;
                      }

                      return (
                        <div key={e.execId || i} style={{ ...rowStyle, gridTemplateColumns: "78px 98px 140px 48px 68px 100px 110px" }}>
                          <div style={timeCell}>
                            {new Date(e.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                          </div>
                          <div style={cellEllipsis}>{e.account}</div>
                          <div>{symbolDisplay}</div>
                          <div style={{ ...centerBold, color: e.side === "BUY" ? "#16a34a" : "#dc2626" }}>
                            {e.side}
                          </div>
                          <div style={right}>{e.quantity.toLocaleString()}</div>
                          <div style={rightMono}>{e.price.toFixed(4)}</div>
                          <div style={{ ...right, ...gray9, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>
                            {e.execId.slice(-12)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
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
                onClose={() => setShowTradeTicket(false)}
              />
            ) : null}
          </div>
        )}

        {/* Debug — immortal + frozen */}
        <section style={{ ...section, marginTop: 20 }}>
          <div style={title}>
            Debug ({filteredDebug.length}/{allDebugMsgs.length})
            {!anyFilterOn && <span style={{ color: "#f59e0b", marginLeft: 8 }}>⏸ FROZEN</span>}
          </div>
          <div style={filters}>
            <label><input type="checkbox" checked={showControl} onChange={e => setShowControl(e.target.checked)} /> control</label>
            <label><input type="checkbox" checked={showMdAll} onChange={e => setShowMdAll(e.target.checked)} /> md.*</label>
            <label><input type="checkbox" checked={showIbAll} onChange={e => setShowIbAll(e.target.checked)} /> ib.*</label>
          </div>

          {/* COPY LAST MESSAGE */}
          <div style={{ padding: "8px 12px", background: "#111", borderTop: "1px solid #444", fontSize: 11, display: "flex", justifyContent: "space-between" }}>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => {
                  const last = allDebugMsgs[allDebugMsgs.length - 1];
                  if (last) {
                    navigator.clipboard.writeText(JSON.stringify(last, null, 2));
                    alert("Last message copied to clipboard!");
                  }
                }}
                style={{
                  padding: "6px 12px",
                  background: "#333",
                  color: "white",
                  border: "none",
                  borderRadius: 6,
                  cursor: "pointer",
                }}
              >
                Copy Last Message
              </button>
              <button
                onClick={() => {
                  setAllDebugMsgs([]);
                  setFrozenDebug([]);
                }}
                style={{
                  padding: "6px 12px",
                  background: "#dc2626",
                  color: "white",
                  border: "none",
                  borderRadius: 6,
                  cursor: "pointer",
                }}
              >
                Clear
              </button>
            </div>
            <span style={{ color: "#888" }}>Stored: {allDebugMsgs.length}</span>
          </div>

          <div ref={debugRef} style={debugBox}>
            {filteredDebug.map((m, i) => (
              <pre key={i} style={{ margin: "2px 0", fontSize: 10 }}>
                {JSON.stringify(m, null, 2)}
              </pre>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

/* ---- Option Symbol Parser ---- */
type ParsedOption = {
  underlying: string;
  right: "call" | "put";
  strike: number;
  expiration: string; // YYYY-MM-DD
};

function parseOptionSymbol(sym: string): ParsedOption | null {
  const S = String(sym || "").toUpperCase().replace(/\s+/g, "");
  
  // OSI format: AAPL250117C00190000
  const m1 = /^([A-Z]+)(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/.exec(S);
  if (m1) {
    const underlying = m1[1];
    const yy = m1[2];
    const mm = m1[3];
    const dd = m1[4];
    const right = m1[5] === "C" ? "call" : "put";
    const strike = parseInt(m1[6], 10) / 1000;
    const yyyy = Number(yy) + 2000;
    const expiration = `${yyyy}-${mm}-${dd}`;
    return { underlying, right, strike, expiration };
  }
  
  // Underscore format: AAPL_011725C_190
  const m2 = /^([A-Z]+)[._-](\d{2})(\d{2})(\d{2})([CP])[._-](\d+(\.\d+)?)$/.exec(S);
  if (m2) {
    const underlying = m2[1];
    const yy = m2[2];
    const mm = m2[3];
    const dd = m2[4];
    const right = m2[5] === "C" ? "call" : "put";
    const strike = parseFloat(m2[6]);
    const yyyy = Number(yy) + 2000;
    const expiration = `${yyyy}-${mm}-${dd}`;
    return { underlying, right, strike, expiration };
  }
  
  // Fallback (no reliable expiry)
  const m3 = /^([A-Z]+)\d{6,8}([CP])(\d+(\.\d+)?)$/.exec(S);
  if (m3) {
    const underlying = m3[1];
    const right = m3[2] === "C" ? "call" : "put";
    const strike = parseFloat(m3[3]);
    return { underlying, right, strike, expiration: "1970-01-01" };
  }
  
  return null;
}

function formatExpiryFromYYYYMMDD(expiry: string): string {
  try {
    // Parse YYYYMMDD format: "20251212" -> "Dec 12, 2025"
    if (expiry.length !== 8) return expiry;
    
    const y = expiry.substring(0, 4);
    const m = expiry.substring(4, 6);
    const d = expiry.substring(6, 8);
    
    const dt = new Date(Number(y), Number(m) - 1, Number(d));
    
    return dt.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return expiry;
  }
}

function formatExpiryShort(expiry: string): string {
  try {
    // Match YYYY-MM-DD explicitly
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(expiry);
    if (!m) return expiry;

    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);

    // Construct LOCAL date (not UTC midnight)
    const dt = new Date(y, mo - 1, d);

    // Format as "Dec 19, 2025"
    return dt.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return expiry;
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
const hdr = { display: "grid", fontWeight: 600, fontSize: 10.5, color: "#374151", padding: "0 10px", background: "#f8fafc", height: 26, alignItems: "center" };
const rowStyle = { display: "grid", fontSize: 11, minHeight: 32, alignItems: "center", padding: "0 10px", borderBottom: "1px solid #f3f4f6" };

const cellEllipsis = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const, fontFamily: "ui-monospace, monospace", fontSize: 10 };
const right = { textAlign: "right" as const };
const rightMono = { ...right, fontFamily: "ui-monospace, monospace" };
const rightMonoBold = { ...rightMono, fontWeight: 600 };
const center = { textAlign: "center" as const };
const centerBold = { ...center, fontWeight: 600 };
const bold = { fontWeight: 600 };
const gray10 = { fontSize: 10, color: "#666" };
const gray9 = { fontSize: 9, color: "#888" };

const timeHeader = { ...center, fontSize: 10, color: "#374151" };
const timeCell = {
  ...center,
  fontSize: 10,
  color: "#555",
  fontFeatureSettings: "'tnum'",
  letterSpacing: "0.5px",
};

const empty = { padding: 40, textAlign: "center" as const, color: "#666", fontSize: 14 };
const emptyRow = { padding: "8px 10px", color: "#888", fontSize: 12 };
const filters = { display: "flex", gap: 16, padding: "6px 10px", fontSize: 12 };
const debugBox = { height: 200, overflow: "auto", background: "#0d1117", color: "#c9d1d9", padding: "8px", fontFamily: "ui-monospace, monospace", fontSize: 11, borderTop: "1px solid #30363d" };

const iconBtn = {
  padding: "4px 10px",
  border: "1px solid #ccc",
  borderRadius: "6px",
  background: "white",
  fontSize: "12px",
  fontWeight: 600,
  cursor: "pointer",
};