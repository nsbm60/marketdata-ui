// src/components/shared/TradeButton.tsx
// Reusable BUY/SELL button component for trading interfaces

import { CSSProperties, MouseEvent } from "react";

type Side = "BUY" | "SELL";

interface TradeButtonProps {
  side: Side;
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
  /** Compact mode for dense grids (smaller font, tighter padding) */
  compact?: boolean;
  /** Custom label (defaults to "BUY"/"SELL" or "B"/"S" in compact mode) */
  label?: string;
}

const colors = {
  BUY: {
    background: "#dcfce7",
    color: "#166534",
    border: "1px solid #86efac",
  },
  SELL: {
    background: "#fce7f3",
    color: "#831843",
    border: "1px solid #fda4af",
  },
};

export default function TradeButton({ side, onClick, compact, label }: TradeButtonProps) {
  const defaultLabel = compact ? (side === "BUY" ? "B" : "S") : side;
  const displayLabel = label ?? defaultLabel;

  const style: CSSProperties = {
    padding: compact ? "2px 6px" : "2px 8px",
    fontSize: compact ? 9 : 11,
    fontWeight: 600,
    borderRadius: compact ? 3 : 4,
    cursor: "pointer",
    lineHeight: compact ? 1 : undefined,
    ...colors[side],
  };

  return (
    <button onClick={onClick} style={style}>
      {displayLabel}
    </button>
  );
}

/** Style helper for button containers */
export const tradeButtonContainer: CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 6,
};

export const tradeButtonContainerCompact: CSSProperties = {
  display: "flex",
  justifyContent: "center",
  gap: 4,
  padding: "1px 2px",
};
