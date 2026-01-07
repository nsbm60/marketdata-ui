// src/components/portfolio/ExpiryScenarioAnalysis.tsx
import { useState, useEffect, useMemo, useCallback } from "react";
import { IbPosition } from "../../types/portfolio";
import { PriceData } from "../../hooks/useMarketData";
import { OptionGreeks, getGreeksForPosition } from "../../hooks/usePortfolioOptionsReports";
import { buildOsiSymbol } from "../../utils/options";
import { socketHub } from "../../ws/SocketHub";
import { light, dark, semantic, pnl, rowHighlight, fonts } from "../../theme";

type Props = {
  positions: IbPosition[];
  equityPrices: Map<string, PriceData>;
  greeksMap?: Map<string, OptionGreeks>;
  greeksVersion?: number;
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

interface AnalysisResult {
  underlying: string;
  currentPrice: number;
  expiryRows: ExpiryRow[];
}

const DEFAULT_SCENARIOS = [-0.06, -0.04, -0.02, 0, 0.02, 0.04, 0.06];

export default function ExpiryScenarioAnalysis({ positions, equityPrices, greeksMap, greeksVersion }: Props) {
  const [results, setResults] = useState<AnalysisResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<number>(0);

  // Build the analysis input from positions and greeks
  const analysisInput = useMemo(() => {
    const options = positions.filter(p => p.secType === "OPT");
    const equities = positions.filter(p => p.secType === "STK");

    const positionData: { osiSymbol: string; quantity: number; iv: number }[] = [];
    const equityPositions: { symbol: string; quantity: number }[] = [];
    const underlyingPrices: Record<string, number> = {};

    // Collect equity positions
    equities.forEach(eq => {
      const symbol = eq.symbol.toUpperCase();
      equityPositions.push({
        symbol,
        quantity: eq.quantity
      });

      // Get underlying price
      if (!underlyingPrices[symbol]) {
        const priceData = equityPrices.get(symbol);
        if (priceData?.last) {
          underlyingPrices[symbol] = priceData.last;
        }
      }
    });

    // Collect option positions
    options.forEach(opt => {
      if (opt.strike === undefined || opt.expiry === undefined || opt.right === undefined) return;

      const osiSymbol = buildOsiSymbol(opt.symbol, opt.expiry, opt.right, opt.strike);
      const underlying = opt.symbol.toUpperCase();

      // Get IV from greeks
      let iv = 0.30; // default
      if (greeksMap) {
        const greeks = getGreeksForPosition(greeksMap, opt.symbol, opt.expiry, opt.right, opt.strike);
        if (greeks?.iv && greeks.iv > 0) {
          iv = greeks.iv;
        }
      }

      positionData.push({
        osiSymbol,
        quantity: opt.quantity,
        iv
      });

      // Get underlying price
      if (!underlyingPrices[underlying]) {
        const priceData = equityPrices.get(underlying);
        if (priceData?.last) {
          underlyingPrices[underlying] = priceData.last;
        }
      }
    });

    return { positions: positionData, equityPositions, underlyingPrices };
  }, [positions, equityPrices, greeksMap, greeksVersion]);

  // Fetch analysis from backend
  const fetchAnalysis = useCallback(async () => {
    if (analysisInput.positions.length === 0 && analysisInput.equityPositions.length === 0) {
      setResults([]);
      return;
    }

    if (Object.keys(analysisInput.underlyingPrices).length === 0) {
      setError("Waiting for underlying prices...");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await socketHub.sendControl("expiry_scenario_analysis", {
        target: "calc",
        positions: analysisInput.positions,
        equityPositions: analysisInput.equityPositions,
        underlyingPrices: analysisInput.underlyingPrices,
        scenarios: DEFAULT_SCENARIOS
      });

      // Handle double-nested data: response.data.data.results (UiSocket wraps the response)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const outerData = response.data as any;
      const innerData = outerData?.data ?? outerData;
      const results = innerData?.results;

      if (response.ok && results) {
        setResults(results);
        setLastRefresh(Date.now());
      } else {
        setError(response.error || "Unknown error");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }, [analysisInput]);

  // Auto-refresh when inputs change (debounced)
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchAnalysis();
    }, 500);
    return () => clearTimeout(timer);
  }, [fetchAnalysis]);

  // Retry when prices become available (handles case where initial fetch returned early)
  const hasPrices = Object.keys(analysisInput.underlyingPrices).length > 0;
  const hasPositions = analysisInput.positions.length > 0 || analysisInput.equityPositions.length > 0;
  useEffect(() => {
    const shouldRetry = hasPrices && hasPositions && results.length === 0 && !loading;
    if (shouldRetry) {
      fetchAnalysis();
    }
  }, [hasPrices, hasPositions, results.length, loading, fetchAnalysis]);

  // Format helpers
  const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  const fmtPrice = (n: number) => n.toFixed(2);
  const fmtPercent = (n: number) => `${n >= 0 ? "+" : ""}${(n * 100).toFixed(0)}%`;

  // Color based on value (green for positive, red for negative)
  const valueColor = (n: number) => {
    if (n > 0) return pnl.positive;
    if (n < 0) return pnl.negative;
    return undefined;
  };

  if (analysisInput.positions.length === 0 && analysisInput.equityPositions.length === 0) {
    return <div style={emptyStyle}>No positions to analyze</div>;
  }

  return (
    <div style={container}>
      <div style={headerSection}>
        <h3 style={{ margin: 0, fontSize: fonts.ui.heading, fontWeight: 600 }}>Expiry Scenario Analysis</h3>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {loading && <span style={{ fontSize: fonts.table.cell, color: light.text.muted }}>Loading...</span>}
          {error && <span style={{ fontSize: fonts.table.cell, color: semantic.error.text }}>{error}</span>}
          {lastRefresh > 0 && !loading && (
            <span style={{ fontSize: fonts.ui.caption, color: light.text.disabled }}>
              Updated {new Date(lastRefresh).toLocaleTimeString()}
            </span>
          )}
          <button onClick={fetchAnalysis} disabled={loading} style={refreshButton}>
            Refresh
          </button>
        </div>
      </div>

      {results.map(result => (
        <div key={result.underlying} style={resultContainer}>
          <div style={resultHeader}>
            <span style={{ fontWeight: 700 }}>{result.underlying}</span>
            <span style={{ marginLeft: 12, color: light.text.muted, fontSize: fonts.ui.body }}>
              Current: ${fmtPrice(result.currentPrice)}
            </span>
          </div>

          {/* Scenario header row */}
          <div style={scenarioHeaderRow}>
            <div style={positionLabelCell}>Position</div>
            <div style={{ ...scenarioHeaderCell, borderLeft: `1px solid ${light.border.primary}` }}>
              <div style={{ fontWeight: 600, color: semantic.info.text }}>Current</div>
            </div>
            {DEFAULT_SCENARIOS.map((pct, i) => {
              const price = result.currentPrice * (1 + pct);
              return (
                <div key={pct} style={{ ...scenarioHeaderCell, borderLeft: `1px solid ${light.border.primary}` }}>
                  <div style={{ fontWeight: 600, color: pct === 0 ? semantic.info.text : undefined }}>
                    {fmtPercent(pct)}
                  </div>
                  <div style={{ fontSize: fonts.table.small, color: light.text.muted }}>${fmtPrice(price)}</div>
                </div>
              );
            })}
          </div>

          {/* Expiry sections */}
          {result.expiryRows.map((expiryRow, rowIdx) => (
            <div key={expiryRow.expiry}>
              {/* Expiry date label */}
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
                const isOption = !isEquity && !isCash;
                return (
                  <div
                    key={pos.osiSymbol}
                    style={{
                      ...positionRow,
                      background: pos.isExpiring ? rowHighlight.expiring : posIdx % 2 === 0 ? light.bg.muted : light.bg.primary
                    }}
                  >
                    <div style={positionLabelCell}>
                      <span style={{ fontWeight: 500 }}>
                        {isEquity ? "Stock" : isCash ? "Cash" : `${pos.strike} ${pos.right === "C" ? "C" : "P"}`}
                      </span>
                      {isOption && (
                        <span style={{ marginLeft: 2, color: light.text.light }}>
                          {pos.quantity > 0 ? "+" : ""}{pos.quantity}
                        </span>
                      )}
                      {isOption && pos.isExpiring && (
                        <span style={{ marginLeft: 2, fontSize: fonts.table.small, color: semantic.warning.textDark, fontWeight: 600 }}>
                          EXP
                        </span>
                      )}
                      {isOption && !pos.isExpiring && (
                        <span style={{ marginLeft: 2, fontSize: fonts.table.small, color: dark.text.muted }}>
                          {formatExpiry(pos.expiry)}
                        </span>
                      )}
                      {isCash && (
                        <span style={{ marginLeft: 2, fontSize: fonts.table.small, color: light.text.muted }}>
                          (from assignments)
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
                    {/* Scenario columns */}
                    {pos.values.map((sv, i) => {
                      if (isEquity) {
                        // For equity: show adjusted share count based on value / projected price
                        const projectedPrice = expiryRow.subtotals[i]?.price ?? result.currentPrice;
                        const adjustedShares = projectedPrice > 0 ? Math.round(sv.value / projectedPrice) : pos.quantity;
                        const sharesChanged = adjustedShares !== pos.quantity;
                        return (
                          <div key={i} style={{ ...valueCell, borderLeft: `1px solid ${light.border.primary}` }}>
                            <div style={{ color: sharesChanged ? semantic.info.text : undefined, fontWeight: sharesChanged ? 600 : undefined }}>
                              {adjustedShares > 0 ? "+" : ""}{adjustedShares}sh
                            </div>
                            <div style={{ fontSize: fonts.table.small, color: light.text.light }}>
                              ${fmt(sv.value)}
                            </div>
                          </div>
                        );
                      } else if (isCash) {
                        // For cash: show cash amount with color coding
                        const hasCash = sv.value !== 0;
                        return (
                          <div key={i} style={{ ...valueCell, borderLeft: `1px solid ${light.border.primary}` }}>
                            <div style={{
                              color: hasCash ? (sv.value > 0 ? pnl.positive : pnl.negative) : light.text.muted,
                              fontWeight: hasCash ? 600 : undefined
                            }}>
                              {sv.value >= 0 ? "+" : ""}{fmt(sv.value)}
                            </div>
                          </div>
                        );
                      } else {
                        // For options: show value and per-contract price
                        const optionPrice = pos.quantity !== 0
                          ? Math.abs(sv.value) / (Math.abs(pos.quantity) * 100)
                          : 0;
                        return (
                          <div key={i} style={{ ...valueCell, borderLeft: `1px solid ${light.border.primary}` }}>
                            <div>${fmt(sv.value)}</div>
                            <div style={{ color: light.text.light, fontSize: fonts.table.small }}>
                              @${optionPrice.toFixed(2)}
                            </div>
                          </div>
                        );
                      }
                    })}
                  </div>
                );
              })}

              {/* Subtotal row for this expiry */}
              <div style={subtotalRow}>
                <div style={positionLabelCell}>
                  <span style={{ fontWeight: 700 }}>Subtotal</span>
                </div>
                <div style={{ ...subtotalCell, borderLeft: `1px solid ${light.border.primary}` }}>
                  ${fmt(expiryRow.subtotals[0]?.currentValue ?? 0)}
                </div>
                {expiryRow.subtotals.map((sv, i) => (
                  <div key={i} style={{ ...subtotalCell, borderLeft: `1px solid ${light.border.primary}` }}>
                    <div style={{ fontWeight: 600 }}>${fmt(sv.total)}</div>
                    <div style={{ color: valueColor(sv.pnl), fontWeight: 600 }}>
                      {sv.pnl >= 0 ? "+" : ""}{fmt(sv.pnl)}
                    </div>
                  </div>
                ))}
              </div>

              {/* Spacer between expiry sections */}
              {rowIdx < result.expiryRows.length - 1 && <div style={{ height: 2 }} />}
            </div>
          ))}

          {/* Grand total (final expiry subtotal) */}
          {result.expiryRows.length > 0 && (
            <div style={grandTotalRow}>
              <div style={positionLabelCell}>
                <span style={{ fontWeight: 700 }}>Final</span>
              </div>
              <div style={{ ...grandTotalCell, borderLeft: `1px solid ${semantic.highlight.blueBorder}` }}>
                ${fmt(result.expiryRows[result.expiryRows.length - 1].subtotals[0]?.currentValue ?? 0)}
              </div>
              {result.expiryRows[result.expiryRows.length - 1].subtotals.map((sv, i) => (
                <div key={i} style={{ ...grandTotalCell, borderLeft: `1px solid ${semantic.highlight.blueBorder}` }}>
                  <div style={{ fontWeight: 700 }}>${fmt(sv.total)}</div>
                  <div style={{ color: valueColor(sv.pnl), fontWeight: 700 }}>
                    {sv.pnl >= 0 ? "+" : ""}{fmt(sv.pnl)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function formatExpiry(dateStr: string): string {
  // Input: "2025-01-17"
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
  padding: 4,
};

const headerSection: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: 4,
};

const refreshButton: React.CSSProperties = {
  padding: "2px 8px",
  fontSize: fonts.ui.button,
  background: light.bg.tertiary,
  border: `1px solid ${light.border.primary}`,
  borderRadius: 3,
  cursor: "pointer",
};

const resultContainer: React.CSSProperties = {
  background: light.bg.primary,
  borderRadius: 8,
  border: `1px solid ${light.border.primary}`,
  overflow: "hidden",
};

const resultHeader: React.CSSProperties = {
  padding: "4px 6px",
  background: light.bg.secondary,
  borderBottom: `1px solid ${light.border.primary}`,
  fontSize: fonts.table.header,
};

const gridCols = "minmax(90px, 120px) 55px repeat(7, minmax(52px, 1fr))";

const scenarioHeaderRow: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: gridCols,
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
  gridTemplateColumns: gridCols,
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
  gridTemplateColumns: gridCols,
  padding: "2px 0",
  background: semantic.warning.bgMuted,
  borderBottom: `1px solid ${semantic.highlight.yellowBorder}`,
};

const subtotalCell: React.CSSProperties = {
  textAlign: "center",
  fontFamily: "ui-monospace, monospace",
  fontSize: fonts.table.cell,
};

const grandTotalRow: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: gridCols,
  padding: "2px 0",
  background: semantic.highlight.blue,
  borderTop: `1px solid ${semantic.highlight.blueBorder}`,
};

const grandTotalCell: React.CSSProperties = {
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
