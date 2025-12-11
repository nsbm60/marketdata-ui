// src/PortfolioPanel.tsx
import { useEffect, useRef, useState } from "react";
import { socketHub } from "./ws/SocketHub";
import TradeTicket from "./components/TradeTicket";

const CHANNELS = ["md.equity.quote", "md.equity.trade"];

type IbPosition = {
  account: string;
  symbol: string;
  secType: string;
  currency: string;
  quantity: number;
  avgCost: number;
  lastUpdated: string;
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
};

type IbAccountState = {
  positions: IbPosition[];
  cash: IbCash[];
  executions: IbExecution[];
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

  const openTradeTicket = (symbol: string, account: string, side: "BUY" | "SELL" = "BUY") => {
    setTicketSymbol(symbol);
    setTicketAccount(account);
    setTicketSide(side);
    setShowTradeTicket(true);
  };

  // Subscribe to market data for position symbols
  useEffect(() => {
    if (!accountState) return;

    const positionSymbols = accountState.positions.map(p => p.symbol.toUpperCase());
    const prev = subsSetRef.current;
    const next = new Set(positionSymbols);

    const toAdd: string[] = [];
    const toDel: string[] = [];

    next.forEach((s) => { if (!prev.has(s)) toAdd.push(s); });
    prev.forEach((s) => { if (!next.has(s)) toDel.push(s); });

    if (toAdd.length) {
      socketHub.send({ type: "subscribe", channels: CHANNELS, symbols: toAdd });
    }
    if (toDel.length) {
      socketHub.send({ type: "unsubscribe", channels: CHANNELS, symbols: toDel });
    }

    subsSetRef.current = next;
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

      // IMMORTAL DEBUG — always store every message
      setAllDebugMsgs(prev => {
        const next = [...prev, snapshot];
        if (next.length > DEBUG_MAX) next.splice(0, next.length - DEBUG_MAX);
        return next;
      });

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
        }));

        setAccountState({ positions, cash, executions });
        setError(null);
        setLoading(false);
        setLastUpdated(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
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
    socketHub.send({ type: "control", target: "ibAccount", op: "account_state" });
    
    // Cleanup: unsubscribe from all market data on unmount
    return () => {
      socketHub.offMessage(handler);
      const symbols = Array.from(subsSetRef.current);
      if (symbols.length) {
        socketHub.send({ type: "unsubscribe", channels: CHANNELS, symbols });
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
    if (debugRef.current) debugRef.current.scrollTop = debugRef.current.scrollHeight;
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
                  <div style={{ ...hdr, gridTemplateColumns: "75px 60px 36px 36px 65px 80px 100px 80px 130px" }}>
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

                  {accountState.positions.map((p, i) => {
                    const lastPrice = cacheRef.current.get(p.symbol)?.last || 0;
                    const mktValue = p.quantity * lastPrice;
                    const mktValueDisplay = lastPrice > 0
                      ? (mktValue < 0
                          ? `(${Math.abs(mktValue).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`
                          : mktValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
                      : "—";

                    return (
                      <div
                        key={i}
                        style={{
                          ...rowStyle,
                          gridTemplateColumns: "75px 60px 36px 36px 65px 80px 100px 80px 130px",
                        }}
                      >
                        <div style={cellEllipsis}>{p.account}</div>
                        <div style={bold}>{p.symbol}</div>
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
                        <div style={rightMono}>{p.avgCost.toFixed(4)}</div>
                        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, paddingRight: 12 }}>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              openTradeTicket(p.symbol, p.account, "BUY");
                            }}
                            style={{ ...iconBtn, background: "#dcfce7", color: "#166534" }}
                          >
                            BUY
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              openTradeTicket(p.symbol, p.account, "SELL");
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

              {/* Recent Executions */}
              <section style={section}>
                <div style={title}>Recent Executions ({accountState.executions.length})</div>
                {accountState.executions.length === 0 ? (
                  <div style={emptyRow}>No executions yet</div>
                ) : (
                  <div style={table}>
                    <div style={{ ...hdr, gridTemplateColumns: "78px 98px 88px 48px 68px 100px 110px" }}>
                      <div style={timeHeader}>Time</div>
                      <div>Account</div>
                      <div>Symbol</div>
                      <div>Side</div>
                      <div style={right}>Qty</div>
                      <div style={right}>Price</div>
                      <div style={right}>ID</div>
                    </div>
                    {accountState.executions.map((e, i) => (
                      <div key={e.execId || i} style={{ ...rowStyle, gridTemplateColumns: "78px 98px 88px 48px 68px 100px 110px" }}>
                        <div style={timeCell}>
                          {new Date(e.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                        </div>
                        <div style={cellEllipsis}>{e.account}</div>
                        <div style={bold}>{e.symbol}</div>
                        <div style={{ ...centerBold, color: e.side === "BUY" ? "#16a34a" : "#dc2626" }}>
                          {e.side}
                        </div>
                        <div style={right}>{e.quantity.toLocaleString()}</div>
                        <div style={rightMono}>{e.price.toFixed(4)}</div>
                        <div style={{ ...right, ...gray9, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>
                          {e.execId.slice(-12)}
                        </div>
                      </div>
                    ))}
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
            <TradeTicket
              symbol={ticketSymbol}
              account={ticketAccount}
              defaultSide={ticketSide}
              onClose={() => setShowTradeTicket(false)}
            />
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
const rowStyle = { display: "grid", fontSize: 11, height: 22, alignItems: "center", padding: "0 10px", borderBottom: "1px solid #f3f4f6" };

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