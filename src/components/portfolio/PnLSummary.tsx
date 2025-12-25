// src/components/portfolio/PnLSummary.tsx
import { useMemo } from "react";
import { IbPosition } from "../../types/portfolio";
import { buildOsiSymbol, formatExpiryYYYYMMDD } from "../../utils/options";
import { getChannelPrices } from "../../hooks/useMarketData";
import { ClosePriceData, formatCloseDateShort } from "../../services/closePrices";
import { TimeframeInfo } from "../../services/marketState";

type OptionPriceData = { prevClose: number; todayClose?: number };

type Props = {
  account: string;
  positions: IbPosition[];
  equityPrices: Map<string, { last?: number; bid?: number; ask?: number }>;
  optionClosePrices: Map<string, OptionPriceData>;
  closePrices: Map<string, ClosePriceData>;
  timeframe: string;
  timeframes: TimeframeInfo[];
};

type PositionPnL = {
  symbol: string;
  displaySymbol: React.ReactNode;
  secType: string;
  quantity: number;
  currentPrice: number;
  prevClose: number;
  currentValue: number;
  prevValue: number;
  pnlDollar: number;
  pnlPercent: number;
};

export default function PnLSummary({
  positions,
  equityPrices,
  optionClosePrices,
  closePrices,
  timeframe,
  timeframes,
}: Props) {
  // Get current timeframe info for display
  const currentTimeframeInfo = useMemo(() => {
    return timeframes.find(t => t.id === timeframe);
  }, [timeframes, timeframe]);

  // Calculate P&L for each position
  const positionPnLs = useMemo(() => {
    const results: PositionPnL[] = [];

    positions.forEach((p) => {
      let priceKey = p.symbol.toUpperCase();
      let priceData;
      let prevClosePrice = 0;

      if (p.secType === "OPT" && p.strike !== undefined && p.expiry !== undefined && p.right !== undefined) {
        priceKey = buildOsiSymbol(p.symbol, p.expiry, p.right, p.strike);
        priceData = getChannelPrices("option").get(priceKey);
        const optPriceData = optionClosePrices.get(priceKey);
        prevClosePrice = optPriceData?.prevClose || 0;
      } else {
        priceData = equityPrices.get(priceKey);
        const equityCloseData = closePrices.get(p.symbol);
        prevClosePrice = equityCloseData?.prevClose || 0;
      }

      // Get current price
      let currentPrice = priceData?.last || 0;
      if (currentPrice === 0) {
        if (p.secType === "OPT") {
          const optPriceData = optionClosePrices.get(priceKey);
          if (optPriceData?.todayClose) currentPrice = optPriceData.todayClose;
        } else if (p.secType === "STK") {
          const equityCloseData = closePrices.get(p.symbol);
          if (equityCloseData?.todayClose) currentPrice = equityCloseData.todayClose;
        }
      }

      // Skip if no price data
      if (currentPrice === 0 && prevClosePrice === 0) return;

      const contractMultiplier = p.secType === "OPT" ? 100 : 1;
      const currentValue = p.quantity * currentPrice * contractMultiplier;
      const prevValue = p.quantity * prevClosePrice * contractMultiplier;
      const pnlDollar = currentValue - prevValue;
      const pnlPercent = prevClosePrice !== 0 ? ((currentPrice - prevClosePrice) / prevClosePrice) * 100 : 0;

      // Format symbol display
      let displaySymbol: React.ReactNode;
      if (p.secType === "OPT" && p.strike !== undefined && p.expiry !== undefined && p.right !== undefined) {
        const rightLabel = p.right === "C" || p.right === "Call" ? "Call" : "Put";
        const formattedExpiry = formatExpiryYYYYMMDD(p.expiry);
        displaySymbol = (
          <div>
            <div style={{ fontWeight: 600, fontSize: 11 }}>
              {p.symbol} {p.strike % 1 === 0 ? p.strike.toFixed(0) : p.strike} {rightLabel}
            </div>
            <div style={{ fontSize: 9, color: "#666" }}>{formattedExpiry}</div>
          </div>
        );
      } else {
        displaySymbol = <div style={{ fontWeight: 600 }}>{p.symbol}</div>;
      }

      results.push({
        symbol: p.symbol,
        displaySymbol,
        secType: p.secType,
        quantity: p.quantity,
        currentPrice,
        prevClose: prevClosePrice,
        currentValue,
        prevValue,
        pnlDollar,
        pnlPercent,
      });
    });

    // Sort by absolute P&L (biggest movers first)
    results.sort((a, b) => Math.abs(b.pnlDollar) - Math.abs(a.pnlDollar));

    return results;
  }, [positions, equityPrices, optionClosePrices, closePrices]);

  // Calculate totals
  const totals = useMemo(() => {
    const totalCurrentValue = positionPnLs.reduce((sum, p) => sum + p.currentValue, 0);
    const totalPrevValue = positionPnLs.reduce((sum, p) => sum + p.prevValue, 0);
    const totalPnlDollar = positionPnLs.reduce((sum, p) => sum + p.pnlDollar, 0);
    const totalPnlPercent = totalPrevValue !== 0 ? ((totalCurrentValue - totalPrevValue) / totalPrevValue) * 100 : 0;
    return { totalCurrentValue, totalPrevValue, totalPnlDollar, totalPnlPercent };
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

  return (
    <div style={table}>
      {/* Header */}
      <div style={{ ...hdr, gridTemplateColumns: "140px 36px 65px 80px 80px 100px 100px 80px 80px" }}>
        <div style={hdrCell}>Symbol</div>
        <div style={hdrCell}>Type</div>
        <div style={hdrCellRight}>Qty</div>
        <div style={hdrCellRight}>Last</div>
        <div style={hdrCellRight}>
          {currentTimeframeInfo ? `${formatCloseDateShort(currentTimeframeInfo.date)}` : "Prev Close"}
        </div>
        <div style={hdrCellRight}>Mkt Value</div>
        <div style={hdrCellRight}>
          {currentTimeframeInfo ? `${currentTimeframeInfo.label} Value` : "Prev Value"}
        </div>
        <div style={hdrCellRight}>P&L $</div>
        <div style={hdrCellRight}>P&L %</div>
      </div>

      {/* Position Rows */}
      {positionPnLs.map((p, i) => (
        <div
          key={i}
          style={{ ...row, gridTemplateColumns: "140px 36px 65px 80px 80px 100px 100px 80px 80px" }}
        >
          <div>{p.displaySymbol}</div>
          <div style={gray10}>{p.secType}</div>
          <div style={rightMono}>{p.quantity.toLocaleString()}</div>
          <div style={rightMono}>{p.currentPrice > 0 ? formatPrice(p.currentPrice) : "—"}</div>
          <div style={rightMono}>{p.prevClose > 0 ? formatPrice(p.prevClose) : "—"}</div>
          <div style={rightMono}>{formatValue(p.currentValue)}</div>
          <div style={rightMono}>{p.prevValue !== 0 ? formatValue(p.prevValue) : "—"}</div>
          <div style={{ ...rightMono, color: getPnLColor(p.pnlDollar), fontWeight: 600 }}>
            {p.prevValue !== 0 ? formatPnL(p.pnlDollar) : "—"}
          </div>
          <div style={{ ...rightMono, color: getPnLColor(p.pnlPercent), fontWeight: 600 }}>
            {p.prevClose !== 0 ? formatPnLPercent(p.pnlPercent) : "—"}
          </div>
        </div>
      ))}

      {/* Totals Row */}
      <div style={{ ...row, gridTemplateColumns: "140px 36px 65px 80px 80px 100px 100px 80px 80px", background: "#f8fafc", fontWeight: 600 }}>
        <div>Total</div>
        <div></div>
        <div></div>
        <div></div>
        <div></div>
        <div style={rightMono}>{formatValue(totals.totalCurrentValue)}</div>
        <div style={rightMono}>{totals.totalPrevValue !== 0 ? formatValue(totals.totalPrevValue) : "—"}</div>
        <div style={{ ...rightMono, color: getPnLColor(totals.totalPnlDollar) }}>
          {totals.totalPrevValue !== 0 ? formatPnL(totals.totalPnlDollar) : "—"}
        </div>
        <div style={{ ...rightMono, color: getPnLColor(totals.totalPnlPercent) }}>
          {totals.totalPrevValue !== 0 ? formatPnLPercent(totals.totalPnlPercent) : "—"}
        </div>
      </div>
    </div>
  );
}

// Styles
const table: React.CSSProperties = { display: "flex", flexDirection: "column" };
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
