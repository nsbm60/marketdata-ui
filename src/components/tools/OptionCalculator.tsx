/**
 * OptionCalculator - General-purpose option pricing calculator.
 *
 * Features:
 * 1. Select any option (underlying → expiry → strike/right)
 * 2. View current price and Greeks
 * 3. Simulate future scenarios (date, IV) with price ranges ±1-5%
 */

import { useState, useCallback } from "react";
import { socketHub } from "../../ws/SocketHub";
import OptionSelector, { type SelectedOption } from "./OptionSelector";
import { light, semantic } from "../../theme";
import { fmtPrice, fmtGreek } from "../../utils/formatters";
import { useMarketPrice } from "../../hooks/useMarketData";

interface ScenarioRow {
  pctChange: number;
  underlyingPrice: number;
  optionPrice: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
}

interface CalculatorResult {
  osiSymbol: string;
  underlying: string;
  strike: number;
  expiry: string;
  right: string;
  simulationDate: string;
  currentPrice: number;
  currentGreeks: {
    delta: number;
    gamma: number;
    theta: number;
    vega: number;
  };
  daysToExpiry: number;
  iv: number;
  scenarios: ScenarioRow[];
}

export default function OptionCalculator() {
  // Selected option from OptionSelector
  const [selectedOption, setSelectedOption] = useState<SelectedOption | null>(null);

  // Simulation parameters
  const [simulationDate, setSimulationDate] = useState<string>(() => {
    const today = new Date();
    return today.toISOString().split("T")[0];
  });
  const [ivOverride, setIvOverride] = useState<string>("");

  // Results
  const [result, setResult] = useState<CalculatorResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Get live underlying price
  const underlyingPriceData = useMarketPrice(
    selectedOption?.underlying,
    "equity"
  );

  const underlyingPrice = underlyingPriceData?.last;

  // Calculate scenarios
  const handleCalculate = useCallback(async () => {
    if (!selectedOption) {
      setError("Please select an option first");
      return;
    }

    const price = underlyingPrice;
    if (!price || price <= 0) {
      setError("Underlying price not available");
      return;
    }

    const iv = ivOverride ? parseFloat(ivOverride) / 100 : selectedOption.iv;
    if (!iv || iv <= 0) {
      setError("IV not available. Please enter an IV value.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await socketHub.sendControl("option_calculate", {
        target: "calc",
        osiSymbol: selectedOption.osiSymbol,
        underlyingPrice: price,
        simulationDate: simulationDate,
        iv: iv,
        scenarios: [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5],
      });

      if (response.ok && response.data) {
        const data = (response.data as any).data || response.data;
        setResult(data as CalculatorResult);
      } else {
        setError(response.error || "Failed to calculate");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to calculate");
    } finally {
      setLoading(false);
    }
  }, [selectedOption, underlyingPrice, simulationDate, ivOverride]);

  // Handle option selection
  const handleSelect = (option: SelectedOption | null) => {
    setSelectedOption(option);
    setResult(null);
    setError(null);
    // Pre-fill IV from selected option
    if (option?.iv) {
      setIvOverride((option.iv * 100).toFixed(1));
    }
  };

  return (
    <div style={container as any}>
      <div style={header as any}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Option Calculator</h2>
      </div>

      <div style={content as any}>
        {/* Left panel: Option selector */}
        <div style={leftPanel as any}>
          <OptionSelector onSelect={handleSelect} />
        </div>

        {/* Right panel: Calculator */}
        <div style={rightPanel as any}>
          {/* Current state */}
          {selectedOption && (
            <div style={currentState as any}>
              <h3 style={sectionTitle as any}>Current State</h3>
              <div style={stateGrid as any}>
                <div style={stateItem as any}>
                  <span style={stateLabel as any}>Option</span>
                  <span style={stateValue as any}>{selectedOption.osiSymbol}</span>
                </div>
                <div style={stateItem as any}>
                  <span style={stateLabel as any}>Underlying</span>
                  <span style={stateValue as any}>
                    {selectedOption.underlying}: {underlyingPrice ? fmtPrice(underlyingPrice) : "-"}
                  </span>
                </div>
                <div style={stateItem as any}>
                  <span style={stateLabel as any}>Strike</span>
                  <span style={stateValue as any}>${selectedOption.strike}</span>
                </div>
                <div style={stateItem as any}>
                  <span style={stateLabel as any}>Type</span>
                  <span style={stateValue as any}>
                    {selectedOption.right === "C" ? "Call" : "Put"}
                  </span>
                </div>
                <div style={stateItem as any}>
                  <span style={stateLabel as any}>Expiry</span>
                  <span style={stateValue as any}>{selectedOption.expiry}</span>
                </div>
                <div style={stateItem as any}>
                  <span style={stateLabel as any}>Market Price</span>
                  <span style={stateValue as any}>
                    {selectedOption.mid ? fmtPrice(selectedOption.mid) : "-"}
                  </span>
                </div>
              </div>

              {/* Greeks from live data */}
              <div style={greeksRow as any}>
                <div style={greekItem as any}>
                  <span style={greekLabel as any}>Delta</span>
                  <span>{fmtGreek(selectedOption.delta)}</span>
                </div>
                <div style={greekItem as any}>
                  <span style={greekLabel as any}>Gamma</span>
                  <span>{fmtGreek(selectedOption.gamma)}</span>
                </div>
                <div style={greekItem as any}>
                  <span style={greekLabel as any}>Theta</span>
                  <span>{fmtGreek(selectedOption.theta)}</span>
                </div>
                <div style={greekItem as any}>
                  <span style={greekLabel as any}>Vega</span>
                  <span>{fmtGreek(selectedOption.vega)}</span>
                </div>
                <div style={greekItem as any}>
                  <span style={greekLabel as any}>IV</span>
                  <span>{selectedOption.iv ? (selectedOption.iv * 100).toFixed(1) + "%" : "-"}</span>
                </div>
              </div>
            </div>
          )}

          {/* Simulation controls */}
          {selectedOption && (
            <div style={simulationSection as any}>
              <h3 style={sectionTitle as any}>Simulation</h3>
              <div style={simControls as any}>
                <div style={simControl as any}>
                  <label style={simLabel as any}>Simulation Date</label>
                  <input
                    type="date"
                    value={simulationDate}
                    onChange={(e) => setSimulationDate(e.target.value)}
                    style={simInput as any}
                  />
                </div>
                <div style={simControl as any}>
                  <label style={simLabel as any}>IV (%)</label>
                  <input
                    type="number"
                    value={ivOverride}
                    onChange={(e) => setIvOverride(e.target.value)}
                    placeholder={selectedOption.iv ? (selectedOption.iv * 100).toFixed(1) : "Enter IV"}
                    step="0.5"
                    min="1"
                    max="500"
                    style={simInput as any}
                  />
                </div>
                <button
                  onClick={handleCalculate}
                  disabled={loading || !underlyingPrice}
                  style={calculateButton as any}
                >
                  {loading ? "Calculating..." : "Calculate"}
                </button>
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div style={errorBox as any}>{error}</div>
          )}

          {/* Results table */}
          {result && (
            <div style={resultsSection as any}>
              <h3 style={sectionTitle as any}>
                Scenarios (as of {result.simulationDate}, {result.daysToExpiry} DTE, IV: {(result.iv * 100).toFixed(1)}%)
              </h3>
              <div style={tableContainer as any}>
                <table style={table as any}>
                  <thead>
                    <tr>
                      <th style={th as any}>% Change</th>
                      <th style={th as any}>Underlying</th>
                      <th style={th as any}>Option Price</th>
                      <th style={th as any}>Delta</th>
                      <th style={th as any}>Gamma</th>
                      <th style={th as any}>Theta</th>
                      <th style={th as any}>Vega</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.scenarios.map((row) => {
                      const isZero = row.pctChange === 0;
                      return (
                        <tr
                          key={row.pctChange}
                          style={isZero ? highlightRow : undefined}
                        >
                          <td style={{ ...td, fontWeight: isZero ? 700 : 400 } as any}>
                            {row.pctChange > 0 ? "+" : ""}{row.pctChange}%
                          </td>
                          <td style={td as any}>{fmtPrice(row.underlyingPrice)}</td>
                          <td style={{ ...td, fontWeight: 600 } as any}>{fmtPrice(row.optionPrice)}</td>
                          <td style={td as any}>{fmtGreek(row.delta)}</td>
                          <td style={td as any}>{fmtGreek(row.gamma)}</td>
                          <td style={td as any}>{fmtGreek(row.theta)}</td>
                          <td style={td as any}>{fmtGreek(row.vega)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Current vs simulated comparison */}
              {selectedOption.mid && (
                <div style={comparison as any}>
                  <span>Market: {fmtPrice(selectedOption.mid)}</span>
                  <span style={{ color: light.text.muted }}>|</span>
                  <span>Theoretical: {fmtPrice(result.currentPrice)}</span>
                  <span style={{ color: light.text.muted }}>|</span>
                  <span style={{
                    color: result.currentPrice > selectedOption.mid
                      ? semantic.success.text
                      : semantic.error.text
                  }}>
                    {result.currentPrice > selectedOption.mid ? "+" : ""}
                    {fmtPrice(result.currentPrice - selectedOption.mid)} ({((result.currentPrice / selectedOption.mid - 1) * 100).toFixed(1)}%)
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Empty state */}
          {!selectedOption && (
            <div style={emptyState as any}>
              Select an option from the left panel to start calculating.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---- Styles ---- */
const container = {
  display: "flex",
  flexDirection: "column" as const,
  height: "100%",
  background: light.bg.secondary,
};

const header = {
  padding: "12px 16px",
  borderBottom: `1px solid ${light.border.primary}`,
  background: light.bg.primary,
};

const content = {
  display: "grid",
  gridTemplateColumns: "400px 1fr",
  gap: 16,
  flex: 1,
  padding: 16,
  overflow: "hidden",
};

const leftPanel = {
  height: "100%",
  overflowY: "auto" as const,
};

const rightPanel = {
  display: "flex",
  flexDirection: "column" as const,
  gap: 16,
  height: "100%",
  overflowY: "auto" as const,
};

const currentState = {
  padding: 16,
  background: light.bg.primary,
  borderRadius: 8,
  border: `1px solid ${light.border.primary}`,
};

const sectionTitle = {
  margin: "0 0 12px 0",
  fontSize: 14,
  fontWeight: 600,
  color: light.text.secondary,
};

const stateGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(3, 1fr)",
  gap: 12,
};

const stateItem = {
  display: "flex",
  flexDirection: "column" as const,
  gap: 2,
};

const stateLabel = {
  fontSize: 11,
  color: light.text.muted,
};

const stateValue = {
  fontSize: 14,
  fontWeight: 500,
};

const greeksRow = {
  display: "flex",
  gap: 24,
  marginTop: 16,
  paddingTop: 12,
  borderTop: `1px solid ${light.border.muted}`,
};

const greekItem = {
  display: "flex",
  flexDirection: "column" as const,
  gap: 2,
  fontSize: 13,
};

const greekLabel = {
  fontSize: 11,
  color: light.text.muted,
};

const simulationSection = {
  padding: 16,
  background: light.bg.primary,
  borderRadius: 8,
  border: `1px solid ${light.border.primary}`,
};

const simControls = {
  display: "flex",
  gap: 16,
  alignItems: "flex-end",
};

const simControl = {
  display: "flex",
  flexDirection: "column" as const,
  gap: 4,
};

const simLabel = {
  fontSize: 12,
  fontWeight: 500,
  color: light.text.secondary,
};

const simInput = {
  padding: "8px 12px",
  fontSize: 14,
  border: `1px solid ${light.border.primary}`,
  borderRadius: 4,
  outline: "none",
  width: 140,
};

const calculateButton = {
  padding: "8px 24px",
  fontSize: 14,
  fontWeight: 600,
  background: "#007bff",
  color: "white",
  border: "none",
  borderRadius: 4,
  cursor: "pointer",
};

const errorBox = {
  padding: "12px 16px",
  background: "#fff5f5",
  border: "1px solid #f8d7da",
  borderRadius: 8,
  color: "#721c24",
  fontSize: 13,
};

const resultsSection = {
  padding: 16,
  background: light.bg.primary,
  borderRadius: 8,
  border: `1px solid ${light.border.primary}`,
  flex: 1,
  overflow: "hidden",
  display: "flex",
  flexDirection: "column" as const,
};

const tableContainer = {
  flex: 1,
  overflowY: "auto" as const,
};

const table = {
  width: "100%",
  borderCollapse: "collapse" as const,
  fontSize: 13,
};

const th = {
  padding: "8px 12px",
  textAlign: "right" as const,
  fontWeight: 600,
  fontSize: 11,
  color: light.text.secondary,
  background: light.bg.tertiary,
  borderBottom: `1px solid ${light.border.primary}`,
  position: "sticky" as const,
  top: 0,
};

const td = {
  padding: "8px 12px",
  textAlign: "right" as const,
  borderBottom: `1px solid ${light.border.muted}`,
  fontVariantNumeric: "tabular-nums",
};

const highlightRow = {
  background: semantic.highlight.yellow,
};

const comparison = {
  display: "flex",
  gap: 16,
  marginTop: 12,
  paddingTop: 12,
  borderTop: `1px solid ${light.border.muted}`,
  fontSize: 13,
  fontWeight: 500,
};

const emptyState = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  height: "100%",
  color: light.text.muted,
  fontSize: 14,
};
