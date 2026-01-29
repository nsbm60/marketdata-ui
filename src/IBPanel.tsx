// src/IBPanel.tsx
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
  ExpiryScenarioAnalysis,
  PnLSummary,
  SimulatorPanel,
} from "./components/portfolio";
import ConnectionStatus from "./components/shared/ConnectionStatus";
import TimeframeSelector from "./components/shared/TimeframeSelector";
import TabButtonGroup from "./components/shared/TabButtonGroup";
import { PriceChangePercent, PriceChangeDollar } from "./components/shared/PriceChange";
import { useMarketState } from "./services/marketState";
import { useThrottledMarketPrices, useChannelUpdates } from "./hooks/useMarketData";
import { buildOsiSymbol, formatExpiryYYYYMMDD } from "./utils/options";
import { useIbErrors } from "./hooks/useIbErrors";
import { useTradeTicket } from "./hooks/useTradeTicket";
import { useAppState } from "./state/useAppState";
import { usePositionsReport, ReportPosition, OptionGreeks, buildGreeksMap } from "./hooks/usePositionsReport";
import type { TimeframeOption } from "./services/marketState";
import type { IbPosition } from "./types/portfolio";
import { light, semantic, table as tableTheme } from "./theme";

// Default timeframes used when marketState hasn't loaded yet
const defaultTimeframes: TimeframeOption[] = [
  { id: "1d", date: "", label: "" },
  { id: "1w", date: "", label: "-1w" },
  { id: "1m", date: "", label: "-1m" },
];

/**
 * Convert ReportPosition to IbPosition format for compatibility with existing components.
 */
function reportPositionToIbPosition(rp: ReportPosition): IbPosition {
  return {
    account: rp.accountNumber || "",
    symbol: rp.symbol,
    secType: rp.secType,
    currency: "USD",
    quantity: rp.quantity,
    avgCost: rp.avgCost,
    lastUpdated: "",
    // Option fields
    strike: rp.strike,
    expiry: rp.expiry,
    right: rp.right,
  };
}

