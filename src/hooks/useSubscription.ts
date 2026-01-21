/**
 * useSubscription - Safe abstraction for WebSocket subscriptions.
 *
 * Encapsulates the correct subscription pattern:
 * - Subscribes when channel/symbol/enabled changes
 * - Unsubscribes on cleanup
 * - Callback is always current (no stale closures)
 * - No exposed dependency array to misuse
 * - Reconnection handled by SocketHub centrally
 *
 * Usage:
 *   useSubscription({
 *     channel: "report.candle",
 *     symbol: `${symbol}.${timeframe}`,
 *     enabled: !!symbol,
 *     onMessage: (tick) => setBars(prev => [...prev, tick.data]),
 *   });
 */

import { useEffect, useRef } from "react";
import { socketHub } from "../ws/SocketHub";
import type { TickEnvelope } from "../ws/ws-types";

export interface UseSubscriptionOptions {
  /** Channel to subscribe to (e.g., "report.candle", "md.equity.quote") */
  channel: string;
  /** Symbol/key for the subscription (e.g., "NVDA", "nvda.5m") */
  symbol: string;
  /** Whether subscription is active */
  enabled: boolean;
  /** Called when a matching tick arrives. Always receives current callback (no stale closure). */
  onMessage: (tick: TickEnvelope) => void;
  /** Optional: filter function to match ticks (default: topic starts with channel) */
  filter?: (tick: TickEnvelope, channel: string, symbol: string) => boolean;
}

/**
 * Default filter: tick topic starts with "channel." and includes symbol
 * e.g., channel="report.candle", symbol="nvda.5m" matches "report.candle.nvda.5m"
 */
const defaultFilter = (tick: TickEnvelope, channel: string, symbol: string): boolean => {
  const prefix = `${channel}.`;
  if (!tick.topic.startsWith(prefix)) return false;

  // Extract the part after the channel prefix and compare with symbol
  const topicSuffix = tick.topic.substring(prefix.length).toLowerCase();
  return topicSuffix === symbol.toLowerCase();
};

export function useSubscription(options: UseSubscriptionOptions): void {
  const { channel, symbol, enabled, onMessage, filter = defaultFilter } = options;

  // Keep callback in ref so it's always current without triggering resubscription
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  // Keep filter in ref too
  const filterRef = useRef(filter);
  filterRef.current = filter;

  // Keep channel/symbol in refs for the tick handler
  const channelRef = useRef(channel);
  channelRef.current = channel;
  const symbolRef = useRef(symbol);
  symbolRef.current = symbol;

  useEffect(() => {
    if (!enabled || !channel || !symbol) {
      return;
    }

    // Subscribe
    socketHub.send({
      type: "subscribe",
      channels: [channel],
      symbols: [symbol],
    });

    // Tick handler uses refs to always have current values
    const handleTick = (tick: TickEnvelope) => {
      if (filterRef.current(tick, channelRef.current, symbolRef.current)) {
        onMessageRef.current(tick);
      }
    };

    socketHub.onTick(handleTick);

    // Cleanup: unsubscribe and remove handler
    return () => {
      socketHub.offTick(handleTick);
      socketHub.send({
        type: "unsubscribe",
        channels: [channel],
        symbols: [symbol],
      });
    };
  }, [channel, symbol, enabled]); // Only subscription parameters - never data!
}

/**
 * useMultiSubscription - Subscribe to multiple channels/symbols at once.
 *
 * Useful when you need to subscribe to related streams together
 * (e.g., quotes and trades for the same symbol).
 */
export interface MultiSubscriptionItem {
  channel: string;
  symbol: string;
}

export interface UseMultiSubscriptionOptions {
  subscriptions: MultiSubscriptionItem[];
  enabled: boolean;
  onMessage: (tick: TickEnvelope) => void;
}

export function useMultiSubscription(options: UseMultiSubscriptionOptions): void {
  const { subscriptions, enabled, onMessage } = options;

  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  // Create stable key for subscriptions array
  const subscriptionKey = subscriptions
    .map(s => `${s.channel}:${s.symbol}`)
    .sort()
    .join("|");

  useEffect(() => {
    if (!enabled || subscriptions.length === 0) {
      return;
    }

    // Build channel -> symbols map for efficient subscription
    const byChannel = new Map<string, string[]>();
    for (const sub of subscriptions) {
      if (!byChannel.has(sub.channel)) {
        byChannel.set(sub.channel, []);
      }
      byChannel.get(sub.channel)!.push(sub.symbol);
    }

    // Subscribe to each channel with its symbols
    for (const [channel, symbols] of byChannel) {
      socketHub.send({
        type: "subscribe",
        channels: [channel],
        symbols,
      });
    }

    // Build lookup set for fast filtering
    const subscriptionSet = new Set(
      subscriptions.map(s => `${s.channel}:${s.symbol}`.toLowerCase())
    );

    const handleTick = (tick: TickEnvelope) => {
      // Check if this tick matches any of our subscriptions
      for (const sub of subscriptions) {
        const prefix = `${sub.channel}.`;
        if (tick.topic.startsWith(prefix)) {
          const topicSuffix = tick.topic.substring(prefix.length).toLowerCase();
          if (topicSuffix === sub.symbol.toLowerCase()) {
            onMessageRef.current(tick);
            return;
          }
        }
      }
    };

    socketHub.onTick(handleTick);

    return () => {
      socketHub.offTick(handleTick);
      for (const [channel, symbols] of byChannel) {
        socketHub.send({
          type: "unsubscribe",
          channels: [channel],
          symbols,
        });
      }
    };
  }, [subscriptionKey, enabled]); // Stable key, not the array itself
}
