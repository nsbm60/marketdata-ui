/**
 * MarketDataBus - Centralized market data management.
 *
 * Provides a single source of truth for all market data:
 * - Handles WebSocket subscriptions with reference counting
 * - Normalizes price data from wire protocol
 * - Notifies subscribers on updates
 *
 * Components should use the React hooks (useMarketPrice, useMarketPrices)
 * rather than interacting with the bus directly.
 */

import { socketHub } from "../ws/SocketHub";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface PriceData {
  symbol: string;
  last?: number;
  bid?: number;
  ask?: number;
  bidSize?: number;
  askSize?: number;
  volume?: number;
  timestamp?: number;
}

export interface OptionPriceData extends PriceData {
  underlying?: string;
  strike?: number;
  expiry?: string;      // YYYY-MM-DD or YYYYMMDD
  right?: "C" | "P";
  // Greeks (when available)
  delta?: number;
  gamma?: number;
  theta?: number;
  vega?: number;
  iv?: number;
}

export type Channel = "equity" | "option";

export type PriceCallback = (price: PriceData) => void;

interface Subscription {
  symbol: string;
  channel: Channel;
  callbacks: Set<PriceCallback>;
}

// ─────────────────────────────────────────────────────────────
// MarketDataBus Class
// ─────────────────────────────────────────────────────────────

class MarketDataBus {
  // Current prices (source of truth)
  private prices = new Map<string, PriceData>();

  // Subscriptions by key (channel:symbol)
  private subscriptions = new Map<string, Subscription>();

  // Channel-level listeners (notified on any update for a channel)
  private channelListeners = new Map<Channel, Set<PriceCallback>>();

  // Wire protocol listener registered?
  private initialized = false;

  // Debug mode
  private debug = false;

  // ─────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────

  /**
   * Subscribe to price updates for a symbol.
   * Returns unsubscribe function.
   *
   * @param symbol - Symbol to subscribe to (e.g., "NVDA" or OSI symbol)
   * @param callback - Function called on each price update
   * @param channel - "equity" or "option"
   * @returns Unsubscribe function
   */
  subscribe(
    symbol: string,
    callback: PriceCallback,
    channel: Channel = "equity"
  ): () => void {
    this.ensureInitialized();
    const normalizedSymbol = symbol.toUpperCase().trim();
    const key = this.makeKey(normalizedSymbol, channel);

    let sub = this.subscriptions.get(key);
    if (!sub) {
      // First subscriber for this symbol - subscribe on wire
      sub = { symbol: normalizedSymbol, channel, callbacks: new Set() };
      this.subscriptions.set(key, sub);
      this.wireSubscribe(normalizedSymbol, channel);
      this.log(`[MarketDataBus] Subscribed: ${key}`);
    }

    sub.callbacks.add(callback);

    // Immediately emit current price if available
    const current = this.prices.get(key);
    if (current) {
      callback(current);
    }

    // Return unsubscribe function
    return () => this.unsubscribe(key, callback);
  }

  /**
   * Get current price (no subscription, immediate return).
   */
  getPrice(symbol: string, channel: Channel = "equity"): PriceData | undefined {
    const key = this.makeKey(symbol.toUpperCase().trim(), channel);
    return this.prices.get(key);
  }

  /**
   * Get all current prices (for debugging).
   */
  getAllPrices(): Map<string, PriceData> {
    return new Map(this.prices);
  }

  /**
   * Get all active subscriptions (for debugging).
   */
  getSubscriptions(): Map<string, { symbol: string; channel: Channel; listenerCount: number }> {
    const result = new Map<string, { symbol: string; channel: Channel; listenerCount: number }>();
    this.subscriptions.forEach((sub, key) => {
      result.set(key, {
        symbol: sub.symbol,
        channel: sub.channel,
        listenerCount: sub.callbacks.size,
      });
    });
    return result;
  }

  /**
   * Listen to all updates for a channel (no subscription management).
   * Useful when backend manages subscriptions (e.g., options via get_chain).
   *
   * @param channel - Channel to listen to
   * @param callback - Called on every price update for this channel
   * @returns Unsubscribe function
   */
  onChannelUpdate(channel: Channel, callback: PriceCallback): () => void {
    this.ensureInitialized();

    let listeners = this.channelListeners.get(channel);
    if (!listeners) {
      listeners = new Set();
      this.channelListeners.set(channel, listeners);
    }
    listeners.add(callback);

    return () => {
      const set = this.channelListeners.get(channel);
      if (set) {
        set.delete(callback);
      }
    };
  }

