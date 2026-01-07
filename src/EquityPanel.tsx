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
import { useWatchlistReport, WatchlistReportRow } from "./hooks/useWatchlistReport";
import { PriceData } from "./services/MarketDataBus";
import { isNum, fmtPrice } from "./utils/formatters";
import { useAppState } from "./state/useAppState";
import { light, semantic } from "./theme";

// Feature flag for report-based data (vs tick-based)
// Set to true to use pre-computed reports from CalcServer
// NOTE: Requires WatchlistReportBuilder running in CalcServer
const USE_REPORT_DATA = true;

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
  const data = resp.data as Record<string, unknown> | undefined;
  const payload = (data?.data ?? data) as Record<string, unknown>;
  return {
    name: payload.name as string,
    symbols: (payload.symbols as string[]) || [],
    lists: (payload.lists as string[]) || [],
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
  const data = resp.data as Record<string, unknown> | undefined;
  const payload = (data?.data ?? data) as Record<string, unknown>;
  return (payload.symbols as string[]) || [];
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

  // Persist timeframe selection and notify CalcServer when using report data
  useEffect(() => {
    localStorage.setItem(LS_TIMEFRAME, timeframe);

    // When using report data, tell CalcServer to use the new timeframe
    if (USE_REPORT_DATA && wsConnected && watchlistLoaded) {
      socketHub.sendControl("refresh_watchlist", {
        target: "calc",
        name: watchlistName,
        timeframe,
      }).then((ack) => {
        if (ack.ok) {
          console.log(`[EquityPanel] CalcServer updated to timeframe=${timeframe}`);
        } else {
          console.warn(`[EquityPanel] CalcServer timeframe update failed: ${ack.error}`);
        }
      }).catch((err) => {
        console.error("[EquityPanel] Failed to update CalcServer timeframe:", err);
      });
    }
  }, [timeframe, wsConnected, watchlistLoaded, watchlistName]);

  // Get current timeframe info for display
  const currentTimeframeInfo = useMemo(() => {
    return marketState?.timeframes?.find(t => t.id === timeframe);
  }, [marketState?.timeframes, timeframe]);

  // Fetch close prices when symbols, timeframe, or connection change
  // Wait for marketState.timeframes to be loaded to ensure correct date interpretation
  // Also re-fetch when marketState.lastUpdated changes (visibility change, reconnect, etc.)
  useEffect(() => {
    if (symbols.length === 0 || !wsConnected || !marketState?.timeframes?.length) return;
    fetchClosePrices(symbols, timeframe).then(setClosePrices);
  }, [symbols.join(","), timeframe, wsConnected, marketState?.timeframes, marketState?.lastUpdated]);

  /* ---------------- WS status for display ---------------- */
  const wsStatus = wsConnected
    ? "open"
    : appState.connection.websocket === "connecting"
      ? "connecting"
      : "closed";

  /* ---------------- MARKET DATA via MarketDataBus OR Reports ---------------- */
  // When paused, pass empty array to avoid subscriptions
  // Throttle to 250ms (4 updates/sec) for readability
  const activeSymbols = paused ? [] : symbols;

  // Tick-based approach (traditional)
  const tickPrices = useThrottledMarketPrices(
    USE_REPORT_DATA ? [] : activeSymbols,
    "equity",
    250
  );

  // Report-based approach (pre-computed from CalcServer)
  const { rowsBySymbol: reportRows, report } = useWatchlistReport(
    watchlistName,
    USE_REPORT_DATA && !paused && wsConnected
  );

  // Unified prices map for downstream use
  const prices = USE_REPORT_DATA ? new Map<string, PriceData>() : tickPrices;

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
          // Notify CalcServer to refresh its WatchlistReportBuilder
          if (USE_REPORT_DATA) {
            // Get current timeframe from localStorage since we may not have it in closure
            const currentTimeframe = localStorage.getItem(LS_TIMEFRAME) ?? "1d";
            socketHub.sendControl("refresh_watchlist", {
              target: "calc",
              name,
              timeframe: currentTimeframe,
            }).then((ack) => {
              if (ack.ok) {
                console.log(`[EquityPanel] CalcServer refreshed watchlist`);
              } else {
                console.warn(`[EquityPanel] CalcServer refresh failed: ${ack.error}`);
              }
            }).catch((err) => {
              console.error("[EquityPanel] Failed to refresh watchlist on CalcServer:", err);
            });
          }
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
    if (USE_REPORT_DATA) {
      // Report-based: data comes pre-computed from CalcServer
      return symbols.map((s) => {
        const row = reportRows.get(s);
        return {
          symbol: s,
          last: row?.last,
          bid: row?.bid,
          ask: row?.ask,
          updatedAt: row?.timestamp,
          // Pre-computed from CalcServer
          change: row?.change,
          pctChange: row?.pctChange,
        };
      });
    } else {
      // Tick-based: raw prices, change calculated locally
      return symbols.map((s) => {
        const price = prices.get(s);
        return {
          symbol: s,
          last: price?.last,
          bid: price?.bid,
          ask: price?.ask,
          updatedAt: price?.timestamp,
          // Change calculated below from closePrices
          change: undefined as number | undefined,
          pctChange: undefined as number | undefined,
        };
      });
    }
  }, [symbols, prices, reportRows]);

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
            <span style={{ fontSize: 12, color: light.text.muted, fontStyle: "italic" }}>None</span>
          )}
          <button onClick={createNewWatchlist} style={linkBtn() as any} title="Create new watchlist">+ New</button>
          {watchlistName && availableLists.length > 0 && (
            <button onClick={deleteCurrentWatchlist} style={{ ...linkBtn(), color: semantic.error.text } as any} title="Delete this watchlist">Delete</button>
          )}
          {saving && <span style={{ fontSize: 10, color: light.text.muted }}>Saving...</span>}
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
                  ...(selectedSym === sym ? { background: semantic.highlight.blue, borderColor: semantic.highlight.blueBorder } : {}),
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
        <div style={{ fontSize: 11, color: light.text.primary, display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
          <span><b>symbols:</b> {stats.total}</span>
          <span><b>quotes:</b> {stats.withQuote}</span>
          <span><b>trades:</b> {stats.withTrade}</span>
          {paused && <span style={{ color: semantic.warning.textDark }}>Paused — unsubscribed</span>}
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
            <col style={{ width: "5ch" }} />  {/* Symbol */}
            <col style={{ width: "8ch" }} />  {/* Last */}
            <col style={{ width: "9ch" }} /> {/* Chg % */}
            <col style={{ width: "7ch" }} />  {/* Chg $ */}
            <col style={{ width: "8ch" }} />  {/* Bid */}
            <col style={{ width: "8ch" }} />  {/* Ask */}
            <col style={{ width: "7ch" }} />  {/* Updated */}
            <col style={{ width: "10ch" }} /> {/* Trade */}
          </colgroup>
          <thead>
            <tr>
              <Th>Symbol</Th>
              <Th center>Last</Th>
              <Th center colSpan={2}>
                {USE_REPORT_DATA && report?.referenceDate
                  ? `Chg (${formatCloseDateShort(report.referenceDate)})`
                  : currentTimeframeInfo
                    ? `Chg (${formatCloseDateShort(currentTimeframeInfo.date)})`
                    : "Change"}
              </Th>
              <Th center>Bid</Th>
              <Th center>Ask</Th>
              <Th center>Updated</Th>
              <Th center>Trade</Th>
            </tr>
          </thead>
          <tbody>
            {symbols.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ padding: 6, color: light.text.muted, textAlign: "center", borderTop: `1px solid ${light.border.muted}`, fontSize: 12 }}>
                  No tickers selected.
                </td>
              </tr>
            ) : (
              list.map((r) => {
                const hasBid = isNum(r.bid);
                const hasAsk = isNum(r.ask);
                const mid = (hasBid && hasAsk) ? (r.bid! + r.ask!) / 2 : undefined;
                const lastVal = isNum(r.last) ? r.last : mid;
                const stale = isStale(r.updatedAt, STALE_MS);
                const isSelected = r.symbol === selectedSym;

                // Use pre-computed changes from report, or calculate from closePrices
                let pctChange: number | undefined;
                let dollarChange: number | undefined;

                if (USE_REPORT_DATA && isNum(r.pctChange)) {
                  // Report-based: use pre-computed values
                  pctChange = r.pctChange;
                  dollarChange = r.change;
                } else {
                  // Tick-based: calculate from closePrices
                  const closeData = closePrices.get(r.symbol);
                  pctChange = (closeData && isNum(lastVal))
                    ? calcPctChange(lastVal!, closeData.prevClose)
                    : undefined;
                  dollarChange = (closeData && isNum(lastVal))
                    ? lastVal! - closeData.prevClose
                    : undefined;
                }
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
                    <Td center selected={isSelected}>{fmtTime(r.updatedAt)}</Td>

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
  background: light.bg.primary,
  color: light.text.primary,
  border: `1px solid ${light.border.light}`,
  borderRadius: 8,
  overflow: "hidden",
  maxWidth: "100%",
};
const header = {
  padding: "8px 10px",
  borderBottom: `1px solid ${light.border.muted}`,
  display: "grid",
  gap: 6,
  background: light.bg.primary,
};
const inputStyle = {
  fontSize: 12,
  padding: "5px 8px",
  minWidth: 320,
  border: `1px solid ${light.border.light}`,
  borderRadius: 6,
  color: light.text.primary,
  background: light.bg.primary,
};
const tableWrap = { overflowX: "auto", maxWidth: "100%" as const };
const tableStyle = {
  width: "100%",
  borderCollapse: "separate" as const,
  borderSpacing: 0,
  tableLayout: "fixed" as const,
  background: light.bg.primary,
  fontSize: 12,
  lineHeight: 1.2,
};

function btn({ variant }: { variant?: "secondary" } = {}) {
  return {
    fontSize: 12,
    padding: "5px 8px",
    border: `1px solid ${variant === "secondary" ? light.border.muted : light.border.lighter}`,
    borderRadius: 6,
    background: variant === "secondary" ? light.bg.primary : light.bg.tertiary,
    cursor: "pointer",
    color: light.text.primary,
  };
}
function linkBtn() {
  return {
    fontSize: 11,
    padding: "3px 4px",
    border: "none",
    background: "transparent",
    color: semantic.info.text,
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
      border: `1px solid ${light.border.lighter}`,
      background: isConnecting ? semantic.warning.bg : semantic.error.bgMuted,
      color: isConnecting ? semantic.warning.text : semantic.error.textDark,
      cursor: "not-allowed",
      opacity: 0.8,
    };
  }

  return {
    fontSize: 11,
    padding: "4px 10px",
    borderRadius: 6,
    border: paused ? `1px solid ${semantic.warning.alt}` : `2px solid ${semantic.success.text}`,
    background: paused ? semantic.warning.bg : semantic.success.bgMuted,
    color: paused ? semantic.warning.text : semantic.success.textDark,
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
    border: `1px solid ${light.border.primary}`,
    background: light.bg.secondary,
    color: light.text.primary,
    fontSize: 11,
  };
}
function chipX() {
  return {
    border: "none",
    background: "transparent",
    color: light.text.secondary,
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
        borderTop: `1px solid ${light.border.muted}`,
        borderBottom: `1px solid ${light.border.muted}`,
        borderRight: `1px solid ${light.border.muted}`,
        textAlign: center ? "center" : "left",
        fontSize: 11,
        fontWeight: 600,
        color: light.text.secondary,
        background: light.bg.tertiary,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </th>
  );
}
function Td(
  { children, mono, num, center, strong, selected, first }:
  { children: any; mono?: boolean; num?: boolean; center?: boolean; strong?: boolean; selected?: boolean; first?: boolean }
) {
  return (
    <td
      style={{
        padding: "4px 6px",
        borderBottom: `1px solid ${light.border.muted}`,
        borderRight: `1px solid ${light.border.muted}`,
        fontFamily: mono ? "ui-monospace, SFMono-Regular, Menlo, monospace" : "inherit",
        textAlign: center ? "center" : num ? "right" : "left",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        color: light.text.primary,
        fontWeight: strong ? 700 : 600,
        background: selected ? semantic.highlight.blue : light.bg.primary,
        ...(selected && first ? { borderLeft: `3px solid ${semantic.info.textLight}` } : {}),
      }}
      title={typeof children === "string" ? children : undefined}
    >
      {children ?? ""}
    </td>
  );
}
