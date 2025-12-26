// src/PortfolioPanel.tsx
import { useEffect, useState, useMemo } from "react";
import { socketHub } from "./ws/SocketHub";
import TradeTicket from "./components/TradeTicket";
import OptionTradeTicket from "./components/OptionTradeTicket";
import {
  CashBalances,
  OpenOrdersTable,
  OrderHistoryTable,
  CancelOrderModal,
  ModifyOrderModal,
  OptionsAnalysisTable,
  PnLSummary,
} from "./components/portfolio";
import ConnectionStatus from "./components/shared/ConnectionStatus";
import TimeframeSelector from "./components/shared/TimeframeSelector";
import TabButtonGroup from "./components/shared/TabButtonGroup";
import { PriceChangePercent, PriceChangeDollar } from "./components/shared/PriceChange";
import { fetchClosePrices, ClosePriceData, calcPctChange, formatCloseDateShort } from "./services/closePrices";
import { useMarketState } from "./services/marketState";
import { useThrottledMarketPrices, useChannelUpdates, getChannelPrices } from "./hooks/useMarketData";
import { buildOsiSymbol, formatExpiryYYYYMMDD } from "./utils/options";
import { usePortfolioData } from "./hooks/usePortfolioData";
import { useTradeTicket } from "./hooks/useTradeTicket";

