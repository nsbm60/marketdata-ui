/**
 * useVix - Hook to consume VIX reports from CalcServer.
 *
 * CalcServer calculates VIX using CBOE methodology from SPY options
 * and publishes updates to the report.vix topic.
 */

import { useState, useEffect, useCallback } from "react";
import { socketHub } from "../ws/SocketHub";
import type { TickEnvelope } from "../ws/ws-types";

export interface VixReport {
  vix: number;              // The calculated VIX value
  nearTermVol: number;      // Near-term implied volatility
  nextTermVol: number;      // Next-term implied volatility
  nearTermExpiry: string;   // Near-term expiry (YYYY-MM-DD)
  nextTermExpiry: string;   // Next-term expiry (YYYY-MM-DD)
  nearTermDte: number;      // Days to near-term expiry
  nextTermDte: number;      // Days to next-term expiry
  forwardNear: number;      // Forward price for near-term
  forwardNext: number;      // Forward price for next-term
  spot: number;             // SPY spot price
  contributingStrikes: number; // Number of strikes used in calculation
  asOf: number;             // Timestamp
}

export interface UseVixResult {
  /** Current VIX report */
  report: VixReport | undefined;
  /** Just the VIX value for convenience */
  vix: number | undefined;
  /** Whether we've received at least one report */
  loaded: boolean;
  /** Timestamp of last update */
  lastUpdated: number | undefined;
  /** Request CalcServer to start VIX calculation */
  startVix: () => Promise<void>;
  /** Request CalcServer to stop VIX calculation */
  stopVix: () => Promise<void>;
}

/**
 * Subscribe to VIX reports from CalcServer.
 *
 * @param enabled - Whether to subscribe (default: true)
 * @returns VIX report data and control functions
 *
 * @example
 * const { vix, loaded } = useVix();
 * if (loaded) {
 *   console.log(`VIX: ${vix}`);
 * }
 */
export function useVix(enabled: boolean = true): UseVixResult {
  const [report, setReport] = useState<VixReport | undefined>(undefined);
  const [lastUpdated, setLastUpdated] = useState<number | undefined>(undefined);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    // Subscribe to report.vix topic
    const channel = "report.vix";

    socketHub.send({
      type: "subscribe",
      channels: [channel],
      symbols: ["vix"],
    });

    // Listen for tick envelopes
    const handleTick = (tick: TickEnvelope) => {
      if (tick.topic !== "report.vix") return;

      try {
        const payload = (tick.data as any)?.data ?? tick.data;

        if (payload && typeof payload === "object") {
          const vixReport: VixReport = {
            vix: payload.vix ?? 0,
            nearTermVol: payload.nearTermVol ?? 0,
            nextTermVol: payload.nextTermVol ?? 0,
            nearTermExpiry: payload.nearTermExpiry ?? "",
            nextTermExpiry: payload.nextTermExpiry ?? "",
            nearTermDte: payload.nearTermDte ?? 0,
            nextTermDte: payload.nextTermDte ?? 0,
            forwardNear: payload.forwardNear ?? 0,
            forwardNext: payload.forwardNext ?? 0,
            spot: payload.spot ?? 0,
            contributingStrikes: payload.contributingStrikes ?? 0,
            asOf: payload.asOf ?? Date.now(),
          };

          setReport(vixReport);
          setLastUpdated(vixReport.asOf);
          setLoaded(true);
        }
      } catch (e) {
        console.warn("[useVix] Failed to parse report:", e);
      }
    };

    socketHub.onTick(handleTick);

    return () => {
      socketHub.offTick(handleTick);
      socketHub.send({
        type: "unsubscribe",
        channels: [channel],
        symbols: ["vix"],
      });
    };
  }, [enabled]);

  // Control functions (memoized for stable references)
  const startVix = useCallback(async () => {
    console.log("[useVix] Requesting CalcServer to start VIX report...");
    try {
      const result = await socketHub.sendControl("start_vix_report", { target: "calc" });
      console.log("[useVix] start_vix_report response:", result);
    } catch (e) {
      console.error("[useVix] Failed to start VIX:", e);
    }
  }, []);

  const stopVix = useCallback(async () => {
    try {
      await socketHub.sendControl("stop_vix_report", { target: "calc" });
    } catch (e) {
      console.error("[useVix] Failed to stop VIX:", e);
    }
  }, []);

  return {
    report,
    vix: report?.vix,
    loaded,
    lastUpdated,
    startVix,
    stopVix,
  };
}
