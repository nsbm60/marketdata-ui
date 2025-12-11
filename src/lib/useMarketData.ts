// src/lib/useMarketData.ts
import { useEffect, useState } from "react";
import { socketHub } from "../ws/SocketHub";

type MarketData = {
  last?: number;
  bid?: number;
  ask?: number;
  delta?: number;
  gamma?: number;
  theta?: number;
  vega?: number;
  iv?: number;
  theo?: number;
  openInterest?: number;
};

const cache = new Map<string, MarketData>();

// Real-time cache update — runs on every message
socketHub.onMessage((m: any) => {
  const topic = m?.topic;
  if (!topic || typeof topic !== "string") return;

  const parts = topic.split(".");
  const symbol = parts[parts.length - 1]?.toUpperCase();
  if (!symbol) return;

  const d = m.data || {};
  const entry = cache.get(symbol) || {};

  if (topic.includes("trade")) {
    const p = d.last ?? d.price ?? d.p;
    if (p !== undefined) entry.last = Number(p);
  }
  if (topic.includes("quote")) {
    if (d.bid !== undefined) entry.bid = Number(d.bid);
    if (d.ask !== undefined) entry.ask = Number(d.ask);
  }

  // Future-proof for options
  if (d.delta !== undefined) entry.delta = Number(d.delta);
  if (d.gamma !== undefined) entry.gamma = Number(d.gamma);
  if (d.theta !== undefined) entry.theta = Number(d.theta);
  if (d.vega !== undefined) entry.vega = Number(d.vega);
  if (d.iv !== undefined) entry.iv = Number(d.iv);
  if (d.theo !== undefined) entry.theo = Number(d.theo);
  if (d.openInterest !== undefined) entry.openInterest = Number(d.openInterest);

  cache.set(symbol, entry);
});

// Hook — use in any component
export function useMarketData(symbol: string): MarketData {
  const [data, setData] = useState<MarketData>(cache.get(symbol.toUpperCase()) || {});

  useEffect(() => {
    const interval = setInterval(() => {
      const latest = cache.get(symbol.toUpperCase());
      if (latest) setData({ ...latest });
    }, 100);

    return () => clearInterval(interval);
  }, [symbol]);

  return data;
}