// marketdata-ui/src/WatchList.jsx
import { useEffect, useMemo, useRef, useState } from "react";

const DEFAULT_WS = "ws://localhost:8088/ws";
const CHANNELS = ["equity.quotes", "equity.trades"];

const LS_APPLIED = "wl.applied";
const LS_INPUT   = "wl.input";

const STALE_MS    = 15_000;
const MAX_FPS     = 15;
const MAX_QUEUE   = 5000;
const BATCH_CHUNK = 1000;

export default function WatchList({ wsUrl }) {
  /* ---------------- input + symbols ---------------- */
  const [input, setInput] = useState(() => localStorage.getItem(LS_INPUT) ?? "");
  const [symbols, setSymbols] = useState(() => {
    const saved = localStorage.getItem(LS_APPLIED);
    return saved ? parseSymbols(saved) : [];
  });
  useEffect(() => { localStorage.setItem(LS_INPUT, input); }, [input]);

  /* ---------------- pause/resume (true unsubscribe) ---------------- */
  const [paused, setPaused] = useState(false);

  /* ---------------- caches and WS plumbing ---------------- */
  const cacheRef = useRef(new Map()); // {SYM -> {symbol,last?,bid?,ask?,updatedAt?}}
  const [wsStatus, setWsStatus] = useState("idle");
  const wsRef = useRef(null);
  const queueRef = useRef([]);
  const subsSetRef = useRef(new Set()); // uppercased tickers

  // render throttle
  const [version, setVersion] = useState(0);
  const lastPaintRef = useRef(0);
  const rafRef = useRef(0);
  const needPaintRef = useRef(false);

  const schedule = () => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(tick);
  };

  function processBatch(lines) {
    let anyChanged = false;
    const cache = cacheRef.current;
    const subs  = subsSetRef.current;

    for (let i = 0; i < lines.length; i++) {
      const s = lines[i];
      if (!s) continue;

      const obj = tryJSON(s) ?? tryJSONFromFirstBrace(s);
      if (!obj) continue;

      const t = obj.topic;
      const d = obj.data && typeof obj.data === "object" ? obj.data : obj;

      if (typeof t === "string" && t.startsWith("md.equity.")) {
        const info = fastExtract(t, d);
        if (!info) continue;
        if (subs.size && !subs.has(info.symbol)) continue;

        const prev = cache.get(info.symbol) || { symbol: info.symbol };
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

      // generic fallback
      const events = normalizeGeneric(obj);
      for (const ev of events) {
        if (subs.size && !subs.has(ev.symbol)) continue;
        const prev = cache.get(ev.symbol) || { symbol: ev.symbol };
        if (ev.kind === "quote") {
          const next = {
            ...prev, bid: ev.bid ?? prev.bid, ask: ev.ask ?? prev.ask,
            updatedAt: ev.ts ?? prev.updatedAt,
          };
          if (!shallowEqualQuote(prev, next)) { cache.set(ev.symbol, next); anyChanged = true; }
          else cache.set(ev.symbol, next);
        } else if (ev.kind === "trade") {
          const next = {
            ...prev, last: ev.last ?? prev.last,
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

  const sendJson = (obj) => {
    try {
      const s = wsRef.current;
      if (s && s.readyState === WebSocket.OPEN) s.send(JSON.stringify(obj));
    } catch {}
  };

  const doSubscribe = (syms) => {
    const prev = Array.from(subsSetRef.current);
    if (prev.length) sendJson({ type: "unsubscribe", channels: CHANNELS, symbols: prev });

    const next = (syms || []).map((s) => s.toUpperCase());
    subsSetRef.current = new Set(next);

    if (!paused && next.length) sendJson({ type: "subscribe", channels: CHANNELS, symbols: next });
  };

  // WS lifecycle
  useEffect(() => {
    let alive = true;
    let retry;

    const openWS = () => {
      if (!alive) return;
      try {
        setWsStatus("connecting");
        const ws = new WebSocket(wsUrl || DEFAULT_WS);
        wsRef.current = ws;

        ws.onopen = () => {
          if (!alive) return;
          setWsStatus("open");
          if (!paused && symbols.length) doSubscribe(symbols);
        };

        ws.onmessage = (ev) => {
          if (paused) return;
          const push = (text) => { queueRef.current.push(text); schedule(); };
          if (ev.data instanceof Blob) ev.data.text().then(push).catch(() => {});
          else if (ev.data instanceof ArrayBuffer) {
            try { push(new TextDecoder("utf-8").decode(new Uint8Array(ev.data))); } catch {}
          } else push(String(ev.data));
        };

        ws.onerror = () => { try { ws.close(); } catch {} };
        ws.onclose = () => {
          if (!alive) return;
          setWsStatus("closed");
          retry = setTimeout(openWS, 1000);
        };
      } catch {
        retry = setTimeout(openWS, 1000);
      }
    };

    openWS();
    return () => {
      alive = false;
      if (retry) clearTimeout(retry);
      try {
        const prev = Array.from(subsSetRef.current);
        if (prev.length) sendJson({ type: "unsubscribe", channels: CHANNELS, symbols: prev });
        wsRef.current?.close();
      } catch {}
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    };
  }, [wsUrl, symbols, paused]);

  /* ---------------- actions ---------------- */
  const applySymbols = (next) => {
    const norm = Array.from(new Set(next.map((s) => s.toUpperCase()))).sort();
    setSymbols(norm);
    if (norm.length === 0) localStorage.removeItem(LS_APPLIED);
    else localStorage.setItem(LS_APPLIED, norm.join(","));

    doSubscribe(norm); // will no-op when paused

    // pre-seed rows
    const cache = cacheRef.current;
    for (const s of norm) if (!cache.has(s)) cache.set(s, { symbol: s });
    setVersion((v) => (v + 1) & 0xffff);
  };

  const actAdd       = () => { const add = parseSymbols(input); applySymbols(Array.from(new Set([...symbols, ...add]))); setInput(""); };
  const actReplace   = () => { applySymbols(parseSymbols(input)); setInput(""); };
  const actClear     = () => { applySymbols([]); setInput(""); };
  const actPurge     = () => {
    localStorage.removeItem(LS_APPLIED);
    localStorage.removeItem(LS_INPUT);
    setInput("");
    applySymbols([]);
    cacheRef.current = new Map();
    setVersion((v) => (v + 1) & 0xffff);
  };
  const togglePaused = () => {
    const next = !paused;
    setPaused(next);
    if (next) { doSubscribe([]); queueRef.current = []; } // pause => hard unsubscribe + clear queue
    else if (symbols.length) { doSubscribe(symbols); schedule(); }
  };
  const removeOne = (sym) => {
    const target = String(sym).toUpperCase();
    const next = symbols.filter((s) => s.toUpperCase() !== target);
    applySymbols(next);
  };

  /* ---------------- view model ---------------- */
  const list = useMemo(() => {
    const cache = cacheRef.current;
    return symbols.map((s) => cache.get(s) || { symbol: s });
  }, [symbols, version]);

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
    <div style={shell}>
      {/* Header / Controls */}
      <div style={header}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>Equity WatchList</div>
          <span style={{ marginLeft: "auto", fontSize: 12, color: wsStatus === "open" ? "#137333" : "#666" }}>
            WS: {wsStatus}
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Tickers (comma/space). Example: NVDA AAPL META"
            title="Enter one or more tickers, then click Add or Replace"
            style={inputStyle}
          />
          <button onClick={actAdd}       style={btn()}>Add</button>
          <button onClick={actReplace}   style={btn()}>Replace</button>
          <button onClick={actClear}     style={btn({ variant: "secondary" })}>Clear</button>
          <button onClick={actPurge}     style={linkBtn()}>Purge saved</button>

          <span style={{ marginLeft: "auto", fontSize: 12 }}>
            WatchList:&nbsp;
            <button onClick={togglePaused} style={toggle(!paused)}>
              {paused ? "Paused" : "Active"}
            </button>
          </span>
        </div>

        {symbols.length > 0 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {symbols.map((sym) => (
              <span key={sym} style={chip()}>
                {sym}
                <button onClick={() => removeOne(sym)} style={chipX()} aria-label={`Remove ${sym}`}>×</button>
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

      {/* Table */}
      <div style={tableWrap}>
        <table style={tableStyle}>
          <colgroup>
            <col style={{ width: "5ch" }} />
            <col style={{ width: "9ch" }} />
            <col style={{ width: "9ch" }} />
            <col style={{ width: "9ch" }} />
            <col style={{ width: "9ch" }} />
            <col style={{ width: "7ch" }} />
            <col style={{ width: "12ch" }} />
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
            </tr>
          </thead>
          <tbody>
            {symbols.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ padding: 6, color: "#666", textAlign: "center", borderTop: "1px solid #eee", fontSize: 12 }}>
                  No tickers selected.
                </td>
              </tr>
            ) : (
              list.map((r) => {
                const hasBid = isNum(r.bid);
                const hasAsk = isNum(r.ask);
                const mid = (hasBid && hasAsk) ? (r.bid + r.ask) / 2 : undefined;
                const spread = (hasBid && hasAsk) ? (r.ask - r.bid) : undefined;
                const lastVal = isNum(r.last) ? r.last : mid;
                const stale = isStale(r.updatedAt, STALE_MS);
                return (
                  <tr key={r.symbol} style={stale ? { opacity: 0.6 } : undefined}>
                    <Td mono>{r.symbol}</Td>
                    <Td num strong>{fmtPrice(lastVal)}</Td>
                    <Td num>{fmtPrice(r.bid)}</Td>
                    <Td num>{fmtPrice(r.ask)}</Td>
                    <Td num>{fmtPrice(mid)}</Td>
                    <Td num>{fmtPrice(spread)}</Td>
                    <Td>{fmtTime(r.updatedAt)}</Td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------------- helpers ---------------- */

function parseSymbols(s) {
  return String(s || "")
    .split(/[\s,]+/)
    .map((x) => x.trim().toUpperCase())
    .filter(Boolean);
}
function tryJSON(s) { try { return JSON.parse(s); } catch { return undefined; } }
function tryJSONFromFirstBrace(s) { const i = s.indexOf("{"); if (i < 0) return undefined; try { return JSON.parse(s.slice(i)); } catch { return undefined; } }
function numberToISO(n) { const ms = n < 2e10 ? n * 1000 : n; return new Date(ms).toISOString(); }
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : undefined; }
function isNum(v) { return typeof v === "number" && Number.isFinite(v); }
const priceFmt = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function fmtPrice(v) { return isNum(v) ? priceFmt.format(v) : "—"; }
function fmtTime(iso) { if (!iso) return ""; try { return new Date(iso).toLocaleTimeString([], { hour12: false }); } catch { return String(iso); } }
function isStale(iso, ms) { if (!iso) return true; try { const t = typeof iso === "string" ? Date.parse(iso) : iso; return (Date.now() - t) > ms; } catch { return false; } }
function shallowEqualQuote(a, b) { return a.bid === b.bid && a.ask === b.ask && a.updatedAt === b.updatedAt; }
function shallowEqualTrade(a, b) { return a.last === b.last && a.updatedAt === b.updatedAt; }
function fastExtract(topic, data) {
  // topic: md.equity.quote.SYM | md.equity.trade.SYM
  const parts = topic.split(".");
  if (parts.length < 4) return null;
  const kind = parts[2] === "quote" ? "quote" : (parts[2] === "trade" ? "trade" : "");
  const symbolFromTopic = parts.slice(3).join(".");
  const inner = (data && typeof data.data === "object") ? data.data : data;
  const symbol = (data.symbol || inner.symbol || symbolFromTopic || "").toString().toUpperCase();
  if (!symbol) return null;
  let ts = inner.timestamp || data.timestamp;
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
  if (last != null)               return { kind: "trade", symbol, last, ts };
  return null;
}
function normalizeGeneric(o) {
  const out = [];
  const topic = o.topic || o.t || o.key;
  let topicKind = "", topicSym = "";
  if (typeof topic === "string" && topic.startsWith("md.")) {
    const parts = topic.split(".");
    if (parts.length >= 4) { topicKind = parts[2]; topicSym = parts.slice(3).join("."); }
  }
  const payload = (o.data && typeof o.data === "object") ? o.data : o;
  const inner   = (payload.data && typeof payload.data === "object") ? payload.data : payload;

  const symbol = (payload.symbol || inner.symbol || topicSym || "").toString().toUpperCase();
  if (!symbol) return out;

  const rawKind = (String(payload.type || payload.event || payload.ev || topicKind || "")).toLowerCase();
  let kind = rawKind.includes("trade") || rawKind === "t" || rawKind === "last" ? "trade"
          : rawKind.includes("quote") ? "quote"
          : (topicKind === "trade" || topicKind === "quote" ? topicKind : "");

  const bid  = num(inner.bidPrice ?? inner.bp ?? inner.bid);
  const ask  = num(inner.askPrice ?? inner.ap ?? inner.ask);
  const last = num(inner.lastPrice ?? inner.price ?? inner.lp ?? inner.p ?? inner.close ?? inner.last);

  let ts = inner.timestamp ?? payload.timestamp;
  if (typeof ts === "number") ts = numberToISO(ts);
  if (typeof ts === "string" && /^\d+$/.test(ts)) ts = numberToISO(Number(ts));

  if (!kind) {
    if (bid != null || ask != null) kind = "quote";
    else if (last != null)          kind = "trade";
    else return out;
  }
  if (kind === "quote") out.push({ kind, symbol, bid, ask, ts });
  else if (kind === "trade") out.push({ kind, symbol, last, ts });
  return out;
}

/* ---- visuals (local only, no global leakage) ---- */
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

const tableWrap  = { overflowX: "auto", maxWidth: "100%" };
const tableStyle = {
  width: "auto",
  borderCollapse: "separate",
  borderSpacing: 0,
  tableLayout: "auto",
  background: "#fff",
  fontSize: 12,
  lineHeight: 1.2,
};

function btn({ variant } = {}) {
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
function toggle(on) {
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
function Th({ children, center }) {
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
function Td({ children, mono, num, strong }) {
  return (
    <td
      style={{
        padding: "4px 6px",
        borderBottom: "1px solid #eee",
        borderRight: "1px solid #eee",
        fontFamily: mono ? "ui-monospace, SFMono-Regular, Menlo, monospace" : "inherit",
        textAlign: num ? "right" : "left",
        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        color: "#111",
        fontWeight: strong ? 600 : 600,
        background: "#fff",
      }}
      title={typeof children === "string" ? children : undefined}
    >
      {children ?? ""}
    </td>
  );
}