  /**
   * Get all prices for a channel.
   * Useful for getting all option prices for the current chain.
   */
  getPricesForChannel(channel: Channel): Map<string, PriceData> {
    const prefix = `${channel}:`;
    const result = new Map<string, PriceData>();
    this.prices.forEach((price, key) => {
      if (key.startsWith(prefix)) {
        const symbol = key.slice(prefix.length);
        result.set(symbol, price);
      }
    });
    return result;
  }

  /**
   * Enable/disable debug logging.
   */
  setDebug(enabled: boolean): void {
    this.debug = enabled;
  }

  /**
   * Clear all data and subscriptions (for testing).
   */
  reset(): void {
    // Unsubscribe all on wire
    this.subscriptions.forEach((sub) => {
      this.wireUnsubscribe(sub.symbol, sub.channel);
    });
    this.subscriptions.clear();
    this.prices.clear();
    this.log("[MarketDataBus] Reset");
  }

  // ─────────────────────────────────────────────────────────
  // Internal
  // ─────────────────────────────────────────────────────────

  private makeKey(symbol: string, channel: Channel): string {
    return `${channel}:${symbol}`;
  }

  private unsubscribe(key: string, callback: PriceCallback): void {
    const sub = this.subscriptions.get(key);
    if (!sub) return;

    sub.callbacks.delete(callback);

    // Last subscriber gone - unsubscribe on wire
    if (sub.callbacks.size === 0) {
      this.subscriptions.delete(key);
      this.wireUnsubscribe(sub.symbol, sub.channel);
      this.log(`[MarketDataBus] Unsubscribed: ${key}`);
    }
  }

  private ensureInitialized(): void {
    if (this.initialized) return;
    this.initialized = true;

    // Single listener for all market data
    const handler = (msg: any) => this.handleMessage(msg);
    socketHub.onTick(handler);
    socketHub.onMessage(handler);

    // Resubscribe to all active subscriptions on reconnect
    socketHub.onConnect(() => this.resubscribeAll());

    this.log("[MarketDataBus] Initialized");
  }

  /**
   * Resubscribe to all active subscriptions.
   * Called automatically on WebSocket reconnect.
   */
  private resubscribeAll(): void {
    // Always log reconnect for debugging (not gated by debug flag)
    console.log("[MarketDataBus] WebSocket reconnected - active subscriptions:", this.subscriptions.size);

    if (this.subscriptions.size === 0) {
      console.log("[MarketDataBus] No subscriptions to resubscribe");
      return;
    }

    this.subscriptions.forEach((sub) => {
      console.log("[MarketDataBus] Resubscribing:", sub.channel, sub.symbol);
      this.wireSubscribe(sub.symbol, sub.channel);
    });
  }

  private handleMessage(msg: any): void {
    if (!msg?.topic || typeof msg.topic !== "string") return;

    const parsed = this.parseTopic(msg.topic);
    if (!parsed.channel || !parsed.symbol) return;

    const key = this.makeKey(parsed.symbol, parsed.channel);
    const data = msg.data?.data || msg.data || {};

    // Normalize and merge with existing data
    const price = this.normalizePrice(parsed.symbol, parsed.channel, data);
    const existing = this.prices.get(key);
    const updated = { ...existing, ...price };

    // Always store the price (even without subscription)
    // This allows components to query prices that the backend subscribed to
    this.prices.set(key, updated);

    // Notify subscribers (if any)
    const sub = this.subscriptions.get(key);
    if (sub && sub.callbacks.size > 0) {
      sub.callbacks.forEach((cb) => {
        try {
          cb(updated);
        } catch (err) {
          console.error("[MarketDataBus] Callback error:", err);
        }
      });
    }

    // Also notify channel-level listeners
    const channelListeners = this.channelListeners.get(parsed.channel);
    if (channelListeners && channelListeners.size > 0) {
      channelListeners.forEach((cb) => {
        try {
          cb(updated);
        } catch (err) {
          console.error("[MarketDataBus] Channel listener error:", err);
        }
      });
    }
  }

