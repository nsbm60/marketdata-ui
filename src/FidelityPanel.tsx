// src/FidelityPanel.tsx
import { useEffect, useState, useMemo, useRef } from "react";
import { socketHub } from "./ws/SocketHub";
import {
  FidelityPosition,
  parseFidelityCSV,
  getSubscriptionSymbols,
  savePositions,
  loadPositions,
  clearPositions,
} from "./utils/fidelity";
import { useThrottledMarketPrices, useChannelUpdates, getChannelPrices, PriceData } from "./hooks/useMarketData";
import { fetchClosePrices, ClosePriceData, calcPctChange, formatPctChange, formatCloseDateShort } from "./services/closePrices";
import { useMarketState } from "./services/marketState";
import { formatExpiryShort, daysToExpiry } from "./utils/options";
import FidelityOptionsAnalysis from "./components/fidelity/FidelityOptionsAnalysis";

export default function FidelityPanel() {
  const [positions, setPositions] = useState<FidelityPosition[]>([]);
  const [importDate, setImportDate] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Tab state: "positions" or "analysis"
  const [activeTab, setActiveTab] = useState<"positions" | "analysis">("positions");

  // Market state for timeframe options
  const marketState = useMarketState();
  const [timeframe, setTimeframe] = useState(() => localStorage.getItem("fidelity.timeframe") ?? "1d");

  // Persist timeframe
  useEffect(() => { localStorage.setItem("fidelity.timeframe", timeframe); }, [timeframe]);

  // Get current timeframe info for display
  const currentTimeframeInfo = useMemo(() => {
    return marketState?.timeframes?.find(t => t.id === timeframe);
  }, [marketState?.timeframes, timeframe]);

  // Load positions from localStorage on mount
  useEffect(() => {
    const stored = loadPositions();
    if (stored.length > 0) {
      setPositions(stored);
      const storedDate = localStorage.getItem("fidelity.importDate");
      if (storedDate) setImportDate(storedDate);
    }
  }, []);

  // Get symbols for subscription
  const subscriptionSymbols = useMemo(() => {
    return getSubscriptionSymbols(positions);
  }, [positions]);

  // Subscribe to equity market data
  const equityPrices = useThrottledMarketPrices(subscriptionSymbols.equities, "equity", 250);

  // Subscribe to option market data
  const optionVersion = useChannelUpdates("option", 250);

  // Register option subscriptions with backend
  useEffect(() => {
    if (subscriptionSymbols.options.length > 0) {
      socketHub.send({
        type: "subscribe",
        channels: ["md.option.quote", "md.option.trade", "md.option.greeks"],
        symbols: subscriptionSymbols.options,
      });

      socketHub.send({
        type: "control",
        target: "marketData",
        op: "subscribe_portfolio_contracts",
        contracts: subscriptionSymbols.options,
      });
    }

    return () => {
      if (subscriptionSymbols.options.length > 0) {
        socketHub.send({
          type: "unsubscribe",
          channels: ["md.option.quote", "md.option.trade", "md.option.greeks"],
          symbols: subscriptionSymbols.options,
        });
      }
    };
  }, [subscriptionSymbols.options.join(",")]);

  // Close prices for equities
  const [closePrices, setClosePrices] = useState<Map<string, ClosePriceData>>(new Map());

  useEffect(() => {
    if (subscriptionSymbols.equities.length > 0) {
      fetchClosePrices(subscriptionSymbols.equities, timeframe).then(setClosePrices);
    }
  }, [subscriptionSymbols.equities.join(","), timeframe]);

  // Option prices from channel
  const optionPrices = useMemo(() => {
    void optionVersion;
    return getChannelPrices("option");
  }, [optionVersion]);

  // Separate cash/pending from tradeable positions
  const { cashPositions, pendingPositions, tradeablePositions } = useMemo(() => {
    const cash: FidelityPosition[] = [];
    const pending: FidelityPosition[] = [];
    const tradeable: FidelityPosition[] = [];
    for (const pos of positions) {
      if (pos.type === "cash") cash.push(pos);
      else if (pos.type === "pending") pending.push(pos);
      else tradeable.push(pos);
    }
    return { cashPositions: cash, pendingPositions: pending, tradeablePositions: tradeable };
  }, [positions]);

  // Calculate total cash
  const totalCash = useMemo(() => {
    return cashPositions.reduce((sum, pos) => sum + (pos.currentValue ?? 0), 0);
  }, [cashPositions]);

  // Calculate total pending
  const totalPending = useMemo(() => {
    return pendingPositions.reduce((sum, pos) => sum + (pos.currentValue ?? 0), 0);
  }, [pendingPositions]);

  // Handle file upload
  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const parsed = parseFidelityCSV(text);
      setPositions(parsed);
      savePositions(parsed);
      const date = new Date().toISOString();
      setImportDate(date);
      localStorage.setItem("fidelity.importDate", date);
      console.log(`[FidelityPanel] Imported ${parsed.length} positions`);
    };
    reader.readAsText(file);

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleClear = () => {
    if (confirm("Clear all Fidelity positions?")) {
      setPositions([]);
      clearPositions();
      setImportDate(null);
      localStorage.removeItem("fidelity.importDate");
    }
  };

  // Calculate totals
  const totals = useMemo(() => {
    let marketValue = 0;
    let costBasis = 0;
    let dayChange = 0;

    tradeablePositions.forEach((pos) => {
      const qty = Math.abs(pos.quantity);
      const multiplier = pos.type === "option" ? 100 : 1;

      let currentPrice = pos.lastPrice;
      if (pos.type === "equity" && equityPrices.has(pos.symbol)) {
        currentPrice = equityPrices.get(pos.symbol)?.last ?? currentPrice;
      } else if (pos.type === "option" && pos.osiSymbol && optionPrices.has(pos.osiSymbol)) {
        currentPrice = optionPrices.get(pos.osiSymbol)?.last ?? currentPrice;
      }

      if (currentPrice !== null) {
        const value = qty * currentPrice * multiplier * (pos.quantity < 0 ? -1 : 1);
        marketValue += value;
      }

      if (pos.costBasisTotal !== null) {
        costBasis += pos.costBasisTotal;
      }

      if (pos.type === "equity") {
        const closeData = closePrices.get(pos.symbol);
        if (closeData && currentPrice !== null) {
          const prevPrice = closeData.prevClose;
          dayChange += (currentPrice - prevPrice) * qty * (pos.quantity < 0 ? -1 : 1);
        }
      }
    });

    return {
      marketValue,
      costBasis,
      unrealizedPL: marketValue - costBasis,
      dayChange,
      totalAccountValue: marketValue + totalCash + totalPending,
    };
  }, [tradeablePositions, equityPrices, optionPrices, closePrices, totalCash, totalPending]);

  // Sort positions: by symbol, then equity before options, then by expiry/strike
  const sortedPositions = useMemo(() => {
    return [...tradeablePositions].sort((a, b) => {
      // Get underlying for comparison
      const underlyingA = a.underlying || a.symbol;
      const underlyingB = b.underlying || b.symbol;
      if (underlyingA !== underlyingB) return underlyingA.localeCompare(underlyingB);

      // Equity before options
      if (a.type !== b.type) return a.type === "equity" ? -1 : 1;

      // For options: sort by expiry, then call/put, then strike
      if (a.type === "option" && b.type === "option") {
        const expiryA = a.expiry || "";
        const expiryB = b.expiry || "";
        if (expiryA !== expiryB) return expiryA.localeCompare(expiryB);
        const rightA = a.optionType === "call" ? "C" : "P";
        const rightB = b.optionType === "call" ? "C" : "P";
        if (rightA !== rightB) return rightA.localeCompare(rightB);
        return (a.strike || 0) - (b.strike || 0);
      }
      return 0;
    });
  }, [tradeablePositions]);

  return (
    <div style={shell}>
      {/* Header */}
      <div style={header}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontWeight: 600, fontSize: 15 }}>Fidelity Positions</span>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={handleFileUpload}
            style={{ display: "none" }}
            id="fidelity-csv-upload"
          />
          <label htmlFor="fidelity-csv-upload" style={uploadBtn as any}>
            Import CSV
          </label>
          {positions.length > 0 && (
            <button onClick={handleClear} style={clearBtn as any}>
              Clear
            </button>
          )}
        </div>
        <div style={{ fontSize: 12, color: "#666" }}>
          {importDate && <>Imported: {new Date(importDate).toLocaleString()}</>}
        </div>
      </div>

      {/* Body */}
      <div style={body}>
        {positions.length === 0 ? (
          <div style={empty}>
            <p>No positions imported.</p>
            <p style={{ fontSize: 12, color: "#666" }}>
              Export positions from Fidelity as CSV and import here.
            </p>
          </div>
        ) : (
          <>
            {/* Summary row */}
            <div style={summary}>
              <span style={{ marginRight: 20, fontWeight: 700, fontSize: 13 }}>
                Total: ${totals.totalAccountValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
              <span style={{ marginRight: 16, fontWeight: 600 }}>
                Securities: ${totals.marketValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
              <span style={{ marginRight: 16, fontWeight: 600 }}>
                Cash: ${totalCash.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
              {totalPending !== 0 && (
                <span style={{ marginRight: 16, color: totalPending >= 0 ? "#16a34a" : "#dc2626" }}>
                  Pending: {totalPending >= 0 ? "+" : ""}${totalPending.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              )}
              <span style={{ marginRight: 16, color: totals.unrealizedPL >= 0 ? "#16a34a" : "#dc2626", fontWeight: 600 }}>
                P&L: {totals.unrealizedPL >= 0 ? "+" : ""}${totals.unrealizedPL.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
              <span style={{ color: "#666" }}>
                ({tradeablePositions.length} positions)
              </span>
            </div>

            {/* Main content */}
            <div style={section}>
              {/* Tab bar */}
              <div style={tabBar}>
                <div style={{ display: "flex", gap: 0 }}>
                  <button
                    onClick={() => setActiveTab("positions")}
                    style={tabButton(activeTab === "positions")}
                  >
                    Positions
                  </button>
                  <button
                    onClick={() => setActiveTab("analysis")}
                    style={tabButton(activeTab === "analysis")}
                  >
                    Options Analysis
                  </button>
                </div>
                {/* Timeframe selector - only for positions tab */}
                {activeTab === "positions" && marketState?.timeframes && (
                  <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
                    <span>vs:</span>
                    <select
                      value={timeframe}
                      onChange={(e) => setTimeframe(e.target.value)}
                      style={selectStyle}
                    >
                      {marketState.timeframes.map((tf) => (
                        <option key={tf.id} value={tf.id}>
                          {formatCloseDateShort(tf.date)}{tf.label ? ` (${tf.label})` : ""}
                        </option>
                      ))}
                    </select>
                  </span>
                )}
              </div>

              {/* Positions Table */}
              {activeTab === "positions" && (
                <div style={table}>
                  {/* Header */}
                  <div style={hdr}>
                    <div style={hdrCell}>Symbol</div>
                    <div style={hdrCell}>Type</div>
                    <div style={hdrCellRight}>Qty</div>
                    <div style={hdrCellRight}>Last</div>
                    <div style={{ ...hdrCellCenter, gridColumn: "span 2" }}>
                      {currentTimeframeInfo
                        ? `Chg (${formatCloseDateShort(currentTimeframeInfo.date)})`
                        : "Change"}
                    </div>
                    <div style={hdrCellRight}>Mkt Value</div>
                    <div style={hdrCellRight}>Avg Cost</div>
                    <div style={hdrCellRight}>P&L</div>
                  </div>

                  {/* Position rows */}
                  {sortedPositions.map((pos, i) => {
                    // Get current price
                    let currentPrice = pos.lastPrice;
                    if (pos.type === "equity" && equityPrices.has(pos.symbol)) {
                      currentPrice = equityPrices.get(pos.symbol)?.last ?? currentPrice;
                    } else if (pos.type === "option" && pos.osiSymbol) {
                      currentPrice = optionPrices.get(pos.osiSymbol)?.last ?? currentPrice;
                    }

                    const multiplier = pos.type === "option" ? 100 : 1;
                    const qty = pos.quantity;
                    const mktValue = currentPrice !== null ? qty * currentPrice * multiplier : null;

                    // P&L calculation
                    let pl: number | null = null;
                    if (mktValue !== null && pos.costBasisTotal !== null) {
                      pl = mktValue - pos.costBasisTotal;
                    }

                    // Change calculation
                    let pctChange: number | undefined;
                    let dollarChange: number | undefined;
                    if (pos.type === "equity" && currentPrice !== null) {
                      const closeData = closePrices.get(pos.symbol);
                      if (closeData?.prevClose && closeData.prevClose > 0) {
                        pctChange = calcPctChange(currentPrice, closeData.prevClose);
                        dollarChange = currentPrice - closeData.prevClose;
                      }
                    }
                    const changeColor = pctChange !== undefined
                      ? (pctChange >= 0 ? "#16a34a" : "#dc2626")
                      : undefined;

                    // Symbol display
                    let symbolDisplay: React.ReactNode;
                    if (pos.type === "option" && pos.strike !== undefined && pos.expiry !== undefined) {
                      const rightLabel = pos.optionType === "call" ? "Call" : "Put";
                      symbolDisplay = (
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 11 }}>
                            {pos.underlying || pos.symbol} {pos.strike} {rightLabel}
                          </div>
                          <div style={{ fontSize: 9, color: "#666" }}>
                            {formatExpiryShort(pos.expiry)} ({daysToExpiry(pos.expiry)}d)
                          </div>
                        </div>
                      );
                    } else {
                      symbolDisplay = <div style={{ fontWeight: 600 }}>{pos.symbol}</div>;
                    }

                    return (
                      <div key={i} style={rowStyle}>
                        <div style={cellEllipsis}>{symbolDisplay}</div>
                        <div style={gray10}>{pos.type === "option" ? "OPT" : "STK"}</div>
                        <div style={rightMono}>
                          {qty.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                        </div>
                        <div style={rightMono}>
                          {currentPrice !== null ? `$${currentPrice.toFixed(2)}` : "—"}
                        </div>
                        <div style={rightMono}>
                          {pctChange !== undefined ? (
                            <span style={{ color: changeColor, fontWeight: 600 }}>
                              {pctChange >= 0 ? "▲" : "▼"} {formatPctChange(pctChange)}
                            </span>
                          ) : "—"}
                        </div>
                        <div style={rightMono}>
                          {dollarChange !== undefined ? (
                            <span style={{ color: changeColor, fontWeight: 600 }}>
                              {dollarChange >= 0 ? "+" : ""}{dollarChange.toFixed(2)}
                            </span>
                          ) : "—"}
                        </div>
                        <div style={rightMono}>
                          {mktValue !== null
                            ? (mktValue < 0
                                ? `(${Math.abs(mktValue).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`
                                : `$${mktValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
                            : "—"}
                        </div>
                        <div style={rightMono}>
                          ${(pos.avgCostBasis ?? 0).toFixed(2)}
                        </div>
                        <div style={{ ...rightMono, color: pl !== null ? (pl >= 0 ? "#16a34a" : "#dc2626") : undefined, fontWeight: pl !== null ? 600 : 400 }}>
                          {pl !== null
                            ? `${pl >= 0 ? "+" : ""}$${pl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                            : "—"}
                        </div>
                      </div>
                    );
                  })}

                  {/* Cash section */}
                  {cashPositions.length > 0 && (
                    <>
                      <div style={{ ...rowStyle, background: "#f0fdf4", borderTop: "2px solid #d1fae5" }}>
                        <div style={{ ...cellEllipsis, fontWeight: 600 }}>Cash & Money Market</div>
                        <div style={gray10}>CASH</div>
                        <div style={rightMono}>—</div>
                        <div style={rightMono}>—</div>
                        <div style={rightMono}>—</div>
                        <div style={rightMono}>—</div>
                        <div style={{ ...rightMono, fontWeight: 600 }}>
                          ${totalCash.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>
                        <div style={rightMono}>—</div>
                        <div style={rightMono}>—</div>
                      </div>
                      {cashPositions.map((pos, i) => (
                        <div key={`cash-${i}`} style={{ ...rowStyle, background: "#f0fdf4", fontSize: 10 }}>
                          <div style={cellEllipsis}>
                            <span style={{ marginLeft: 12 }}>{pos.symbol}</span>
                            <span style={{ marginLeft: 8, color: "#666" }}>{pos.description}</span>
                          </div>
                          <div style={gray10}></div>
                          <div style={rightMono}></div>
                          <div style={rightMono}></div>
                          <div style={rightMono}></div>
                          <div style={rightMono}></div>
                          <div style={rightMono}>
                            ${(pos.currentValue ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </div>
                          <div style={rightMono}></div>
                          <div style={rightMono}></div>
                        </div>
                      ))}
                    </>
                  )}

                  {/* Pending section */}
                  {pendingPositions.length > 0 && totalPending !== 0 && (
                    <div style={{ ...rowStyle, background: "#fffbeb", borderTop: "2px solid #fde68a" }}>
                      <div style={{ ...cellEllipsis, fontWeight: 600 }}>Pending Activity</div>
                      <div style={gray10}></div>
                      <div style={rightMono}>—</div>
                      <div style={rightMono}>—</div>
                      <div style={rightMono}>—</div>
                      <div style={rightMono}>—</div>
                      <div style={{ ...rightMono, fontWeight: 600, color: totalPending >= 0 ? "#16a34a" : "#dc2626" }}>
                        {totalPending >= 0 ? "+" : ""}${totalPending.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                      <div style={rightMono}>—</div>
                      <div style={rightMono}>—</div>
                    </div>
                  )}
                </div>
              )}

              {/* Options Analysis Tab */}
              {activeTab === "analysis" && (
                <FidelityOptionsAnalysis
                  positions={tradeablePositions}
                  equityPrices={equityPrices}
                  optionPrices={optionPrices}
                />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* Styles */
const shell: React.CSSProperties = { display: "flex", flexDirection: "column", height: "100%", color: "#111", background: "#fff" };
const header: React.CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", borderBottom: "1px solid #e5e7eb", background: "#fff" };
const body: React.CSSProperties = { flex: 1, overflow: "auto", padding: "12px 14px", background: "#f9fafb" };
const summary: React.CSSProperties = { fontSize: 11, color: "#4b5563", marginBottom: 10 };
const section: React.CSSProperties = { background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, overflow: "hidden" };
const tabBar: React.CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", background: "#f1f5f9", borderBottom: "1px solid #e5e7eb" };

const tabButton = (active: boolean): React.CSSProperties => ({
  padding: "4px 12px",
  border: "1px solid #d1d5db",
  borderRadius: active ? "4px 0 0 4px" : "0 4px 4px 0",
  borderLeft: active ? "1px solid #d1d5db" : "none",
  background: active ? "#2563eb" : "white",
  color: active ? "white" : "#374151",
  fontSize: 11,
  fontWeight: 500,
  cursor: "pointer",
});

const selectStyle: React.CSSProperties = {
  padding: "4px 20px 4px 8px",
  fontSize: 11,
  border: "1px solid #d1d5db",
  borderRadius: 4,
  background: "white",
  cursor: "pointer",
};

const table: React.CSSProperties = { display: "flex", flexDirection: "column" };
const gridCols = "180px 45px 70px 70px 55px 55px 100px 70px 100px";
const hdr: React.CSSProperties = { display: "grid", gridTemplateColumns: gridCols, fontWeight: 600, fontSize: 10.5, color: "#374151", padding: "0 10px", background: "#f8fafc", height: 26, alignItems: "center", borderBottom: "1px solid #e5e7eb" };
const hdrCell: React.CSSProperties = { borderRight: "1px solid #ddd", paddingRight: 4 };
const hdrCellRight: React.CSSProperties = { ...hdrCell, textAlign: "right" };
const hdrCellCenter: React.CSSProperties = { ...hdrCell, textAlign: "center" };
const rowStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: gridCols, fontSize: 11, minHeight: 32, alignItems: "center", padding: "0 10px", borderBottom: "1px solid #f3f4f6" };

const cellBorder: React.CSSProperties = { borderRight: "1px solid #eee", paddingRight: 4, paddingLeft: 2 };
const cellEllipsis: React.CSSProperties = { ...cellBorder, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const rightMono: React.CSSProperties = { ...cellBorder, textAlign: "right", fontFamily: "ui-monospace, monospace" };
const gray10: React.CSSProperties = { ...cellBorder, fontSize: 10, color: "#666" };

const empty: React.CSSProperties = { padding: 40, textAlign: "center", color: "#666", fontSize: 14 };

const uploadBtn: React.CSSProperties = {
  padding: "4px 12px",
  fontSize: 12,
  background: "#3b82f6",
  color: "#fff",
  border: "none",
  borderRadius: 4,
  cursor: "pointer",
};

const clearBtn: React.CSSProperties = {
  padding: "4px 12px",
  fontSize: 12,
  background: "#dc2626",
  color: "#fff",
  border: "none",
  borderRadius: 4,
  cursor: "pointer",
};
