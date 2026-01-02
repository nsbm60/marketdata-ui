// Minimal wire types (loose enough to iterate, tighten later)

export type WireMessage =
  | ReadyMsg
  | PongMsg
  | SubAckMsg
  | ControlAck
  | TickEnvelope
  | Record<string, unknown>; // fallback for anything unexpected

export interface ReadyMsg {
  type: "ready";
  ts?: number;
}

export interface PongMsg {
  type: "pong";
  id?: string;
}

export interface SubAckMsg {
  type: "sub.ack";
  op: "subscribe" | "unsubscribe";
  channels?: string[];
  symbols?: string[];
}

export interface ControlAck {
  type: "control.ack";
  id?: string;
  op: string;                 // e.g. "find_and_subscribe"
  ok: boolean;
  error?: string | null;
  data?: unknown;             // tighten per-op as we stabilize
}

export interface TickEnvelope {
  // Matches your logs: {"topic":"md.option.quote.SYMBOL", "data":{...}}
  topic: string;              // e.g. "md.option.quote.NVDA.2025-01-03.C.177_50"
  data: {
    type: string;             // "quote" | "trade" | "lastTrade" | etc.
    symbol?: string;          // parsed by server; may be present
    data?: unknown;           // payload (bid/ask/size/ts etc.)
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

// Outbound control shape (loose)
export interface ControlRequest {
  type: "control";
  op: string;
  id?: string;
  // plus arbitrary filters like underlying, band_pct, etc.
  [k: string]: unknown;
}