// src/components/portfolio/PnLSummary.tsx
import { useMemo, useEffect, useState } from "react";
import { IbPosition } from "../../types/portfolio";
import { buildOsiSymbol, formatExpiryYYYYMMDD } from "../../utils/options";
import { getChannelPrices } from "../../hooks/useMarketData";
import { formatCloseDateShort } from "../../services/closePrices";
import { TimeframeInfo } from "../../services/marketState";
import {
  fetchPositionSnapshots,
  PositionSnapshot,
  PositionSnapshotResponse,
  buildPositionKey,
} from "../../services/positionSnapshots";

type Props = {
  account: string;
  positions: IbPosition[];
  equityPrices: Map<string, { last?: number; bid?: number; ask?: number }>;
  timeframe: string;
  timeframes: TimeframeInfo[];
};

type PositionPnL = {
  symbol: string;
  displaySymbol: React.ReactNode;
  secType: string;
  currentQty: number;
  snapshotQty: number;
  currentPrice: number;
  snapshotPrice: number;
  currentValue: number;
  snapshotValue: number;
  pnlDollar: number;
  pnlPercent: number;
  status: "existing" | "new" | "closed";
};

export default function PnLSummary({
  account,
  positions,
  equityPrices,
  timeframe,
  timeframes,
}: Props) {
  // State for snapshot data from CalcServer
  const [snapshot, setSnapshot] = useState<PositionSnapshotResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch snapshots when account or timeframe changes
  useEffect(() => {
    if (!account || !timeframe) return;

    // Map timeframe ID to CalcServer format
    const calcTimeframe = mapTimeframe(timeframe);
    if (!calcTimeframe) return;

    setLoading(true);
    setError(null);

    fetchPositionSnapshots(account, calcTimeframe)
      .then((data) => {
        setSnapshot(data);
        if (!data) {
          setError("No snapshot data available");
        }
      })
      .catch((err) => {
        console.error("[PnLSummary] Error fetching snapshots:", err);
        setError("Failed to fetch snapshot data");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [account, timeframe]);

  // Get current timeframe info for display
  const currentTimeframeInfo = useMemo(() => {
    return timeframes.find((t) => t.id === timeframe);
  }, [timeframes, timeframe]);

  // Build snapshot lookup map
  const snapshotMap = useMemo(() => {
    const map = new Map<string, PositionSnapshot>();
    if (snapshot?.positions) {
      snapshot.positions.forEach((p) => {
        const key = buildPositionKey(p.symbol, p.sec_type, p.strike, p.expiry, p.right);
        map.set(key, p);
      });
    }
    return map;
  }, [snapshot]);

  // Calculate P&L for each position
  const positionPnLs = useMemo(() => {
    const results: PositionPnL[] = [];
    const processedKeys = new Set<string>();

    // Process current positions
    positions.forEach((p) => {
      const posKey = buildPositionKey(
        p.symbol,
        p.secType,
        p.strike,
        p.expiry ? formatExpiryForKey(p.expiry) : undefined,
        p.right
      );
      processedKeys.add(posKey);

      // Get current price
      let currentPrice = 0;
      if (p.secType === "OPT" && p.strike !== undefined && p.expiry !== undefined && p.right !== undefined) {
        const osiSymbol = buildOsiSymbol(p.symbol, p.expiry, p.right, p.strike);
        const priceData = getChannelPrices("option").get(osiSymbol);
        currentPrice = priceData?.last || 0;
      } else {
        const priceData = equityPrices.get(p.symbol.toUpperCase());
        currentPrice = priceData?.last || 0;
      }

      const contractMultiplier = p.secType === "OPT" ? 100 : 1;
      const currentValue = p.quantity * currentPrice * contractMultiplier;

      // Get snapshot data
      const snapshotPos = snapshotMap.get(posKey);
      const snapshotValue = snapshotPos?.market_value ?? 0;
      const snapshotPrice = snapshotPos?.close_price ?? 0;
      const snapshotQty = snapshotPos?.quantity ?? 0;

      const pnlDollar = currentValue - snapshotValue;
      const pnlPercent = snapshotValue !== 0 ? (pnlDollar / Math.abs(snapshotValue)) * 100 : 0;

      // Format symbol display
      const displaySymbol = formatDisplaySymbol(p);

      results.push({
        symbol: p.symbol,
        displaySymbol,
        secType: p.secType,
        currentQty: p.quantity,
        snapshotQty,
        currentPrice,
        snapshotPrice,
        currentValue,
        snapshotValue,
        pnlDollar,
        pnlPercent,
        status: snapshotPos ? "existing" : "new",
      });
    });

    // Process closed positions (in snapshot but not in current)
    snapshotMap.forEach((snapshotPos, key) => {
      if (!processedKeys.has(key)) {
        const displaySymbol = formatDisplaySymbolFromSnapshot(snapshotPos);

        results.push({
          symbol: snapshotPos.symbol,
          displaySymbol,
          secType: snapshotPos.sec_type,
          currentQty: 0,
          snapshotQty: snapshotPos.quantity,
          currentPrice: 0,
          snapshotPrice: snapshotPos.close_price,
          currentValue: 0,
          snapshotValue: snapshotPos.market_value,
          pnlDollar: -snapshotPos.market_value,
          pnlPercent: -100,
          status: "closed",
        });
      }
    });

    // Sort by symbol, then STK before OPT, for stable ordering
    results.sort((a, b) => {
      // First by symbol
      const symCmp = a.symbol.localeCompare(b.symbol);
      if (symCmp !== 0) return symCmp;
      // STK before OPT
      if (a.secType !== b.secType) return a.secType === "STK" ? -1 : 1;
      // For same symbol+type, maintain insertion order (stable)
      return 0;
    });

    return results;
  }, [positions, equityPrices, snapshotMap]);

  // Calculate totals
  const totals = useMemo(() => {
    const totalCurrentValue = positionPnLs.reduce((sum, p) => sum + p.currentValue, 0);
    const totalSnapshotValue = positionPnLs.reduce((sum, p) => sum + p.snapshotValue, 0);
    const totalPnlDollar = positionPnLs.reduce((sum, p) => sum + p.pnlDollar, 0);
    const totalPnlPercent =
      totalSnapshotValue !== 0 ? (totalPnlDollar / Math.abs(totalSnapshotValue)) * 100 : 0;
    return { totalCurrentValue, totalSnapshotValue, totalPnlDollar, totalPnlPercent };
  }, [positionPnLs]);

  const formatPrice = (value: number) => value.toFixed(4);
  const formatValue = (value: number) => {
    if (value < 0) {
      return `(${Math.abs(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`;
    }
    return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  const formatPnL = (value: number) => {
    const prefix = value >= 0 ? "+" : "";
    return `${prefix}${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };
  const formatPnLPercent = (value: number) => {
    const prefix = value >= 0 ? "+" : "";
    return `${prefix}${value.toFixed(2)}%`;
  };

  const getPnLColor = (value: number) => (value >= 0 ? "#16a34a" : "#dc2626");
  const getStatusBadge = (status: "existing" | "new" | "closed") => {
    if (status === "new") return <span style={newBadge}>NEW</span>;
    if (status === "closed") return <span style={closedBadge}>CLOSED</span>;
    return null;
  };

  // Show loading/error states
  if (loading) {
    return <div style={{ padding: 20, color: "#666" }}>Loading snapshot data...</div>;
  }

  // Show message if no snapshot data
  const hasSnapshotData = snapshot?.positions && snapshot.positions.length > 0;
  const noSnapshotMessage = !snapshot
    ? "Could not fetch snapshot data from CalcServer. Check console for details."
    : !snapshot.positions || snapshot.positions.length === 0
      ? `No position snapshots found for ${snapshot.snapshot_date}. Run the position snapshot batch job to populate historical data.`
      : null;

  return (
    <div style={table}>
      {/* Header */}
      <div style={{ ...hdr, gridTemplateColumns: "150px 36px 55px 55px 70px 70px 90px 90px 80px 70px" }}>
        <div style={hdrCell}>Symbol</div>
        <div style={hdrCell}>Type</div>
        <div style={hdrCellRight}>Qty</div>
        <div style={hdrCellRight}>Snap Qty</div>
        <div style={hdrCellRight}>Last</div>
        <div style={hdrCellRight}>
          {snapshot?.snapshot_date ? formatCloseDateShort(snapshot.snapshot_date) : "Snap"}
        </div>
        <div style={hdrCellRight}>Mkt Value</div>
        <div style={hdrCellRight}>
          {currentTimeframeInfo ? `${currentTimeframeInfo.label} Val` : "Snap Val"}
        </div>
        <div style={hdrCellRight}>P&L $</div>
        <div style={hdrCellRight}>P&L %</div>
      </div>

      {/* Position Rows */}
      {positionPnLs.map((p, i) => (
        <div
          key={i}
          style={{
            ...row,
            gridTemplateColumns: "150px 36px 55px 55px 70px 70px 90px 90px 80px 70px",
            opacity: p.status === "closed" ? 0.6 : 1,
          }}
        >
          <div>
            {p.displaySymbol}
            {getStatusBadge(p.status)}
          </div>
          <div style={gray10}>{p.secType}</div>
          <div style={rightMono}>{p.currentQty !== 0 ? p.currentQty.toLocaleString() : "—"}</div>
          <div style={rightMono}>{p.snapshotQty !== 0 ? p.snapshotQty.toLocaleString() : "—"}</div>
          <div style={rightMono}>{p.currentPrice > 0 ? formatPrice(p.currentPrice) : "—"}</div>
          <div style={rightMono}>{p.snapshotPrice > 0 ? formatPrice(p.snapshotPrice) : "—"}</div>
          <div style={rightMono}>{p.currentValue !== 0 ? formatValue(p.currentValue) : "—"}</div>
          <div style={rightMono}>{p.snapshotValue !== 0 ? formatValue(p.snapshotValue) : "—"}</div>
          <div style={{ ...rightMono, color: getPnLColor(p.pnlDollar), fontWeight: 600 }}>
            {formatPnL(p.pnlDollar)}
          </div>
          <div style={{ ...rightMono, color: getPnLColor(p.pnlPercent), fontWeight: 600 }}>
            {p.snapshotValue !== 0 ? formatPnLPercent(p.pnlPercent) : "—"}
          </div>
        </div>
      ))}

      {/* Totals Row */}
      <div
        style={{
          ...row,
          gridTemplateColumns: "150px 36px 55px 55px 70px 70px 90px 90px 80px 70px",
          background: "#f8fafc",
          fontWeight: 600,
        }}
      >
        <div>Total</div>
        <div></div>
        <div></div>
        <div></div>
        <div></div>
        <div></div>
        <div style={rightMono}>{formatValue(totals.totalCurrentValue)}</div>
        <div style={rightMono}>
          {totals.totalSnapshotValue !== 0 ? formatValue(totals.totalSnapshotValue) : "—"}
        </div>
        <div style={{ ...rightMono, color: getPnLColor(totals.totalPnlDollar) }}>
          {formatPnL(totals.totalPnlDollar)}
        </div>
        <div style={{ ...rightMono, color: getPnLColor(totals.totalPnlPercent) }}>
          {totals.totalSnapshotValue !== 0 ? formatPnLPercent(totals.totalPnlPercent) : "—"}
        </div>
      </div>

      {/* Snapshot info footer */}
      {snapshot?.snapshot_date && (
        <div style={{ padding: "8px 10px", fontSize: 10, color: "#666", borderTop: "1px solid #e5e7eb" }}>
          Comparing to snapshot from {snapshot.snapshot_date}
          {!hasSnapshotData && " (no positions in snapshot)"}
        </div>
      )}

      {/* Warning if no snapshot data */}
      {noSnapshotMessage && (
        <div style={{ padding: "12px 10px", fontSize: 11, color: "#b45309", background: "#fef3c7", borderTop: "1px solid #fcd34d" }}>
          {noSnapshotMessage}
        </div>
      )}
    </div>
  );
}

// ---- Helpers ----

function mapTimeframe(timeframe: string): string | null {
  // Map UI timeframe IDs to CalcServer format
  const mapping: Record<string, string> = {
    "1d": "1D",
    "2d": "1D", // Use 1D for 2d as well for now
    "1w": "1W",
    "1m": "1M",
    "3m": "3M",
    "ytd": "YTD",
  };
  return mapping[timeframe.toLowerCase()] ?? timeframe.toUpperCase();
}

function formatExpiryForKey(expiry: string): string {
  // Convert YYYYMMDD to YYYY-MM-DD for matching
  if (expiry.length === 8 && !expiry.includes("-")) {
    return `${expiry.slice(0, 4)}-${expiry.slice(4, 6)}-${expiry.slice(6, 8)}`;
  }
  return expiry;
}

function formatDisplaySymbol(p: IbPosition): React.ReactNode {
  if (p.secType === "OPT" && p.strike !== undefined && p.expiry !== undefined && p.right !== undefined) {
    const rightLabel = p.right === "C" || p.right === "Call" ? "Call" : "Put";
    const formattedExpiry = formatExpiryYYYYMMDD(p.expiry);
    return (
      <div>
        <div style={{ fontWeight: 600, fontSize: 11 }}>
          {p.symbol} {p.strike % 1 === 0 ? p.strike.toFixed(0) : p.strike} {rightLabel}
        </div>
        <div style={{ fontSize: 9, color: "#666" }}>{formattedExpiry}</div>
      </div>
    );
  }
  return <div style={{ fontWeight: 600 }}>{p.symbol}</div>;
}

function formatDisplaySymbolFromSnapshot(p: PositionSnapshot): React.ReactNode {
  if (p.sec_type === "OPT" && p.strike && p.expiry && p.right) {
    const rightLabel = p.right === "C" ? "Call" : "Put";
    return (
      <div>
        <div style={{ fontWeight: 600, fontSize: 11 }}>
          {p.symbol} {p.strike % 1 === 0 ? p.strike.toFixed(0) : p.strike} {rightLabel}
        </div>
        <div style={{ fontSize: 9, color: "#666" }}>{p.expiry}</div>
      </div>
    );
  }
  return <div style={{ fontWeight: 600 }}>{p.symbol}</div>;
}

// ---- Styles ----

const table: React.CSSProperties = { display: "flex", flexDirection: "column", maxHeight: "100%", overflow: "auto" };
const hdr: React.CSSProperties = {
  display: "grid",
  fontWeight: 600,
  fontSize: 10.5,
  color: "#374151",
  padding: "0 10px",
  background: "#f8fafc",
  height: 26,
  alignItems: "center",
  borderBottom: "1px solid #e5e7eb",
  position: "sticky",
  top: 0,
  zIndex: 1,
};
const hdrCell: React.CSSProperties = { borderRight: "1px solid #ddd", paddingRight: 4 };
const hdrCellRight: React.CSSProperties = { ...hdrCell, textAlign: "right" };
const row: React.CSSProperties = {
  display: "grid",
  fontSize: 11,
  minHeight: 32,
  alignItems: "center",
  padding: "0 10px",
  borderBottom: "1px solid #f3f4f6",
};
const cellBorder: React.CSSProperties = { borderRight: "1px solid #eee", paddingRight: 4, paddingLeft: 2 };
const rightMono: React.CSSProperties = { ...cellBorder, textAlign: "right", fontFamily: "ui-monospace, monospace" };
const gray10: React.CSSProperties = { ...cellBorder, fontSize: 10, color: "#666" };
const newBadge: React.CSSProperties = {
  marginLeft: 4,
  padding: "1px 4px",
  fontSize: 8,
  fontWeight: 600,
  background: "#dbeafe",
  color: "#1d4ed8",
  borderRadius: 2,
};
const closedBadge: React.CSSProperties = {
  marginLeft: 4,
  padding: "1px 4px",
  fontSize: 8,
  fontWeight: 600,
  background: "#fee2e2",
  color: "#dc2626",
  borderRadius: 2,
};
