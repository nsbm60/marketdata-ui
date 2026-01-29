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
import { formatCloseDateShort } from "./services/closePrices";
import { useMarketState } from "./services/marketState";
import { formatExpiryShort, daysToExpiry } from "./utils/options";
import { OptionsAnalysisTable } from "./components/portfolio";
import { ExpiryScenarioAnalysis, SimulatorPanel } from "./components/portfolio";
import TimeframeSelector from "./components/shared/TimeframeSelector";
import { usePositionsReport, positionsReportClientId, ReportPosition, OptionGreeks, buildGreeksMap } from "./hooks/usePositionsReport";
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

  // Simulator drill-down state
  const [simulatorUnderlying, setSimulatorUnderlying] = useState<string | null>(null);

  // Market state for timeframe options
  const marketState = useMarketState();
  const [timeframe, setTimeframe] = useState(() => localStorage.getItem("fidelity.timeframe") ?? "1d");

  // Persist timeframe
  useEffect(() => { localStorage.setItem("fidelity.timeframe", timeframe); }, [timeframe]);

  // Reset timeframe if cached value is not in available options (e.g., "0d" on a weekend)
  useEffect(() => {
    if (marketState?.timeframes?.length) {
      const isValid = marketState.timeframes.some(t => t.id === timeframe);
      if (!isValid) {
        setTimeframe("1d");
      }
    }
  }, [marketState?.timeframes, timeframe]);

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

  // Upload positions to CalcServer when WebSocket connects (handles page refresh)
  // This is defined as a ref to avoid recreating the function on each render
  const uploadedRef = useRef(false);
  useEffect(() => {
    if (wsConnected && positions.length > 0 && !uploadedRef.current) {
      // Delay to ensure positions report is started first
      const timer = setTimeout(() => {
        const downloadedAtStr = localStorage.getItem("fidelity.downloadedAt");
        const downloadedAt = downloadedAtStr ? new Date(downloadedAtStr) : undefined;

        // Convert FidelityPosition to the format expected by CalcServer
        const positionsPayload = positions.map(pos => ({
          accountNumber: pos.accountNumber,
          accountName: pos.accountName,
          symbol: pos.symbol,
          description: pos.description,
          quantity: pos.quantity,
          lastPrice: pos.lastPrice,
          currentValue: pos.currentValue,
          costBasisTotal: pos.costBasisTotal,
          avgCostBasis: pos.avgCostBasis,
          type: pos.type,
          osiSymbol: pos.osiSymbol,
          optionType: pos.optionType,
          strike: pos.strike,
          expiry: pos.expiry,
          underlying: pos.underlying,
        }));

        socketHub.sendControl("upload_fidelity_positions", {
          target: "calc",
          clientId: positionsReportClientId,
          positions: positionsPayload,
          downloadedAt: downloadedAt?.toISOString(),
        }).then(response => {
          if (response.ok) {
            console.log(`[FidelityPanel] Uploaded ${positions.length} positions to CalcServer on connect`);
            uploadedRef.current = true;
          }
        }).catch(err => {
          console.warn("[FidelityPanel] Error uploading on connect:", err);
        });
      }, 500);

      return () => clearTimeout(timer);
    }
  }, [wsConnected, positions]);

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

  // Subscribe to option market data (client-side for reliable streaming)
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

  // Option prices from channel
  const optionPrices = useMemo(() => {
    void optionVersion;
    return getChannelPrices("option");
  }, [optionVersion]);

  // Server-computed Fidelity positions report (P&L, Greeks, per-expiry subtotals)
  const {
    positions: reportFidelityPositions,
    referenceDates: reportReferenceDates,
    underlyingGroups,
    version: reportVersion,
  } = usePositionsReport("fidelity");

  // Build Greeks map from report data (keyed by both colon and OSI formats)
  const greeksMap = useMemo(() => {
    if (!reportFidelityPositions || reportFidelityPositions.length === 0) return new Map<string, OptionGreeks>();
    return buildGreeksMap(reportFidelityPositions);
  }, [reportFidelityPositions]);

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

  // Upload positions to CalcServer for server-side processing
  const uploadToCalcServer = async (fidelityPositions: FidelityPosition[], downloadedAt?: Date) => {
    try {
      // Convert FidelityPosition to the format expected by CalcServer
      const positionsPayload = fidelityPositions.map(pos => ({
        accountNumber: pos.accountNumber,
        accountName: pos.accountName,
        symbol: pos.symbol,
        description: pos.description,
        quantity: pos.quantity,
        lastPrice: pos.lastPrice,
        currentValue: pos.currentValue,
        costBasisTotal: pos.costBasisTotal,
        avgCostBasis: pos.avgCostBasis,
        type: pos.type,
        // Option-specific fields
        osiSymbol: pos.osiSymbol,
        optionType: pos.optionType,
        strike: pos.strike,
        expiry: pos.expiry,
        underlying: pos.underlying,
      }));

      const response = await socketHub.sendControl("upload_fidelity_positions", {
        target: "calc",
        clientId: positionsReportClientId,
        positions: positionsPayload,
        downloadedAt: downloadedAt?.toISOString(),
      });

      if (response.ok) {
        console.log(`[FidelityPanel] Uploaded ${fidelityPositions.length} positions to CalcServer`);
      } else {
        console.warn("[FidelityPanel] Failed to upload positions to CalcServer:", response.error);
      }
    } catch (err) {
      console.warn("[FidelityPanel] Error uploading to CalcServer:", err);
    }
  };

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

      // Upload to CalcServer for server-side processing
      uploadToCalcServer(result.positions, result.downloadedAt || undefined);
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

      // Clear positions on CalcServer
      socketHub.sendControl("clear_fidelity_positions", {
        target: "calc",
        clientId: positionsReportClientId,
      }).catch(err => console.warn("[FidelityPanel] Error clearing CalcServer positions:", err));
    }
  };

  // Calculate totals - use client-side prices for reliability
  const totals = useMemo(() => {
    let marketValue = 0;
    let costBasis = 0;
    let dayChange = 0;

    let missingPriceCount = 0;
    tradeablePositions.forEach((pos) => {
      const qty = Math.abs(pos.quantity);
      const multiplier = pos.type === "option" ? 100 : 1;

      // Get price: prefer live streaming, fall back to position's lastPrice
      let currentPrice: number | null = null;
      if (pos.type === "equity") {
        currentPrice = equityPrices.get(pos.symbol)?.last ?? pos.lastPrice;
      } else if (pos.type === "option" && pos.osiSymbol) {
        const priceKey = pos.osiSymbol.toUpperCase();
        currentPrice = optionPrices.get(priceKey)?.last ?? pos.lastPrice;
      }

      if (currentPrice === null || currentPrice === 0) {
        missingPriceCount++;
        const key = pos.type === "option" ? pos.osiSymbol : pos.symbol;
        console.warn(`[FidelityPanel] Missing price for position: ${key} (${pos.type})`);
        return; // Skip this position in totals
      }

      const value = qty * currentPrice * multiplier * (pos.quantity < 0 ? -1 : 1);
      marketValue += value;

      if (pos.costBasisTotal !== null) {
        costBasis += pos.costBasisTotal;
      }

      // Use server-computed change from report when available
      const reportPos = reportFidelityPositions.find(rp => {
        if (pos.type === "option" && pos.osiSymbol) {
          return rp.osiSymbol?.toUpperCase() === pos.osiSymbol.toUpperCase();
        }
        return rp.secType === "STK" && rp.symbol.toUpperCase() === pos.symbol.toUpperCase();
      });
      const tfChange = reportPos?.changes?.[timeframe];
      if (tfChange) {
        dayChange += tfChange.change * qty * multiplier * (pos.quantity < 0 ? -1 : 1);
      }
    });

    if (missingPriceCount > 0) {
      console.warn(`[FidelityPanel] ${missingPriceCount} position(s) excluded from total due to missing prices`);
    }

    return {
      marketValue,
      costBasis,
      unrealizedPL: marketValue - costBasis,
      dayChange,
      totalAccountValue: marketValue + totalCash + totalPending,
    };
  }, [tradeablePositions, equityPrices, optionPrices, reportFidelityPositions, timeframe, totalCash, totalPending]);

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
                      {reportReferenceDates[timeframe]
                        ? `Chg (${formatCloseDateShort(reportReferenceDates[timeframe])})`
                        : currentTimeframeInfo
                          ? `Chg (${formatCloseDateShort(currentTimeframeInfo.date)})`
                          : "Change"}
                    </div>
                    <div style={hdrCellRight}>Mkt Value</div>
                    <div style={hdrCellRight}>Avg Cost</div>
                    <div style={hdrCellRight}>P&L</div>
                  </div>

                  {/* Position rows */}
                  {sortedPositions.map((pos, i) => {
                    // Get current price: prefer live streaming, fall back to position's lastPrice
                    let currentPrice: number | null = null;
                    if (pos.type === "equity") {
                      currentPrice = equityPrices.get(pos.symbol)?.last ?? pos.lastPrice;
                    } else if (pos.type === "option" && pos.osiSymbol) {
                      currentPrice = optionPrices.get(pos.osiSymbol.toUpperCase())?.last ?? pos.lastPrice;
                    }

                    const hasMissingPrice = currentPrice === null || currentPrice === 0;
                    const multiplier = pos.type === "option" ? 100 : 1;
                    const qty = pos.quantity;
                    const mktValue = hasMissingPrice ? null : qty * currentPrice! * multiplier;

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

                    // Change calculation (using server-computed values from report)
                    // Find matching report position directly (like IBPanel)
                    let pctChange: number | undefined;
                    let dollarChange: number | undefined;
                    const reportPos = reportFidelityPositions.find(rp => {
                      if (pos.type === "option" && pos.osiSymbol) {
                        return rp.osiSymbol?.toUpperCase() === pos.osiSymbol.toUpperCase();
                      }
                      return rp.secType === "STK" && rp.symbol.toUpperCase() === pos.symbol.toUpperCase();
                    });
                    const tfChange = reportPos?.changes?.[timeframe];
                    if (tfChange) {
                      pctChange = tfChange.pct;
                      dollarChange = tfChange.change;
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
                  <OptionsAnalysisTable
                    positions={reportFidelityPositions ?? []}
                    underlyingGroups={underlyingGroups}
                    version={reportVersion}
                  />
                </div>
              )}

              {/* Expiry Scenarios Tab / Simulator */}
              {activeTab === "scenarios" && (
                <div style={{ maxHeight: 750, overflow: "auto" }}>
                  {simulatorUnderlying ? (
                    <SimulatorPanel
                      underlying={simulatorUnderlying}
                      positions={ibFormatPositions}
                      equityPrices={equityPrices}
                      greeksMap={greeksMap}
                      onClose={() => setSimulatorUnderlying(null)}
                    />
                  ) : (
                    <ExpiryScenarioAnalysis
                      positions={ibFormatPositions}
                      equityPrices={equityPrices}
                      greeksMap={greeksMap}
                      greeksVersion={reportVersion}
                      onSelectUnderlying={setSimulatorUnderlying}
                    />
                  )}
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
const body: React.CSSProperties = { flex: 1, overflow: "hidden", padding: "12px 14px", background: light.bg.muted };
const summary: React.CSSProperties = { fontSize: 11, color: light.text.secondary, marginBottom: 10 };
const section: React.CSSProperties = { background: light.bg.primary, border: `1px solid ${light.border.primary}`, borderRadius: 8, overflow: "hidden" };
const tabBar: React.CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", background: light.bg.tertiary, borderBottom: `1px solid ${light.border.primary}`, maxWidth: 745 };

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
