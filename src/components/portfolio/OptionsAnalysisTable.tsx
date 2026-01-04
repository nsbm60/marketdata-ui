// src/components/portfolio/OptionsAnalysisTable.tsx
import { useMemo } from "react";
import { IbPosition } from "../../types/portfolio";
import { PriceData, getChannelPrices } from "../../hooks/useMarketData";
import { buildOsiSymbol, buildTopicSymbolFromYYYYMMDD, formatExpiryShort, compareOptions } from "../../utils/options";
import { OptionGreeks, getGreeksForPosition } from "../../hooks/usePortfolioOptionsReports";

/**
 * Calculate days to expiry from YYYYMMDD expiry string.
 */
function calcDTE(expiry: string): number {
  if (!expiry || expiry.length !== 8) return 0;
  const y = parseInt(expiry.substring(0, 4), 10);
  const m = parseInt(expiry.substring(4, 6), 10) - 1;
  const d = parseInt(expiry.substring(6, 8), 10);
  const expiryDate = new Date(y, m, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffMs = expiryDate.getTime() - today.getTime();
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

type Props = {
  positions: IbPosition[];
  equityPrices: Map<string, PriceData>;
  /** Greeks from OptionsReportBuilder (if available) */
  greeksMap?: Map<string, OptionGreeks>;
  /** Version counter to trigger re-renders when Greeks update */
  greeksVersion?: number;
  /** Debug: subscribed pairs */
  subscribedPairs?: string;
};

interface OptionMetrics {
  position: IbPosition;
  osiSymbol: string;
  delta: number | null;
  theta: number | null;
  thetaDollar: number | null;     // theta * quantity * 100 (daily $ decay)
  effectiveEquiv: number | null;  // contracts * 100 * delta
  intrinsicValue: number;         // $ total
  timeValue: number;              // $ total
  exerciseEffect: {
    shares: number;               // +/- shares if exercised
    cashEffect: number;           // +/- cash if exercised
  };
  optionPrice: number | null;
  theoPrice: number | null;       // Black-Scholes theoretical price
  underlyingPrice: number | null;
}

interface UnderlyingGroup {
  underlying: string;
  equityPosition: IbPosition | null;
  equityShares: number;
  options: OptionMetrics[];
  // Subtotals
  totalEffectiveEquiv: number;
  totalIntrinsicValue: number;
  totalTimeValue: number;
  totalThetaDollar: number;
  totalExerciseShares: number;
  totalExerciseCash: number;
  // Call/Put subtotals
  callIntrinsicValue: number;
  callTimeValue: number;
  callThetaDollar: number;
  putIntrinsicValue: number;
  putTimeValue: number;
  putThetaDollar: number;
}

export default function OptionsAnalysisTable({ positions, equityPrices, greeksMap, greeksVersion, subscribedPairs }: Props) {
  // Get option prices from the channel
  const optionPrices = getChannelPrices("option");

  // Group positions by underlying and calculate metrics
  const groups = useMemo(() => {
    // Separate equities and options
    const equities = positions.filter(p => p.secType === "STK");
    const options = positions.filter(p => p.secType === "OPT");

    // Get all unique underlyings (from options, plus any equities)
    const underlyings = new Set<string>();
    options.forEach(p => underlyings.add(p.symbol.toUpperCase()));
    equities.forEach(p => underlyings.add(p.symbol.toUpperCase()));

    // Build groups
    const result: UnderlyingGroup[] = [];

    Array.from(underlyings).sort().forEach(underlying => {
      // Find equity position (if any)
      const equity = equities.find(p => p.symbol.toUpperCase() === underlying) || null;
      const equityShares = equity?.quantity || 0;
      const underlyingPrice = equityPrices.get(underlying)?.last || null;

      // Calculate metrics for each option
      const optionMetrics: OptionMetrics[] = [];
      const underlyingOptions = options.filter(p => p.symbol.toUpperCase() === underlying);

      underlyingOptions.forEach(opt => {
        if (opt.strike === undefined || opt.expiry === undefined || opt.right === undefined) return;

        const osiSymbol = buildOsiSymbol(opt.symbol, opt.expiry, opt.right, opt.strike);
        const topicSymbol = buildTopicSymbolFromYYYYMMDD(opt.symbol, opt.expiry, opt.right, opt.strike);
        const priceData = optionPrices.get(topicSymbol);

        // Try to get Greeks from the report-based greeksMap first (more reliable)
        // Fall back to raw market data if greeksMap not available
        const greeksData = greeksMap
          ? getGreeksForPosition(greeksMap, opt.symbol, opt.expiry, opt.right, opt.strike)
          : undefined;

        const optionPrice = greeksData?.last ?? priceData?.last ?? null;
        const theoPrice = greeksData?.theo ?? (priceData as any)?.theo ?? null;
        const delta = greeksData?.delta ?? (priceData as any)?.delta ?? null;
        const theta = greeksData?.theta ?? (priceData as any)?.theta ?? null;

        // Calculate effective equivalent position
        const effectiveEquiv = delta !== null ? opt.quantity * 100 * delta : null;

        // Calculate theta dollar impact (daily $ decay)
        const thetaDollar = theta !== null ? theta * opt.quantity * 100 : null;

        // Calculate intrinsic value
        let intrinsicPerShare = 0;
        if (underlyingPrice !== null) {
          if (opt.right === "C" || opt.right === "Call") {
            intrinsicPerShare = Math.max(0, underlyingPrice - opt.strike);
          } else {
            intrinsicPerShare = Math.max(0, opt.strike - underlyingPrice);
          }
        }
        const intrinsicValue = intrinsicPerShare * opt.quantity * 100;

        // Calculate time value
        let timeValue = 0;
        if (optionPrice !== null) {
          const timePerShare = optionPrice - intrinsicPerShare;
          timeValue = timePerShare * opt.quantity * 100;
        }

        // Calculate exercise effect - only for ITM options
        const isCall = opt.right === "C" || opt.right === "Call";
        const isLong = opt.quantity > 0;
        const absContracts = Math.abs(opt.quantity);

        let exerciseShares = 0;
        let exerciseCash = 0;

        // Only calculate exercise effect if option is in-the-money
        const isITM = underlyingPrice !== null && (
          (isCall && underlyingPrice > opt.strike) ||
          (!isCall && underlyingPrice < opt.strike)
        );

        if (isITM) {
          if (isCall) {
            // Calls: exercising buys shares at strike
            if (isLong) {
              // Long call: +shares, -cash
              exerciseShares = absContracts * 100;
              exerciseCash = -opt.strike * absContracts * 100;
            } else {
              // Short call: -shares, +cash (assigned)
              exerciseShares = -absContracts * 100;
              exerciseCash = opt.strike * absContracts * 100;
            }
          } else {
            // Puts: exercising sells shares at strike
            if (isLong) {
              // Long put: -shares, +cash
              exerciseShares = -absContracts * 100;
              exerciseCash = opt.strike * absContracts * 100;
            } else {
              // Short put: +shares, -cash (assigned)
              exerciseShares = absContracts * 100;
              exerciseCash = -opt.strike * absContracts * 100;
            }
          }
        }

        optionMetrics.push({
          position: opt,
          osiSymbol,
          delta,
          theta,
          thetaDollar,
          effectiveEquiv,
          intrinsicValue,
          timeValue,
          exerciseEffect: { shares: exerciseShares, cashEffect: exerciseCash },
          optionPrice,
          theoPrice,
          underlyingPrice,
        });
      });

      // Sort options by expiry, then call/put (calls first), then strike
      optionMetrics.sort((a, b) => compareOptions(
        { expiry: a.position.expiry || "", right: a.position.right || "", strike: a.position.strike || 0 },
        { expiry: b.position.expiry || "", right: b.position.right || "", strike: b.position.strike || 0 }
      ));

      // Calculate subtotals (overall and by call/put)
      let totalEffectiveEquiv = 0;
      let totalIntrinsicValue = 0;
      let totalTimeValue = 0;
      let totalThetaDollar = 0;
      let totalExerciseShares = 0;
      let totalExerciseCash = 0;
      let callIntrinsicValue = 0;
      let callTimeValue = 0;
      let callThetaDollar = 0;
      let putIntrinsicValue = 0;
      let putTimeValue = 0;
      let putThetaDollar = 0;

      optionMetrics.forEach(m => {
        const isCall = m.position.right === "C" || m.position.right === "Call";
        if (m.effectiveEquiv !== null) totalEffectiveEquiv += m.effectiveEquiv;
        totalIntrinsicValue += m.intrinsicValue;
        totalTimeValue += m.timeValue;
        if (m.thetaDollar !== null) totalThetaDollar += m.thetaDollar;
        totalExerciseShares += m.exerciseEffect.shares;
        totalExerciseCash += m.exerciseEffect.cashEffect;

        if (isCall) {
          callIntrinsicValue += m.intrinsicValue;
          callTimeValue += m.timeValue;
          if (m.thetaDollar !== null) callThetaDollar += m.thetaDollar;
        } else {
          putIntrinsicValue += m.intrinsicValue;
          putTimeValue += m.timeValue;
          if (m.thetaDollar !== null) putThetaDollar += m.thetaDollar;
        }
      });

      result.push({
        underlying,
        equityPosition: equity,
        equityShares,
        options: optionMetrics,
        totalEffectiveEquiv,
        totalIntrinsicValue,
        totalTimeValue,
        totalThetaDollar,
        totalExerciseShares,
        totalExerciseCash,
        callIntrinsicValue,
        callTimeValue,
        callThetaDollar,
        putIntrinsicValue,
        putTimeValue,
        putThetaDollar,
      });
    });

    return result;
  }, [positions, equityPrices, optionPrices, greeksMap, greeksVersion]);

  // Format helpers
  const fmt = (n: number, decimals = 2) =>
    n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

  const fmtDelta = (d: number | null) =>
    d !== null ? d.toFixed(4) : "—";

  const fmtShares = (n: number) => {
    if (n === 0) return "0";
    const sign = n > 0 ? "+" : "";
    return `${sign}${n.toLocaleString()}`;
  };

  const fmtCash = (n: number) => {
    if (n === 0) return "$0";
    const sign = n > 0 ? "+" : "-";
    return `${sign}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  };

  if (groups.length === 0) {
    return <div style={emptyStyle}>No positions to analyze</div>;
  }

  // Debug: show subscribed pairs and data status
  const debugInfo = `Subscribed: ${subscribedPairs || "none"} | Data: ${greeksMap?.size || 0} entries`;

  return (
    <div style={container}>
      <div style={{ fontSize: 10, color: "#999", marginBottom: 8, fontFamily: "monospace" }}>
        {debugInfo}
      </div>
      {groups.map(group => (
        <div key={group.underlying} style={groupContainer}>
          {/* Underlying header */}
          <div style={groupHeader}>
            <span style={{ fontWeight: 700, fontSize: 13 }}>{group.underlying}</span>
            <span style={{ marginLeft: 12, color: "#666", fontSize: 12 }}>
              Last: ${equityPrices.get(group.underlying)?.last?.toFixed(2) || "—"}
            </span>
            {group.equityPosition && (
              <span style={{ marginLeft: 8, color: "#888", fontSize: 11 }}>
                ({group.equityShares.toLocaleString()} shares)
              </span>
            )}
          </div>

          {/* Table */}
          <div style={table}>
            {/* Header row */}
            <div style={headerRow}>
              <div style={cellLeft}>Position</div>
              <div style={cellRight}>DTE</div>
              <div style={cellRight}>Qty</div>
              <div style={cellRight}>Price</div>
              <div style={{ ...cellRight, color: "#2563eb" }}>Theo</div>
              <div style={cellRight}>Value</div>
              <div style={cellRight}>Delta</div>
              <div style={cellRight}>Theta</div>
              <div style={cellRight}>Eff. Equiv</div>
              <div style={cellRight}>Intrinsic</div>
              <div style={cellRight}>Time $</div>
              <div style={cellRight}>Theta $</div>
              <div style={cellRight}>Exer Shrs</div>
              <div style={cellRight}>Exer Cash</div>
            </div>

            {/* Equity row */}
            <div style={equityRow}>
              <div style={cellLeft}>Shares</div>
              <div style={cellRight}>—</div>
              <div style={cellRight}>{fmtShares(group.equityShares)}</div>
              <div style={cellRight}>{equityPrices.get(group.underlying)?.last?.toFixed(2) || "—"}</div>
              <div style={cellRight}>—</div>
              <div style={cellRight}>{group.equityShares !== 0 && equityPrices.get(group.underlying)?.last ? `$${fmt(group.equityShares * (equityPrices.get(group.underlying)?.last || 0), 0)}` : "—"}</div>
              <div style={cellRight}>1.0000</div>
              <div style={cellRight}>—</div>
              <div style={cellRight}>{fmtShares(group.equityShares)}</div>
              <div style={cellRight}>—</div>
              <div style={cellRight}>—</div>
              <div style={cellRight}>—</div>
              <div style={cellRight}>—</div>
              <div style={cellRight}>—</div>
            </div>

            {/* Option rows */}
            {group.options.map(opt => {
              const p = opt.position;
              const isCall = p.right === "C" || p.right === "Call";
              const strikeStr = p.strike !== undefined
                ? (p.strike % 1 === 0 ? p.strike.toFixed(0) : p.strike.toString())
                : "?";
              const expiryShort = p.expiry ? formatExpiryShort(`${p.expiry.substring(0, 4)}-${p.expiry.substring(4, 6)}-${p.expiry.substring(6, 8)}`) : "?";
              const dte = p.expiry ? calcDTE(p.expiry) : 0;

              const positionValue = opt.optionPrice !== null ? opt.optionPrice * p.quantity * 100 : null;

              return (
                <div key={opt.osiSymbol} style={optionRow}>
                  <div style={cellLeft}>
                    <span style={{ fontWeight: 600 }}>{strikeStr} {isCall ? "Call" : "Put"}</span>
                    <span style={{ marginLeft: 8, color: "#666", fontSize: 10 }}>{expiryShort}</span>
                  </div>
                  <div style={cellRight}>{dte}</div>
                  <div style={cellRight}>{fmtShares(p.quantity)}</div>
                  <div style={cellRight}>{opt.optionPrice !== null ? opt.optionPrice.toFixed(2) : "—"}</div>
                  <div style={{ ...cellRight, color: "#2563eb" }}>{opt.theoPrice !== null ? opt.theoPrice.toFixed(2) : "—"}</div>
                  <div style={cellRight}>{positionValue !== null ? `$${fmt(positionValue, 0)}` : "—"}</div>
                  <div style={cellRight}>{fmtDelta(opt.delta)}</div>
                  <div style={cellRight}>{opt.theta !== null ? opt.theta.toFixed(4) : "—"}</div>
                  <div style={cellRight}>
                    {opt.effectiveEquiv !== null ? fmtShares(Math.round(opt.effectiveEquiv)) : "—"}
                  </div>
                  <div style={{ ...cellRight, color: opt.intrinsicValue > 0 ? "#16a34a" : undefined }}>
                    ${fmt(opt.intrinsicValue, 0)}
                  </div>
                  <div style={{ ...cellRight, color: opt.timeValue < 0 ? "#dc2626" : opt.timeValue > 0 ? "#16a34a" : undefined }}>
                    ${fmt(opt.timeValue, 0)}
                  </div>
                  <div style={{ ...cellRight, color: opt.thetaDollar !== null && opt.thetaDollar > 0 ? "#16a34a" : opt.thetaDollar !== null && opt.thetaDollar < 0 ? "#dc2626" : undefined }}>
                    {opt.thetaDollar !== null ? `$${fmt(opt.thetaDollar, 0)}` : "—"}
                  </div>
                  <div style={cellRight}>{fmtShares(opt.exerciseEffect.shares)}</div>
                  <div style={cellRight}>{fmtCash(opt.exerciseEffect.cashEffect)}</div>
                </div>
              );
            })}

            {/* Call subtotal row */}
            {group.options.some(o => o.position.right === "C" || o.position.right === "Call") && (
              <div style={callSubtotalRow}>
                <div style={cellLeft}>Calls Subtotal</div>
                <div style={cellRight}>—</div>
                <div style={cellRight}>—</div>
                <div style={cellRight}>—</div>
                <div style={cellRight}>—</div>
                <div style={cellRight}>—</div>
                <div style={cellRight}>—</div>
                <div style={cellRight}>—</div>
                <div style={cellRight}>—</div>
                <div style={{ ...cellRight, color: group.callIntrinsicValue > 0 ? "#16a34a" : undefined }}>
                  ${fmt(group.callIntrinsicValue, 0)}
                </div>
                <div style={{ ...cellRight, color: group.callTimeValue < 0 ? "#dc2626" : group.callTimeValue > 0 ? "#16a34a" : undefined }}>
                  ${fmt(group.callTimeValue, 0)}
                </div>
                <div style={{ ...cellRight, color: group.callThetaDollar > 0 ? "#16a34a" : group.callThetaDollar < 0 ? "#dc2626" : undefined }}>
                  ${fmt(group.callThetaDollar, 0)}
                </div>
                <div style={cellRight}>—</div>
                <div style={cellRight}>—</div>
              </div>
            )}

            {/* Put subtotal row */}
            {group.options.some(o => o.position.right === "P" || o.position.right === "Put") && (
              <div style={putSubtotalRow}>
                <div style={cellLeft}>Puts Subtotal</div>
                <div style={cellRight}>—</div>
                <div style={cellRight}>—</div>
                <div style={cellRight}>—</div>
                <div style={cellRight}>—</div>
                <div style={cellRight}>—</div>
                <div style={cellRight}>—</div>
                <div style={cellRight}>—</div>
                <div style={cellRight}>—</div>
                <div style={{ ...cellRight, color: group.putIntrinsicValue > 0 ? "#16a34a" : undefined }}>
                  ${fmt(group.putIntrinsicValue, 0)}
                </div>
                <div style={{ ...cellRight, color: group.putTimeValue < 0 ? "#dc2626" : group.putTimeValue > 0 ? "#16a34a" : undefined }}>
                  ${fmt(group.putTimeValue, 0)}
                </div>
                <div style={{ ...cellRight, color: group.putThetaDollar > 0 ? "#16a34a" : group.putThetaDollar < 0 ? "#dc2626" : undefined }}>
                  ${fmt(group.putThetaDollar, 0)}
                </div>
                <div style={cellRight}>—</div>
                <div style={cellRight}>—</div>
              </div>
            )}

            {/* Total subtotal row */}
            {group.options.length > 0 && (
              <div style={subtotalRow}>
                <div style={cellLeft}>Total</div>
                <div style={cellRight}>—</div>
                <div style={cellRight}>—</div>
                <div style={cellRight}>—</div>
                <div style={cellRight}>—</div>
                <div style={cellRight}>—</div>
                <div style={cellRight}>—</div>
                <div style={cellRight}>—</div>
                <div style={cellRight}>{fmtShares(Math.round(group.totalEffectiveEquiv))}</div>
                <div style={{ ...cellRight, color: group.totalIntrinsicValue > 0 ? "#16a34a" : undefined }}>
                  ${fmt(group.totalIntrinsicValue, 0)}
                </div>
                <div style={{ ...cellRight, color: group.totalTimeValue < 0 ? "#dc2626" : group.totalTimeValue > 0 ? "#16a34a" : undefined }}>
                  ${fmt(group.totalTimeValue, 0)}
                </div>
                <div style={{ ...cellRight, color: group.totalThetaDollar > 0 ? "#16a34a" : group.totalThetaDollar < 0 ? "#dc2626" : undefined }}>
                  ${fmt(group.totalThetaDollar, 0)}
                </div>
                <div style={cellRight}>{fmtShares(group.totalExerciseShares)}</div>
                <div style={cellRight}>{fmtCash(group.totalExerciseCash)}</div>
              </div>
            )}

            {/* Net position row (shares + exercise effect) */}
            {group.options.length > 0 && (
              <div style={netRow}>
                <div style={cellLeft}>Net After Exercise</div>
                <div style={cellRight}>—</div>
                <div style={cellRight}>—</div>
                <div style={cellRight}>—</div>
                <div style={cellRight}>—</div>
                <div style={cellRight}>—</div>
                <div style={cellRight}>—</div>
                <div style={cellRight}>—</div>
                <div style={cellRight}>
                  {fmtShares(group.equityShares + Math.round(group.totalEffectiveEquiv))}
                </div>
                <div style={cellRight}>—</div>
                <div style={cellRight}>—</div>
                <div style={cellRight}>—</div>
                <div style={{ ...cellRight, fontWeight: 600 }}>
                  {fmtShares(group.equityShares + group.totalExerciseShares)}
                </div>
                <div style={{ ...cellRight, fontWeight: 600 }}>
                  {fmtCash(group.totalExerciseCash)}
                </div>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// Styles
const container: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 20,
};

const groupContainer: React.CSSProperties = {
  background: "white",
  borderRadius: 8,
  border: "1px solid #e5e7eb",
  overflow: "hidden",
};

const groupHeader: React.CSSProperties = {
  padding: "10px 12px",
  background: "#f8fafc",
  borderBottom: "1px solid #e5e7eb",
};

const table: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  fontSize: 11,
};

const gridCols = "140px 35px 45px 55px 50px 55px 60px 70px 70px 65px 65px 70px 80px 80px";

const headerRow: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: gridCols,
  padding: "8px 12px",
  background: "#f1f5f9",
  fontWeight: 600,
  borderBottom: "1px solid #e5e7eb",
  position: "sticky",
  top: 0,
  zIndex: 1,
};

const equityRow: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: gridCols,
  padding: "6px 12px",
  background: "#f0fdf4",
  borderBottom: "1px solid #e5e7eb",
};

const optionRow: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: gridCols,
  padding: "6px 12px",
  borderBottom: "1px solid #f3f4f6",
};

const callSubtotalRow: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: gridCols,
  padding: "6px 12px",
  background: "#dcfce7",
  fontWeight: 500,
  fontSize: 10,
  borderBottom: "1px solid #e5e7eb",
};

const putSubtotalRow: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: gridCols,
  padding: "6px 12px",
  background: "#fce7f3",
  fontWeight: 500,
  fontSize: 10,
  borderBottom: "1px solid #e5e7eb",
};

const subtotalRow: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: gridCols,
  padding: "8px 12px",
  background: "#fef3c7",
  fontWeight: 600,
  borderBottom: "1px solid #e5e7eb",
};

const netRow: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: gridCols,
  padding: "8px 12px",
  background: "#dbeafe",
  fontWeight: 500,
};

const cellLeft: React.CSSProperties = {
  textAlign: "left",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  borderRight: "1px solid #eee",
  paddingRight: 4,
};

const cellRight: React.CSSProperties = {
  textAlign: "right",
  fontFamily: "ui-monospace, monospace",
  borderRight: "1px solid #eee",
  paddingRight: 4,
};

const emptyStyle: React.CSSProperties = {
  padding: 40,
  textAlign: "center",
  color: "#666",
  fontSize: 14,
};
