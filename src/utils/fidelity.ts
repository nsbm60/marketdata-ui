/**
 * Fidelity CSV parser and utilities
 */

export interface FidelityPosition {
  accountNumber: string;
  accountName: string;
  symbol: string;           // Original Fidelity symbol
  osiSymbol: string | null; // Converted OSI symbol for options, null for equities
  description: string;
  quantity: number;
  lastPrice: number | null;
  currentValue: number | null; // Current market value
  costBasisTotal: number | null;
  avgCostBasis: number | null;
  type: "equity" | "option" | "cash" | "pending";
  optionType?: "call" | "put";
  strike?: number;
  expiry?: string;          // YYYY-MM-DD format
  underlying?: string;
}

/**
 * Result of parsing a Fidelity CSV export.
 */
export interface FidelityImportResult {
  positions: FidelityPosition[];
  downloadedAt: Date | null;      // Extracted from "Date downloaded..." line
  downloadedAtRaw: string | null; // Original string for display
}

/**
 * Parse Fidelity CSV export into positions array.
 * Includes cash positions and pending activity.
 * Also extracts the download timestamp from the footer.
 */
export function parseFidelityCSV(csvText: string): FidelityImportResult {
  const lines = csvText.split("\n");
  if (lines.length < 2) return { positions: [], downloadedAt: null, downloadedAtRaw: null };

  // Find header line
  const headerLine = lines[0];
  if (!headerLine.includes("Account Number")) {
    console.error("[Fidelity] Invalid CSV format - missing headers");
    return { positions: [], downloadedAt: null, downloadedAtRaw: null };
  }

  // Extract download timestamp from footer
  // Format: "Date downloaded Dec-30-2025 at 1:06 p.m ET"
  const { downloadedAt, downloadedAtRaw } = extractDownloadTimestamp(lines);

  const positions: FidelityPosition[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Stop at disclaimer (starts with quote)
    if (line.startsWith('"')) break;

    const fields = parseCSVLine(line);
    if (fields.length < 16) continue;

    const [
      accountNumber,
      accountName,
      rawSymbol,
      description,
      quantityStr,
      lastPriceStr,
      _lastPriceChange,
      currentValueStr,
      _todayGainDollar,
      _todayGainPercent,
      _totalGainDollar,
      _totalGainPercent,
      _percentOfAccount,
      costBasisTotalStr,
      avgCostBasisStr,
      typeStr,
    ] = fields;

    const symbol = rawSymbol.trim();

    // Handle pending activity
    if (rawSymbol === "Pending activity") {
      const currentValue = parseNumber(currentValueStr);
      if (currentValue !== null && currentValue !== 0) {
        positions.push({
          accountNumber,
          accountName,
          symbol: "Pending Activity",
          osiSymbol: null,
          description: description || "Pending transactions",
          quantity: 1,
          lastPrice: null,
          currentValue,
          costBasisTotal: null,
          avgCostBasis: null,
          type: "pending",
        });
      }
      continue;
    }

    // Handle cash positions (SPAXX, core cash, etc.)
    const isCash = typeStr === "Cash" || rawSymbol.includes("SPAXX") || rawSymbol.includes("FDRXX") || rawSymbol.includes("FCASH");
    if (isCash) {
      const currentValue = parseNumber(currentValueStr);
      if (currentValue !== null) {
        positions.push({
          accountNumber,
          accountName,
          symbol: symbol || "Cash",
          osiSymbol: null,
          description: description || "Cash",
          quantity: currentValue,
          lastPrice: 1,
          currentValue,
          costBasisTotal: currentValue,
          avgCostBasis: 1,
          type: "cash",
        });
      }
      continue;
    }

    const isOption = symbol.startsWith("-") || symbol.startsWith(" -");
    const cleanSymbol = symbol.replace(/^[\s-]+/, "");

    // Parse quantity (remove commas, handle negative)
    let quantity = parseNumber(quantityStr) || 0;
    // Short options have - in symbol, quantity should be negative
    if (symbol.includes("-") && quantity > 0) {
      quantity = -quantity;
    }

    const position: FidelityPosition = {
      accountNumber,
      accountName,
      symbol: cleanSymbol,
      osiSymbol: null,
      description,
      quantity,
      lastPrice: parseNumber(lastPriceStr),
      currentValue: parseNumber(currentValueStr),
      costBasisTotal: parseNumber(costBasisTotalStr),
      avgCostBasis: parseNumber(avgCostBasisStr),
      type: isOption ? "option" : "equity",
    };

    if (isOption) {
      const parsed = parseFidelityOptionSymbol(cleanSymbol);
      if (parsed) {
        position.osiSymbol = parsed.osiSymbol;
        position.optionType = parsed.optionType;
        position.strike = parsed.strike;
        position.expiry = parsed.expiry;
        position.underlying = parsed.underlying;
      }
    }

    positions.push(position);
  }

  return { positions, downloadedAt, downloadedAtRaw };
}

/**
 * Extract download timestamp from Fidelity CSV footer.
 * Looks for: "Date downloaded Dec-30-2025 at 1:06 p.m ET"
 */
