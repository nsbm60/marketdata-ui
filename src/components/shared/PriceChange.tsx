// src/components/shared/PriceChange.tsx
import { formatPctChange } from "../../services/closePrices";

// Shared color constants for price changes
export const CHANGE_COLOR_UP = "#16a34a";
export const CHANGE_COLOR_DOWN = "#dc2626";

export function getChangeColor(value: number | undefined): string | undefined {
  if (value === undefined) return undefined;
  return value >= 0 ? CHANGE_COLOR_UP : CHANGE_COLOR_DOWN;
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
