// src/components/portfolio/SimulatorPanel.tsx
import { useState, useEffect, useMemo, useCallback } from "react";
import { IbPosition } from "../../types/portfolio";
import { PriceData } from "../../hooks/useMarketData";
import { OptionGreeks, getGreeksForPosition } from "../../hooks/usePortfolioOptionsReports";
import { buildOsiSymbol } from "../../utils/options";
import { socketHub } from "../../ws/SocketHub";
import { light, semantic, pnl, rowHighlight, fonts } from "../../theme";
import SimulatorDateNav from "./SimulatorDateNav";
import HypotheticalTradeBuilder, { HypotheticalTrade } from "./HypotheticalTradeBuilder";

type Props = {
  underlying: string;
  positions: IbPosition[];
  equityPrices: Map<string, PriceData>;
  greeksMap?: Map<string, OptionGreeks>;
  onClose: () => void;
};

interface PositionScenarioValue {
  percent: number;
  value: number;
  pnl: number;
}

interface PositionRow {
  osiSymbol: string;
  quantity: number;
  strike: number;
  right: string;
  expiry: string;
  isExpiring: boolean;
  currentPrice: number;
  currentValue: number;
  isHypothetical: boolean;
  hypotheticalTradeDate?: string;  // YYYY-MM-DD, only for hypotheticals
  values: PositionScenarioValue[];
}

interface ScenarioSubtotal {
  percent: number;
  price: number;
  total: number;
  currentValue: number;
  pnl: number;
  expiring: number;
  future: number;
}

interface ExpiryRow {
  expiry: string;
  positions: PositionRow[];
  subtotals: ScenarioSubtotal[];
}

interface SimulationResult {
  underlying: string;
  currentPrice: number;
  expiryRows: ExpiryRow[];
}

interface SimulationResponse {
  results: SimulationResult[];
  valuationDate: string;
  scenarioStep: number;
  scenarioRange: number;
  scenarios: number[];
}

const SCENARIO_STEPS = [0.01, 0.02, 0.03, 0.04];
const DEFAULT_STEP = 0.02;
const DEFAULT_RANGE = 0.10;

