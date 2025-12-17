/**
 * React hooks for market data.
 *
 * These hooks provide a clean interface to the MarketDataBus:
 * - Automatic subscription/unsubscription on mount/unmount
 * - Triggers re-render on price updates
 * - Handles cleanup properly
 */

import { useState, useEffect, useRef, useMemo } from "react";
import {
  marketDataBus,
  PriceData,
  Channel,
} from "../services/MarketDataBus";

// Re-export types for convenience
export type { PriceData, Channel };

// ─────────────────────────────────────────────────────────────
// useMarketPrice - Single symbol subscription
// ─────────────────────────────────────────────────────────────

/**
 * Subscribe to price updates for a single symbol.
 *
 * @param symbol - Symbol to subscribe to (undefined = no subscription)
 * @param channel - "equity" or "option" (default: "equity")
 * @returns Current price data or undefined
 *
 * @example
 * const price = useMarketPrice("NVDA");
 * // price?.last, price?.bid, price?.ask
 */
export function useMarketPrice(
  symbol: string | undefined,
  channel: Channel = "equity"
): PriceData | undefined {
  const [price, setPrice] = useState<PriceData | undefined>(() =>
    symbol ? marketDataBus.getPrice(symbol, channel) : undefined
  );

  useEffect(() => {
    if (!symbol) {
      setPrice(undefined);
      return;
    }

    // Subscribe returns unsubscribe function
    const unsubscribe = marketDataBus.subscribe(symbol, setPrice, channel);

    return unsubscribe;
  }, [symbol, channel]);

  return price;
}

// ─────────────────────────────────────────────────────────────
// useMarketPrices - Multiple symbol subscription
// ─────────────────────────────────────────────────────────────

/**
 * Subscribe to price updates for multiple symbols.
 *
 * @param symbols - Array of symbols to subscribe to
 * @param channel - "equity" or "option" (default: "equity")
 * @returns Map of symbol -> price data
 *
 * @example
 * const prices = useMarketPrices(["NVDA", "TSLA", "SPY"]);
 * // prices.get("NVDA")?.last
 */
export function useMarketPrices(
  symbols: string[],
  channel: Channel = "equity"
): Map<string, PriceData> {
  const [prices, setPrices] = useState<Map<string, PriceData>>(() => {
    // Initialize with any existing prices
    const initial = new Map<string, PriceData>();
    symbols.forEach((s) => {
      const existing = marketDataBus.getPrice(s, channel);
      if (existing) {
        initial.set(s.toUpperCase(), existing);
      }
    });
    return initial;
  });

  // Stable reference to symbols for dependency tracking
  const symbolsKey = useMemo(() => {
    return symbols
      .map((s) => s.toUpperCase().trim())
      .filter((s) => s.length > 0)
      .sort()
      .join(",");
  }, [symbols]);

  useEffect(() => {
    if (!symbolsKey) {
      setPrices(new Map());
      return;
    }

    const symbolList = symbolsKey.split(",");
    const unsubscribes: (() => void)[] = [];

    symbolList.forEach((symbol) => {
      const unsubscribe = marketDataBus.subscribe(
        symbol,
        (price) => {
          setPrices((prev) => {
            const next = new Map(prev);
            next.set(symbol, price);
            return next;
          });
        },
        channel
      );
      unsubscribes.push(unsubscribe);
    });

    return () => {
      unsubscribes.forEach((fn) => fn());
    };
  }, [symbolsKey, channel]);

  return prices;
}

// ─────────────────────────────────────────────────────────────
// useMarketPriceRef - Non-reactive price access
// ─────────────────────────────────────────────────────────────

/**
 * Subscribe to price updates but store in a ref (no re-render on updates).
 * Useful for high-frequency updates where you only need the latest value
 * when handling events.
 *
 * @param symbol - Symbol to subscribe to
 * @param channel - "equity" or "option" (default: "equity")
 * @returns Ref containing current price
 *
 * @example
 * const priceRef = useMarketPriceRef("NVDA");
 * const handleClick = () => console.log(priceRef.current?.last);
 */
export function useMarketPriceRef(
  symbol: string | undefined,
  channel: Channel = "equity"
): React.MutableRefObject<PriceData | undefined> {
  const priceRef = useRef<PriceData | undefined>(
    symbol ? marketDataBus.getPrice(symbol, channel) : undefined
  );

  useEffect(() => {
    if (!symbol) {
      priceRef.current = undefined;
      return;
    }

    const unsubscribe = marketDataBus.subscribe(
      symbol,
      (price) => {
        priceRef.current = price;
      },
      channel
    );

    return unsubscribe;
  }, [symbol, channel]);

  return priceRef;
}

// ─────────────────────────────────────────────────────────────
// useMarketPricesRef - Multiple symbols, non-reactive
// ─────────────────────────────────────────────────────────────

/**
 * Subscribe to multiple symbols but store in a ref (no re-render on updates).
 *
 * @param symbols - Array of symbols to subscribe to
 * @param channel - "equity" or "option" (default: "equity")
 * @returns Ref containing Map of prices
 */
export function useMarketPricesRef(
  symbols: string[],
  channel: Channel = "equity"
): React.MutableRefObject<Map<string, PriceData>> {
  const pricesRef = useRef<Map<string, PriceData>>(new Map());

  const symbolsKey = useMemo(() => {
    return symbols
      .map((s) => s.toUpperCase().trim())
      .filter((s) => s.length > 0)
      .sort()
      .join(",");
  }, [symbols]);

  useEffect(() => {
    if (!symbolsKey) {
      pricesRef.current = new Map();
      return;
    }

    const symbolList = symbolsKey.split(",");
    const unsubscribes: (() => void)[] = [];

    symbolList.forEach((symbol) => {
      const unsubscribe = marketDataBus.subscribe(
        symbol,
        (price) => {
          pricesRef.current.set(symbol, price);
        },
        channel
      );
      unsubscribes.push(unsubscribe);
    });

    return () => {
      unsubscribes.forEach((fn) => fn());
    };
  }, [symbolsKey, channel]);

  return pricesRef;
}

