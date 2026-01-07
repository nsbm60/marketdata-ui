// src/components/portfolio/ExpiryScenarioAnalysis.tsx
import { useState, useEffect, useMemo, useCallback } from "react";
import { IbPosition } from "../../types/portfolio";
import { PriceData } from "../../hooks/useMarketData";
import { OptionGreeks, getGreeksForPosition } from "../../hooks/usePortfolioOptionsReports";
import { buildOsiSymbol } from "../../utils/options";
import { socketHub } from "../../ws/SocketHub";
import { light, dark, semantic, pnl, rowHighlight } from "../../theme";

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
      const outerData = response.data as { data?: { results?: AnalysisResult[] }; results?: AnalysisResult[] } | undefined;
      const results = outerData?.data?.results ?? outerData?.results;
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
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Expiry Scenario Analysis</h3>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {loading && <span style={{ fontSize: 11, color: light.text.muted }}>Loading...</span>}
          {error && <span style={{ fontSize: 11, color: semantic.error.text }}>{error}</span>}
          {lastRefresh > 0 && !loading && (
            <span style={{ fontSize: 10, color: light.text.disabled }}>
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
            <span style={{ marginLeft: 12, color: light.text.muted, fontSize: 12 }}>
              Current: ${fmtPrice(result.currentPrice)}
            </span>
          </div>

          {/* Scenario header row */}
          <div style={scenarioHeaderRow}>
            <div style={positionLabelCell}>Position</div>
            <div style={scenarioHeaderCell}>
              <div style={{ fontWeight: 600, color: semantic.info.text }}>Current</div>
              <div style={{ fontSize: 9, color: light.text.muted }}>Value</div>
            </div>
            {DEFAULT_SCENARIOS.map(pct => {
              const price = result.currentPrice * (1 + pct);
              return (
                <div key={pct} style={scenarioHeaderCell}>
                  <div style={{ fontWeight: 600, color: pct === 0 ? semantic.info.text : undefined }}>
                    {fmtPercent(pct)}
                  </div>
                  <div style={{ fontSize: 9, color: light.text.muted }}>${fmtPrice(price)}</div>
                  <div style={{ fontSize: 8, color: light.text.disabled }}>Δ</div>
                </div>
              );
            })}
          </div>

          {/* Expiry sections */}
          {result.expiryRows.map((expiryRow, rowIdx) => (
            <div key={expiryRow.expiry}>
              {/* Expiry date label */}
              <div style={expiryLabelRow}>
                <span style={{ fontWeight: 600, fontSize: 11 }}>
                  {formatExpiry(expiryRow.expiry)}
                </span>
                <span style={{ marginLeft: 8, fontSize: 10, color: light.text.light }}>
                  ({expiryRow.positions.filter(p => p.isExpiring).length} expiring)
                </span>
              </div>

              {/* Position rows */}
              {expiryRow.positions.map((pos, posIdx) => (
                <div
                  key={pos.osiSymbol}
                  style={{
                    ...positionRow,
                    background: pos.isExpiring ? rowHighlight.expiring : posIdx % 2 === 0 ? light.bg.muted : light.bg.primary
                  }}
                >
                  <div style={positionLabelCell}>
                    <span style={{ fontWeight: 500 }}>
                      {pos.right === "S" ? "Stock" : `${pos.strike} ${pos.right === "C" ? "Call" : "Put"}`}
                    </span>
                    <span style={{ marginLeft: 6, fontSize: 9, color: light.text.light }}>
                      {pos.quantity > 0 ? "+" : ""}{pos.quantity}{pos.right === "S" ? " sh" : ""}
                    </span>
                    {pos.right !== "S" && pos.isExpiring && (
                      <span style={{ marginLeft: 6, fontSize: 8, color: semantic.warning.textDark, fontWeight: 600 }}>
                        EXP
                      </span>
                    )}
                    {pos.right !== "S" && !pos.isExpiring && (
                      <span style={{ marginLeft: 6, fontSize: 8, color: dark.text.muted }}>
                        {formatExpiry(pos.expiry)}
                      </span>
                    )}
                  </div>
                  <div style={valueCell}>
                    <span style={{ fontSize: 11, color: light.text.muted }}>
                      ${fmt(pos.currentValue)}
                    </span>
                  </div>
                  {pos.values.map((sv, i) => (
                    <div key={i} style={valueCell}>
                      <span style={{ color: valueColor(sv.pnl), fontSize: 11 }}>
                        {sv.pnl >= 0 ? "+" : ""}{fmt(sv.pnl)}
                      </span>
                    </div>
                  ))}
                </div>
              ))}

              {/* Subtotal row for this expiry */}
              <div style={subtotalRow}>
                <div style={positionLabelCell}>
                  <span style={{ fontWeight: 700, fontSize: 11 }}>Subtotal</span>
                </div>
                <div style={subtotalCell}>
                  <span style={{ fontWeight: 600, fontSize: 12, color: light.text.muted }}>
                    ${fmt(expiryRow.subtotals[0]?.currentValue ?? 0)}
                  </span>
                </div>
                {expiryRow.subtotals.map((sv, i) => (
                  <div key={i} style={subtotalCell}>
                    <span style={{ color: valueColor(sv.pnl), fontWeight: 600, fontSize: 12 }}>
                      {sv.pnl >= 0 ? "+" : ""}{fmt(sv.pnl)}
                    </span>
                  </div>
                ))}
              </div>

              {/* Spacer between expiry sections */}
              {rowIdx < result.expiryRows.length - 1 && <div style={{ height: 8 }} />}
            </div>
          ))}

          {/* Grand total (final expiry subtotal) */}
          {result.expiryRows.length > 0 && (
            <div style={grandTotalRow}>
              <div style={positionLabelCell}>
                <span style={{ fontWeight: 700, fontSize: 12 }}>Final P&L</span>
              </div>
              <div style={grandTotalCell}>
                <span style={{ fontWeight: 700, fontSize: 13, color: light.text.muted }}>
                  ${fmt(result.expiryRows[result.expiryRows.length - 1].subtotals[0]?.currentValue ?? 0)}
                </span>
              </div>
              {result.expiryRows[result.expiryRows.length - 1].subtotals.map((sv, i) => (
                <div key={i} style={grandTotalCell}>
                  <span style={{ color: valueColor(sv.pnl), fontWeight: 700, fontSize: 13 }}>
                    {sv.pnl >= 0 ? "+" : ""}{fmt(sv.pnl)}
                  </span>
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
  gap: 16,
  padding: 12,
};

const headerSection: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: 8,
};

const refreshButton: React.CSSProperties = {
  padding: "4px 12px",
  fontSize: 11,
  background: light.bg.tertiary,
  border: `1px solid ${light.border.primary}`,
  borderRadius: 4,
  cursor: "pointer",
};

const resultContainer: React.CSSProperties = {
  background: light.bg.primary,
  borderRadius: 8,
  border: `1px solid ${light.border.primary}`,
  overflow: "hidden",
};

const resultHeader: React.CSSProperties = {
  padding: "10px 12px",
  background: light.bg.secondary,
  borderBottom: `1px solid ${light.border.primary}`,
  fontSize: 13,
};

const gridCols = "minmax(140px, 180px) 80px repeat(7, 1fr)";

const scenarioHeaderRow: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: gridCols,
  background: light.bg.tertiary,
  borderBottom: `1px solid ${light.border.primary}`,
  padding: "8px 0",
};

const scenarioHeaderCell: React.CSSProperties = {
  textAlign: "center",
  fontSize: 11,
};

const positionLabelCell: React.CSSProperties = {
  paddingLeft: 12,
  display: "flex",
  alignItems: "center",
  fontSize: 11,
  gap: 4,
};

const expiryLabelRow: React.CSSProperties = {
  padding: "6px 12px",
  background: semantic.highlight.cyan,
  borderBottom: `1px solid ${semantic.highlight.cyanBorder}`,
  fontSize: 11,
};

const positionRow: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: gridCols,
  padding: "4px 0",
  borderBottom: `1px solid ${light.bg.hover}`,
};

const valueCell: React.CSSProperties = {
  textAlign: "center",
  fontFamily: "ui-monospace, monospace",
  fontSize: 11,
};

const subtotalRow: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: gridCols,
  padding: "6px 0",
  background: semantic.warning.bgMuted,
  borderBottom: `1px solid ${semantic.highlight.yellowBorder}`,
};

const subtotalCell: React.CSSProperties = {
  textAlign: "center",
  fontFamily: "ui-monospace, monospace",
};

const grandTotalRow: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: gridCols,
  padding: "10px 0",
  background: semantic.highlight.blue,
  borderTop: `2px solid ${semantic.highlight.blueBorder}`,
};

const grandTotalCell: React.CSSProperties = {
  textAlign: "center",
  fontFamily: "ui-monospace, monospace",
};

const emptyStyle: React.CSSProperties = {
  padding: 40,
  textAlign: "center",
  color: light.text.muted,
  fontSize: 14,
};
