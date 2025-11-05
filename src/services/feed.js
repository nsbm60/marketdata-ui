// marketdata-ui/src/services/feed.js

export const USE_MOCK = false;

/** Safely JSON-parse a string; returns undefined on failure */
function tryJson(str) {
  try { return JSON.parse(str); } catch { return undefined; }
}

/** Pick the first present key; supports dotted paths (e.g. "data.bidPrice") */
function pick(obj, ...paths) {
  for (const path of paths) {
    const parts = path.split(".");
    let v = obj;
    for (const p of parts) {
      if (v && Object.prototype.hasOwnProperty.call(v, p)) {
        v = v[p];
      } else {
        v = undefined;
        break;
      }
    }
    if (v !== undefined && v !== null) return v;
  }
  return undefined;
}

/** Map *any* option/equity feed message to a UI row */
export function normalizeOption(any) {
  let o = any;

  // Strings may be JSON, NDJSON, or "topic {json}"
  if (typeof o === "string") {
    const brace = o.indexOf("{");
    if (brace >= 0) {
      const parsed = tryJson(o.slice(brace));
      if (parsed !== undefined) o = parsed;
      else return null;
    } else {
      return null;
    }
  }

  if (!o || typeof o !== "object") return null;

  // Ignore ready / heartbeat
  const typ = (pick(o, "type", "ev", "event") || "").toString().toLowerCase();
  if (typ === "ready" || typ.includes("heartbeat")) return null;

  // Unified mapping of symbol
  const symbol = pick(
    o,
    "symbol", "sym", "ticker", "S",
    "data.symbol", "data.data.symbol"
  );

  // Prices — supports both flat and nested payloads
  const last = pick(
    o,
    "p", "price", "last", "lastPrice",
    "data.last", "data.price", "data.lastPrice",
    "data.data.last", "data.data.price", "data.data.lastPrice"
  );

  const bid = pick(
    o,
    "bid", "bidPrice", "b",
    "data.bid", "data.bidPrice",
    "data.data.bid", "data.data.bidPrice"
  );

  const ask = pick(
    o,
    "ask", "askPrice", "a",
    "data.ask", "data.askPrice",
    "data.data.ask", "data.data.askPrice"
  );

  const iv    = pick(o, "iv", "impliedVol", "greeks.iv", "data.data.iv");
  const delta = pick(o, "delta", "greeks.delta", "data.data.delta");
  const gamma = pick(o, "gamma", "greeks.gamma", "data.data.gamma");
  const theta = pick(o, "theta", "greeks.theta", "data.data.theta");
  const vega  = pick(o, "vega", "greeks.vega", "data.data.vega");

  let ts = pick(
    o,
    "t", "timestamp", "updatedAt",
    "data.timestamp", "data.updatedAt", "data.data.timestamp"
  );

  if (typeof ts === "number") {
    ts = new Date(ts < 2e10 ? ts * 1000 : ts).toISOString();
  } else if (typeof ts === "string") {
    if (/^\d+$/.test(ts)) {
      const n = Number(ts);
      ts = new Date(n < 2e10 ? n * 1000 : n).toISOString();
    }
  } else {
    ts = new Date().toISOString();
  }

  const hasPrice = [last, bid, ask].some(v => v !== undefined);
  if (!symbol && !hasPrice) return null;

  return {
    symbol: String(symbol || ""),
    last:   last ?? "",
    bid:    bid  ?? "",
    ask:    ask  ?? "",
    iv:     iv   ?? "",
    delta:  delta?? "",
    gamma:  gamma?? "",
    theta:  theta?? "",
    vega:   vega ?? "",
    updatedAt: ts,
  };
}

/** Stream data from backend */
export function startFeed(onRow, onRaw) {
  if (USE_MOCK) {
    const id = setInterval(() => {
      const row = normalizeOption({
        symbol: "NVDA",
        last: 100, bid: 99.5, ask: 100.5,
        iv: 0.33, delta: 0.5
      });
      if (row) onRow(row);
    }, 500);
    return () => clearInterval(id);
  }

  // ---- Configure your subscription here ----
  const SUB_CHANNELS = ["equity.quotes"];      // backend acknowledged this channel
  const SUB_SYMBOLS  = ["NVDA"];               // <- add more symbols as needed
  // ------------------------------------------

  const ws = new WebSocket("ws://localhost:8088/ws");

  ws.onopen = () => {
    console.log("WS open");
    // Subscribe with channels + symbols (your server sent sub.ack for this shape)
    ws.send(JSON.stringify({
      type: "subscribe",
      channels: SUB_CHANNELS,
      symbols: SUB_SYMBOLS
    }));
  };

  ws.onmessage = (msg) => {
    const raw = typeof msg.data === "string" ? msg.data : JSON.stringify(msg.data);
    if (onRaw) onRaw(raw);

    // Parse single JSON, arrays, or NDJSON
    const parsed = tryJson(raw);
    const frames = parsed
      ? (Array.isArray(parsed) ? parsed : [parsed])
      : raw.split(/\r?\n/).map(tryJson).filter(Boolean);

    for (const f of frames) {
      const row = normalizeOption(f);
      if (row) onRow(row);
    }
  };

  ws.onerror = (e) => console.error("WS error", e);
  ws.onclose = (e) => console.warn("WS closed", e.code, e.reason);

  return () => ws.close();
}