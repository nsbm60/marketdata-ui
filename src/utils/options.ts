/**
 * Shared utilities for option symbol parsing and formatting.
 */

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export type OptionRight = "call" | "put";

export type ParsedOption = {
  underlying: string;
  right: OptionRight;
  strike: number;
  expiration: string; // YYYY-MM-DD
};

// ─────────────────────────────────────────────────────────────
// Symbol Parsing
// ─────────────────────────────────────────────────────────────

/**
 * Parse an option symbol (OSI or other formats) into its components.
 *
 * Supported formats:
 * - OSI: AAPL250117C00190000
 * - Underscore: AAPL_011725C_190
 * - Fallback: AAPL250117C190
 */
export function parseOptionSymbol(sym: string): ParsedOption | null {
  const S = String(sym || "").toUpperCase().replace(/\s+/g, "");

  // OSI format: AAPL250117C00190000
  const m1 = /^([A-Z]+)(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/.exec(S);
  if (m1) {
    const underlying = m1[1];
    const yy = m1[2], mm = m1[3], dd = m1[4];
    const right: OptionRight = m1[5] === "C" ? "call" : "put";
    const strike = parseInt(m1[6], 10) / 1000;
    const yyyy = Number(yy) + 2000;
    const expiration = `${yyyy}-${mm}-${dd}`;
    return { underlying, right, strike, expiration };
  }

  // Underscore format: AAPL_011725C_190
  const m2 = /^([A-Z]+)[._-](\d{2})(\d{2})(\d{2})([CP])[._-](\d+(\.\d+)?)$/.exec(S);
  if (m2) {
    const underlying = m2[1];
    const yy = m2[2], mm = m2[3], dd = m2[4];
    const right: OptionRight = m2[5] === "C" ? "call" : "put";
    const strike = parseFloat(m2[6]);
    const yyyy = Number(yy) + 2000;
    const expiration = `${yyyy}-${mm}-${dd}`;
    return { underlying, right, strike, expiration };
  }

  // Fallback (no reliable expiry)
  const m3 = /^([A-Z]+)\d{6,8}([CP])(\d+(\.\d+)?)$/.exec(S);
  if (m3) {
    const underlying = m3[1];
    const right: OptionRight = m3[2] === "C" ? "call" : "put";
    const strike = parseFloat(m3[3]);
    return { underlying, right, strike, expiration: "1970-01-01" };
  }

  return null;
}

// ─────────────────────────────────────────────────────────────
// Symbol Building
// ─────────────────────────────────────────────────────────────

/**
 * Build an OSI option symbol from components.
 *
 * @param underlying - The underlying symbol (e.g., "AAPL")
 * @param expiry - Expiry in YYYYMMDD, YYYY-MM-DD, or YYMMDD format
 * @param right - "C", "P", "Call", or "Put"
 * @param strike - Strike price
 * @returns OSI symbol (e.g., "AAPL251219C00140000")
 */
export function buildOsiSymbol(
  underlying: string,
  expiry: string,
  right: string,
  strike: number
): string {
  // Normalize expiry to YYMMDD
  let yymmdd: string;
  if (expiry.includes("-")) {
    // YYYY-MM-DD -> YYMMDD
    const parts = expiry.split("-");
    if (parts.length === 3) {
      yymmdd = parts[0].substring(2) + parts[1] + parts[2];
    } else if (parts.length === 2) {
      // YYYY-MM (no day) - shouldn't happen for valid option contracts
      console.warn(`[buildOsiSymbol] Expiry missing day: ${expiry}`);
      yymmdd = parts[0].substring(2) + parts[1] + "01";
    } else {
      yymmdd = expiry;
    }
  } else if (expiry.length === 8) {
    // YYYYMMDD -> YYMMDD
    yymmdd = expiry.substring(2);
  } else if (expiry.length === 6) {
    // Already YYMMDD
    yymmdd = expiry;
  } else {
    console.warn(`[buildOsiSymbol] Unknown expiry format: ${expiry}`);
    yymmdd = expiry;
  }

  const rightChar = right === "Call" || right === "C" ? "C" : "P";
  const strikeFormatted = String(Math.round(strike * 1000)).padStart(8, "0");
  return `${underlying.toUpperCase()}${yymmdd}${rightChar}${strikeFormatted}`;
}

// ─────────────────────────────────────────────────────────────
// Expiry Formatting
// ─────────────────────────────────────────────────────────────

/**
 * Format expiry from YYYYMMDD to human-readable.
 * "20251212" -> "Dec 12, 2025"
 */
export function formatExpiryYYYYMMDD(expiry: string): string {
  try {
    if (expiry.length !== 8) return expiry;
    const y = expiry.substring(0, 4);
    const m = expiry.substring(4, 6);
    const d = expiry.substring(6, 8);
    const dt = new Date(Number(y), Number(m) - 1, Number(d));
    return dt.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return expiry;
  }
}

/**
 * Format expiry from YYYY-MM-DD to human-readable.
 * "2025-12-19" -> "Dec 19, 2025"
 */
export function formatExpiryISO(expiry: string): string {
  try {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(expiry);
    if (!m) return expiry;
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    const dt = new Date(y, mo - 1, d);
    return dt.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return expiry;
  }
}

/**
 * Calculate days to expiry from today.
 * Returns 0 if expiry is today, negative if past.
 */
export function daysToExpiry(expiry: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(expiry);
  if (!m) return 0;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const expiryDate = new Date(y, mo - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffMs = expiryDate.getTime() - today.getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Format expiry from YYYY-MM-DD to short format for tabs.
 * "2025-12-19" -> "Dec 19"
 */
export function formatExpiryShort(expiry: string): string {
  try {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(expiry);
    if (!m) return expiry;
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    const dt = new Date(y, mo - 1, d);
    return dt.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  } catch {
    return expiry;
  }
}

/**
 * Format expiry with days to expiry.
 * "2025-12-19" -> "Dec 19 (3d)"
 */
export function formatExpiryWithDTE(expiry: string): string {
  const short = formatExpiryShort(expiry);
  const dte = daysToExpiry(expiry);
  return `${short} (${dte}d)`;
}

/**
 * Format expiry from YYYY-MM-DD with weekday.
 * "2025-12-19" -> "Fri, Dec 19, 2025"
 */
export function formatExpiryWithWeekday(expiry: string): string {
  try {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(expiry);
    if (!m) return expiry;
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    const dt = new Date(y, mo - 1, d);
    return dt.toLocaleDateString(undefined, {
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "2-digit",
    });
  } catch {
    return expiry;
  }
}

// ─────────────────────────────────────────────────────────────
// Option Sorting
// ─────────────────────────────────────────────────────────────

/**
 * Normalized option fields for sorting.
 */
export interface OptionSortFields {
  expiry: string;       // Any format (YYYYMMDD or YYYY-MM-DD)
  right: string;        // "C", "P", "Call", "Put", "call", or "put"
  strike: number;
}

/**
 * Normalize right/optionType to single char for comparison.
 * "C" < "P" so calls sort before puts.
 */
function normalizeRight(right: string): string {
  const r = right.toUpperCase();
  if (r === "C" || r === "CALL") return "C";
  if (r === "P" || r === "PUT") return "P";
  return r;
}

/**
 * Normalize expiry to comparable string (YYYYMMDD).
 * Handles both YYYYMMDD and YYYY-MM-DD formats.
 */
function normalizeExpiry(expiry: string): string {
  if (!expiry) return "";
  // If already YYYYMMDD, return as-is
  if (/^\d{8}$/.test(expiry)) return expiry;
  // If YYYY-MM-DD, convert to YYYYMMDD
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(expiry);
  if (m) return `${m[1]}${m[2]}${m[3]}`;
  return expiry;
}

/**
 * Compare two options for sorting.
 * Sort order: expiry (asc), call before put, strike (asc)
 *
 * @example
 * options.sort((a, b) => compareOptions(
 *   { expiry: a.expiry, right: a.right, strike: a.strike },
 *   { expiry: b.expiry, right: b.right, strike: b.strike }
 * ));
 */
export function compareOptions(a: OptionSortFields, b: OptionSortFields): number {
  // 1. Compare by expiry (ascending)
  const expA = normalizeExpiry(a.expiry);
  const expB = normalizeExpiry(b.expiry);
  if (expA !== expB) return expA.localeCompare(expB);

  // 2. Compare by right (calls before puts: C < P)
  const rightA = normalizeRight(a.right);
  const rightB = normalizeRight(b.right);
  if (rightA !== rightB) return rightA.localeCompare(rightB);

  // 3. Compare by strike (ascending)
  return (a.strike ?? 0) - (b.strike ?? 0);
}
