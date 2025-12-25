// src/EquityPanel.tsx
import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { socketHub } from "./ws/SocketHub";
import TradeTicket from "./components/TradeTicket";
import TradeButton, { tradeButtonContainer } from "./components/shared/TradeButton";
import Select from "./components/shared/Select";
import TimeframeSelector from "./components/shared/TimeframeSelector";
import { PriceChangePercent, PriceChangeDollar } from "./components/shared/PriceChange";
import { fetchClosePrices, ClosePriceData, calcPctChange, formatCloseDateShort } from "./services/closePrices";
import { useMarketState, TimeframeOption } from "./services/marketState";
import { useThrottledMarketPrices } from "./hooks/useMarketData";
import { PriceData } from "./services/MarketDataBus";
import { isNum, fmtPrice } from "./utils/formatters";
import { useAppState } from "./state/useAppState";

const LS_INPUT = "wl.input";
const LS_TIMEFRAME = "wl.timeframe";
const STALE_MS = 15_000;

// Watchlist API helpers
async function fetchActiveWatchlist(): Promise<{ name: string; symbols: string[]; lists: string[] }> {
  const resp = await socketHub.sendControl("get_active_watchlist", {
    target: "marketData",
  });
  if (!resp.ok) throw new Error(resp.error || "Failed to fetch watchlist");
  // Response has nested data: resp.data.data contains the actual payload
  const payload = resp.data?.data ?? resp.data;
  return {
    name: payload.name,
    symbols: payload.symbols || [],
    lists: payload.lists || [],
  };
}

async function saveWatchlist(name: string, symbols: string[]): Promise<void> {
  const resp = await socketHub.sendControl("save_watchlist", {
    target: "marketData",
    name,
    symbols,
  });
  if (!resp.ok) throw new Error(resp.error || "Failed to save watchlist");
}

async function setActiveWatchlist(name: string): Promise<string[]> {
  const resp = await socketHub.sendControl("set_active_watchlist", {
    target: "marketData",
    name,
  });
  if (!resp.ok) throw new Error(resp.error || "Failed to set active watchlist");
  const payload = resp.data?.data ?? resp.data;
  return payload.symbols || [];
}

async function deleteWatchlist(name: string): Promise<void> {
  const resp = await socketHub.sendControl("delete_watchlist", {
    target: "marketData",
    name,
  });
  if (!resp.ok) throw new Error(resp.error || "Failed to delete watchlist");
}

