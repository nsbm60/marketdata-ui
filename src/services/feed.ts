// marketdata-ui/src/services/feed.ts
// TypeScript version of the streaming feed used by App.tsx.
// Uses the canonical WS URL from src/ws/SocketConfig.ts.

import { WS_URL } from "../ws/SocketConfig";

export type NormalizedRow = {
  symbol: string;
  last: number | string | "";
  bid: number | string | "";
  ask: number | string | "";
  iv?: number | string | "";
  delta?: number | string | "";
  gamma?: number | string | "";
  theta?: number | string | "";
  vega?: number | string | "";
  updatedAt: string;
};

/** Safely JSON-parse a string; returns undefined on failure */
function tryJson(str: string): any | undefined {
  try {
    return JSON.parse(str);
  } catch {
    return undefined;
  }
}

/** Pick the first present key; supports dotted paths (e.g. "data.bidPrice") */
function pick(obj: any, ...paths: string[]): any {
  for (const path of paths) {
    const parts = path.split(".");
    let v: any = obj;
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
export function normalizeOption(any: unknown): NormalizedRow | null {
  let o: any = any;

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
    "symbol",
    "sym",
    "ticker",
    "S",
    "data.symbol",
    "data.data.symbol"
  );

  // Prices — supports both flat and nested payloads
  const last = pick(
    o,
    "p",
    "price",
    "last",
    "lastPrice",
    "data.last",
    "data.price",
    "data.lastPrice",
    "data.data.last",
    "data.data.price",
    "data.data.lastPrice"
  );

  const bid = pick(
    o,
    "bid",
    "bidPrice",
    "b",
    "data.bid",
    "data.bidPrice",
    "data.data.bid",
    "data.data.bidPrice"
  );

  const ask = pick(
    o,
    "ask",
    "askPrice",
    "a",
    "data.ask",
    "data.askPrice",
    "data.data.ask",
    "data.data.askPrice"
  );

  const iv = pick(o, "iv", "impliedVol", "greeks.iv", "data.data.iv");
  const delta = pick(o, "delta", "greeks.delta", "data.data.delta");
  const gamma = pick(o, "gamma", "greeks.gamma", "data.data.gamma");
  const theta = pick(o, "theta", "greeks.theta", "data.data.theta");
  const vega = pick(o, "vega", "greeks.vega", "data.data.vega");

  let ts: any = pick(
    o,
    "t",
    "timestamp",
    "updatedAt",
    "data.timestamp",
    "data.updatedAt",
    "data.data.timestamp"
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

  const hasPrice = [last, bid, ask].some((v) => v !== undefined);
  if (!symbol && !hasPrice) return null;

  return {
    symbol: String(symbol || ""),
    last: last ?? "",
    bid: bid ?? "",
    ask: ask ?? "",
    iv: iv ?? "",
    delta: delta ?? "",
    gamma: gamma ?? "",
    theta: theta ?? "",
    vega: vega ?? "",
    updatedAt: ts,
  };
}

/** Start the stream; returns a stop function */
export function startFeed(
  onRow: (row: NormalizedRow) => void,
  onRaw?: (line: string) => void
): () => void {
  const ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    // No auto-subscribe here; your UI drives subscribe messages elsewhere
    // Keep this minimal so App.tsx doesn’t need to pass wsUrl/config.
  };

  ws.onmessage = (msg: MessageEvent) => {
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