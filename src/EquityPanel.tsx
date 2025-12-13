// src/EquityPanel.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { socketHub } from "./ws/SocketHub";
import TradeTicket from "./components/TradeTicket"; // ← ONLY NEW IMPORT

const CHANNELS = ["md.equity.quote", "md.equity.trade"];
const LS_APPLIED = "wl.applied";
const LS_INPUT = "wl.input";
const STALE_MS = 15_000;
const MAX_FPS = 15;
const MAX_QUEUE = 5000;
const BATCH_CHUNK = 1000;
type TickEnvelope = { topic: string; data: any };

export default function EquityPanel({
  onSelect,
  onClear,
}: {
  onSelect?: (symbol: string) => void;
  onClear?: () => void;
}) {
  /* ---------------- input + symbols ---------------- */
  const [input, setInput] = useState(() => localStorage.getItem(LS_INPUT) ?? "");
  const [symbols, setSymbols] = useState<string[]>(() => {
    const saved = localStorage.getItem(LS_APPLIED);
    return saved ? parseSymbols(saved) : [];
  });
  useEffect(() => { localStorage.setItem(LS_INPUT, input); }, [input]);

  /* ---------------- selection ---------------- */
  const [selectedSym, setSelectedSym] = useState<string | null>(null);

  /* ---------------- pause/resume ---------------- */
  const [paused, setPaused] = useState(false);

  /* ---------------- TRADE TICKET — NEW ---------------- */
  const [showTradeTicket, setShowTradeTicket] = useState(false);
  const [ticketSymbol, setTicketSymbol] = useState("");
  const [ticketAccount] = useState("DU333427");
  const [ticketSide, setTicketSide] = useState<"BUY" | "SELL">("BUY");

  const openTradeTicket = (symbol: string, side: "BUY" | "SELL" = "BUY") => {
    setTicketSymbol(symbol);
    setTicketSide(side);
    setShowTradeTicket(true);
  };

  /* ---------------- caches and WS plumbing ---------------- */
  const cacheRef = useRef(new Map<string, any>());
  const [wsStatus, setWsStatus] = useState<"idle"|"connecting"|"open"|"closed">("idle");
  const queueRef = useRef<TickEnvelope[]>([]);
  const subsSetRef = useRef<Set<string>>(new Set());
  const [version, setVersion] = useState(0);
  const lastPaintRef = useRef(0);
  const rafRef = useRef<number>(0 as any);
  const needPaintRef = useRef(false);

  useEffect(() => {
    socketHub.connect();
    setWsStatus("connecting");
    const onAny = (m: any) => {
      if (wsStatus !== "open") setWsStatus("open");
    };
    socketHub.onMessage(onAny);
    return () => socketHub.offMessage(onAny);
  }, []);

  const schedule = () => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(tick);
  };

  function processBatch(batch: TickEnvelope[]) {
    let anyChanged = false;
    const cache = cacheRef.current;
    const subs = subsSetRef.current;
    for (let i = 0; i < batch.length; i++) {
      const env = batch[i];
      if (!env) continue;
      const t = env.topic;
      const d = env.data && typeof env.data === "object" ? env.data : env;
      if (typeof t === "string" && t.startsWith("md.equity.")) {
        const info = fastExtract(t, d);
        if (!info) continue;
        if (subs.size && !subs.has(info.symbol)) continue;
        const prev = (cache.get(info.symbol) as any) || { symbol: info.symbol };
        if (info.kind === "quote") {
          const next = {
            ...prev,
            bid: info.bid ?? prev.bid,
            ask: info.ask ?? prev.ask,
            updatedAt: info.ts ?? prev.updatedAt,
          };
          if (!shallowEqualQuote(prev, next)) { cache.set(info.symbol, next); anyChanged = true; }
          else cache.set(info.symbol, next);
        } else if (info.kind === "trade") {
          const next = {
            ...prev,
            last: info.last ?? prev.last,
            updatedAt: info.ts ?? prev.updatedAt,
          };
          if (!shallowEqualTrade(prev, next)) { cache.set(info.symbol, next); anyChanged = true; }
          else cache.set(info.symbol, next);
        }
        continue;
      }
      const events = normalizeGeneric({ topic: t, data: d });
      for (const ev of events) {
        if (subs.size && !subs.has(ev.symbol)) continue;
        const prev = (cache.get(ev.symbol) as any) || { symbol: ev.symbol };
        if (ev.kind === "quote") {
          const next = {
            ...prev,
            bid: ev.bid ?? prev.bid,
            ask: ev.ask ?? prev.ask,
            updatedAt: ev.ts ?? prev.updatedAt,
          };
          if (!shallowEqualQuote(prev, next)) { cache.set(ev.symbol, next); anyChanged = true; }
          else cache.set(ev.symbol, next);
        } else if (ev.kind === "trade") {
          const next = {
            ...prev,
            last: ev.last ?? prev.last,
            updatedAt: ev.ts ?? prev.updatedAt,
          };
          if (!shallowEqualTrade(prev, next)) { cache.set(ev.symbol, next); anyChanged = true; }
          else cache.set(ev.symbol, next);
        }
      }
    }
    return anyChanged;
  }

  const tick = () => {
    rafRef.current = 0;
    if (paused) return;
    if (queueRef.current.length > MAX_QUEUE) {
      queueRef.current = queueRef.current.slice(-MAX_QUEUE);
    }
    const batch = queueRef.current.splice(0, Math.min(queueRef.current.length, BATCH_CHUNK));
    let changed = false;
    if (batch.length) changed = processBatch(batch);
    const now = performance.now();
    const minDelta = 1000 / MAX_FPS;
    if (changed && now - lastPaintRef.current >= minDelta) {
      lastPaintRef.current = now;
      setVersion((v) => (v + 1) & 0xffff);
      needPaintRef.current = false;
    } else if (changed) {
      needPaintRef.current = true;
    }
    if (queueRef.current.length || needPaintRef.current) schedule();
  };

  useEffect(() => {
    const onTick = (te: TickEnvelope) => {
      try {
        queueRef.current.push(te);
        schedule();
      } catch {}
    };
    socketHub.onTick(onTick);
    return () => socketHub.offTick(onTick);
  }, []);

  const sendJson = (obj: any) => socketHub.send(obj);

  const applySubscriptionDelta = (target: string[]) => {
    const prev = subsSetRef.current;
    const next = new Set(target.map((s) => s.toUpperCase()));
    const toAdd: string[] = [];
    const toDel: string[] = [];
    next.forEach((s) => { if (!prev.has(s)) toAdd.push(s); });
    prev.forEach((s) => { if (!next.has(s)) toDel.push(s); });
    if (!paused && toAdd.length) sendJson({ type: "subscribe", channels: CHANNELS, symbols: toAdd });
    if (toDel.length) sendJson({ type: "unsubscribe", channels: CHANNELS, symbols: toDel });
    subsSetRef.current = next;
  };

  /* ---------------- actions ---------------- */
  const applySymbols = (next: string[]) => {
    const norm = Array.from(new Set(next.map((s) => s.toUpperCase()))).sort();
    setSymbols(norm);
    if (norm.length === 0) localStorage.removeItem(LS_APPLIED);
    else localStorage.setItem(LS_APPLIED, norm.join(","));
    const cache = cacheRef.current;
    for (const s of norm) if (!cache.has(s)) cache.set(s, { symbol: s });
    setVersion((v) => (v + 1) & 0xffff);
    applySubscriptionDelta(norm);
    if (selectedSym && !norm.includes(selectedSym)) {
      setSelectedSym(norm.length ? norm[0] : null);
    }
  };
  const actAdd = () => { const add = parseSymbols(input); applySymbols(Array.from(new Set([...symbols, ...add]))); setInput(""); };
  const actReplace = () => { applySymbols(parseSymbols(input)); setInput(""); };
  const actClear = () => { applySymbols([]); setInput(""); onClear?.(); };
  const actPurge = () => {
    localStorage.removeItem(LS_APPLIED);
    localStorage.removeItem(LS_INPUT);
    setInput("");
    applySymbols([]);
    cacheRef.current = new Map();
    setVersion((v) => (v + 1) & 0xffff);
    setSelectedSym(null);
  };
  const togglePaused = () => {
    const next = !paused;
    setPaused(next);
    if (next) {
      const prev = Array.from(subsSetRef.current);
      if (prev.length) sendJson({ type: "unsubscribe", channels: CHANNELS, symbols: prev });
      subsSetRef.current = new Set();
      queueRef.current = [];
    } else if (symbols.length) {
      applySubscriptionDelta(symbols);
      schedule();
    }
  };
  const removeOne = (sym: string) => {
    const target = String(sym).toUpperCase();
    const next = symbols.filter((s) => s.toUpperCase() !== target);
    applySymbols(next);
  };

  /* ---------------- view model ---------------- */
  const list = useMemo(() => {
    const cache = cacheRef.current;
    return symbols.map((s) => (cache.get(s) as any) || { symbol: s });
  }, [symbols, version]);

  const stats = useMemo(() => {
    let withQuote = 0, withTrade = 0;
    for (const r of list as any[]) {
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
          <span style={{ marginLeft: "auto", fontSize: 12, color: wsStatus === "open" ? "#137333" : "#666" }}>
            WS: {wsStatus}
          </span>
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
          <button onClick={actPurge} style={linkBtn() as any}>Purge saved</button>
          <span style={{ marginLeft: "auto", fontSize: 12 }}>
            Equity: 
            <button onClick={togglePaused} style={toggle(!paused) as any}>
              {paused ? "Paused" : "Active"}
            </button>
          </span>
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
        <div style={{ fontSize: 11, color: "#333", display: "flex", gap: 16, flexWrap: "wrap" }}>
          <span><b>symbols:</b> {stats.total}</span>
          <span><b>quotes:</b> {stats.withQuote}</span>
          <span><b>trades:</b> {stats.withTrade}</span>
          {paused && <span style={{ color: "#b45309" }}>Paused — unsubscribed</span>}
        </div>
      </div>

      {/* Table — ONLY CHANGE: added Trade column + buttons */}
      <div style={tableWrap as any}>
        <table style={tableStyle as any}>
          <colgroup>
            <col style={{ width: "6ch" }} />
            <col style={{ width: "9ch" }} />
            <col style={{ width: "9ch" }} />
            <col style={{ width: "9ch" }} />
            <col style={{ width: "9ch" }} />
            <col style={{ width: "7ch" }} />
            <col style={{ width: "12ch" }} />
            <col style={{ width: "14ch" }} /> {/* NEW */}
          </colgroup>
          <thead>
            <tr>
              <Th>Symbol</Th>
              <Th center>Last</Th>
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
                <td colSpan={8} style={{ padding: 6, color: "#666", textAlign: "center", borderTop: "1px solid #eee", fontSize: 12 }}>
                  No tickers selected.
                </td>
              </tr>
            ) : (
              (list as any[]).map((r) => {
                const hasBid = isNum(r.bid);
                const hasAsk = isNum(r.ask);
                const mid = (hasBid && hasAsk) ? (r.bid + r.ask) / 2 : undefined;
                const spread = (hasBid && hasAsk) ? (r.ask - r.bid) : undefined;
                const lastVal = isNum(r.last) ? r.last : mid;
                const stale = isStale(r.updatedAt, STALE_MS);
                const isSelected = r.symbol === selectedSym;
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
                    <Td num selected={isSelected}>{fmtPrice(r.bid)}</Td>
                    <Td num selected={isSelected}>{fmtPrice(r.ask)}</Td>
                    <Td num selected={isSelected}>{fmtPrice(mid)}</Td>
                    <Td num selected={isSelected}>{fmtPrice(spread)}</Td>
                    <Td selected={isSelected}>{fmtTime(r.updatedAt)}</Td>

                    {/* NEW: BUY/SELL */}
                    <Td selected={isSelected}>
                      <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            openTradeTicket(r.symbol, "BUY");
                          }}
                          style={{
                            padding: "2px 8px",
                            fontSize: 11,
                            background: "#dcfce7",
                            color: "#166534",
                            border: "1px solid #86efac",
                            borderRadius: 4,
                            cursor: "pointer",
                          }}
                        >
                          BUY
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            openTradeTicket(r.symbol, "SELL");
                          }}
                          style={{
                            padding: "2px 8px",
                            fontSize: 11,
                            background: "#fce7f3",
                            color: "#831843",
                            border: "1px solid #fda4af",
                            borderRadius: 4,
                            cursor: "pointer",
                          }}
                        >
                          SELL
                        </button>
                      </div>
                    </Td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* NEW: Trade Ticket */}
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
function tryJSON(s: string) { try { return JSON.parse(s); } catch { return undefined; } }
function tryJSONFromFirstBrace(s: string) { const i = s.indexOf("{"); if (i < 0) return undefined; try { return JSON.parse(s.slice(i)); } catch { return undefined; } }
function numberToISO(n: number) { const ms = n < 2e10 ? n * 1000 : n; return new Date(ms).toISOString(); }
function num(v: any) { const n = Number(v); return Number.isFinite(n) ? n : undefined; }
function isNum(v: any) { return typeof v === "number" && Number.isFinite(v); }
const priceFmt = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function fmtPrice(v: any) { return isNum(v) ? priceFmt.format(v) : "—"; }
function fmtTime(iso: any) { if (!iso) return ""; try { return new Date(iso).toLocaleTimeString([], { hour12: false }); } catch { return String(iso); } }
function isStale(iso: any, ms: number) { if (!iso) return true; try { const t = typeof iso === "string" ? Date.parse(iso) : iso; return (Date.now() - t) > ms; } catch { return false; } }
function shallowEqualQuote(a: any, b: any) { return a.bid === b.bid && a.ask === b.ask && a.updatedAt === b.updatedAt; }
function shallowEqualTrade(a: any, b: any) { return a.last === b.last && a.updatedAt === b.updatedAt; }
function fastExtract(topic: string, data: any) {
  const parts = topic.split(".");
  if (parts.length < 4) return null;
  const kind = parts[2] === "quote" ? "quote" : (parts[2] === "trade" ? "trade" : "");
  const symbolFromTopic = parts.slice(3).join(".");
  const inner = (data && typeof data.data === "object") ? data.data : data;
  const symbol = (data.symbol || inner.symbol || symbolFromTopic || "").toString().toUpperCase();
  if (!symbol) return null;
  let ts: any = inner.timestamp || data.timestamp;
  if (typeof ts === "number") ts = numberToISO(ts);
  if (typeof ts === "string" && /^\d+$/.test(ts)) ts = numberToISO(Number(ts));
  if (kind === "quote") {
    const bid = num(inner.bidPrice ?? inner.bp ?? inner.bid);
    const ask = num(inner.askPrice ?? inner.ap ?? inner.ask);
    return { kind, symbol, bid, ask, ts };
  }
  if (kind === "trade") {
    const last = num(inner.lastPrice ?? inner.price ?? inner.lp ?? inner.p ?? inner.close ?? inner.last);
    return { kind, symbol, last, ts };
  }
  const bid = num(inner.bidPrice ?? inner.bp ?? inner.bid);
  const ask = num(inner.askPrice ?? inner.ap ?? inner.ask);
  const last = num(inner.lastPrice ?? inner.price ?? inner.lp ?? inner.p ?? inner.close ?? inner.last);
  if (bid != null || ask != null) return { kind: "quote", symbol, bid, ask, ts };
  if (last != null) return { kind: "trade", symbol, last, ts };
  return null;
}
function normalizeGeneric(o: any) {
  const out: any[] = [];
  const topic = o.topic || o.t || o.key;
  let topicKind = "", topicSym = "";
  if (typeof topic === "string" && topic.startsWith("md.")) {
    const parts = topic.split(".");
    if (parts.length >= 4) { topicKind = parts[2]; topicSym = parts.slice(3).join("."); }
  }
  const payload = (o.data && typeof o.data === "object") ? o.data : o;
  const inner = (payload.data && typeof payload.data === "object") ? payload.data : payload;
  const symbol = (payload.symbol || inner.symbol || topicSym || "").toString().toUpperCase();
  if (!symbol) return out;
  const rawKind = (String(payload.type || payload.event || payload.ev || topicKind || "")).toLowerCase();
  let kind = rawKind.includes("trade") || rawKind === "t" || rawKind === "last" ? "trade"
    : rawKind.includes("quote") ? "quote"
    : (topicKind === "trade" || topicKind === "quote" ? topicKind : "");
  const bid = num(inner.bidPrice ?? inner.bp ?? inner.bid);
  const ask = num(inner.askPrice ?? inner.ap ?? inner.ask);
  const last = num(inner.lastPrice ?? inner.price ?? inner.lp ?? inner.p ?? inner.close ?? inner.last);
  let ts: any = inner.timestamp ?? payload.timestamp;
  if (typeof ts === "number") ts = numberToISO(ts);
  if (typeof ts === "string" && /^\d+$/.test(ts)) ts = numberToISO(Number(ts));
  if (!kind) {
    if (bid != null || ask != null) kind = "quote";
    else if (last != null) kind = "trade";
    else return out;
  }
  if (kind === "quote") out.push({ kind, symbol, bid, ask, ts });
  else if (kind === "trade") out.push({ kind, symbol, last, ts });
  return out;
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
function toggle(on: boolean) {
  return {
    fontSize: 11,
    padding: "4px 8px",
    borderRadius: 6,
    border: on ? "2px solid #1e90ff" : "1px solid #ccc",
    background: on ? "#eef6ff" : "#fff",
    cursor: "pointer",
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
function Th({ children, center }: { children: any; center?: boolean }) {
  return (
    <th
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