  private parseTopic(topic: string): { channel?: Channel; symbol?: string } {
    // md.equity.quote.NVDA -> { channel: "equity", symbol: "NVDA" }
    // md.equity.trade.NVDA -> { channel: "equity", symbol: "NVDA" }
    // md.option.quote.NVDA251219C00140000 -> { channel: "option", symbol: "NVDA251219C00140000" }

    if (topic.startsWith("md.equity.")) {
      const parts = topic.split(".");
      if (parts.length >= 4) {
        const symbol = parts.slice(3).join(".").toUpperCase();
        return { channel: "equity", symbol };
      }
    }

    if (topic.startsWith("md.option.")) {
      const parts = topic.split(".");
      if (parts.length >= 4) {
        const symbol = parts.slice(3).join(".").toUpperCase();
        return { channel: "option", symbol };
      }
    }

    return {};
  }

  private normalizePrice(symbol: string, channel: Channel, data: any): PriceData {
    const price: PriceData = {
      symbol,
      timestamp: Date.now(),
    };

    // Extract last price (various field names from different sources)
    const last = data.lastPrice ?? data.last ?? data.price ?? data.p ?? data.lp;
    if (last !== undefined && last !== null) {
      price.last = Number(last);
    }

    // Extract bid
    const bid = data.bidPrice ?? data.bp ?? data.bid;
    if (bid !== undefined && bid !== null) {
      price.bid = Number(bid);
    }

    // Extract ask
    const ask = data.askPrice ?? data.ap ?? data.ask;
    if (ask !== undefined && ask !== null) {
      price.ask = Number(ask);
    }

    // Extract sizes
    const bidSize = data.bidSize ?? data.bs;
    if (bidSize !== undefined && bidSize !== null) {
      price.bidSize = Number(bidSize);
    }

    const askSize = data.askSize ?? data.as;
    if (askSize !== undefined && askSize !== null) {
      price.askSize = Number(askSize);
    }

    // Extract volume
    const volume = data.volume ?? data.v;
    if (volume !== undefined && volume !== null) {
      price.volume = Number(volume);
    }

    // Extract timestamp if provided
    const ts = data.timestamp ?? data.t;
    if (ts !== undefined && ts !== null) {
      price.timestamp = typeof ts === "number" ? ts : new Date(ts).getTime();
    }

    // Extract Greeks (for options)
    if (channel === "option") {
      const optPrice = price as OptionPriceData;

      const delta = data.delta ?? data.d;
      if (delta !== undefined && delta !== null) {
        optPrice.delta = Number(delta);
      }

      const gamma = data.gamma ?? data.g;
      if (gamma !== undefined && gamma !== null) {
        optPrice.gamma = Number(gamma);
      }

      const theta = data.theta ?? data.th;
      if (theta !== undefined && theta !== null) {
        optPrice.theta = Number(theta);
      }

      const vega = data.vega ?? data.v;
      if (vega !== undefined && vega !== null && channel === "option") {
        // Note: 'v' is volume for equities, vega for options - check channel
        optPrice.vega = Number(vega);
      }

      const iv = data.iv ?? data.impliedVolatility ?? data.impliedVol;
      if (iv !== undefined && iv !== null) {
        optPrice.iv = Number(iv);
      }
    }

    return price;
  }

  private wireSubscribe(symbol: string, channel: Channel): void {
    const channels =
      channel === "equity"
        ? ["md.equity.quote", "md.equity.trade"]
        : ["md.option.quote", "md.option.trade"];

    socketHub.send({ type: "subscribe", channels, symbols: [symbol] });

    // For options, also trigger backend subscription for Alpaca streaming
    if (channel === "option") {
      socketHub.send({
        type: "control",
        target: "marketData",
        op: "subscribe",
        kind: "option_contracts",
        contracts: [symbol],
      });
    }
  }

  private wireUnsubscribe(symbol: string, channel: Channel): void {
    const channels =
      channel === "equity"
        ? ["md.equity.quote", "md.equity.trade"]
        : ["md.option.quote", "md.option.trade"];

    socketHub.send({ type: "unsubscribe", channels, symbols: [symbol] });

    // For options, also unsubscribe on backend
    if (channel === "option") {
      socketHub.send({
        type: "control",
        target: "marketData",
        op: "unsubscribe",
        kind: "option_contracts",
        contracts: [symbol],
      });
    }
  }

  private log(...args: any[]): void {
    if (this.debug) {
      console.log(...args);
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Singleton Export
// ─────────────────────────────────────────────────────────────

export const marketDataBus = new MarketDataBus();

// Expose on window for debugging in console
if (typeof window !== "undefined") {
  (window as any).marketDataBus = marketDataBus;
}
