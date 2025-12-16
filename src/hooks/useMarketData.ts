/**
 * React hooks for market data.
 *
 * These hooks provide a clean interface to the MarketDataBus:
 * - Automatic subscription/unsubscription on mount/unmount
 * - Triggers re-render on price updates
 * - Handles cleanup properly
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
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
// useThrottledMarketPrices - Throttled updates for performance
// ─────────────────────────────────────────────────────────────

/**
 * Subscribe to multiple symbols with throttled updates.
 * Useful when displaying many symbols and you don't need every tick.
 *
 * @param symbols - Array of symbols to subscribe to
 * @param channel - "equity" or "option" (default: "equity")
 * @param throttleMs - Minimum ms between re-renders (default: 100)
 * @returns Map of symbol -> price data
 */
export function useThrottledMarketPrices(
  symbols: string[],
  channel: Channel = "equity",
  throttleMs: number = 100
): Map<string, PriceData> {
  const [prices, setPrices] = useState<Map<string, PriceData>>(new Map());
  const pendingRef = useRef<Map<string, PriceData>>(new Map());
  const lastUpdateRef = useRef<number>(0);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const symbolsKey = useMemo(() => {
    return symbols
      .map((s) => s.toUpperCase().trim())
      .filter((s) => s.length > 0)
      .sort()
      .join(",");
  }, [symbols]);

  const flushPending = useCallback(() => {
    if (pendingRef.current.size > 0) {
      setPrices((prev) => {
        const next = new Map(prev);
        pendingRef.current.forEach((price, symbol) => {
          next.set(symbol, price);
        });
        return next;
      });
      pendingRef.current.clear();
      lastUpdateRef.current = Date.now();
    }
    timeoutRef.current = null;
  }, []);

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
          pendingRef.current.set(symbol, price);

          const now = Date.now();
          const elapsed = now - lastUpdateRef.current;

          if (elapsed >= throttleMs) {
            // Enough time passed, update immediately
            flushPending();
          } else if (!timeoutRef.current) {
            // Schedule update for later
            timeoutRef.current = setTimeout(flushPending, throttleMs - elapsed);
          }
        },
        channel
      );
      unsubscribes.push(unsubscribe);
    });

    return () => {
      unsubscribes.forEach((fn) => fn());
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [symbolsKey, channel, throttleMs, flushPending]);

  return prices;
}

// ─────────────────────────────────────────────────────────────
// useChannelPrices - Listen to all prices on a channel
// ─────────────────────────────────────────────────────────────

/**
 * Listen to all price updates on a channel.
 * Useful when backend manages subscriptions (e.g., options via get_chain).
 * Returns a version number that increments on updates - use with getPricesForChannel().
 *
 * @param channel - Channel to listen to
 * @param throttleMs - Minimum ms between re-renders (default: 100)
 * @returns Version number that increments on updates
 */
export function useChannelUpdates(
  channel: Channel,
  throttleMs: number = 100
): number {
  const [version, setVersion] = useState(0);
  const lastUpdateRef = useRef<number>(0);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pendingRef = useRef(false);

  const flush = useCallback(() => {
    if (pendingRef.current) {
      setVersion((v) => (v + 1) & 0xffff);
      pendingRef.current = false;
      lastUpdateRef.current = Date.now();
    }
    timeoutRef.current = null;
  }, []);

  useEffect(() => {
    const unsubscribe = marketDataBus.onChannelUpdate(channel, () => {
      pendingRef.current = true;

      const now = Date.now();
      const elapsed = now - lastUpdateRef.current;

      if (elapsed >= throttleMs) {
        flush();
      } else if (!timeoutRef.current) {
        timeoutRef.current = setTimeout(flush, throttleMs - elapsed);
      }
    });

    return () => {
      unsubscribe();
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [channel, throttleMs, flush]);

  return version;
}

/**
 * Get all prices for a channel (call after useChannelUpdates).
 * This is a utility function, not a hook.
 */
export function getChannelPrices(channel: Channel): Map<string, PriceData> {
  return marketDataBus.getPricesForChannel(channel);
}
