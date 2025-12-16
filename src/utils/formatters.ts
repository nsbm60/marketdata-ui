/**
 * Shared formatting utilities for market data display.
 */

// Type guard for finite numbers
export function isNum(v: any): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

// Price formatter (2 decimal places)
const priceFmt = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function fmtPrice(v: any): string {
  return isNum(v) ? priceFmt.format(v) : "—";
}

// Greek formatter (4 decimal places)
const greekFmt = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
});

export function fmtGreek(v: any): string {
  return isNum(v) ? greekFmt.format(v) : "—";
}

// Volume/quantity formatter (no decimals, with commas)
const volFmt = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 0,
});

export function fmtVolume(v: any): string {
  return isNum(v) ? volFmt.format(v) : "—";
}
