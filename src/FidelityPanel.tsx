// src/FidelityPanel.tsx
import { useEffect, useState, useMemo, useRef } from "react";
import { socketHub } from "./ws/SocketHub";
import {
  FidelityPosition,
  parseFidelityCSV,
  groupPositionsByUnderlying,
  getSubscriptionSymbols,
  savePositions,
  loadPositions,
  clearPositions,
} from "./utils/fidelity";
import { useThrottledMarketPrices, useChannelUpdates, getChannelPrices } from "./hooks/useMarketData";
import { fetchClosePrices, ClosePriceData } from "./services/closePrices";
import { useMarketState } from "./services/marketState";
import { formatExpiryShort, daysToExpiry } from "./utils/options";

export default function FidelityPanel() {
  const [positions, setPositions] = useState<FidelityPosition[]>([]);
  const [importDate, setImportDate] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Market state for timeframe options
  const marketState = useMarketState();
  const [timeframe, setTimeframe] = useState(() => localStorage.getItem("fidelity.timeframe") ?? "1d");

  // Persist timeframe
  useEffect(() => { localStorage.setItem("fidelity.timeframe", timeframe); }, [timeframe]);

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

  // Register equity subscriptions with backend
  useEffect(() => {
    if (subscriptionSymbols.equities.length > 0) {
      // Register with UI bridge
      socketHub.send({
        type: "subscribe",
        channels: ["md.equity.quote", "md.equity.trade"],
        symbols: subscriptionSymbols.equities,
      });

      // Tell backend to subscribe
      socketHub.send({
        type: "control",
        target: "marketData",
        op: "subscribe",
        symbols: subscriptionSymbols.equities,
      });
    }

    return () => {
      if (subscriptionSymbols.equities.length > 0) {
        socketHub.send({
          type: "unsubscribe",
          channels: ["md.equity.quote", "md.equity.trade"],
          symbols: subscriptionSymbols.equities,
        });

        socketHub.send({
          type: "control",
          target: "marketData",
          op: "unsubscribe",
          symbols: subscriptionSymbols.equities,
        });
      }
    };
  }, [subscriptionSymbols.equities.join(",")]);

  // Register option subscriptions with backend
  useEffect(() => {
    if (subscriptionSymbols.options.length > 0) {
      // Register with UI bridge
      socketHub.send({
        type: "subscribe",
        channels: ["md.option.quote", "md.option.trade", "md.option.greeks"],
        symbols: subscriptionSymbols.options,
      });

      // Tell backend to subscribe to Alpaca streaming
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
    // Trigger recalc on optionVersion change
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

  // Group tradeable positions by underlying
  const groupedPositions = useMemo(() => {
    return groupPositionsByUnderlying(tradeablePositions);
  }, [tradeablePositions]);

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

    // Reset input so same file can be re-uploaded
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

      // Get current price
      let currentPrice = pos.lastPrice;
      if (pos.type === "equity" && equityPrices.has(pos.symbol)) {
        currentPrice = equityPrices.get(pos.symbol)?.price ?? currentPrice;
      } else if (pos.type === "option" && pos.osiSymbol && optionPrices.has(pos.osiSymbol)) {
        currentPrice = optionPrices.get(pos.osiSymbol)?.price ?? currentPrice;
      }

      if (currentPrice !== null) {
        const value = qty * currentPrice * multiplier * (pos.quantity < 0 ? -1 : 1);
        marketValue += value;
      }

      if (pos.costBasisTotal !== null) {
        costBasis += pos.costBasisTotal;
      }

      // Day change from close prices
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

  return (
    <div style={container}>
      {/* Header */}
      <div style={header}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span style={{ fontWeight: 700, fontSize: 16 }}>Fidelity Positions</span>
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
          {importDate && (
            <span style={{ fontSize: 11, color: "#666" }}>
              Imported: {new Date(importDate).toLocaleString()}
            </span>
          )}
        </div>

        {/* Timeframe selector */}
        {marketState?.timeframes && marketState.timeframes.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 11, color: "#666" }}>Change vs:</span>
            <select
              value={timeframe}
              onChange={(e) => setTimeframe(e.target.value)}
              style={selectStyle as any}
            >
              {marketState.timeframes.map((tf) => (
                <option key={tf.id} value={tf.id}>
                  {tf.label || tf.id} ({tf.date})
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Summary */}
      {positions.length > 0 && (
        <div style={summaryRow}>
          <div>
            <span style={{ color: "#666", fontSize: 11 }}>Total Account</span>
            <div style={{ fontWeight: 700, fontSize: 14 }}>${totals.totalAccountValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          </div>
          <div>
            <span style={{ color: "#666", fontSize: 11 }}>Securities</span>
            <div style={{ fontWeight: 600 }}>${totals.marketValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          </div>
          <div>
            <span style={{ color: "#666", fontSize: 11 }}>Cash</span>
            <div>${totalCash.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          </div>
          {totalPending !== 0 && (
            <div>
              <span style={{ color: "#666", fontSize: 11 }}>Pending</span>
              <div style={{ color: totalPending >= 0 ? "#16a34a" : "#dc2626" }}>
                {totalPending >= 0 ? "+" : ""}${totalPending.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </div>
          )}
          <div>
            <span style={{ color: "#666", fontSize: 11 }}>Unrealized P&L</span>
            <div style={{ color: totals.unrealizedPL >= 0 ? "#16a34a" : "#dc2626", fontWeight: 600 }}>
              {totals.unrealizedPL >= 0 ? "+" : ""}${totals.unrealizedPL.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          </div>
          <div>
            <span style={{ color: "#666", fontSize: 11 }}>Day Change</span>
            <div style={{ color: totals.dayChange >= 0 ? "#16a34a" : "#dc2626" }}>
              {totals.dayChange >= 0 ? "+" : ""}${totals.dayChange.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          </div>
          <div>
            <span style={{ color: "#666", fontSize: 11 }}>Positions</span>
            <div>{tradeablePositions.length}</div>
          </div>
        </div>
      )}

      {/* Positions */}
      <div style={positionsContainer}>
        {positions.length === 0 ? (
          <div style={emptyState}>
            <p>No positions imported.</p>
            <p style={{ fontSize: 12, color: "#666" }}>
              Export positions from Fidelity as CSV and import here.
            </p>
          </div>
        ) : (
          <>
            {/* Cash positions */}
            {cashPositions.length > 0 && (
              <div style={cashContainer}>
                <div style={cashHeader}>
                  <span style={{ fontWeight: 600 }}>Cash & Money Market</span>
                  <span style={{ fontWeight: 600 }}>
                    ${totalCash.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
                {cashPositions.map((pos, idx) => (
                  <div key={idx} style={cashRow}>
                    <div style={{ flex: 1 }}>
                      <span style={{ fontWeight: 500 }}>{pos.symbol}</span>
                      <span style={{ marginLeft: 8, color: "#666", fontSize: 11 }}>{pos.description}</span>
                    </div>
                    <div>${(pos.currentValue ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Pending activity */}
            {pendingPositions.length > 0 && (
              <div style={pendingContainer}>
                <div style={pendingHeader}>
                  <span style={{ fontWeight: 600 }}>Pending Activity</span>
                  <span style={{ fontWeight: 600, color: totalPending >= 0 ? "#16a34a" : "#dc2626" }}>
                    {totalPending >= 0 ? "+" : ""}${totalPending.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
                {pendingPositions.map((pos, idx) => (
                  <div key={idx} style={pendingRow}>
                    <div style={{ flex: 1 }}>
                      <span style={{ color: "#666", fontSize: 11 }}>{pos.description}</span>
                    </div>
                    <div style={{ color: (pos.currentValue ?? 0) >= 0 ? "#16a34a" : "#dc2626" }}>
                      {(pos.currentValue ?? 0) >= 0 ? "+" : ""}${(pos.currentValue ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Securities */}
            {Array.from(groupedPositions.entries()).map(([underlying, group]) => (
              <PositionGroup
                key={underlying}
                underlying={underlying}
                positions={group}
                equityPrices={equityPrices}
                optionPrices={optionPrices}
                closePrices={closePrices}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

// Position group component
function PositionGroup({
  underlying,
  positions,
  equityPrices,
  optionPrices,
  closePrices,
}: {
  underlying: string;
  positions: FidelityPosition[];
  equityPrices: Map<string, { price: number; timestamp?: number }>;
  optionPrices: Map<string, { price: number; bid?: number; ask?: number }>;
  closePrices: Map<string, ClosePriceData>;
}) {
  // Separate equity and options
  const equityPos = positions.find((p) => p.type === "equity");
  const optionPositions = positions.filter((p) => p.type === "option");

  // Get current price for underlying
  const currentPrice = equityPrices.get(underlying)?.price;
  const closeData = closePrices.get(underlying);

  return (
    <div style={groupContainer}>
      {/* Group header */}
      <div style={groupHeader}>
        <span style={{ fontWeight: 600 }}>{underlying}</span>
        {currentPrice !== undefined && (
          <span style={{ marginLeft: 12 }}>
            ${currentPrice.toFixed(2)}
            {closeData && (
              <span style={{ marginLeft: 8, color: currentPrice >= closeData.prevClose ? "#16a34a" : "#dc2626", fontSize: 12 }}>
                {currentPrice >= closeData.prevClose ? "+" : ""}
                {((currentPrice - closeData.prevClose) / closeData.prevClose * 100).toFixed(2)}%
              </span>
            )}
          </span>
        )}
      </div>

      {/* Equity position */}
      {equityPos && (
        <div style={positionRow}>
          <div style={{ width: 80 }}>Stock</div>
          <div style={{ width: 80, textAlign: "right" }}>{equityPos.quantity}</div>
          <div style={{ width: 80, textAlign: "right" }}>
            ${(equityPos.avgCostBasis ?? 0).toFixed(2)}
          </div>
          <div style={{ width: 100, textAlign: "right" }}>
            {currentPrice !== undefined
              ? `$${currentPrice.toFixed(2)}`
              : equityPos.lastPrice !== null
              ? `$${equityPos.lastPrice.toFixed(2)}`
              : "--"}
          </div>
          <div style={{ width: 120, textAlign: "right" }}>
            ${(equityPos.costBasisTotal ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div style={{ width: 120, textAlign: "right", ...plStyle(calcPL(equityPos, currentPrice)) }}>
            {formatPL(calcPL(equityPos, currentPrice))}
          </div>
        </div>
      )}

      {/* Option positions */}
      {optionPositions.length > 0 && (
        <div style={optionsSection}>
          <div style={optionHeaderRow}>
            <div style={{ width: 140 }}>Option</div>
            <div style={{ width: 50, textAlign: "center" }}>DTE</div>
            <div style={{ width: 60, textAlign: "right" }}>Qty</div>
            <div style={{ width: 70, textAlign: "right" }}>Avg Cost</div>
            <div style={{ width: 70, textAlign: "right" }}>Price</div>
            <div style={{ width: 70, textAlign: "right" }}>Bid</div>
            <div style={{ width: 70, textAlign: "right" }}>Ask</div>
            <div style={{ width: 100, textAlign: "right" }}>Cost Basis</div>
            <div style={{ width: 100, textAlign: "right" }}>P&L</div>
          </div>
          {optionPositions.map((pos, idx) => {
            const optPrice = pos.osiSymbol ? optionPrices.get(pos.osiSymbol) : null;
            const price = optPrice?.price ?? pos.lastPrice;
            const pl = calcPL(pos, price);

            return (
              <div key={idx} style={optionRow}>
                <div style={{ width: 140 }}>
                  {pos.expiry ? formatExpiryShort(pos.expiry) : "?"}{" "}
                  ${pos.strike} {pos.optionType === "call" ? "C" : "P"}
                </div>
                <div style={{ width: 50, textAlign: "center", color: "#666" }}>
                  {pos.expiry ? daysToExpiry(pos.expiry) : "--"}
                </div>
                <div style={{ width: 60, textAlign: "right" }}>{pos.quantity}</div>
                <div style={{ width: 70, textAlign: "right" }}>
                  ${(pos.avgCostBasis ?? 0).toFixed(2)}
                </div>
                <div style={{ width: 70, textAlign: "right" }}>
                  {price !== null ? `$${price.toFixed(2)}` : "--"}
                </div>
                <div style={{ width: 70, textAlign: "right", color: "#666" }}>
                  {optPrice?.bid !== undefined ? `$${optPrice.bid.toFixed(2)}` : "--"}
                </div>
                <div style={{ width: 70, textAlign: "right", color: "#666" }}>
                  {optPrice?.ask !== undefined ? `$${optPrice.ask.toFixed(2)}` : "--"}
                </div>
                <div style={{ width: 100, textAlign: "right" }}>
                  ${(pos.costBasisTotal ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                <div style={{ width: 100, textAlign: "right", ...plStyle(pl) }}>
                  {formatPL(pl)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Calculate P&L
function calcPL(pos: FidelityPosition, currentPrice: number | null | undefined): number | null {
  if (currentPrice === null || currentPrice === undefined || pos.costBasisTotal === null) {
    return null;
  }
  const multiplier = pos.type === "option" ? 100 : 1;
  const qty = Math.abs(pos.quantity);
  const marketValue = qty * currentPrice * multiplier;
  // For short positions, P&L is inverted
  if (pos.quantity < 0) {
    return pos.costBasisTotal - marketValue;
  }
  return marketValue - pos.costBasisTotal;
}

// Format P&L
function formatPL(pl: number | null): string {
  if (pl === null) return "--";
  const sign = pl >= 0 ? "+" : "";
  return `${sign}$${pl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// P&L color style
function plStyle(pl: number | null): React.CSSProperties {
  if (pl === null) return {};
  return { color: pl >= 0 ? "#16a34a" : "#dc2626" };
}

// Styles
const container: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100%",
  overflow: "hidden",
  background: "#fff",
};

const header: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "8px 12px",
  borderBottom: "1px solid #e5e7eb",
  flexWrap: "wrap",
  gap: 8,
};

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

const selectStyle: React.CSSProperties = {
  padding: "2px 6px",
  fontSize: 11,
  border: "1px solid #d1d5db",
  borderRadius: 4,
};

const summaryRow: React.CSSProperties = {
  display: "flex",
  gap: 24,
  padding: "8px 12px",
  background: "#f9fafb",
  borderBottom: "1px solid #e5e7eb",
  flexWrap: "wrap",
};

const positionsContainer: React.CSSProperties = {
  flex: 1,
  overflow: "auto",
  padding: 12,
};

const emptyState: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  height: "100%",
  color: "#666",
};

const groupContainer: React.CSSProperties = {
  marginBottom: 16,
  border: "1px solid #e5e7eb",
  borderRadius: 6,
  overflow: "hidden",
};

const groupHeader: React.CSSProperties = {
  padding: "8px 12px",
  background: "#f3f4f6",
  borderBottom: "1px solid #e5e7eb",
};

const positionRow: React.CSSProperties = {
  display: "flex",
  padding: "6px 12px",
  fontSize: 12,
  borderBottom: "1px solid #f3f4f6",
};

const optionsSection: React.CSSProperties = {
  background: "#fafafa",
};

const optionHeaderRow: React.CSSProperties = {
  display: "flex",
  padding: "4px 12px",
  fontSize: 10,
  color: "#666",
  borderBottom: "1px solid #e5e7eb",
  fontWeight: 600,
};

const optionRow: React.CSSProperties = {
  display: "flex",
  padding: "4px 12px",
  fontSize: 11,
  borderBottom: "1px solid #f3f4f6",
};

const cashContainer: React.CSSProperties = {
  marginBottom: 16,
  border: "1px solid #d1fae5",
  borderRadius: 6,
  overflow: "hidden",
  background: "#f0fdf4",
};

const cashHeader: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  padding: "8px 12px",
  background: "#dcfce7",
  borderBottom: "1px solid #d1fae5",
};

const cashRow: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  padding: "6px 12px",
  fontSize: 12,
  borderBottom: "1px solid #d1fae5",
};

const pendingContainer: React.CSSProperties = {
  marginBottom: 16,
  border: "1px solid #fde68a",
  borderRadius: 6,
  overflow: "hidden",
  background: "#fffbeb",
};

const pendingHeader: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  padding: "8px 12px",
  background: "#fef3c7",
  borderBottom: "1px solid #fde68a",
};

const pendingRow: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  padding: "6px 12px",
  fontSize: 12,
  borderBottom: "1px solid #fde68a",
};