export default function SimulatorPanel({ underlying, positions, equityPrices, greeksMap, onClose }: Props) {
  const today = useMemo(() => new Date().toISOString().split("T")[0], []);

  const [valuationDate, setValuationDate] = useState<string>(today);
  const [scenarioStep, setScenarioStep] = useState<number>(DEFAULT_STEP);
  const [hypotheticals, setHypotheticals] = useState<HypotheticalTrade[]>([]);
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [scenarios, setScenarios] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Get furthest expiry for date nav max
  const maxDate = useMemo(() => {
    const expiries = positions
      .filter(p => p.secType === "OPT" && p.expiry)
      .map(p => p.expiry!)
      .sort();
    return expiries[expiries.length - 1] || today;
  }, [positions, today]);

  // Build analysis input
  const analysisInput = useMemo(() => {
    const options = positions.filter(p => p.secType === "OPT" && p.symbol.toUpperCase() === underlying);
    const equities = positions.filter(p => p.secType === "STK" && p.symbol.toUpperCase() === underlying);

    const positionData: { osiSymbol: string; quantity: number; iv: number }[] = [];
    const equityPositions: { symbol: string; quantity: number }[] = [];

    equities.forEach(eq => {
      equityPositions.push({ symbol: eq.symbol.toUpperCase(), quantity: eq.quantity });
    });

    options.forEach(opt => {
      if (opt.strike === undefined || opt.expiry === undefined || opt.right === undefined) return;
      const osiSymbol = buildOsiSymbol(opt.symbol, opt.expiry, opt.right, opt.strike);
      let iv = 0.30;
      if (greeksMap) {
        const greeks = getGreeksForPosition(greeksMap, opt.symbol, opt.expiry, opt.right, opt.strike);
        if (greeks?.iv && greeks.iv > 0) iv = greeks.iv;
      }
      positionData.push({ osiSymbol, quantity: opt.quantity, iv });
    });

    const priceData = equityPrices.get(underlying);
    const underlyingPrices: Record<string, number> = {};
    if (priceData?.last) underlyingPrices[underlying] = priceData.last;

    return { positions: positionData, equityPositions, underlyingPrices };
  }, [positions, underlying, equityPrices, greeksMap]);

  // Fetch simulation
  const fetchSimulation = useCallback(async () => {
    if (analysisInput.positions.length === 0 && analysisInput.equityPositions.length === 0) {
      setResult(null);
      return;
    }

    if (Object.keys(analysisInput.underlyingPrices).length === 0) {
      setError("Waiting for underlying price...");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Only send enabled hypotheticals to the simulation
      const enabledHypotheticals = hypotheticals.filter(t => t.enabled ?? true);

      const response = await socketHub.sendControl("simulate_portfolio", {
        target: "calc",
        underlying,
        positions: analysisInput.positions,
        equityPositions: analysisInput.equityPositions,
        underlyingPrices: analysisInput.underlyingPrices,
        valuationDate,
        scenarioStep,
        scenarioRange: DEFAULT_RANGE,
        hypotheticalTrades: enabledHypotheticals
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const outerData = response.data as any;
      const innerData = outerData?.data ?? outerData;

      if (response.ok && innerData?.results) {
        const simResponse = innerData as SimulationResponse;
        setResult(simResponse.results[0] || null);
        setScenarios(simResponse.scenarios || []);
      } else {
        setError(response.error || "Unknown error");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }, [analysisInput, underlying, valuationDate, scenarioStep, hypotheticals]);

  // Auto-fetch on input changes
  useEffect(() => {
    const timer = setTimeout(() => fetchSimulation(), 300);
    return () => clearTimeout(timer);
  }, [fetchSimulation]);

  // Format helpers
  const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  const fmtPrice = (n: number) => n.toFixed(2);
  const fmtPercent = (n: number) => `${n >= 0 ? "+" : ""}${(n * 100).toFixed(0)}%`;

  const valueColor = (n: number) => {
    if (n > 0) return pnl.positive;
    if (n < 0) return pnl.negative;
    return undefined;
  };

  const currentPrice = result?.currentPrice ?? equityPrices.get(underlying)?.last ?? 0;

  // Extract calculated prices for hypothetical positions from simulation results
  // Use composite key (osiSymbol:tradeDate) to support multiple trades of same option
  const hypotheticalPrices = useMemo(() => {
    const priceMap = new Map<string, number>();
    if (result) {
      result.expiryRows.forEach(expiryRow => {
        expiryRow.positions.forEach(pos => {
          if (pos.isHypothetical && pos.currentPrice > 0 && pos.hypotheticalTradeDate) {
            const key = `${pos.osiSymbol}:${pos.hypotheticalTradeDate}`;
            priceMap.set(key, pos.currentPrice);
          }
        });
      });
    }
    return priceMap;
  }, [result]);

  // Dynamic grid columns based on scenarios
  const gridCols = `110px 62px repeat(${scenarios.length}, 68px)`;

  const scenarioBorder = (idx: number) => {
    const zeroIdx = scenarios.indexOf(0);
    if (idx === zeroIdx) return `2px solid ${light.border.secondary}`;
    if (idx === zeroIdx + 1) return `2px solid ${light.border.secondary}`;
    return `1px solid ${light.border.primary}`;
  };

  return (
    <div style={container}>
      {/* Header */}
      <div style={headerSection}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <h3 style={{ margin: 0, fontSize: fonts.ui.heading, fontWeight: 600 }}>
            {underlying} Simulator
          </h3>
          <span style={{ color: light.text.muted, fontSize: fonts.ui.body }}>
            ${fmtPrice(currentPrice)}
          </span>
        </div>
        <button onClick={onClose} style={closeButton}>
          Close
        </button>
      </div>

      {/* Controls */}
      <div style={controlsRow}>
        <SimulatorDateNav
          date={valuationDate}
          minDate={today}
          maxDate={maxDate}
          onChange={setValuationDate}
        />
        <div style={stepSelector}>
          <span style={{ fontSize: fonts.ui.caption, color: light.text.muted, marginRight: 8 }}>Step:</span>
          {SCENARIO_STEPS.map(step => (
            <label key={step} style={stepLabel}>
              <input
                type="radio"
                checked={scenarioStep === step}
                onChange={() => setScenarioStep(step)}
                style={{ marginRight: 2 }}
              />
              {step * 100}%
            </label>
          ))}
        </div>
        {loading && <span style={{ fontSize: fonts.ui.caption, color: light.text.muted }}>Loading...</span>}
        {error && <span style={{ fontSize: fonts.ui.caption, color: semantic.error.text }}>{error}</span>}
      </div>

      {/* Hypothetical Trades */}
      <HypotheticalTradeBuilder
        underlying={underlying}
        valuationDate={valuationDate}
        maxDate={maxDate}
        trades={hypotheticals}
        scenarios={scenarios}
        currentPrice={currentPrice}
        calculatedPrices={hypotheticalPrices}
        onChange={setHypotheticals}
      />

      {/* Scenario Grid */}
      {result && scenarios.length > 0 && (
        <div style={gridContainer}>
          {/* Header row */}
          <div style={{ ...scenarioHeaderRow, gridTemplateColumns: gridCols }}>
            <div style={positionLabelCell}>Position</div>
            <div style={{ ...scenarioHeaderCell, borderLeft: `1px solid ${light.border.primary}` }}>
              <div style={{ fontWeight: 600, color: semantic.info.text }}>Current</div>
            </div>
            {scenarios.map((pct, i) => {
              const price = currentPrice * (1 + pct);
              return (
                <div key={pct} style={{ ...scenarioHeaderCell, borderLeft: scenarioBorder(i) }}>
                  <div style={{ fontWeight: 600, color: pct === 0 ? semantic.info.text : undefined }}>
                    {fmtPercent(pct)}
                  </div>
                  <div style={{ fontSize: fonts.table.small, color: light.text.muted }}>
                    ${fmtPrice(price)}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Expiry sections */}
          {result.expiryRows.map((expiryRow, rowIdx) => (
            <div key={expiryRow.expiry}>
              {/* Expiry label */}
              <div style={expiryLabelRow}>
                <span style={{ fontWeight: 600, fontSize: fonts.ui.body }}>
                  {formatExpiry(expiryRow.expiry)}
                </span>
                <span style={{ marginLeft: 8, fontSize: fonts.table.cell, color: light.text.light }}>
                  ({expiryRow.positions.filter(p => p.isExpiring).length} expiring)
                </span>
              </div>

              {/* Position rows */}
              {expiryRow.positions.map((pos, posIdx) => {
                const isEquity = pos.right === "S";
                const isCash = pos.right === "$";
                return (
                  <div
                    key={pos.osiSymbol}
                    style={{
                      ...positionRow,
                      gridTemplateColumns: gridCols,
                      background: pos.isExpiring ? rowHighlight.expiring :
                        pos.isHypothetical ? rowHighlight.hypothetical :
                        posIdx % 2 === 0 ? light.bg.muted : light.bg.primary,
                      fontStyle: pos.isHypothetical ? "italic" : undefined
                    }}
                  >
                    <div style={positionLabelCell}>
                      <span style={{ fontWeight: 500 }}>
                        {isEquity ? "Stock" : isCash ? "Cash" : `${pos.strike} ${pos.right === "C" ? "C" : "P"}`}
                      </span>
                      {!isEquity && !isCash && (
                        <span style={{ marginLeft: 2, color: light.text.light }}>
                          {pos.quantity > 0 ? "+" : ""}{pos.quantity}
                        </span>
                      )}
                      {pos.isHypothetical && (
                        <span style={{ marginLeft: 4, fontSize: fonts.table.small, color: semantic.info.text }}>
                          (hyp)
                        </span>
                      )}
                    </div>
                    {/* Current column */}
                    <div style={{ ...valueCell, borderLeft: `1px solid ${light.border.primary}` }}>
                      {isEquity ? (
                        <>
                          <div>{pos.quantity > 0 ? "+" : ""}{pos.quantity}sh</div>
                          <div style={{ fontSize: fonts.table.small, color: light.text.light }}>
                            ${fmt(pos.currentValue)}
                          </div>
                        </>
                      ) : isCash ? (
                        <span style={{ color: light.text.muted }}>$0</span>
                      ) : (
                        <>${fmt(pos.currentValue)}</>
                      )}
                    </div>
                    {/* Scenario columns - show P&L */}
                    {pos.values.map((sv, i) => (
                      <div key={i} style={{ ...valueCell, borderLeft: scenarioBorder(i) }}>
                        <div style={{ color: valueColor(sv.pnl) }}>
                          {sv.pnl >= 0 ? "+" : ""}{fmt(sv.pnl)}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })}

              {/* Subtotal row */}
              <div style={{ ...subtotalRow, gridTemplateColumns: gridCols }}>
                <div style={positionLabelCell}>
                  <span style={{ fontWeight: 700 }}>Subtotal</span>
                </div>
                <div style={{ ...subtotalCell, borderLeft: `1px solid ${light.border.primary}` }}>
                  ${fmt(expiryRow.subtotals[0]?.currentValue ?? 0)}
                </div>
                {expiryRow.subtotals.map((sv, i) => (
                  <div key={i} style={{ ...subtotalCell, borderLeft: scenarioBorder(i) }}>
                    <div style={{ fontWeight: 600 }}>${fmt(sv.total)}</div>
                    <div style={{ color: valueColor(sv.pnl), fontWeight: 600 }}>
                      {sv.pnl >= 0 ? "+" : ""}{fmt(sv.pnl)}
                    </div>
                  </div>
                ))}
              </div>

              {rowIdx < result.expiryRows.length - 1 && <div style={{ height: 2 }} />}
            </div>
          ))}
        </div>
      )}

      {!result && !loading && !error && (
        <div style={emptyStyle}>No positions for {underlying}</div>
      )}
    </div>
  );
}

function formatExpiry(dateStr: string): string {
  const [year, month, day] = dateStr.split("-");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const m = parseInt(month, 10) - 1;
  return `${months[m]} ${parseInt(day, 10)}`;
}

// Styles
const container: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
  padding: 8,
  height: "100%",
  overflow: "auto",
};

const headerSection: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
};

const closeButton: React.CSSProperties = {
  padding: "4px 12px",
  fontSize: fonts.ui.button,
  background: light.bg.tertiary,
  border: `1px solid ${light.border.primary}`,
  borderRadius: 4,
  cursor: "pointer",
};

const controlsRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 16,
  padding: "4px 0",
  borderBottom: `1px solid ${light.border.primary}`,
};

const stepSelector: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
};

const stepLabel: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  marginRight: 8,
  fontSize: fonts.ui.caption,
  cursor: "pointer",
};

const gridContainer: React.CSSProperties = {
  background: light.bg.primary,
  borderRadius: 8,
  border: `1px solid ${light.border.primary}`,
  overflow: "hidden",
};

const scenarioHeaderRow: React.CSSProperties = {
  display: "grid",
  background: light.bg.tertiary,
  borderBottom: `1px solid ${light.border.primary}`,
  padding: "2px 0",
};

const scenarioHeaderCell: React.CSSProperties = {
  textAlign: "center",
  fontSize: fonts.table.header,
};

const positionLabelCell: React.CSSProperties = {
  paddingLeft: 4,
  display: "flex",
  alignItems: "center",
  fontSize: fonts.table.label,
  gap: 2,
};

const expiryLabelRow: React.CSSProperties = {
  padding: "2px 4px",
  background: semantic.highlight.cyan,
  borderBottom: `1px solid ${semantic.highlight.cyanBorder}`,
  fontSize: fonts.table.label,
};

const positionRow: React.CSSProperties = {
  display: "grid",
  padding: "1px 0",
  borderBottom: `1px solid ${light.bg.hover}`,
};

const valueCell: React.CSSProperties = {
  textAlign: "center",
  fontFamily: "ui-monospace, monospace",
  fontSize: fonts.table.cell,
};

const subtotalRow: React.CSSProperties = {
  display: "grid",
  padding: "2px 0",
  background: semantic.warning.bgMuted,
  borderBottom: `1px solid ${semantic.highlight.yellowBorder}`,
};

const subtotalCell: React.CSSProperties = {
  textAlign: "center",
  fontFamily: "ui-monospace, monospace",
  fontSize: fonts.table.cell,
};

const emptyStyle: React.CSSProperties = {
  padding: 40,
  textAlign: "center",
  color: light.text.muted,
  fontSize: fonts.ui.heading,
};
