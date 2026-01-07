// src/components/shared/VixTicker.tsx

import { useEffect, useRef } from "react";
import { useVix } from "../../hooks/useVix";
import { light, semantic } from "../../theme";

/**
 * VIX ticker for the global header.
 * Shows calculated VIX (CBOE-style from SPY options) from CalcServer.
 */
export default function VixTicker() {
  const { vix, report, loaded, startVix } = useVix();
  const startedRef = useRef(false);

  // Request CalcServer to start VIX calculation on mount
  useEffect(() => {
    if (!startedRef.current) {
      startedRef.current = true;
      console.log("[VixTicker] Calling startVix on mount");
      startVix();
    }
  }, [startVix]);

  // Determine color based on VIX level
  // Low VIX (<15): Green (calm)
  // Medium (15-20): Neutral
  // High (20-30): Yellow (elevated)
  // Very High (>30): Red (fear)
  const getVixColor = (v: number) => {
    if (v < 15) return semantic.success.text;
    if (v < 20) return light.text.primary;
    if (v < 30) return semantic.warning.textDark;
    return semantic.error.text;
  };

  // Format VIX value
  const vixStr = vix !== undefined ? vix.toFixed(2) : "--";
  const vixColor = vix !== undefined ? getVixColor(vix) : light.text.muted;

  // Build tooltip with details
  const tooltip = report
    ? `VIX: ${report.vix.toFixed(2)} (calculated from SPY options)
Near-term: ${report.nearTermExpiry} (${report.nearTermDte} DTE) - ${report.nearTermVol.toFixed(1)}%
Next-term: ${report.nextTermExpiry} (${report.nextTermDte} DTE) - ${report.nextTermVol.toFixed(1)}%
SPY: $${report.spot.toFixed(2)}
Contributing strikes: ${report.contributingStrikes}`
    : "VIX - Calculating from SPY options...";

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 10px",
        borderRadius: 6,
        fontSize: 11,
        fontWeight: 500,
        border: `1px solid ${light.border.secondary}`,
        background: light.bg.tertiary,
        color: light.text.secondary,
      }}
      title={tooltip}
    >
      <span style={{ fontWeight: 600, color: light.text.primary }}>VIX</span>
      <span
        style={{
          fontFamily: "monospace",
          fontWeight: 600,
          color: vixColor,
          minWidth: 40,
          textAlign: "right",
        }}
      >
        {vixStr}
      </span>
      {!loaded && (
        <span style={{ fontSize: 9, color: light.text.muted }}>...</span>
      )}
    </div>
  );
}