export default function IBPanel() {
  // Server-computed IB positions report — single source of truth for all position data
  const {
    report,
    positions: reportIbPositions,
    summary: reportSummary,
    underlyingGroups,
    cash: reportCash,
    referenceDates,
    openOrders: reportOpenOrders,
    completedOrders: reportCompletedOrders,
    ibConnected,
    reportStatus,
    loading: reportLoading,
    version: reportVersion,
  } = usePositionsReport("ib");

  // IB errors — separate hook for error event accumulation
  const {
    ibErrors,
    showErrors,
    setShowErrors,
    clearErrors,
  } = useIbErrors();

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

  // Global app state
  const { setIbConnected: setIbConnectedGlobal, markDataLoaded } = useAppState();

  // Sync IB connected state with global app state
  useEffect(() => {
    if (ibConnected !== null) {
      setIbConnectedGlobal(ibConnected);
    }
  }, [ibConnected, setIbConnectedGlobal]);

  // Mark data loaded when first report arrives
  useEffect(() => {
    if (!reportLoading && report) {
      markDataLoaded();
    }
  }, [reportLoading, report, markDataLoaded]);

  // Tab for positions view: "positions", "analysis", or "pnl"
  const [positionsTab, setPositionsTab] = useState<"positions" | "analysis" | "scenarios" | "pnl">("positions");

  // Simulator drill-down state
  const [simulatorUnderlying, setSimulatorUnderlying] = useState<string | null>(null);

  // Market state for prevTradingDay and timeframes
  const marketState = useMarketState();
  const [timeframe, setTimeframe] = useState(() => localStorage.getItem("portfolio.timeframe") ?? "1d");

  // Persist timeframe selection
  useEffect(() => { localStorage.setItem("portfolio.timeframe", timeframe); }, [timeframe]);

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

  // Build list of equity symbols from report positions (for streaming subscription)
  const equitySymbols = useMemo(() => {
    const symbols = new Set<string>();
    reportIbPositions.forEach(p => {
      if (p.secType === "STK" || p.secType === "OPT") {
        symbols.add(p.symbol.toUpperCase());
      }
    });
    return Array.from(symbols);
  }, [reportIbPositions]);

  // Subscribe to equity market data via MarketDataBus
  // Still needed for: trade tickets (bid/ask), downstream components (ExpiryScenarioAnalysis, PnLSummary)
  const equityPrices = useThrottledMarketPrices(equitySymbols, "equity", 250);

  // Listen to option channel updates — triggers re-renders for PnLSummary which calls getChannelPrices("option")
  useChannelUpdates("option", 250);

  // Build OSI symbols for option positions AND open orders (for backend subscription)
  const optionOsiSymbols = useMemo(() => {
    const symbols = new Set<string>();

    // Add option positions (report has OSI symbol directly)
    reportIbPositions.forEach(p => {
      if (p.secType === "OPT" && p.osiSymbol) {
        symbols.add(p.osiSymbol);
      }
    });

    // Add option open orders (so ModifyOrderModal can get prices/Greeks)
    reportOpenOrders.forEach(o => {
      if (o.secType === "OPT" && o.strike !== undefined && o.expiry !== undefined && o.right !== undefined) {
        symbols.add(buildOsiSymbol(o.symbol, o.expiry!, o.right!, o.strike!));
      }
    });

    return Array.from(symbols);
  }, [reportIbPositions, reportOpenOrders]);

  // Convert report positions to IbPosition format for downstream components
  const reportPositionsAsIb = useMemo((): IbPosition[] => {
    if (!reportIbPositions || reportIbPositions.length === 0) return [];
    return reportIbPositions.map(reportPositionToIbPosition);
  }, [reportIbPositions]);

  // Build Greeks map from report data (keyed by both colon and OSI formats)
  const greeksMap = useMemo(() => {
    if (!reportIbPositions || reportIbPositions.length === 0) return new Map<string, OptionGreeks>();
    return buildGreeksMap(reportIbPositions);
  }, [reportIbPositions]);

  // Helper to send option subscriptions (used on initial mount and reconnect)
  const sendOptionSubscriptions = (symbols: string[]) => {
    if (symbols.length === 0) return;
    // 1. Register interest with UI bridge so it forwards option messages to this client
    socketHub.send({
      type: "subscribe",
      channels: ["md.option.quote", "md.option.trade", "md.option.greeks"],
      symbols,
    });
    // 2. Tell backend to subscribe to Alpaca streaming for these contracts
    socketHub.send({
      type: "control",
      target: "marketData",
      op: "subscribe_portfolio_contracts",
      contracts: symbols,
    });
  };

  // Tell backend to subscribe to portfolio option contracts AND register interest with UI bridge
  useEffect(() => {
    sendOptionSubscriptions(optionOsiSymbols);

    // Cleanup: unsubscribe when component unmounts or symbols change
    return () => {
      if (optionOsiSymbols.length > 0) {
        socketHub.send({
          type: "unsubscribe",
          channels: ["md.option.quote", "md.option.trade", "md.option.greeks"],
          symbols: optionOsiSymbols,
        });
      }
    };
  }, [optionOsiSymbols]);

  // Re-subscribe to option contracts on WebSocket reconnect
  useEffect(() => {
    const handleReconnect = () => {
      sendOptionSubscriptions(optionOsiSymbols);
    };
    socketHub.onConnect(handleReconnect);
    return () => socketHub.offConnect(handleReconnect);
  }, [optionOsiSymbols]);

  // Create positions list with synthetic 0-quantity underlying positions
  // for options where we don't own the underlying stock
  const positionsForTable = useMemo((): ReportPosition[] => {
    const positions = reportIbPositions;
    if (positions.length === 0) return [];

    const stkSymbols = new Set(
      positions.filter(p => p.secType === "STK").map(p => p.symbol.toUpperCase())
    );
    const optionUnderlyings = new Set(
      positions.filter(p => p.secType === "OPT").map(p => p.symbol.toUpperCase())
    );
    const missingUnderlyings = [...optionUnderlyings].filter(s => !stkSymbols.has(s));

    if (missingUnderlyings.length === 0) return positions;

    const account = positions[0]?.accountNumber || "";

    // Create synthetic 0-quantity STK positions for missing underlyings
    // Get underlying prices from underlyingGroups
    const underlyingPriceMap = new Map<string, number>();
    underlyingGroups.forEach(g => {
      if (g.underlyingPrice) {
        underlyingPriceMap.set(g.underlying.toUpperCase(), g.underlyingPrice);
      }
    });

    const syntheticPositions: ReportPosition[] = missingUnderlyings.map(symbol => {
      const price = underlyingPriceMap.get(symbol);
      return {
        key: `synthetic:${symbol}`,
        source: "ib" as const,
        symbol,
        secType: "STK" as const,
        quantity: 0,
        avgCost: 0,
        accountNumber: account,
        currentPrice: price,
        currentValue: 0,
      };
    });

    return [...positions, ...syntheticPositions];
  }, [reportIbPositions, underlyingGroups]);

  // Primary account from report
  const primaryAccount = reportIbPositions[0]?.accountNumber || "";

  // Has data to display
  const hasData = report !== null;

  return (
    <div style={shell}>
      <div style={header}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ fontWeight: 600, fontSize: 15 }}>Portfolio</div>
          {/* IB Gateway Connection Status */}
          {ibConnected !== null && (
            <ConnectionStatus connected={ibConnected} label="IB Gateway" />
          )}
          {/* Report error status */}
          {reportStatus === "error" && report?.reportError && (
            <span style={{ fontSize: 11, color: semantic.error.text, fontWeight: 600 }}>
              {report.reportError}
            </span>
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
                border: `1px solid ${ibErrors.some(e => e.severity === "error") ? semantic.error.light : semantic.warning.accent}`,
                borderRadius: 4,
                cursor: "pointer",
                background: ibErrors.some(e => e.severity === "error") ? semantic.error.bgMuted : semantic.warning.bg,
                color: ibErrors.some(e => e.severity === "error") ? semantic.error.textDark : semantic.warning.text,
              }}
              title={showErrors ? "Hide IB errors" : "Show IB errors"}
            >
              <span>{ibErrors.some(e => e.severity === "error") ? "⚠" : "⚡"}</span>
              <span>{ibErrors.length} {ibErrors.length === 1 ? "error" : "errors"}</span>
              <span style={{ fontSize: 9 }}>{showErrors ? "▲" : "▼"}</span>
            </button>
          )}
        </div>
        <div style={{ fontSize: 12, color: light.text.muted }}>
          {reportLoading && !report && "Loading..."}
          {report && <>Updated <b>{new Date(report.asOf).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</b></>}
        </div>
      </div>

      {/* Expandable IB Errors Panel */}
      {showErrors && ibErrors.length > 0 && (
        <div style={{
          background: semantic.highlight.yellow,
          borderBottom: `1px solid ${semantic.warning.accent}`,
          padding: "8px 12px",
          maxHeight: 200,
          overflowY: "auto",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: semantic.warning.text }}>IB Errors & Warnings</span>
            <button
              onClick={clearErrors}
              style={{
                fontSize: 10,
                padding: "2px 6px",
                border: `1px solid ${light.border.secondary}`,
                borderRadius: 3,
                background: light.bg.primary,
                color: light.text.muted,
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
                  background: err.severity === "error" ? semantic.error.bgMuted : light.bg.primary,
                  border: `1px solid ${err.severity === "error" ? semantic.error.light : light.border.primary}`,
                  borderRadius: 3,
                }}
              >
                <span style={{ color: light.text.disabled, whiteSpace: "nowrap" }}>
                  {new Date(err.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                </span>
                <span style={{
                  color: err.severity === "error" ? semantic.error.textDark : semantic.warning.text,
                  fontWeight: err.severity === "error" ? 600 : 400,
                }}>
                  [{err.code}] {err.message}
                </span>
                {err.id !== -1 && (
                  <span style={{ color: light.text.disabled }}>(id: {err.id})</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={body}>
        {hasData ? (
          <>
            <div style={summary}>
              <span style={{ marginRight: 20, fontWeight: 700, fontSize: 13 }}>
                Portfolio: ${((reportSummary?.totalPositionValue ?? 0) + (reportSummary?.totalCash ?? 0)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
              <span style={{ marginRight: 16, fontWeight: 600 }}>
                Mkt Value: ${(reportSummary?.totalPositionValue ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
              <span style={{ marginRight: 16, fontWeight: 600 }}>
                Cash: ${(reportSummary?.totalCash ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
              <span style={{ color: light.text.muted, fontWeight: 500 }}>
                ({reportSummary?.positionCount ?? 0} positions)
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
                      { id: "scenarios", label: "Expiry Scenarios" },
                      { id: "pnl", label: "P&L" },
                    ]}
                    activeTab={positionsTab}
                    onTabChange={(tab) => setPositionsTab(tab as "positions" | "analysis" | "scenarios" | "pnl")}
                  />
                  {(positionsTab === "positions" || positionsTab === "pnl") && (
                    <TimeframeSelector
                      value={timeframe}
                      onChange={setTimeframe}
                      timeframes={marketState?.timeframes?.length ? marketState.timeframes : defaultTimeframes}
                    />
                  )}
                </div>

                {/* Positions Table */}
                {positionsTab === "positions" && (
                <div style={{ maxHeight: 750, overflow: "auto" }}>
                <div style={tableStyles}>
                  <div style={{ ...hdr, gridTemplateColumns: "75px 140px 36px 36px 65px 80px 75px 65px 100px 80px 120px" }}>
                    <div style={hdrCell}>Account</div>
                    <div style={hdrCell}>Symbol</div>
                    <div style={hdrCell}>Type</div>
                    <div style={hdrCellCenter}>CCY</div>
                    <div style={hdrCellRight}>Qty</div>
                    <div style={hdrCellRight}>Last</div>
                    <div style={{ ...hdrCellCenter, gridColumn: "span 2" }}>
                      {referenceDates[timeframe]
                        ? `Chg (${formatCloseDateShort(referenceDates[timeframe])})`
                        : currentTimeframeInfo
                          ? `Chg (${formatCloseDateShort(currentTimeframeInfo.date)})`
                          : "Change"}
                    </div>
                    <div style={hdrCellRight}>Mkt Value</div>
                    <div style={hdrCellRight}>Avg Cost</div>
                    <div style={hdrCellRight}>Trade</div>
                  </div>

                  {positionsForTable
                    .slice()
                    .sort((a, b) => {
                      // Sort by symbol, then by secType (STK before OPT)
                      if (a.symbol !== b.symbol) return a.symbol.localeCompare(b.symbol);
                      if (a.secType !== b.secType) return a.secType === "STK" ? -1 : 1;
                      // For options: sort by expiry, then Call/Put (calls first), then strike
                      if (a.secType === "OPT" && b.secType === "OPT") {
                        const expiryA = a.expiry || "";
                        const expiryB = b.expiry || "";
                        if (expiryA !== expiryB) return expiryA.localeCompare(expiryB);
                        const rightA = (a.right === "Call" || a.right === "C") ? "C" : "P";
                        const rightB = (b.right === "Call" || b.right === "C") ? "C" : "P";
                        if (rightA !== rightB) return rightA.localeCompare(rightB);
                        if (a.strike !== b.strike) return (a.strike || 0) - (b.strike || 0);
                      }
                      return 0;
                    })
                    .map((p, i) => {
                    // All pricing comes from the report — no lookup chains
                    const displayPrice = p.currentPrice ?? null;
                    const hasMissingPrice = displayPrice === null || displayPrice === 0;

                    // Market value directly from report (already computed server-side)
                    const mktValue = p.currentValue ?? (hasMissingPrice ? null : (() => {
                      const contractMultiplier = p.secType === "OPT" ? 100 : 1;
                      return p.quantity * displayPrice! * contractMultiplier;
                    })());

                    const mktValueDisplay = mktValue !== null && mktValue !== undefined
                      ? (mktValue < 0
                          ? `(${Math.abs(mktValue).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`
                          : mktValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
                      : "—";

                    // For options, display avg cost per share (divide by 100)
                    const displayAvgCost = p.secType === "OPT" ? p.avgCost / 100 : p.avgCost;

                    // Price changes directly from report (all computed server-side)
                    const tfChange = p.changes?.[timeframe];
                    const pctChange = tfChange?.pct;
                    const dollarChange = tfChange?.change;

                    // Format symbol display based on secType
                    let symbolDisplay: React.ReactNode;
                    if (p.secType === "OPT" && p.strike !== undefined && p.expiry !== undefined && p.right !== undefined) {
                      const rightLabel = p.right === "C" || p.right === "Call" ? "Call" : "Put";
                      const formattedExpiry = formatExpiryYYYYMMDD(p.expiry);
                      symbolDisplay = (
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 11 }}>
                            {p.symbol} {p.strike % 1 === 0 ? p.strike.toFixed(0) : p.strike} {rightLabel}
                          </div>
                          <div style={{ fontSize: 9, color: light.text.muted }}>
                            {formattedExpiry}
                          </div>
                        </div>
                      );
                    } else {
                      symbolDisplay = <div style={{ fontWeight: 600 }}>{p.symbol}</div>;
                    }

                    return (
                      <div
                        key={p.key || i}
                        style={{
                          ...rowStyle,
                          gridTemplateColumns: "75px 140px 36px 36px 65px 80px 75px 65px 100px 80px 120px",
                        }}
                      >
                        <div style={cellEllipsis}>{p.accountNumber || ""}</div>
                        <div style={cellBorder}>{symbolDisplay}</div>
                        <div style={gray10}>{p.secType}</div>
                        <div style={centerBold}>USD</div>
                        <div style={rightMono}>
                          {p.quantity.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                        </div>
                        <div style={rightMono}>
                          {displayPrice && displayPrice > 0 ? displayPrice.toFixed(4) : "—"}
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
                        <div style={{ ...cellBorder, display: "flex", justifyContent: "flex-end", gap: 8, paddingRight: 12 }}>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              const optionDetails = p.secType === "OPT" && p.strike !== undefined && p.expiry !== undefined && p.right !== undefined
                                ? { strike: p.strike, expiry: p.expiry, right: p.right }
                                : undefined;
                              const marketData = getMarketDataForPosition(p, greeksMap, equityPrices);
                              openTradeTicket(p.symbol, p.accountNumber || "", "BUY", p.secType, optionDetails, marketData);
                            }}
                            style={{ ...iconBtn, background: semantic.success.bgMuted, color: semantic.success.textDark }}
                          >
                            BUY
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              const optionDetails = p.secType === "OPT" && p.strike !== undefined && p.expiry !== undefined && p.right !== undefined
                                ? { strike: p.strike, expiry: p.expiry, right: p.right }
                                : undefined;
                              const marketData = getMarketDataForPosition(p, greeksMap, equityPrices);
                              openTradeTicket(p.symbol, p.accountNumber || "", "SELL", p.secType, optionDetails, marketData);
                            }}
                            style={{ ...iconBtn, background: semantic.highlight.pink, color: semantic.error.textDark }}
                          >
                            SELL
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
                </div>
                )}

                {/* Options Analysis Table */}
                {positionsTab === "analysis" && (
                  <div style={{ maxHeight: 750, overflow: "auto" }}>
                    <OptionsAnalysisTable
                      positions={reportIbPositions ?? []}
                      underlyingGroups={underlyingGroups}
                      version={reportVersion}
                    />
                  </div>
                )}

                {/* Expiry Scenario Analysis / Simulator */}
                {positionsTab === "scenarios" && (
                  <div style={{ maxHeight: 750, overflow: "auto" }}>
                    {simulatorUnderlying ? (
                      <SimulatorPanel
                        underlying={simulatorUnderlying}
                        positions={reportPositionsAsIb}
                        equityPrices={equityPrices}
                        greeksMap={greeksMap}
                        onClose={() => setSimulatorUnderlying(null)}
                      />
                    ) : (
                      <ExpiryScenarioAnalysis
                        positions={reportPositionsAsIb}
                        equityPrices={equityPrices}
                        greeksMap={greeksMap}
                        greeksVersion={reportVersion}
                        onSelectUnderlying={setSimulatorUnderlying}
                      />
                    )}
                  </div>
                )}

                {/* P&L Table */}
                {positionsTab === "pnl" && (
                  <div style={{ maxHeight: 750, overflow: "auto" }}>
                    <PnLSummary
                      account={primaryAccount}
                      positions={reportPositionsAsIb}
                      equityPrices={equityPrices}
                      timeframe={timeframe}
                      timeframes={marketState?.timeframes ?? []}
                    />
                  </div>
                )}
              </section>

              {/* Cash */}
              <CashBalances cash={reportCash} />
              </div>

              {/* Right Column: Open Orders + Order History */}
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* Open Orders */}
              <OpenOrdersTable
                orders={reportOpenOrders}
                onModify={(o) => setModifyingOrder(o)}
                onCancel={(o) => setCancellingOrder(o)}
              />

              {/* Order History (Fills + Cancellations) */}
              <OrderHistoryTable orders={reportCompletedOrders} />
              </div>

            </div>
          </>
        ) : (
          <div style={empty}>{reportLoading ? "Waiting for data…" : "No data"}</div>
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
            initialMarketData={(() => {
              // Get market data from report (single source of truth)
              if (modifyingOrder.secType === "OPT" && modifyingOrder.strike && modifyingOrder.expiry && modifyingOrder.right) {
                const right = (modifyingOrder.right === "C" || modifyingOrder.right === "Call") ? "C" : "P";
                const colonKey = `${modifyingOrder.symbol.toUpperCase()}:${modifyingOrder.expiry}:${right}:${modifyingOrder.strike}`;
                const osiKey = buildOsiSymbol(modifyingOrder.symbol, modifyingOrder.expiry, right, modifyingOrder.strike);
                const greeks = greeksMap.get(colonKey) || greeksMap.get(osiKey);
                if (greeks) {
                  return {
                    last: greeks.last,
                    bid: greeks.bid,
                    ask: greeks.ask,
                    mid: greeks.mid,
                    delta: greeks.delta,
                    gamma: greeks.gamma,
                    theta: greeks.theta,
                    vega: greeks.vega,
                    iv: greeks.iv,
                  };
                }
              }
              return undefined;
            })()}
          />
        )}
      </div>
    </div>
  );
}

/**
 * Get market data for a position (for trade tickets).
 * Options: from greeksMap. Equities: from streaming prices.
 */
function getMarketDataForPosition(
  p: ReportPosition,
  greeksMap: Map<string, OptionGreeks>,
  equityPrices: Map<string, { last?: number; bid?: number; ask?: number }>
): any {
  if (p.secType === "OPT" && p.strike !== undefined && p.expiry !== undefined && p.right !== undefined) {
    const right = (p.right === "C" || p.right === "Call") ? "C" : "P";
    const colonKey = `${p.symbol.toUpperCase()}:${p.expiry}:${right}:${p.strike}`;
    const osiKey = p.osiSymbol || buildOsiSymbol(p.symbol, p.expiry, right, p.strike);
    const greeks = greeksMap.get(colonKey) || greeksMap.get(osiKey);
    if (greeks) {
      return {
        last: greeks.last,
        bid: greeks.bid,
        ask: greeks.ask,
        mid: greeks.mid,
        delta: greeks.delta,
        gamma: greeks.gamma,
        theta: greeks.theta,
        vega: greeks.vega,
        iv: greeks.iv,
      };
    }
  } else {
    const priceData = equityPrices.get(p.symbol.toUpperCase());
    if (priceData) {
      return {
        last: priceData.last,
        bid: priceData.bid,
        ask: priceData.ask,
        mid: (priceData.bid !== undefined && priceData.ask !== undefined)
          ? (priceData.bid + priceData.ask) / 2 : undefined,
      };
    }
  }
  return undefined;
}

/**
 * Format a close date string for column header display.
 */
function formatCloseDateShort(dateStr: string): string {
  if (!dateStr) return "";
  try {
    // Handle both "YYYY-MM-DD" and other formats
    const d = new Date(dateStr + "T00:00:00");
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return dateStr;
  }
}

/* Styles */
const shell = { display: "flex", flexDirection: "column" as const, height: "100%", color: light.text.primary, background: light.bg.primary };
const header = { padding: "10px 14px", borderBottom: `1px solid ${light.border.primary}`, background: light.bg.primary };
const body = { flex: 1, overflow: "auto", padding: "12px 14px", background: light.bg.secondary };
const summary = { fontSize: 11, color: light.text.secondary, marginBottom: 10 };
const gridWrap = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 };
const section = { background: light.bg.primary, border: `1px solid ${light.border.primary}`, borderRadius: 8, overflow: "hidden" };
const title = { fontSize: 12, fontWeight: 600, padding: "8px 10px", background: light.bg.tertiary, borderBottom: `1px solid ${light.border.primary}` };
const tableStyles = { display: "flex", flexDirection: "column" as const };
const hdr = { display: "grid", fontWeight: 600, fontSize: 10.5, color: light.text.secondary, padding: "0 10px", background: tableTheme.headerBg, height: 26, alignItems: "center", borderBottom: `1px solid ${light.border.primary}`, position: "sticky" as const, top: 0, zIndex: 1 };
const hdrCell = { borderRight: `1px solid ${light.border.light}`, paddingRight: 4 };
const hdrCellRight = { ...hdrCell, textAlign: "right" as const };
const hdrCellCenter = { ...hdrCell, textAlign: "center" as const };
const rowStyle = { display: "grid", fontSize: 11, minHeight: 32, alignItems: "center", padding: "0 10px", borderBottom: `1px solid ${tableTheme.rowBorder}` };

// Cell border for column dividers
const cellBorder = { borderRight: `1px solid ${light.border.muted}`, paddingRight: 4, paddingLeft: 2 };
const cellEllipsis = { ...cellBorder, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const, fontFamily: "ui-monospace, monospace", fontSize: 10 };
const right = { ...cellBorder, textAlign: "right" as const };
const rightMono = { ...right, fontFamily: "ui-monospace, monospace" };
const center = { ...cellBorder, textAlign: "center" as const };
const centerBold = { ...center, fontWeight: 600 };
const gray10 = { ...cellBorder, fontSize: 10, color: light.text.muted };

const empty = { padding: 40, textAlign: "center" as const, color: light.text.muted, fontSize: 14 };

const iconBtn = {
  padding: "4px 10px",
  border: `1px solid ${light.border.lighter}`,
  borderRadius: "6px",
  background: light.bg.primary,
  fontSize: "12px",
  fontWeight: 600,
  cursor: "pointer",
};
