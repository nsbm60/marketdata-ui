// src/FidelityPanel.tsx
import { useEffect, useState, useMemo, useRef } from "react";
import { socketHub } from "./ws/SocketHub";
import { light, semantic, pnl, dark } from "./theme";
import {
  FidelityPosition,
  FidelityImportResult,
  parseFidelityCSV,
  getSubscriptionSymbols,
  savePositions,
  loadPositions,
  clearPositions,
} from "./utils/fidelity";
import { useThrottledMarketPrices, useChannelUpdates, getChannelPrices, PriceData } from "./hooks/useMarketData";
import { fetchClosePrices, ClosePriceData, calcPctChange, formatCloseDateShort } from "./services/closePrices";
import { useMarketState } from "./services/marketState";
import { formatExpiryShort, daysToExpiry, osiToTopicSymbol, parseOptionSymbol } from "./utils/options";
import FidelityOptionsAnalysis from "./components/fidelity/FidelityOptionsAnalysis";
import ExpiryScenarioAnalysis from "./components/portfolio/ExpiryScenarioAnalysis";
import TimeframeSelector from "./components/shared/TimeframeSelector";
import { usePortfolioOptionsReports, PortfolioOptionPosition } from "./hooks/usePortfolioOptionsReports";
import TabButtonGroup from "./components/shared/TabButtonGroup";
import { PriceChangePercent, PriceChangeDollar } from "./components/shared/PriceChange";
import { useAppState } from "./state/useAppState";
import { IbPosition } from "./types/portfolio";

