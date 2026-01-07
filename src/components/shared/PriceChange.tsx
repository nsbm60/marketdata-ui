// src/components/shared/PriceChange.tsx
import { formatPctChange } from "../../services/closePrices";
import { pnl } from "../../theme";

// Shared color constants for price changes
export const CHANGE_COLOR_UP = pnl.positive;
export const CHANGE_COLOR_DOWN = pnl.negative;

export function getChangeColor(value: number | undefined): string | undefined {
  if (value === undefined) return undefined;
  return value >= 0 ? pnl.positive : pnl.negative;
}

interface PriceChangePercentProps {
  value?: number;
  showArrow?: boolean;
}

/**
 * Displays a percentage change with optional arrow and coloring.
 * Example: "▲ +1.25%" in green or "▼ -0.50%" in red
 */
export function PriceChangePercent({ value, showArrow = true }: PriceChangePercentProps) {
  if (value === undefined) return <span>—</span>;

  const color = getChangeColor(value);
  const arrow = value >= 0 ? "▲" : "▼";

  return (
    <span style={{ color, fontWeight: 600, whiteSpace: "nowrap" }}>
      {showArrow && `${arrow} `}
      {formatPctChange(value)}
    </span>
  );
}

interface PriceChangeDollarProps {
  value?: number;
  decimals?: number;
}

/**
 * Displays a dollar change with sign and coloring.
 * Example: "+1.25" in green or "-0.50" in red
 */
export function PriceChangeDollar({ value, decimals = 2 }: PriceChangeDollarProps) {
  if (value === undefined) return <span>—</span>;

  const color = getChangeColor(value);
  const sign = value >= 0 ? "+" : "";

  return (
    <span style={{ color, fontWeight: 600, whiteSpace: "nowrap" }}>
      {sign}
      {value.toFixed(decimals)}
    </span>
  );
}