// ─────────────────────────────────────────────────────────────
// Shared flush scheduler - synchronizes all throttled hooks
// ─────────────────────────────────────────────────────────────

type FlushCallback = () => void;
const flushRegistry = new Map<number, Set<FlushCallback>>();
const flushTimers = new Map<number, ReturnType<typeof setInterval>>();

function registerFlush(throttleMs: number, callback: FlushCallback): () => void {
  let callbacks = flushRegistry.get(throttleMs);
  if (!callbacks) {
    callbacks = new Set();
    flushRegistry.set(throttleMs, callbacks);
    // Start shared timer for this throttle interval
    const timer = setInterval(() => {
      const cbs = flushRegistry.get(throttleMs);
      if (cbs && cbs.size > 0) {
        cbs.forEach((cb) => cb());
      }
    }, throttleMs);
    flushTimers.set(throttleMs, timer);
  }
  callbacks.add(callback);

  return () => {
    const cbs = flushRegistry.get(throttleMs);
    if (cbs) {
      cbs.delete(callback);
      if (cbs.size === 0) {
        flushRegistry.delete(throttleMs);
        const timer = flushTimers.get(throttleMs);
        if (timer) {
          clearInterval(timer);
          flushTimers.delete(throttleMs);
        }
      }
    }
  };
}

// ─────────────────────────────────────────────────────────────
// useThrottledMarketPrices - Throttled updates for performance
// ─────────────────────────────────────────────────────────────

/**
 * Subscribe to multiple symbols with throttled updates.
 * Uses a shared flush scheduler so all hooks with the same throttle
 * interval update at exactly the same time (synchronized).
 *
 * @param symbols - Array of symbols to subscribe to
 * @param channel - "equity" or "option" (default: "equity")
 * @param throttleMs - Interval between re-renders (default: 100)
 * @returns Map of symbol -> price data
 */
export function useThrottledMarketPrices(
  symbols: string[],
  channel: Channel = "equity",
  throttleMs: number = 100
): Map<string, PriceData> {
  const [prices, setPrices] = useState<Map<string, PriceData>>(new Map());
  const pendingRef = useRef<Map<string, PriceData>>(new Map());

  const symbolsKey = useMemo(() => {
    return symbols
      .map((s) => s.toUpperCase().trim())
      .filter((s) => s.length > 0)
      .sort()
      .join(",");
  }, [symbols]);

  useEffect(() => {
    if (!symbolsKey) {
      setPrices(new Map());
      return;
    }

    const symbolList = symbolsKey.split(",");
    const unsubscribes: (() => void)[] = [];

    // Subscribe to all symbols, accumulate updates in pendingRef
    symbolList.forEach((symbol) => {
      const unsubscribe = marketDataBus.subscribe(
        symbol,
        (price) => {
          pendingRef.current.set(symbol, price);
        },
        channel
      );
      unsubscribes.push(unsubscribe);
    });

    // Register with shared flush scheduler (all hooks with same throttleMs flush together)
    const flush = () => {
      if (pendingRef.current.size > 0) {
        // Capture snapshot before clearing - React strict mode may call the callback twice
        const snapshot = new Map(pendingRef.current);
        pendingRef.current.clear();

        setPrices((prev) => {
          const next = new Map(prev);
          snapshot.forEach((price, symbol) => {
            next.set(symbol, price);
          });
          return next;
        });
      }
    };

    const unregisterFlush = registerFlush(throttleMs, flush);

    return () => {
      unregisterFlush();
      unsubscribes.forEach((fn) => fn());
    };
  }, [symbolsKey, channel, throttleMs]);

  return prices;
}

// ─────────────────────────────────────────────────────────────
// useChannelPrices - Listen to all prices on a channel
// ─────────────────────────────────────────────────────────────

/**
 * Listen to all price updates on a channel.
 * Useful when backend manages subscriptions (e.g., options via get_chain).
 * Returns a version number that increments on updates - use with getPricesForChannel().
 * Uses the shared flush scheduler for synchronized updates with useThrottledMarketPrices.
 *
 * @param channel - Channel to listen to
 * @param throttleMs - Interval between re-renders (default: 100)
 * @returns Version number that increments on updates
 */
export function useChannelUpdates(
  channel: Channel,
  throttleMs: number = 100
): number {
  const [version, setVersion] = useState(0);
  const pendingRef = useRef(false);

  useEffect(() => {
    // Listen for any updates on this channel
    const unsubscribe = marketDataBus.onChannelUpdate(channel, () => {
      pendingRef.current = true;
    });

    // Use shared flush scheduler for synchronized updates
    const flush = () => {
      if (pendingRef.current) {
        setVersion((v) => (v + 1) & 0xffff);
        pendingRef.current = false;
      }
    };

    const unregisterFlush = registerFlush(throttleMs, flush);

    return () => {
      unsubscribe();
      unregisterFlush();
    };
  }, [channel, throttleMs]);

  return version;
}

/**
 * Get all prices for a channel (call after useChannelUpdates).
 * This is a utility function, not a hook.
 */
export function getChannelPrices(channel: Channel): Map<string, PriceData> {
  return marketDataBus.getPricesForChannel(channel);
}