export default function EquityPanel({
  onSelect,
  onClear,
}: {
  onSelect?: (symbol: string) => void;
  onClear?: () => void;
}) {
  /* ---------------- input + symbols ---------------- */
  const [input, setInput] = useState(() => localStorage.getItem(LS_INPUT) ?? "");
  const [symbols, setSymbols] = useState<string[]>([]);
  const [watchlistName, setWatchlistNameState] = useState("default");
  const [availableLists, setAvailableLists] = useState<string[]>([]);
  const [watchlistLoaded, setWatchlistLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const saveTimeoutRef = useRef<number | null>(null);

  // Ref to always have the current watchlist name (avoids stale closure issues)
  const watchlistNameRef = useRef(watchlistName);
  const setWatchlistName = (name: string) => {
    watchlistNameRef.current = name;
    setWatchlistNameState(name);
  };

  useEffect(() => { localStorage.setItem(LS_INPUT, input); }, [input]);

  /* ---------------- WS status from app state ---------------- */
  const { state: appState } = useAppState();
  const wsConnected = appState.connection.websocket === "connected";

  // Load active watchlist when WebSocket connects
  useEffect(() => {
    if (!wsConnected) return;

    fetchActiveWatchlist()
      .then(({ name, symbols, lists }) => {
        setWatchlistName(name);
        setSymbols(symbols);
        setAvailableLists(lists);
        setWatchlistLoaded(true);
        console.log(`[EquityPanel] Loaded watchlist '${name}' with ${symbols.length} symbols`);
      })
      .catch((err) => {
        console.error("[EquityPanel] Failed to load watchlist:", err);
        setWatchlistLoaded(true); // Allow UI to render even if backend fails
      });
  }, [wsConnected]);

  /* ---------------- selection ---------------- */
  const [selectedSym, setSelectedSym] = useState<string | null>(null);

  /* ---------------- pause/resume ---------------- */
  const [paused, setPaused] = useState(false);

  /* ---------------- TRADE TICKET ---------------- */
  const [showTradeTicket, setShowTradeTicket] = useState(false);
  const [ticketSymbol, setTicketSymbol] = useState("");
  const [ticketAccount] = useState("DU333427");
  const [ticketSide, setTicketSide] = useState<"BUY" | "SELL">("BUY");

  const openTradeTicket = (symbol: string, side: "BUY" | "SELL" = "BUY") => {
    setTicketSymbol(symbol);
    setTicketSide(side);
    setShowTradeTicket(true);
  };

  /* ---------------- MARKET STATE & CLOSE PRICES ---------------- */
  const marketState = useMarketState();
  const [closePrices, setClosePrices] = useState<Map<string, ClosePriceData>>(new Map());
  const [timeframe, setTimeframe] = useState(() => localStorage.getItem(LS_TIMEFRAME) ?? "1d");

  // Persist timeframe selection
  useEffect(() => { localStorage.setItem(LS_TIMEFRAME, timeframe); }, [timeframe]);

  // Get current timeframe info for display
  const currentTimeframeInfo = useMemo(() => {
    return marketState?.timeframes?.find(t => t.id === timeframe);
  }, [marketState?.timeframes, timeframe]);

  // Fetch close prices when symbols or timeframe change
  useEffect(() => {
    if (symbols.length === 0) return;
    fetchClosePrices(symbols, timeframe).then(setClosePrices);
  }, [symbols.join(","), timeframe]);

  /* ---------------- WS status for display ---------------- */
  const wsStatus = wsConnected
    ? "open"
    : appState.connection.websocket === "connecting"
      ? "connecting"
      : "closed";

  /* ---------------- MARKET DATA via MarketDataBus ---------------- */
  // When paused, pass empty array to avoid subscriptions
  // Throttle to 250ms (4 updates/sec) for readability
  const activeSymbols = paused ? [] : symbols;
  const prices = useThrottledMarketPrices(activeSymbols, "equity", 250);

  /* ---------------- actions ---------------- */
  // Debounced save to backend
  const saveToBackend = useCallback((name: string, syms: string[]) => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    setSaving(true);
    saveTimeoutRef.current = window.setTimeout(() => {
      saveWatchlist(name, syms)
        .then(() => {
          console.log(`[EquityPanel] Saved watchlist '${name}'`);
          setSaving(false);
        })
        .catch((err) => {
          console.error("[EquityPanel] Failed to save watchlist:", err);
          setSaving(false);
        });
    }, 500); // Debounce 500ms
  }, []);

  const applySymbols = (next: string[]) => {
    const norm = Array.from(new Set(next.map((s) => s.toUpperCase()))).sort();
    setSymbols(norm);
    if (selectedSym && !norm.includes(selectedSym)) {
      setSelectedSym(norm.length ? norm[0] : null);
    }
    // Save to backend (debounced) - use ref to get current name, not stale closure
    saveToBackend(watchlistNameRef.current, norm);
  };

  const actAdd = () => {
    const add = parseSymbols(input);
    applySymbols(Array.from(new Set([...symbols, ...add])));
    setInput("");
  };
  const actReplace = () => { applySymbols(parseSymbols(input)); setInput(""); };
  const actClear = () => { applySymbols([]); setInput(""); onClear?.(); };

  const switchWatchlist = async (name: string) => {
    try {
      const syms = await setActiveWatchlist(name);
      setWatchlistName(name);
      setSymbols(syms);
      console.log(`[EquityPanel] Switched to watchlist '${name}' with ${syms.length} symbols`);
    } catch (err) {
      console.error("[EquityPanel] Failed to switch watchlist:", err);
    }
  };

  const createNewWatchlist = async () => {
    const name = prompt("Enter name for new watchlist:");
    if (!name || name.trim() === "") return;
    const trimmedName = name.trim();
    try {
      // Just switch to the new list - set_active_watchlist handles new empty lists
      await switchWatchlist(trimmedName);
      // Add to available lists if not already there
      setAvailableLists((prev) =>
        prev.includes(trimmedName) ? prev : [...prev, trimmedName].sort()
      );
    } catch (err) {
      console.error("[EquityPanel] Failed to create watchlist:", err);
      alert("Failed to create watchlist");
    }
  };

  const deleteCurrentWatchlist = async () => {
    if (watchlistName === "default") {
      alert("Cannot delete the default watchlist");
      return;
    }
    if (!confirm(`Delete watchlist "${watchlistName}"?`)) return;
    try {
      await deleteWatchlist(watchlistName);
      setAvailableLists((prev) => prev.filter((n) => n !== watchlistName));
      await switchWatchlist("default");
    } catch (err) {
      console.error("[EquityPanel] Failed to delete watchlist:", err);
      alert("Failed to delete watchlist");
    }
  };

  const togglePaused = () => setPaused((p) => !p);
  const removeOne = (sym: string) => {
    const target = String(sym).toUpperCase();
    const next = symbols.filter((s) => s.toUpperCase() !== target);
    applySymbols(next);
  };

  /* ---------------- view model ---------------- */
  const list = useMemo(() => {
    return symbols.map((s) => {
      const price = prices.get(s);
      return {
        symbol: s,
        last: price?.last,
        bid: price?.bid,
        ask: price?.ask,
        updatedAt: price?.timestamp,
      };
    });
  }, [symbols, prices]);

  const stats = useMemo(() => {
    let withQuote = 0, withTrade = 0;
    for (const r of list) {
      if (isNum(r.bid) || isNum(r.ask)) withQuote++;
      if (isNum(r.last)) withTrade++;
    }
    return { withQuote, withTrade, total: list.length };
  }, [list]);

  /* ---------------- render ---------------- */
  return (
    <div style={shell as any}>
      {/* Header / Controls */}
      <div style={header as any}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>Watchlist</div>
          {availableLists.length > 0 ? (
            <Select
              value={watchlistName}
              onChange={(e) => switchWatchlist(e.target.value)}
              size="md"
              style={{ minWidth: 100 }}
              title="Select watchlist"
            >
              {availableLists.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </Select>
          ) : (
            <span style={{ fontSize: 12, color: "#666", fontStyle: "italic" }}>None</span>
          )}
          <button onClick={createNewWatchlist} style={linkBtn() as any} title="Create new watchlist">+ New</button>
          {watchlistName && availableLists.length > 0 && (
            <button onClick={deleteCurrentWatchlist} style={{ ...linkBtn(), color: "#dc2626" } as any} title="Delete this watchlist">Delete</button>
          )}
          {saving && <span style={{ fontSize: 10, color: "#666" }}>Saving...</span>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <input
            value={input}
            onChange={(e) => setInput((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => { if (e.key === "Enter") actAdd(); }}
            placeholder="Tickers (comma/space). Example: NVDA AAPL META"
            title="Enter one or more tickers, then click Add or Replace (or press Enter)"
            style={inputStyle as any}
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="on"
            autoComplete="off"
          />
          <button onClick={actAdd} style={btn() as any}>Add</button>
          <button onClick={actReplace} style={btn() as any}>Replace</button>
          <button onClick={actClear} style={btn({ variant: "secondary" }) as any}>Clear</button>
          <button
            onClick={togglePaused}
            disabled={wsStatus !== "open"}
            style={feedButton(wsStatus, paused) as any}
            title={wsStatus !== "open" ? `WebSocket ${wsStatus}` : (paused ? "Click to resume" : "Click to pause")}
          >
            {wsStatus !== "open"
              ? (wsStatus === "connecting" ? "Connecting…" : "Disconnected")
              : (paused ? "Paused" : "Live")
            }
          </button>
        </div>
        {symbols.length > 0 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {symbols.map((sym) => (
              <span
                key={sym}
                style={{
                  ...chip(),
                  ...(selectedSym === sym ? { background: "#e0ecff", borderColor: "#93c5fd" } : {}),
                  cursor: "pointer",
                } as any}
                onClick={() => { setSelectedSym(sym); onSelect?.(sym); }}
                title="Click to load options"
              >
                {sym}
                <button onClick={(e) => { e.stopPropagation(); removeOne(sym); }} style={chipX() as any} aria-label={`Remove ${sym}`}>×</button>
              </span>
            ))}
          </div>
        )}
        <div style={{ fontSize: 11, color: "#333", display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
          <span><b>symbols:</b> {stats.total}</span>
          <span><b>quotes:</b> {stats.withQuote}</span>
          <span><b>trades:</b> {stats.withTrade}</span>
          {paused && <span style={{ color: "#b45309" }}>Paused — unsubscribed</span>}
          <TimeframeSelector
            value={timeframe}
            onChange={setTimeframe}
            timeframes={marketState?.timeframes ?? []}
            alignRight
          />
        </div>
      </div>

      {/* Table */}
      <div style={tableWrap as any}>
        <table style={tableStyle as any}>
          <colgroup>
            <col style={{ width: "6ch" }} />
            <col style={{ width: "9ch" }} />
            <col style={{ width: "8ch" }} />
            <col style={{ width: "8ch" }} />
            <col style={{ width: "9ch" }} />
            <col style={{ width: "9ch" }} />
            <col style={{ width: "9ch" }} />
            <col style={{ width: "7ch" }} />
            <col style={{ width: "12ch" }} />
            <col style={{ width: "14ch" }} />
          </colgroup>
          <thead>
            <tr>
              <Th>Symbol</Th>
              <Th center>Last</Th>
              <Th center colSpan={2}>
                {currentTimeframeInfo
                  ? `Chg (${formatCloseDateShort(currentTimeframeInfo.date)})`
                  : "Change"}
              </Th>
              <Th center>Bid</Th>
              <Th center>Ask</Th>
              <Th center>Mid</Th>
              <Th center>Spread</Th>
              <Th>Updated</Th>
              <Th>Trade</Th>
            </tr>
          </thead>
          <tbody>
            {symbols.length === 0 ? (
              <tr>
                <td colSpan={10} style={{ padding: 6, color: "#666", textAlign: "center", borderTop: "1px solid #eee", fontSize: 12 }}>
                  No tickers selected.
                </td>
              </tr>
            ) : (
              list.map((r) => {
                const hasBid = isNum(r.bid);
                const hasAsk = isNum(r.ask);
                const mid = (hasBid && hasAsk) ? (r.bid! + r.ask!) / 2 : undefined;
                const spread = (hasBid && hasAsk) ? (r.ask! - r.bid!) : undefined;
                const lastVal = isNum(r.last) ? r.last : mid;
                const stale = isStale(r.updatedAt, STALE_MS);
                const isSelected = r.symbol === selectedSym;

                // Calculate price change (% and $)
                const closeData = closePrices.get(r.symbol);
                const pctChange = (closeData && isNum(lastVal))
                  ? calcPctChange(lastVal!, closeData.prevClose)
                  : undefined;
                const dollarChange = (closeData && isNum(lastVal))
                  ? lastVal! - closeData.prevClose
                  : undefined;
                return (
                  <tr
                    key={r.symbol}
                    aria-selected={isSelected}
                    style={{ cursor: "pointer", ...(stale ? { opacity: 0.72 } : {}) }}
                    onClick={() => { setSelectedSym(r.symbol); onSelect?.(r.symbol); }}
                    title="Click to load options"
                  >
                    <Td mono strong={isSelected} selected={isSelected} first>{r.symbol}</Td>
                    <Td num strong={isSelected} selected={isSelected}>{fmtPrice(lastVal)}</Td>
                    <Td num selected={isSelected}>
                      <PriceChangePercent value={pctChange} />
                    </Td>
                    <Td num selected={isSelected}>
                      <PriceChangeDollar value={dollarChange} />
                    </Td>
                    <Td num selected={isSelected}>{fmtPrice(r.bid)}</Td>
                    <Td num selected={isSelected}>{fmtPrice(r.ask)}</Td>
                    <Td num selected={isSelected}>{fmtPrice(mid)}</Td>
                    <Td num selected={isSelected}>{fmtPrice(spread)}</Td>
                    <Td selected={isSelected}>{fmtTime(r.updatedAt)}</Td>

                    {/* BUY/SELL */}
                    <Td selected={isSelected}>
                      <div style={tradeButtonContainer}>
                        <TradeButton
                          side="BUY"
                          onClick={(e) => { e.stopPropagation(); openTradeTicket(r.symbol, "BUY"); }}
                        />
                        <TradeButton
                          side="SELL"
                          onClick={(e) => { e.stopPropagation(); openTradeTicket(r.symbol, "SELL"); }}
                        />
                      </div>
                    </Td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Trade Ticket */}
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
    </div>
  );
}

/* ---------------- helpers ---------------- */
function parseSymbols(s: string): string[] {
  return String(s || "")
    .split(/[\s,]+/)
    .map((x) => x.trim().toUpperCase())
    .filter(Boolean);
}
function fmtTime(ts: any) {
  if (!ts) return "";
  try {
    const d = typeof ts === "number" ? new Date(ts) : new Date(ts);
    return d.toLocaleTimeString([], { hour12: false });
  } catch { return String(ts); }
}
function isStale(ts: any, ms: number) {
  if (!ts) return true;
  try {
    const t = typeof ts === "number" ? ts : Date.parse(ts);
    return (Date.now() - t) > ms;
  } catch { return false; }
}

/* ---- visuals ---- */
const shell = {
  margin: 0,
  background: "#fff",
  color: "#111",
  border: "1px solid #ddd",
  borderRadius: 8,
  overflow: "hidden",
  maxWidth: "100%",
};
const header = {
  padding: "8px 10px",
  borderBottom: "1px solid #eee",
  display: "grid",
  gap: 6,
  background: "#fff",
};
const inputStyle = {
  fontSize: 12,
  padding: "5px 8px",
  minWidth: 320,
  border: "1px solid #ddd",
  borderRadius: 6,
  color: "#111",
  background: "#fff",
};
const tableWrap = { overflowX: "auto", maxWidth: "100%" as const };
const tableStyle = {
  width: "auto",
  borderCollapse: "separate" as const,
  borderSpacing: 0,
  tableLayout: "auto" as const,
  background: "#fff",
  fontSize: 12,
  lineHeight: 1.2,
};

function btn({ variant }: { variant?: "secondary" } = {}) {
  return {
    fontSize: 12,
    padding: "5px 8px",
    border: `1px solid ${variant === "secondary" ? "#e3e3e3" : "#ccc"}`,
    borderRadius: 6,
    background: variant === "secondary" ? "#fff" : "#f7f7f7",
    cursor: "pointer",
    color: "#111",
  };
}
function linkBtn() {
  return {
    fontSize: 11,
    padding: "3px 4px",
    border: "none",
    background: "transparent",
    color: "#2563eb",
    cursor: "pointer",
    textDecoration: "underline",
  };
}
function feedButton(wsStatus: string, paused: boolean) {
  const isConnected = wsStatus === "open";
  const isConnecting = wsStatus === "connecting";

  if (!isConnected) {
    return {
      fontSize: 11,
      padding: "4px 10px",
      borderRadius: 6,
      border: "1px solid #ccc",
      background: isConnecting ? "#fef3c7" : "#fee2e2",
      color: isConnecting ? "#92400e" : "#991b1b",
      cursor: "not-allowed",
      opacity: 0.8,
    };
  }

  return {
    fontSize: 11,
    padding: "4px 10px",
    borderRadius: 6,
    border: paused ? "1px solid #d97706" : "2px solid #16a34a",
    background: paused ? "#fef3c7" : "#dcfce7",
    color: paused ? "#92400e" : "#166534",
    cursor: "pointer",
    fontWeight: 500,
  };
}
function chip() {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "3px 6px",
    borderRadius: 999,
    border: "1px solid #e5e7eb",
    background: "#f8fafc",
    color: "#111",
    fontSize: 11,
  };
}
function chipX() {
  return {
    border: "none",
    background: "transparent",
    color: "#444",
    cursor: "pointer",
    fontSize: 13,
    lineHeight: 1,
    padding: 0,
  };
}
function Th({ children, center, colSpan }: { children: any; center?: boolean; colSpan?: number }) {
  return (
    <th
      colSpan={colSpan}
      style={{
        padding: "4px 6px",
        borderTop: "1px solid #eee",
        borderBottom: "1px solid #eee",
        borderRight: "1px solid #eee",
        textAlign: center ? "center" : "left",
        fontSize: 11,
        fontWeight: 600,
        color: "#333",
        background: "#f6f6f6",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </th>
  );
}
function Td(
  { children, mono, num, strong, selected, first }:
  { children: any; mono?: boolean; num?: boolean; strong?: boolean; selected?: boolean; first?: boolean }
) {
  return (
    <td
      style={{
        padding: "4px 6px",
        borderBottom: "1px solid #eee",
        borderRight: "1px solid #eee",
        fontFamily: mono ? "ui-monospace, SFMono-Regular, Menlo, monospace" : "inherit",
        textAlign: num ? "right" : "left",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        color: "#111",
        fontWeight: strong ? 700 : 600,
        background: selected ? "#dbeafe" : "#fff",
        ...(selected && first ? { borderLeft: "3px solid #1e90ff" } : {}),
      }}
      title={typeof children === "string" ? children : undefined}
    >
      {children ?? ""}
    </td>
  );
}
