import { useEffect, useMemo, useRef, useState } from "react";

/**
 * WatchList — compact columns (content-based), minimal widths in `ch`.
 * - Numeric columns widened ~20% to safely fit 4-figure prices with decimals.
 */

const DEFAULT_WS = "ws://localhost:8088/ws";
const CHANNELS = ["equity.quotes", "equity.trades"];
const LS_APPLIED = "wl.applied";
const LS_INPUT   = "wl.input";

export default function WatchList({ wsUrl, feedRaw }) {
  const externalFeed = Array.isArray(feedRaw);

  useEffect(() => {
    const id = "wl-top-anchor";
    if (!document.getElementById(id)) {
      const style = document.createElement("style");
      style.id = id;
      style.textContent = `
        html, body, #root { height: 100%; }
        #root, .app-root { display: block !important; align-items: initial !important; justify-content: initial !important; }
        body { margin: 0; }
      `;
      document.head.appendChild(style);
    }
  }, []);

  /* ---------------- symbols + input ---------------- */
  const [input, setInput] = useState(() => localStorage.getItem(LS_INPUT) ?? "");
  const [symbols, setSymbols] = useState(() => {
    const saved = localStorage.getItem(LS_APPLIED);
    return saved ? parseSymbols(saved) : [];
  });
  useEffect(() => { localStorage.setItem(LS_INPUT, input); }, [input]);

  /* ---------------- websocket ---------------- */
  const [wsStatus, setWsStatus] = useState("idle");
  const [wsFrames, setWsFrames] = useState([]);
  const wsRef = useRef(null);
  const lastSubsRef = useRef({ channels: CHANNELS, symbols: [] });

  const sendJson = (obj) => {
    try {
      const s = wsRef.current;
      if (s && s.readyState === WebSocket.OPEN) s.send(JSON.stringify(obj));
    } catch {}
  };

  const doSubscribe = (syms) => {
    const prev = lastSubsRef.current;
    if (prev.symbols.length) {
      sendJson({ type: "unsubscribe", channels: prev.channels, symbols: prev.symbols });
    }
    if (syms.length) {
      sendJson({ type: "subscribe", channels: CHANNELS, symbols: syms });
      lastSubsRef.current = { channels: CHANNELS, symbols: syms };
    } else {
      lastSubsRef.current = { channels: CHANNELS, symbols: [] };
    }
  };

  useEffect(() => {
    if (externalFeed) return;

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
          if (symbols.length) doSubscribe(symbols);
        };

        ws.onmessage = (ev) => {
          const pushText = (text) => setWsFrames((prev) => {
            const next = [text, ...prev];
            if (next.length > 5000) next.length = 5000;
            return next;
          });
          if (ev.data instanceof Blob) {
            ev.data.text().then(pushText).catch(() => {});
          } else if (ev.data instanceof ArrayBuffer) {
            try {
              const text = new TextDecoder("utf-8").decode(new Uint8Array(ev.data));
              pushText(text);
            } catch {}
          } else {
            pushText(String(ev.data));
          }
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
        const prev = lastSubsRef.current;
        if (prev.symbols.length) sendJson({ type: "unsubscribe", channels: prev.channels, symbols: prev.symbols });
        wsRef.current?.close();
      } catch {}
    };
  }, [externalFeed, wsUrl, symbols]);

  /* ---------------- manual paste (optional) ---------------- */
  const [manualBuf, setManualBuf] = useState("");
  const [manualFrames, setManualFrames] = useState([]);
  const ingestManual = () => {
    const lines = manualBuf.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    if (lines.length) {
      setManualFrames(prev => [...lines.reverse(), ...prev].slice(0, 5000));
      setManualBuf("");
    }
  };
  const clearManual = () => setManualFrames([]);

  /* ---------------- feed selection ---------------- */
  const frames = manualFrames.length > 0
    ? manualFrames
    : (externalFeed ? (feedRaw || []) : wsFrames);

  /* ---------------- parsing ---------------- */
  const { rows, stats } = useMemo(() => computeRows(frames), [frames]);

  const list = useMemo(() => {
    if (symbols.length === 0) return [];
    const want = new Set(symbols.map(s => s.toUpperCase()));
    const arr = [];
    for (const v of rows.values()) {
      if (want.has(String(v.symbol || "").toUpperCase())) arr.push(v);
    }
    arr.sort((a, b) => a.symbol.localeCompare(b.symbol));
    return arr;
  }, [rows, symbols]);

  const applySymbols = (next) => {
    const norm = Array.from(new Set(next.map(s => s.toUpperCase()))).sort();
    setSymbols(norm);
    if (norm.length === 0) localStorage.removeItem(LS_APPLIED);
    else localStorage.setItem(LS_APPLIED, norm.join(","));
    if (!externalFeed && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      doSubscribe(norm);
    }
  };

  const actAdd = () => {
    const add = parseSymbols(input);
    const next = Array.from(new Set([...symbols, ...add]));
    applySymbols(next);
    setInput("");
  };
  const actReplace = () => {
    const next = parseSymbols(input);
    applySymbols(next);
    setInput("");
  };
  const actClear = () => {
    applySymbols([]);
    setInput("");
  };
  const actPurgeSaved = () => {
    localStorage.removeItem(LS_APPLIED);
    localStorage.removeItem(LS_INPUT);
    setInput("");
    applySymbols([]);
  };
  const removeOne = (sym) => {
    const target = String(sym).toUpperCase();
    const next = symbols.filter(s => s.toUpperCase() !== target);
    applySymbols(next);
  };

  /* ---------------- render ---------------- */
  return (
    <div style={outerShell}>
      {/* Header / Controls */}
      <div style={headerBox}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>Equity WatchList</div>
          {!externalFeed && (
            <span style={{ marginLeft: "auto", fontSize: 12, color: wsStatus === "open" ? "#137333" : "#666" }}>
              WS: {wsStatus}
            </span>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Tickers (comma/space). Example: NVDA AAPL META"
            title="Enter one or more tickers, then click Add or Replace"
            style={inputStyle}
          />
          <button onClick={actAdd}         title="Add these tickers to the existing set"         style={btn()}>Add</button>
          <button onClick={actReplace}     title="Replace the watchlist with only these tickers" style={btn()}>Replace</button>
          <button onClick={actClear}       title="Unsubscribe and clear the watchlist"           style={btn({ variant: "secondary" })}>Clear</button>
          <button onClick={actPurgeSaved}  title="Erase any saved tickers and input"             style={linkBtn()}>Purge saved</button>
        </div>

        {/* Chips */}
        {symbols.length > 0 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {symbols.map(sym => (
              <span key={sym} style={chip()}>
                {sym}
                <button
                  onClick={() => removeOne(sym)}
                  title={`Remove ${sym}`}
                  style={chipX()}
                  aria-label={`Remove ${sym}`}
                >×</button>
              </span>
            ))}
          </div>
        )}

        {/* Diagnostics */}
        <div style={{ fontSize: 11, color: "#333", display: "flex", gap: 16, flexWrap: "wrap" }}>
          <span><b>feedRaw:</b> {frames.length}</span>
          <span><b>parsed:</b> Q={stats.parsedQuotes} T={stats.parsedTrades}</span>
          <span><b>symbols:</b> {rows.size}</span>
        </div>

        {/* Manual paste */}
        <details>
          <summary style={{ cursor: "pointer", fontSize: 12 }}>Manual Paste (JSON lines or array)</summary>
          <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
            <textarea
              value={manualBuf}
              onChange={(e) => setManualBuf(e.target.value)}
              rows={5}
              placeholder='{"topic":"md.equity.quote.NVDA","data":{"type":"quote","symbol":"NVDA","data":{"bidPrice":196.65,"askPrice":196.68,"timestamp":"2025-11-05T22:52:42Z"}}}'
              style={textareaStyle}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={ingestManual} style={btn()}>Ingest</button>
              <button onClick={clearManual} style={btn({ variant: "secondary" })}>Clear Manual</button>
            </div>
          </div>
        </details>
      </div>

      {/* Table wrapper stops stretching; enables horizontal scroll if needed */}
      <div style={tableWrap}>
        <table style={tableStyle}>
          <colgroup>
            <col style={{ width: "5ch" }} />   {/* Symbol */}
            <col style={{ width: "9ch" }} />   {/* Last  (was 7ch) */}
            <col style={{ width: "9ch" }} />   {/* Bid   (was 7ch) */}
            <col style={{ width: "9ch" }} />   {/* Ask   (was 7ch) */}
            <col style={{ width: "9ch" }} />   {/* Mid   (was 7ch) */}
            <col style={{ width: "7ch" }} />   {/* Spread (was 6ch) */}
            <col style={{ width: "12ch" }} />  {/* Updated */}
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
            {list.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ padding: 6, color: "#666", textAlign: "center", borderTop: "1px solid #eee", fontSize: 12 }}>
                  {symbols.length === 0
                    ? "No tickers selected."
                    : (frames.length === 0
                        ? "Connected — waiting for quotes/trades…"
                        : "Received data, but no actionable quotes/trades yet.")}
                </td>
              </tr>
            ) : (
              list.map((r) => {
                const hasBid = isNum(r.bid);
                const hasAsk = isNum(r.ask);
                const mid = (hasBid && hasAsk) ? (r.bid + r.ask) / 2 : undefined;
                const spread = (hasBid && hasAsk) ? (r.ask - r.bid) : undefined;
                const lastVal = isNum(r.last) ? r.last : mid;

                return (
                  <tr key={r.symbol}>
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

/* =================== parsing =================== */

function computeRows(feedRaw) {
  const rows = new Map();
  const stats = { raw: 0, parsedQuotes: 0, parsedTrades: 0, symbols: 0 };

  if (!Array.isArray(feedRaw) || feedRaw.length === 0) return { rows, stats };

  const recent = feedRaw.slice(0, 800);
  stats.raw = recent.length;

  // oldest -> newest so latest wins
  for (let i = recent.length - 1; i >= 0; i--) {
    const frame = recent[i];
    const events = parseFrame(frame);
    for (const ev of events) {
      const prev = rows.get(ev.symbol) || { symbol: ev.symbol };
      if (ev.kind === "quote") {
        stats.parsedQuotes++;
        rows.set(ev.symbol, {
          ...prev,
          bid: ev.bid ?? prev.bid,
          ask: ev.ask ?? prev.ask,
          updatedAt: ev.ts ?? prev.updatedAt,
        });
      } else if (ev.kind === "trade") {
        stats.parsedTrades++;
        rows.set(ev.symbol, {
          ...prev,
          last: ev.last ?? prev.last,
          updatedAt: ev.ts ?? prev.updatedAt,
        });
      }
    }
  }

  stats.symbols = rows.size;
  return { rows, stats };
}

function parseFrame(frame) {
  const out = [];
  if (frame == null) return out;

  const s = typeof frame === "string" ? frame : JSON.stringify(frame);

  const j = tryJSON(s);
  if (j !== undefined) {
    const arr = Array.isArray(j) ? j : [j];
    for (const o of arr) out.push(...normalize(o));
    return out;
  }

  const lines = s.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  if (lines.length > 1) {
    for (const ln of lines) {
      const jj = tryJSON(ln);
      if (jj !== undefined) {
        const arr = Array.isArray(jj) ? jj : [jj];
        for (const o of arr) out.push(...normalize(o));
      } else {
        const i = ln.indexOf("{");
        if (i >= 0) {
          const j2 = tryJSON(ln.slice(i));
          if (j2 !== undefined) {
            const arr = Array.isArray(j2) ? j2 : [j2];
            for (const o of arr) out.push(...normalize(o));
          }
        }
      }
    }
    return out;
  }

  const i = s.indexOf("{");
  if (i >= 0) {
    const j2 = tryJSON(s.slice(i));
    if (j2 !== undefined) {
      const arr = Array.isArray(j2) ? j2 : [j2];
      for (const o of arr) out.push(...normalize(o));
      return out;
    }
  }

  return out;
}

function normalize(o) {
  if (!o || typeof o !== "object") return [];

  let topicKind = "", topicSym = "";
  const topic = o.topic || o.t || o.key;
  if (typeof topic === "string" && topic.startsWith("md.")) {
    const parts = topic.split(".");
    if (parts.length >= 4) {
      topicKind = parts[2];
      topicSym  = parts.slice(3).join(".");
    }
  }

  const payload = (o.data && typeof o.data === "object") ? o.data : o;
  const inner   = (payload.data && typeof payload.data === "object") ? payload.data : payload;

  const flat = {};
  deepCollect(payload, "", flat);
  deepCollect(inner, "", flat);

  const symbol = first(flat, ["symbol","ticker","s","sym","underlying"]) || topicSym;
  if (!symbol) return [];

  const rawKind = (String(first(flat, ["type","event","ev"]) || topicKind || "")).toLowerCase();
  let kind =
    rawKind.includes("trade") || rawKind === "t" || rawKind === "last" ? "trade" :
    rawKind.includes("quote") ? "quote" :
    (topicKind === "trade" || topicKind === "quote" ? topicKind : "");

  const bid  = toNum(first(flat, ["bidprice","bp","bid"]));
  const ask  = toNum(first(flat, ["askprice","ap","ask"]));
  const last = toNum(first(flat, ["lastprice","price","p","lp","close","last"]));

  const tsRaw = first(flat, ["timestamp","time","ts","t","updatedat"]);
  const ts = toISO(tsRaw);

  if (!kind) {
    if (bid != null || ask != null) kind = "quote";
    else if (last != null)          kind = "trade";
    else return [];
  }

  if (kind === "quote") return [{ kind, symbol: String(symbol), bid, ask, ts }];
  if (kind === "trade") return [{ kind, symbol: String(symbol), last, ts }];
  return [];
}

/* =================== utils + styles =================== */

function parseSymbols(s) {
  return String(s || "")
    .split(/[\s,]+/)
    .map(x => x.trim().toUpperCase())
    .filter(Boolean);
}

function deepCollect(obj, prefix, out) {
  if (!obj || typeof obj !== "object") return;
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) deepCollect(obj[i], prefix, out);
    return;
  }
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    const key = (prefix ? prefix + "." : "") + k;
    if (v && typeof v === "object") deepCollect(v, key, out);
    else out[key.toLowerCase().replace(/\s+/g, "")] = v;
    out[k.toLowerCase()] = v;
  }
}

function first(dict, keys) {
  for (const k of keys) {
    const v = dict[k.toLowerCase()];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

function tryJSON(s) { try { return JSON.parse(s); } catch { return undefined; } }

function toISO(t) {
  if (t == null || t === "") return undefined;
  if (typeof t === "number") {
    const ms = t < 2e10 ? t * 1000 : t;
    return new Date(ms).toISOString();
  }
  if (typeof t === "string" && /^\d+$/.test(t)) {
    const n = Number(t);
    const ms = n < 2e10 ? n * 1000 : n;
    return new Date(ms).toISOString();
  }
  if (typeof t === "string") return t;
  return undefined;
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
function isNum(v) { return typeof v === "number" && Number.isFinite(v); }

const priceFmt = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function fmtPrice(v) { return isNum(v) ? priceFmt.format(v) : ""; }

function fmtTime(iso) {
  if (!iso) return "";
  try { return new Date(iso).toLocaleTimeString([], { hour12: false }); }
  catch { return String(iso); }
}

/* ---- compact visuals ---- */

const outerShell = {
  alignSelf: "flex-start",
  justifySelf: "start",
  margin: 0,
  background: "#fff",
  color: "#111",
  border: "1px solid #ddd",
  borderRadius: 8,
  overflow: "hidden",
  maxWidth: "100%",
};

const headerBox = {
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

const textareaStyle = {
  width: "100%",
  fontFamily: "ui-monospace, Menlo, monospace",
  fontSize: 11,
  padding: 6,
  border: "1px solid #ddd",
  borderRadius: 6,
  color: "#111",
  background: "#fff",
};

const tableWrap = {
  overflowX: "auto",
  maxWidth: "100%",
};

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
        background: "#fff"
      }}
      title={typeof children === "string" ? children : undefined}
    >
      {children ?? ""}
    </td>
  );
}