function extractDownloadTimestamp(lines: string[]): { downloadedAt: Date | null; downloadedAtRaw: string | null } {
  for (const line of lines) {
    const match = line.match(/Date downloaded\s+([A-Za-z]{3}-\d{1,2}-\d{4})\s+at\s+(\d{1,2}:\d{2})\s*(a\.m\.|p\.m\.)\s*ET/i);
    if (match) {
      const [, dateStr, timeStr, ampm] = match;
      const rawString = `${dateStr} at ${timeStr} ${ampm} ET`;

      try {
        // Parse "Dec-30-2025" -> month, day, year
        const [monthStr, dayStr, yearStr] = dateStr.split("-");
        const months: Record<string, number> = {
          Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
          Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11
        };
        const month = months[monthStr];
        const day = parseInt(dayStr, 10);
        const year = parseInt(yearStr, 10);

        // Parse time "1:06" with am/pm
        const [hourStr, minStr] = timeStr.split(":");
        let hour = parseInt(hourStr, 10);
        const min = parseInt(minStr, 10);

        // Convert to 24-hour
        if (ampm.toLowerCase().includes("p") && hour !== 12) {
          hour += 12;
        } else if (ampm.toLowerCase().includes("a") && hour === 12) {
          hour = 0;
        }

        // Create date in ET (approximate - use local for now)
        const downloadedAt = new Date(year, month, day, hour, min);

        console.log(`[Fidelity] Extracted download timestamp: ${rawString} -> ${downloadedAt.toISOString()}`);
        return { downloadedAt, downloadedAtRaw: rawString };
      } catch (e) {
        console.warn("[Fidelity] Failed to parse download timestamp:", dateStr, timeStr, ampm);
      }
    }
  }

  return { downloadedAt: null, downloadedAtRaw: null };
}

/**
 * Parse a CSV line handling quoted fields with commas
 */
function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      fields.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current.trim());

  return fields;
}

/**
 * Parse a number from Fidelity format (handles $, commas, +/- signs)
 */
function parseNumber(str: string): number | null {
  if (!str || str === "--" || str === "n/a") return null;
  const cleaned = str.replace(/[$,+%]/g, "").trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

/**
 * Parse Fidelity option symbol and convert to OSI format.
 *
 * Fidelity format: AMD251226P212.5
 *   - AMD = underlying
 *   - 251226 = YYMMDD expiry
 *   - P = put (C = call)
 *   - 212.5 = strike price
 *
 * OSI format: AMD251226P02125000
 *   - Strike is 8 digits: price * 1000, zero-padded
 */
function parseFidelityOptionSymbol(symbol: string): {
  osiSymbol: string;
  underlying: string;
  expiry: string;
  optionType: "call" | "put";
  strike: number;
} | null {
  // Match: UNDERLYING + YYMMDD + C/P + STRIKE
  const match = symbol.match(/^([A-Z]+)(\d{6})([CP])(\d+\.?\d*)$/);
  if (!match) {
    console.warn(`[Fidelity] Could not parse option symbol: ${symbol}`);
    return null;
  }

  const [, underlying, dateStr, cpChar, strikeStr] = match;
  const optionType = cpChar === "C" ? "call" : "put";
  const strike = parseFloat(strikeStr);

  // Convert date YYMMDD to YYYY-MM-DD
  const yy = parseInt(dateStr.slice(0, 2), 10);
  const mm = dateStr.slice(2, 4);
  const dd = dateStr.slice(4, 6);
  const year = yy >= 50 ? 1900 + yy : 2000 + yy;
  const expiry = `${year}-${mm}-${dd}`;

  // Convert strike to OSI format (8 digits, strike * 1000)
  const strikeOSI = Math.round(strike * 1000)
    .toString()
    .padStart(8, "0");

  const osiSymbol = `${underlying}${dateStr}${cpChar}${strikeOSI}`;

  return { osiSymbol, underlying, expiry, optionType, strike };
}

/**
 * Group positions by underlying symbol
 */
export function groupPositionsByUnderlying(
  positions: FidelityPosition[]
): Map<string, FidelityPosition[]> {
  const groups = new Map<string, FidelityPosition[]>();

  for (const pos of positions) {
    const key = pos.underlying || pos.symbol;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(pos);
  }

  return groups;
}

/**
 * Get all unique symbols for market data subscription
 */
export function getSubscriptionSymbols(positions: FidelityPosition[]): {
  equities: string[];
  options: string[];
} {
  const equities = new Set<string>();
  const options = new Set<string>();

  for (const pos of positions) {
    if (pos.type === "option" && pos.osiSymbol) {
      options.add(pos.osiSymbol);
      if (pos.underlying) {
        equities.add(pos.underlying);
      }
    } else if (pos.type === "equity") {
      equities.add(pos.symbol);
    }
  }

  return {
    equities: Array.from(equities),
    options: Array.from(options),
  };
}

// LocalStorage key for persisted positions
const STORAGE_KEY = "fidelity.positions";

export function savePositions(positions: FidelityPosition[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(positions));
}

export function loadPositions(): FidelityPosition[] {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return [];
  try {
    return JSON.parse(stored);
  } catch {
    return [];
  }
}

export function clearPositions(): void {
  localStorage.removeItem(STORAGE_KEY);
}
