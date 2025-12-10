/**
 * Single shared WebSocket for the whole app.
 * - Auto-detect ws(s)://<host>/ws from window.location
 * - One connection, many listeners
 * - Promise-style control acks (correlated by "id")
 * - Reconnect with backoff; queues outbound until connected
 */

import type { WireMessage, ControlAck, ControlRequest, TickEnvelope } from "./ws-types";

type MessageHandler = (msg: WireMessage) => void;
type TickHandler = (tick: TickEnvelope) => void;

class SocketHub {
  private socket: WebSocket | null = null;
  private connecting = false;
  private reconnectAttempts = 0;
  private sendQueue: string[] = [];

  private messageHandlers = new Set<MessageHandler>();
  private tickHandlers = new Set<TickHandler>();

  // control.ack correlation by id
  private pendingAcks = new Map<
    string,
    { resolve: (ack: ControlAck) => void; reject: (err: Error) => void; timeout: number }
  >();

  // ---- Public API ---------------------------------------------------------

  /** Ensure there is a connected socket (idempotent). */
  public connect(): void {
    if (
      this.socket &&
      (this.socket.readyState === WebSocket.OPEN ||
        this.socket.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }
    if (this.connecting) return;

    this.connecting = true;

    const wsUrl = this.resolveWsUrl();
    const ws = new WebSocket(wsUrl);
    this.socket = ws;

    ws.onopen = () => {
      this.connecting = false;
      this.reconnectAttempts = 0;
      // flush queue
      while (this.sendQueue.length && ws.readyState === WebSocket.OPEN) {
        ws.send(this.sendQueue.shift()!);
      }
    };

    ws.onmessage = (ev) => this.handleInbound(ev.data as string);
    ws.onerror = () => {
      // errors are also followed by close in most cases; let onclose handle retry
    };
    ws.onclose = () => {
      this.connecting = false;
      this.scheduleReconnect();
    };
  }

  /** Add/remove listeners for ALL inbound messages. */
  public onMessage(fn: MessageHandler): void {
    this.messageHandlers.add(fn);
  }
  public offMessage(fn: MessageHandler): void {
    this.messageHandlers.delete(fn);
  }

  /** Add/remove listeners for streaming ticks (topic + data). */
  public onTick(fn: TickHandler): void {
    this.tickHandlers.add(fn);
  }
  public offTick(fn: TickHandler): void {
    this.tickHandlers.delete(fn);
  }

  /** Fire-and-forget send of a JSON-able object. */
  public send(obj: Record<string, unknown>): void {
    const s = JSON.stringify(obj);
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(s);
    } else {
      this.sendQueue.push(s);
      this.connect(); // ensure a connection attempt exists
    }
  }

  /**
   * Send a control request and await its control.ack (matched by id).
   * If you don't pass an id, one is generated.
   */
  public sendControl<T extends ControlAck = ControlAck>(
    op: string,
    payload: Record<string, unknown> = {},
    opts?: { id?: string; timeoutMs?: number }
  ): Promise<T> {
    const id = opts?.id ?? this.nextId(op);
    const timeoutMs = opts?.timeoutMs ?? 8000;

    const req: ControlRequest = { type: "control", op, id, ...payload };
    const p = new Promise<T>((resolve, reject) => {
      const to = window.setTimeout(() => {
        this.pendingAcks.delete(id);
        reject(new Error(`control.ack timeout for op='${op}', id='${id}'`));
      }, timeoutMs);
      this.pendingAcks.set(id, { resolve: resolve as any, reject, timeout: to });
    });

    this.send(req as unknown as Record<string, unknown>);
    return p;
  }

  // ---- Internals ----------------------------------------------------------

  private handleInbound(raw: string) {
    let msg: WireMessage;
    try {
      msg = JSON.parse(raw);
    } catch {
      // Non-JSON noise; ignore.
      return;
    }

    // Correlate control.ack first
    if ((msg as any).type === "control.ack") {
      const ack = msg as unknown as ControlAck;
      const id = ack.id || "";
      if (id && this.pendingAcks.has(id)) {
        const entry = this.pendingAcks.get(id)!;
        window.clearTimeout(entry.timeout);
        this.pendingAcks.delete(id);
        if (ack.ok) entry.resolve(ack);
        else entry.reject(new Error(ack.error || "control.ack error"));
        // still fall-through to broadcast if callers want to observe all messages
      }
    }

    // Broadcast to generic listeners
    this.messageHandlers.forEach((fn) => {
      try {
        fn(msg);
      } catch {
        /* no-op */
      }
    });

    // If it looks like a tick envelope, broadcast to tick listeners
    if ((msg as any).topic && (msg as any).data) {
      const tick = msg as TickEnvelope;

      // *** DEBUG: log IB topics so we can see if they reach the browser ***
      if (tick.topic.startsWith("ib.")) {
        // This is safe to leave in while we debug; remove or comment later if noisy.
        console.log("[SocketHub] IB tick:", tick.topic, tick.data);
      }

      this.tickHandlers.forEach((fn) => {
        try {
          fn(tick);
        } catch {
          /* no-op */
        }
      });
    }
  }

  private scheduleReconnect() {
    // Reject all pending acks on disconnect
    for (const [id, entry] of this.pendingAcks.entries()) {
      window.clearTimeout(entry.timeout);
      entry.reject(new Error("socket disconnected"));
      this.pendingAcks.delete(id);
    }

    // backoff: 250ms, 500ms, 1s, 2s, 4s, cap at 5s
    const delay = Math.min(5000, 250 * Math.pow(2, this.reconnectAttempts++));
    window.setTimeout(() => this.connect(), delay);
  }

  private resolveWsUrl(): string {
    const { protocol, host } = window.location;
    const scheme = protocol === "https:" ? "wss" : "ws";
    return `${scheme}://${host}/ws`;
  }

  private nextId(op: string): string {
    // e.g. "find_and_subscribe-1731351234567-3"
    const n = Math.floor(Math.random() * 1e6).toString(36);
    return `${op}-${Date.now()}-${n}`;
  }
}

// Export a singleton instance for the whole app.
export const socketHub = new SocketHub();