export default function FidelityPanel() {
  const [positions, setPositions] = useState<FidelityPosition[]>([]);
  const [importDate, setImportDate] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // WebSocket connection status
  const { state: appState } = useAppState();
  const wsConnected = appState.connection.websocket === "connected";

  // Tab state: "positions", "analysis", or "scenarios"
  const [activeTab, setActiveTab] = useState<"positions" | "analysis" | "scenarios">("positions");

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

  // Compute import reminder based on last import time and market state
  const importReminder = useMemo(() => {
    const downloadedAtStr = localStorage.getItem("fidelity.downloadedAt");
    if (!downloadedAtStr) {
      return positions.length > 0 ? null : "Import positions from Fidelity CSV";
    }

    const downloadedAt = new Date(downloadedAtStr);
    const now = new Date();
    const today = now.toDateString();
    const importDay = downloadedAt.toDateString();
    const isToday = today === importDay;
    const importHour = downloadedAt.getHours();

    // If import is from a different day
    if (!isToday) {
      const daysDiff = Math.floor((now.getTime() - downloadedAt.getTime()) / (1000 * 60 * 60 * 24));
      if (daysDiff === 1) {
        return "Last import was yesterday - consider importing today's positions";
      }
      return `Last import was ${daysDiff} days ago - positions may be stale`;
    }

    // Import is from today - check timing vs market state
    if (marketState?.state === "PreMarket" && importHour >= 16) {
      // Have yesterday's EOD import, but need today's SOD
      return "Import pre-market positions for accurate intraday P&L";
    }

    if (marketState?.state === "AfterHours" && importHour < 16) {
      // Have SOD but not EOD - optional reminder
      return "Consider EOD import for historical record";
    }

    return null; // All good
  }, [positions.length, marketState?.state]);

  // Get symbols for subscription
  const subscriptionSymbols = useMemo(() => {
    return getSubscriptionSymbols(positions);
  }, [positions]);

  // Subscribe to equity market data
  const equityPrices = useThrottledMarketPrices(subscriptionSymbols.equities, "equity", 250);

  // Subscribe to option market data
  const optionVersion = useChannelUpdates("option", 250);

  // Helper to send option subscriptions (used on initial mount and reconnect)
  const sendOptionSubscriptions = (symbols: string[]) => {
    if (symbols.length === 0) return;
    console.log("[FidelityPanel] Subscribing to option contracts:", symbols);
    socketHub.send({
      type: "subscribe",
      channels: ["md.option.quote", "md.option.trade", "md.option.greeks"],
      symbols,
    });
    socketHub.send({
      type: "control",
      target: "marketData",
      op: "subscribe_portfolio_contracts",
      contracts: symbols,
    });
  };

  // Register option subscriptions with backend
  useEffect(() => {
    sendOptionSubscriptions(subscriptionSymbols.options);

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

  // Re-subscribe to option contracts on WebSocket reconnect
  useEffect(() => {
    const handleReconnect = () => {
      console.log("[FidelityPanel] WebSocket reconnected, resubscribing to options...");
      sendOptionSubscriptions(subscriptionSymbols.options);
    };
    socketHub.onConnect(handleReconnect);
    return () => socketHub.offConnect(handleReconnect);
  }, [subscriptionSymbols.options.join(",")]);

  // Close prices for equities
  const [closePrices, setClosePrices] = useState<Map<string, ClosePriceData>>(new Map());

  // Fetch close prices when symbols, timeframe, or connection change
  // Wait for marketState.timeframes to be loaded to ensure correct date interpretation
  // Also re-fetch when marketState.lastUpdated changes (visibility change, reconnect, etc.)
  useEffect(() => {
    if (subscriptionSymbols.equities.length > 0 && wsConnected && marketState?.timeframes?.length) {
      fetchClosePrices(subscriptionSymbols.equities, timeframe).then(setClosePrices);
    }
  }, [subscriptionSymbols.equities.join(","), timeframe, wsConnected, marketState?.timeframes, marketState?.lastUpdated]);

  // Option close prices for % change display
  type OptionPriceData = { prevClose: number; todayClose?: number };
  const [optionClosePrices, setOptionClosePrices] = useState<Map<string, OptionPriceData>>(new Map());

  // Fetch close prices for option positions when options, timeframe, or connection change
  useEffect(() => {
    if (subscriptionSymbols.options.length === 0 || !marketState?.timeframes || !wsConnected) return;

    // Find the date for the selected timeframe
    const tfInfo = marketState.timeframes.find(t => t.id === timeframe);
    const closeDate = tfInfo?.date || marketState.prevTradingDay;
    if (!closeDate) return;

    socketHub.sendControl("option_close_prices", {
      symbols: subscriptionSymbols.options,
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
      console.error("[FidelityPanel] Failed to fetch option close prices:", err);
    });
  }, [subscriptionSymbols.options.join(","), marketState?.timeframes, timeframe, wsConnected, marketState?.lastUpdated]);

  // Option prices from channel
  const optionPrices = useMemo(() => {
    void optionVersion;
    return getChannelPrices("option");
  }, [optionVersion]);

  // Build option positions for Greeks lookup via OptionsReportBuilder
  const portfolioOptionPositions = useMemo((): PortfolioOptionPosition[] => {
    return positions
      .filter(p => p.type === "option" && p.osiSymbol)
      .map(p => {
        const parsed = parseOptionSymbol(p.osiSymbol!);
        if (!parsed) return null;
        return {
          underlying: parsed.underlying,
          expiry: parsed.expiration,  // YYYY-MM-DD format
          strike: parsed.strike,
          right: parsed.right === "call" ? "C" : "P",
        };
      })
      .filter((p): p is PortfolioOptionPosition => p !== null);
  }, [positions]);

  // Subscribe to OptionsReportBuilders for portfolio options to get Greeks
  const { greeksMap: portfolioGreeksMap, version: greeksVersion } = usePortfolioOptionsReports(portfolioOptionPositions);

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
      const result = parseFidelityCSV(text);
      setPositions(result.positions);
      savePositions(result.positions);
      // Use extracted timestamp from file, fallback to current time
      const dateDisplay = result.downloadedAtRaw || new Date().toLocaleString();
      setImportDate(dateDisplay);
      localStorage.setItem("fidelity.importDate", dateDisplay);
      // Also store the parsed Date for programmatic use
      if (result.downloadedAt) {
        localStorage.setItem("fidelity.downloadedAt", result.downloadedAt.toISOString());
      }
      console.log(`[FidelityPanel] Imported ${result.positions.length} positions, downloaded: ${dateDisplay}`);
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
      } else if (pos.type === "option" && pos.osiSymbol) {
        const topicKey = osiToTopicSymbol(pos.osiSymbol);
        if (topicKey && optionPrices.has(topicKey)) {
          currentPrice = optionPrices.get(topicKey)?.last ?? currentPrice;
        }
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

  // Convert Fidelity positions to IbPosition format for ExpiryScenarioAnalysis
  const ibFormatPositions = useMemo((): IbPosition[] => {
    return tradeablePositions.map(pos => ({
      symbol: pos.underlying || pos.symbol,
      secType: pos.type === "option" ? "OPT" : "STK",
      quantity: pos.quantity,
      avgCost: pos.avgCostBasis ?? 0,
      strike: pos.strike,
      expiry: pos.expiry,
      right: pos.optionType === "call" ? "C" : pos.optionType === "put" ? "P" : undefined,
    }));
  }, [tradeablePositions]);

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
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {importReminder && (
            <span style={reminderStyle}>
              {importReminder}
            </span>
          )}
          <span style={{ fontSize: 12, color: light.text.muted }}>
            {importDate && <>Imported: {importDate}</>}
          </span>
        </div>
      </div>

      {/* Body */}
      <div style={body}>
        {positions.length === 0 ? (
          <div style={empty}>
            <p>No positions imported.</p>
            <p style={{ fontSize: 12, color: light.text.muted }}>
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
                <span style={{ marginRight: 16, color: totalPending >= 0 ? pnl.positive : pnl.negative }}>
                  Pending: {totalPending >= 0 ? "+" : ""}${totalPending.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              )}
              <span style={{ marginRight: 16, color: totals.unrealizedPL >= 0 ? pnl.positive : pnl.negative, fontWeight: 600 }}>
                P&L: {totals.unrealizedPL >= 0 ? "+" : ""}${totals.unrealizedPL.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
              <span style={{ color: light.text.muted }}>
                ({tradeablePositions.length} positions)
              </span>
            </div>

            {/* Main content */}
            <div style={section}>
              {/* Tab bar */}
              <div style={tabBar}>
                <TabButtonGroup
                  tabs={[
                    { id: "positions", label: "Positions" },
                    { id: "analysis", label: "Options Analysis" },
                    { id: "scenarios", label: "Expiry Scenarios" },
                  ]}
                  activeTab={activeTab}
                  onTabChange={(tab) => setActiveTab(tab as "positions" | "analysis" | "scenarios")}
                />
                {activeTab === "positions" && marketState?.timeframes && (
                  <TimeframeSelector
                    value={timeframe}
                    onChange={setTimeframe}
                    timeframes={marketState.timeframes}
                  />
                )}
              </div>

              {/* Positions Table */}
              {activeTab === "positions" && (
                <div style={{ maxHeight: 750, overflow: "auto" }}>
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
                      const topicKey = osiToTopicSymbol(pos.osiSymbol);
                      if (topicKey) {
                        currentPrice = optionPrices.get(topicKey)?.last ?? currentPrice;
                      }
                    }

                    const multiplier = pos.type === "option" ? 100 : 1;
                    const qty = pos.quantity;
                    const mktValue = currentPrice !== null ? qty * currentPrice * multiplier : null;

                    // P&L calculation
                    // For long positions: P&L = market value - cost paid
                    // For short positions: P&L = premium received - cost to close
                    //   costBasisTotal is premium received (positive), mktValue is negative (qty < 0)
                    //   So: P&L = costBasisTotal + mktValue
                    let pl: number | null = null;
                    if (mktValue !== null && pos.costBasisTotal !== null) {
                      pl = qty < 0
                        ? pos.costBasisTotal + mktValue
                        : mktValue - pos.costBasisTotal;
                    }

                    // Change calculation
                    let pctChange: number | undefined;
                    let dollarChange: number | undefined;
                    if (currentPrice !== null) {
                      if (pos.type === "equity") {
                        const closeData = closePrices.get(pos.symbol);
                        if (closeData?.prevClose && closeData.prevClose > 0) {
                          pctChange = calcPctChange(currentPrice, closeData.prevClose);
                          dollarChange = currentPrice - closeData.prevClose;
                        }
                      } else if (pos.type === "option" && pos.osiSymbol) {
                        const optCloseData = optionClosePrices.get(pos.osiSymbol.toUpperCase());
                        if (optCloseData?.prevClose && optCloseData.prevClose > 0) {
                          pctChange = calcPctChange(currentPrice, optCloseData.prevClose);
                          dollarChange = currentPrice - optCloseData.prevClose;
                        }
                      }
                    }
                    // Symbol display
                    let symbolDisplay: React.ReactNode;
                    if (pos.type === "option" && pos.strike !== undefined && pos.expiry !== undefined) {
                      const rightLabel = pos.optionType === "call" ? "Call" : "Put";
                      symbolDisplay = (
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 11 }}>
                            {pos.underlying || pos.symbol} {pos.strike} {rightLabel}
                          </div>
                          <div style={{ fontSize: 9, color: light.text.muted }}>
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
                          <PriceChangePercent value={pctChange} />
                        </div>
                        <div style={rightMono}>
                          <PriceChangeDollar value={dollarChange} />
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
                        <div style={{ ...rightMono, color: pl !== null ? (pl >= 0 ? pnl.positive : pnl.negative) : undefined, fontWeight: pl !== null ? 600 : 400 }}>
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
                      <div style={{ ...rowStyle, background: semantic.success.bg, borderTop: `2px solid ${semantic.success.bgMuted}` }}>
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
                        <div key={`cash-${i}`} style={{ ...rowStyle, background: semantic.success.bg, fontSize: 10 }}>
                          <div style={cellEllipsis}>
                            <span style={{ marginLeft: 12 }}>{pos.symbol}</span>
                            <span style={{ marginLeft: 8, color: light.text.muted }}>{pos.description}</span>
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
                    <div style={{ ...rowStyle, background: semantic.warning.bg, borderTop: `2px solid ${semantic.warning.bgMuted}` }}>
                      <div style={{ ...cellEllipsis, fontWeight: 600 }}>Pending Activity</div>
                      <div style={gray10}></div>
                      <div style={rightMono}>—</div>
                      <div style={rightMono}>—</div>
                      <div style={rightMono}>—</div>
                      <div style={rightMono}>—</div>
                      <div style={{ ...rightMono, fontWeight: 600, color: totalPending >= 0 ? pnl.positive : pnl.negative }}>
                        {totalPending >= 0 ? "+" : ""}${totalPending.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                      <div style={rightMono}>—</div>
                      <div style={rightMono}>—</div>
                    </div>
                  )}
                </div>
                </div>
              )}

              {/* Options Analysis Tab */}
              {activeTab === "analysis" && (
                <div style={{ maxHeight: 750, overflow: "auto" }}>
                  <FidelityOptionsAnalysis
                    positions={tradeablePositions}
                    equityPrices={equityPrices}
                    optionPrices={optionPrices}
                    greeksMap={portfolioGreeksMap}
                    greeksVersion={greeksVersion}
                  />
                </div>
              )}

              {/* Expiry Scenarios Tab */}
              {activeTab === "scenarios" && (
                <div style={{ maxHeight: 750, overflow: "auto" }}>
                  <ExpiryScenarioAnalysis
                    positions={ibFormatPositions}
                    equityPrices={equityPrices}
                    greeksMap={portfolioGreeksMap}
                    greeksVersion={greeksVersion}
                  />
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* Styles */
const shell: React.CSSProperties = { display: "flex", flexDirection: "column", height: "100%", color: light.text.primary, background: light.bg.primary };
const header: React.CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", borderBottom: `1px solid ${light.border.primary}`, background: light.bg.primary };
const body: React.CSSProperties = { flex: 1, overflow: "auto", padding: "12px 14px", background: light.bg.muted };
const summary: React.CSSProperties = { fontSize: 11, color: light.text.secondary, marginBottom: 10 };
const section: React.CSSProperties = { background: light.bg.primary, border: `1px solid ${light.border.primary}`, borderRadius: 8, overflow: "hidden" };
const tabBar: React.CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", background: light.bg.tertiary, borderBottom: `1px solid ${light.border.primary}` };

const table: React.CSSProperties = { display: "flex", flexDirection: "column" };
const gridCols = "180px 45px 70px 70px 70px 65px 100px 70px 75px";
const hdr: React.CSSProperties = { display: "grid", gridTemplateColumns: gridCols, fontWeight: 600, fontSize: 10.5, color: light.text.secondary, padding: "0 10px", background: light.bg.secondary, height: 26, alignItems: "center", borderBottom: `1px solid ${light.border.primary}`, position: "sticky", top: 0, zIndex: 1 };
const hdrCell: React.CSSProperties = { borderRight: `1px solid ${light.border.light}`, paddingRight: 4 };
const hdrCellRight: React.CSSProperties = { ...hdrCell, textAlign: "right" };
const hdrCellCenter: React.CSSProperties = { ...hdrCell, textAlign: "center" };
const rowStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: gridCols, fontSize: 11, minHeight: 32, alignItems: "center", padding: "0 10px", borderBottom: `1px solid ${light.bg.hover}` };

const cellBorder: React.CSSProperties = { borderRight: `1px solid ${light.border.muted}`, paddingRight: 4, paddingLeft: 2 };
const cellEllipsis: React.CSSProperties = { ...cellBorder, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const rightMono: React.CSSProperties = { ...cellBorder, textAlign: "right", fontFamily: "ui-monospace, monospace" };
const gray10: React.CSSProperties = { ...cellBorder, fontSize: 10, color: light.text.muted };

const empty: React.CSSProperties = { padding: 40, textAlign: "center", color: light.text.muted, fontSize: 14 };

const reminderStyle: React.CSSProperties = {
  fontSize: 11,
  padding: "4px 10px",
  background: semantic.warning.bg,
  border: `1px solid ${semantic.warning.accent}`,
  borderRadius: 4,
  color: semantic.warning.text,
};

const uploadBtn: React.CSSProperties = {
  padding: "4px 12px",
  fontSize: 12,
  background: dark.accent.primary,
  color: light.bg.primary,
  border: "none",
  borderRadius: 4,
  cursor: "pointer",
};

const clearBtn: React.CSSProperties = {
  padding: "4px 12px",
  fontSize: 12,
  background: semantic.error.text,
  color: light.bg.primary,
  border: "none",
  borderRadius: 4,
  cursor: "pointer",
};