export default function PortfolioPanel() {
  // Portfolio data and IB connection state
  const {
    accountState,
    orderHistory,
    ibErrors,
    loading,
    error,
    lastUpdated,
    ibConnected,
    showErrors,
    setShowErrors,
    clearErrors,
  } = usePortfolioData();

  // Trade ticket UI state
  const {
    showTradeTicket,
    ticketSymbol,
    ticketAccount,
    ticketSide,
    ticketSecType,
    ticketMarketData,
    ticketOptionData,
    modifyingOrder,
    cancellingOrder,
    openTradeTicket,
    closeTradeTicket,
    setModifyingOrder,
    setCancellingOrder,
  } = useTradeTicket();

  // Tab for positions view: "positions", "analysis", or "pnl"
  const [positionsTab, setPositionsTab] = useState<"positions" | "analysis" | "pnl">("positions");

  // Market state for prevTradingDay and timeframes
  const marketState = useMarketState();
  const [timeframe, setTimeframe] = useState(() => localStorage.getItem("portfolio.timeframe") ?? "1d");

  // Persist timeframe selection
  useEffect(() => { localStorage.setItem("portfolio.timeframe", timeframe); }, [timeframe]);

  // Get current timeframe info for display
  const currentTimeframeInfo = useMemo(() => {
    return marketState?.timeframes?.find(t => t.id === timeframe);
  }, [marketState?.timeframes, timeframe]);

  // Build list of equity symbols for market data subscription
  // Include both STK positions AND underlying symbols from options
  const equitySymbols = useMemo(() => {
    if (!accountState?.positions) return [];
    const symbols = new Set<string>();
    accountState.positions.forEach(p => {
      // Add equity positions
      if (p.secType === "STK") {
        symbols.add(p.symbol.toUpperCase());
      }
      // Also add underlying symbols from options (for Options Analysis)
      if (p.secType === "OPT") {
        symbols.add(p.symbol.toUpperCase());
      }
    });
    return Array.from(symbols);
  }, [accountState?.positions]);

  // Subscribe to equity market data via MarketDataBus
  // Throttle to 250ms (4 updates/sec) for readability
  const equityPrices = useThrottledMarketPrices(equitySymbols, "equity", 250);

  // Debug: log when equity symbols change
  useEffect(() => {
    if (equitySymbols.length > 0) {
      console.log("[PortfolioPanel] Equity symbols for subscription:", equitySymbols);
    }
  }, [equitySymbols.join(",")]);

  // Listen to option channel updates (backend manages option subscriptions)
  // Throttle to 250ms for consistency
  const optionVersion = useChannelUpdates("option", 250);

  // Close prices for % change display (equities)
  const [closePrices, setClosePrices] = useState<Map<string, ClosePriceData>>(new Map());

  // Option close prices for % change display
  type OptionPriceData = { prevClose: number; todayClose?: number };
  const [optionClosePrices, setOptionClosePrices] = useState<Map<string, OptionPriceData>>(new Map());

  // Fetch close prices for equity positions
  useEffect(() => {
    if (!accountState?.positions) return;
    const equitySymbols = accountState.positions
      .filter(p => p.secType === "STK")
      .map(p => p.symbol);
    if (equitySymbols.length > 0) {
      // Pass timeframe for date calculation
      fetchClosePrices(equitySymbols, timeframe).then(setClosePrices);
    }
  }, [accountState?.positions, timeframe]);

  // Fetch close prices for option positions
  useEffect(() => {
    if (!accountState?.positions || !marketState?.timeframes) return;

    // Find the date for the selected timeframe
    const tfInfo = marketState.timeframes.find(t => t.id === timeframe);
    const closeDate = tfInfo?.date || marketState.prevTradingDay;
    if (!closeDate) return;

    const optionPositions = accountState.positions.filter(p =>
      p.secType === "OPT" && p.strike !== undefined && p.expiry !== undefined && p.right !== undefined
    );

    if (optionPositions.length === 0) return;

    // Build OSI symbols for options
    const osiSymbols = optionPositions.map(p =>
      buildOsiSymbol(p.symbol, p.expiry!, p.right!, p.strike!)
    );

    // Fetch option close prices for the selected timeframe
    socketHub.sendControl("option_close_prices", {
      symbols: osiSymbols,
      prev_trading_day: closeDate,
    }, { timeoutMs: 10000 }).then(ack => {
      if (ack.ok && ack.data) {
        const data = (ack.data as any).data || ack.data;
        const newMap = new Map<string, OptionPriceData>();
        Object.entries(data).forEach(([symbol, prices]: [string, any]) => {
          if (prices && typeof prices.prevClose === "number") {
            newMap.set(symbol.toUpperCase(), {
              prevClose: prices.prevClose,
              todayClose: typeof prices.todayClose === "number" ? prices.todayClose : undefined,
            });
          }
        });
        setOptionClosePrices(newMap);
      }
    }).catch(err => {
      console.error("[PortfolioPanel] Failed to fetch option close prices:", err);
    });
  }, [accountState?.positions, marketState?.timeframes, timeframe]);

  // Build OSI symbols for option positions (for backend subscription)
  const optionOsiSymbols = useMemo(() => {
    if (!accountState?.positions) return [];
    return accountState.positions
      .filter(p => p.secType === "OPT" && p.strike !== undefined && p.expiry !== undefined && p.right !== undefined)
      .map(p => buildOsiSymbol(p.symbol, p.expiry!, p.right!, p.strike!));
  }, [accountState?.positions]);

  // Tell backend to subscribe to portfolio option contracts AND register interest with UI bridge
  useEffect(() => {
    console.log("[PortfolioPanel] optionOsiSymbols changed:", optionOsiSymbols.length, "symbols");
    if (optionOsiSymbols.length > 0) {
      console.log("[PortfolioPanel] Subscribing to option contracts:", optionOsiSymbols);
      // 1. Register interest with UI bridge so it forwards option messages to this client
      socketHub.send({
        type: "subscribe",
        channels: ["md.option.quote", "md.option.trade", "md.option.greeks"],
        symbols: optionOsiSymbols,
      });

      // 2. Tell backend to subscribe to Alpaca streaming for these contracts
      socketHub.send({
        type: "control",
        target: "marketData",
        op: "subscribe_portfolio_contracts",
        contracts: optionOsiSymbols,
      });
    }

    // Cleanup: unsubscribe when component unmounts or symbols change
    return () => {
      if (optionOsiSymbols.length > 0) {
        console.log("[PortfolioPanel] Cleanup: unsubscribing from option contracts:", optionOsiSymbols);
        socketHub.send({
          type: "unsubscribe",
          channels: ["md.option.quote", "md.option.trade", "md.option.greeks"],
          symbols: optionOsiSymbols,
        });
      }
    };
  }, [optionOsiSymbols]);

  // Memoize portfolio totals for P&L summary
  const { totalMktValue, totalCash, totalPortfolio, primaryAccount } = useMemo(() => {
    if (!accountState?.positions) {
      return { totalMktValue: 0, totalCash: 0, totalPortfolio: 0, primaryAccount: "" };
    }

    let mktValue = 0;
    accountState.positions.forEach((p) => {
      let priceKey = p.symbol.toUpperCase();
      let priceData;
      if (p.secType === "OPT" && p.strike !== undefined && p.expiry !== undefined && p.right !== undefined) {
        priceKey = buildOsiSymbol(p.symbol, p.expiry, p.right, p.strike);
        priceData = getChannelPrices("option").get(priceKey);
      } else {
        priceData = equityPrices.get(priceKey);
      }
      const lastPrice = priceData?.last || 0;
      let displayPrice = lastPrice;
      if (lastPrice === 0) {
        if (p.secType === "OPT") {
          const optPriceData = optionClosePrices.get(priceKey);
          if (optPriceData?.todayClose) displayPrice = optPriceData.todayClose;
        } else if (p.secType === "STK") {
          const equityCloseData = closePrices.get(p.symbol);
          if (equityCloseData?.todayClose) displayPrice = equityCloseData.todayClose;
        }
      }
      const contractMultiplier = p.secType === "OPT" ? 100 : 1;
      mktValue += p.quantity * displayPrice * contractMultiplier;
    });

    const cash = accountState.cash.reduce((sum, c) => sum + c.amount, 0);

    // Get primary account (first account seen)
    const account = accountState.positions[0]?.account || accountState.cash[0]?.account || "";

    return {
      totalMktValue: mktValue,
      totalCash: cash,
      totalPortfolio: mktValue + cash,
      primaryAccount: account,
    };
  }, [accountState, equityPrices, optionClosePrices, closePrices]);

  return (
    <div style={shell}>
      <div style={header}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ fontWeight: 600, fontSize: 15 }}>Portfolio</div>
          {/* IB Gateway Connection Status */}
          {ibConnected !== null && (
            <ConnectionStatus connected={ibConnected} label="IB Gateway" />
          )}
          {/* IB Errors Indicator */}
          {ibErrors.length > 0 && (
            <button
              onClick={() => setShowErrors(!showErrors)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                padding: "2px 8px",
                fontSize: 11,
                border: "1px solid",
                borderRadius: 4,
                cursor: "pointer",
                background: ibErrors.some(e => e.severity === "error") ? "#fee2e2" : "#fef3c7",
                borderColor: ibErrors.some(e => e.severity === "error") ? "#fca5a5" : "#fcd34d",
                color: ibErrors.some(e => e.severity === "error") ? "#991b1b" : "#92400e",
              }}
              title={showErrors ? "Hide IB errors" : "Show IB errors"}
            >
              <span>{ibErrors.some(e => e.severity === "error") ? "⚠" : "⚡"}</span>
              <span>{ibErrors.length} {ibErrors.length === 1 ? "error" : "errors"}</span>
              <span style={{ fontSize: 9 }}>{showErrors ? "▲" : "▼"}</span>
            </button>
          )}
        </div>
        <div style={{ fontSize: 12, color: "#666" }}>
          {loading && !accountState && "Loading…"}
          {error && <span style={{ color: "#dc2626" }}>{error}</span>}
          {lastUpdated && <>Updated <b>{lastUpdated}</b></>}
        </div>
      </div>

      {/* Expandable IB Errors Panel */}
      {showErrors && ibErrors.length > 0 && (
        <div style={{
          background: "#fefce8",
          borderBottom: "1px solid #fcd34d",
          padding: "8px 12px",
          maxHeight: 200,
          overflowY: "auto",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: "#92400e" }}>IB Errors & Warnings</span>
            <button
              onClick={clearErrors}
              style={{
                fontSize: 10,
                padding: "2px 6px",
                border: "1px solid #d1d5db",
                borderRadius: 3,
                background: "#fff",
                color: "#666",
                cursor: "pointer",
              }}
            >
              Clear All
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {ibErrors.map((err, idx) => (
              <div
                key={`${err.ts}-${idx}`}
                style={{
                  display: "flex",
                  gap: 8,
                  fontSize: 11,
                  padding: "4px 6px",
                  background: err.severity === "error" ? "#fee2e2" : "#fff",
                  border: "1px solid",
                  borderColor: err.severity === "error" ? "#fca5a5" : "#e5e7eb",
                  borderRadius: 3,
                }}
              >
                <span style={{ color: "#999", whiteSpace: "nowrap" }}>
                  {new Date(err.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                </span>
                <span style={{
                  color: err.severity === "error" ? "#991b1b" : "#92400e",
                  fontWeight: err.severity === "error" ? 600 : 400,
                }}>
                  [{err.code}] {err.message}
                </span>
                {err.id !== -1 && (
                  <span style={{ color: "#999" }}>(id: {err.id})</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={body}>
        {accountState ? (
          <>
            <div style={summary}>
              <span style={{ marginRight: 20, fontWeight: 700, fontSize: 13 }}>
                Portfolio: ${totalPortfolio.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
              <span style={{ marginRight: 16, fontWeight: 600 }}>
                Mkt Value: ${totalMktValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
              <span style={{ marginRight: 16, fontWeight: 600 }}>
                Cash: ${totalCash.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
              <span style={{ color: "#666", fontWeight: 500 }}>
                ({accountState.positions.length} positions)
              </span>
            </div>

            <div style={gridWrap}>
              {/* Left Column: Positions + Cash */}
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* Positions with BUY/SELL buttons */}
              <section style={section}>
                <div style={{ ...title, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <TabButtonGroup
                    tabs={[
                      { id: "positions", label: "Positions" },
                      { id: "analysis", label: "Options Analysis" },
                      { id: "pnl", label: "P&L" },
                    ]}
                    activeTab={positionsTab}
                    onTabChange={(tab) => setPositionsTab(tab as "positions" | "analysis" | "pnl")}
                  />
                  {(positionsTab === "positions" || positionsTab === "pnl") && (
                    <TimeframeSelector
                      value={timeframe}
                      onChange={setTimeframe}
                      timeframes={marketState?.timeframes ?? []}
                    />
                  )}
                </div>

                {/* Positions Table */}
                {positionsTab === "positions" && (
                <div style={table}>
                  <div style={{ ...hdr, gridTemplateColumns: "75px 140px 36px 36px 65px 80px 65px 65px 100px 80px 130px" }}>
                    <div style={hdrCell}>Account</div>
                    <div style={hdrCell}>Symbol</div>
                    <div style={hdrCell}>Type</div>
                    <div style={hdrCellCenter}>CCY</div>
                    <div style={hdrCellRight}>Qty</div>
                    <div style={hdrCellRight}>Last</div>
                    <div style={{ ...hdrCellCenter, gridColumn: "span 2" }}>
                      {currentTimeframeInfo
                        ? `Chg (${formatCloseDateShort(currentTimeframeInfo.date)})`
                        : "Change"}
                    </div>
                    <div style={hdrCellRight}>Mkt Value</div>
                    <div style={hdrCellRight}>Avg Cost</div>
                    <div style={{ textAlign: "right" as const }}>Trade</div>
                  </div>

                  {accountState.positions
                    .slice()
                    .sort((a, b) => {
                      // Sort by symbol, then by secType (STK before OPT)
                      if (a.symbol !== b.symbol) return a.symbol.localeCompare(b.symbol);
                      if (a.secType !== b.secType) return a.secType === "STK" ? -1 : 1;
                      // For options: sort by expiry, then Call/Put (calls first), then strike
                      if (a.secType === "OPT" && b.secType === "OPT") {
                        // Expiry (YYYYMMDD format, so string comparison works)
                        const expiryA = a.expiry || "";
                        const expiryB = b.expiry || "";
                        if (expiryA !== expiryB) return expiryA.localeCompare(expiryB);
                        // Call before Put (C < P alphabetically, or normalize)
                        const rightA = (a.right === "Call" || a.right === "C") ? "C" : "P";
                        const rightB = (b.right === "Call" || b.right === "C") ? "C" : "P";
                        if (rightA !== rightB) return rightA.localeCompare(rightB);
                        // Then by strike
                        if (a.strike !== b.strike) return (a.strike || 0) - (b.strike || 0);
                      }
                      return 0;
                    })
                    .map((p, i) => {
                    // Build the proper symbol for price lookup
                    let priceKey = p.symbol.toUpperCase();
                    let priceData;
                    if (p.secType === "OPT" && p.strike !== undefined && p.expiry !== undefined && p.right !== undefined) {
                      priceKey = buildOsiSymbol(p.symbol, p.expiry, p.right, p.strike);
                      priceData = getChannelPrices("option").get(priceKey);
                    } else {
                      priceData = equityPrices.get(priceKey);
                    }

                    const lastPrice = priceData?.last || 0;

                    // Use todayClose as fallback when no live price (after market close / no post-market trades)
                    const optPriceData = p.secType === "OPT" ? optionClosePrices.get(priceKey) : undefined;
                    const equityCloseData = p.secType === "STK" ? closePrices.get(p.symbol) : undefined;
                    let displayPrice = lastPrice;
                    if (lastPrice === 0) {
                      if (p.secType === "OPT" && optPriceData?.todayClose) {
                        displayPrice = optPriceData.todayClose;
                      } else if (p.secType === "STK" && equityCloseData?.todayClose) {
                        displayPrice = equityCloseData.todayClose;
                      }
                    }

                    // For options, multiply by contract size (100)
                    const contractMultiplier = p.secType === "OPT" ? 100 : 1;
                    const mktValue = p.quantity * displayPrice * contractMultiplier;

                    const mktValueDisplay = displayPrice > 0
                      ? (mktValue < 0
                          ? `(${Math.abs(mktValue).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`
                          : mktValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
                      : "—";

                    // For options, display avg cost per share (divide by 100)
                    const displayAvgCost = p.secType === "OPT" ? p.avgCost / 100 : p.avgCost;

                    // Calculate % and $ change for equities and options
                    let pctChange: number | undefined;
                    let dollarChange: number | undefined;
                    if (p.secType === "STK") {
                      if (displayPrice > 0 && equityCloseData?.prevClose && equityCloseData.prevClose > 0) {
                        pctChange = calcPctChange(displayPrice, equityCloseData.prevClose);
                        dollarChange = displayPrice - equityCloseData.prevClose;
                      }
                    } else if (p.secType === "OPT") {
                      if (displayPrice > 0 && optPriceData?.prevClose && optPriceData.prevClose > 0) {
                        pctChange = calcPctChange(displayPrice, optPriceData.prevClose);
                        dollarChange = displayPrice - optPriceData.prevClose;
                      }
                    }
                    // Format symbol display based on secType
                    let symbolDisplay: React.ReactNode;
                    if (p.secType === "OPT" && p.strike !== undefined && p.expiry !== undefined && p.right !== undefined) {
                      // Use the fields directly from the backend
                      const rightLabel = p.right === "C" || p.right === "Call" ? "Call" : "Put";
                      const formattedExpiry = formatExpiryYYYYMMDD(p.expiry);
                      symbolDisplay = (
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 11 }}>
                            {p.symbol} {p.strike % 1 === 0 ? p.strike.toFixed(0) : p.strike} {rightLabel}
                          </div>
                          <div style={{ fontSize: 9, color: "#666" }}>
                            {formattedExpiry}
                          </div>
                        </div>
                      );
                    } else {
                      // Equity or incomplete option data
                      symbolDisplay = <div style={{ fontWeight: 600 }}>{p.symbol}</div>;
                    }

                    return (
                      <div
                        key={i}
                        style={{
                          ...rowStyle,
                          gridTemplateColumns: "75px 140px 36px 36px 65px 80px 65px 65px 100px 80px 130px",
                        }}
                      >
                        <div style={cellEllipsis}>{p.account}</div>
                        <div>{symbolDisplay}</div>
                        <div style={gray10}>{p.secType}</div>
                        <div style={centerBold}>{p.currency}</div>
                        <div style={rightMono}>
                          {p.quantity.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                        </div>
                        <div style={rightMono}>
                          {displayPrice > 0 ? displayPrice.toFixed(4) : "—"}
                        </div>
                        <div style={rightMono}>
                          <PriceChangePercent value={pctChange} />
                        </div>
                        <div style={rightMono}>
                          <PriceChangeDollar value={dollarChange} />
                        </div>
                        <div style={rightMono}>
                          {mktValueDisplay}
                        </div>
                        <div style={rightMono}>{displayAvgCost.toFixed(4)}</div>
                        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, paddingRight: 12 }}>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              const optionDetails = p.secType === "OPT" && p.strike !== undefined && p.expiry !== undefined && p.right !== undefined
                                ? { strike: p.strike, expiry: p.expiry, right: p.right }
                                : undefined;
                              // Get fresh price data at click time (not closure-captured render-time value)
                              const freshPriceData = p.secType === "OPT" && p.strike !== undefined && p.expiry !== undefined && p.right !== undefined
                                ? getChannelPrices("option").get(buildOsiSymbol(p.symbol, p.expiry, p.right, p.strike))
                                : equityPrices.get(p.symbol.toUpperCase());
                              // Calculate mid if we have bid and ask
                              const marketData = freshPriceData ? {
                                ...freshPriceData,
                                mid: (freshPriceData.bid !== undefined && freshPriceData.ask !== undefined)
                                  ? (freshPriceData.bid + freshPriceData.ask) / 2
                                  : undefined
                              } : undefined;
                              openTradeTicket(p.symbol, p.account, "BUY", p.secType, optionDetails, marketData);
                            }}
                            style={{ ...iconBtn, background: "#dcfce7", color: "#166534" }}
                          >
                            BUY
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              const optionDetails = p.secType === "OPT" && p.strike !== undefined && p.expiry !== undefined && p.right !== undefined
                                ? { strike: p.strike, expiry: p.expiry, right: p.right }
                                : undefined;
                              // Get fresh price data at click time (not closure-captured render-time value)
                              const freshPriceData = p.secType === "OPT" && p.strike !== undefined && p.expiry !== undefined && p.right !== undefined
                                ? getChannelPrices("option").get(buildOsiSymbol(p.symbol, p.expiry, p.right, p.strike))
                                : equityPrices.get(p.symbol.toUpperCase());
                              // Calculate mid if we have bid and ask
                              const marketData = freshPriceData ? {
                                ...freshPriceData,
                                mid: (freshPriceData.bid !== undefined && freshPriceData.ask !== undefined)
                                  ? (freshPriceData.bid + freshPriceData.ask) / 2
                                  : undefined
                              } : undefined;
                              openTradeTicket(p.symbol, p.account, "SELL", p.secType, optionDetails, marketData);
                            }}
                            style={{ ...iconBtn, background: "#fce7f3", color: "#831843" }}
                          >
                            SELL
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
                )}

                {/* Options Analysis Table */}
                {positionsTab === "analysis" && (
                  <OptionsAnalysisTable
                    positions={accountState.positions}
                    equityPrices={equityPrices}
                  />
                )}

                {/* P&L Table */}
                {positionsTab === "pnl" && (
                  <div style={{ maxHeight: 500, overflow: "auto" }}>
                    <PnLSummary
                      account={primaryAccount}
                      positions={accountState.positions}
                      equityPrices={equityPrices}
                      timeframe={timeframe}
                      timeframes={marketState?.timeframes ?? []}
                    />
                  </div>
                )}
              </section>

              {/* Cash */}
              <CashBalances cash={accountState.cash} />
              </div>

              {/* Right Column: Open Orders + Order History */}
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* Open Orders */}
              <OpenOrdersTable
                orders={accountState.openOrders}
                onModify={(o) => setModifyingOrder(o)}
                onCancel={(o) => setCancellingOrder(o)}
              />

              {/* Order History (Fills + Cancellations) - sorted newest first */}
              <OrderHistoryTable orders={[...orderHistory].sort((a, b) => {
                // Sort by timestamp descending (newest first)
                const tsA = a.ts || "";
                const tsB = b.ts || "";
                return tsB.localeCompare(tsA);
              })} />
              </div>

            </div>
          </>
        ) : (
          <div style={empty}>{loading ? "Waiting for data…" : error || "No data"}</div>
        )}

        {/* Floating Trade Ticket */}
        {showTradeTicket && (
          <div style={{ position: "fixed", bottom: 24, right: 24, zIndex: 1000 }}>
            {ticketSecType === "STK" ? (
              <TradeTicket
                symbol={ticketSymbol}
                account={ticketAccount}
                defaultSide={ticketSide}
                last={ticketMarketData.last}
                bid={ticketMarketData.bid}
                ask={ticketMarketData.ask}
                onClose={closeTradeTicket}
              />
            ) : ticketOptionData ? (
              <OptionTradeTicket
                underlying={ticketOptionData.underlying}
                strike={ticketOptionData.strike}
                expiry={ticketOptionData.expiry}
                right={ticketOptionData.right}
                account={ticketAccount}
                defaultSide={ticketSide}
                last={ticketMarketData.last}
                bid={ticketMarketData.bid}
                ask={ticketMarketData.ask}
                mid={ticketMarketData.mid}
                delta={ticketMarketData.delta}
                gamma={ticketMarketData.gamma}
                theta={ticketMarketData.theta}
                vega={ticketMarketData.vega}
                iv={ticketMarketData.iv}
                onClose={closeTradeTicket}
              />
            ) : null}
          </div>
        )}

        {/* Cancel Confirmation Modal */}
        {cancellingOrder && (
          <CancelOrderModal
            order={cancellingOrder}
            onClose={() => setCancellingOrder(null)}
          />
        )}

        {/* Modify Order Modal */}
        {modifyingOrder && (
          <ModifyOrderModal
            order={modifyingOrder}
            onClose={() => setModifyingOrder(null)}
          />
        )}
      </div>
    </div>
  );
}

/* Styles */
const shell = { display: "flex", flexDirection: "column" as const, height: "100%", color: "#111", background: "#fff" };
const header = { padding: "10px 14px", borderBottom: "1px solid #e5e7eb", background: "#fff" };
const body = { flex: 1, overflow: "auto", padding: "12px 14px", background: "#f9fafb" };
const summary = { fontSize: 11, color: "#4b5563", marginBottom: 10 };
const gridWrap = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 };
const section = { background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, overflow: "hidden" };
const title = { fontSize: 12, fontWeight: 600, padding: "8px 10px", background: "#f1f5f9", borderBottom: "1px solid #e5e7eb" };
const table = { display: "flex", flexDirection: "column" as const };
const hdr = { display: "grid", fontWeight: 600, fontSize: 10.5, color: "#374151", padding: "0 10px", background: "#f8fafc", height: 26, alignItems: "center", borderBottom: "1px solid #e5e7eb" };
const hdrCell = { borderRight: "1px solid #ddd", paddingRight: 4 };
const hdrCellRight = { ...hdrCell, textAlign: "right" as const };
const hdrCellCenter = { ...hdrCell, textAlign: "center" as const };
const rowStyle = { display: "grid", fontSize: 11, minHeight: 32, alignItems: "center", padding: "0 10px", borderBottom: "1px solid #f3f4f6" };

// Cell border for column dividers
const cellBorder = { borderRight: "1px solid #eee", paddingRight: 4, paddingLeft: 2 };
const cellEllipsis = { ...cellBorder, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const, fontFamily: "ui-monospace, monospace", fontSize: 10 };
const right = { ...cellBorder, textAlign: "right" as const };
const rightMono = { ...right, fontFamily: "ui-monospace, monospace" };
const center = { ...cellBorder, textAlign: "center" as const };
const centerBold = { ...center, fontWeight: 600 };
const gray10 = { ...cellBorder, fontSize: 10, color: "#666" };

const empty = { padding: 40, textAlign: "center" as const, color: "#666", fontSize: 14 };

const iconBtn = {
  padding: "4px 10px",
  border: "1px solid #ccc",
  borderRadius: "6px",
  background: "white",
  fontSize: "12px",
  fontWeight: 600,
  cursor: "pointer",
};
