// src/components/portfolio/OptionsAnalysisTable.tsx
import { useMemo } from "react";
import { IbPosition } from "../../types/portfolio";
import { PriceData, getChannelPrices } from "../../hooks/useMarketData";
import { buildOsiSymbol, formatExpiryShort, compareOptions } from "../../utils/options";

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
};

interface OptionMetrics {
  position: IbPosition;
  osiSymbol: string;
  delta: number | null;
  effectiveEquiv: number | null;  // contracts * 100 * delta
  intrinsicValue: number;         // $ total
  timeValue: number;              // $ total
  exerciseEffect: {
    shares: number;               // +/- shares if exercised
    cashEffect: number;           // +/- cash if exercised
  };
  optionPrice: number | null;
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
  totalExerciseShares: number;
  totalExerciseCash: number;
}

export default function OptionsAnalysisTable({ positions, equityPrices }: Props) {
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
        const priceData = optionPrices.get(osiSymbol);
        const optionPrice = priceData?.last || null;
        const delta = (priceData as any)?.delta ?? null;

        // Calculate effective equivalent position
        const effectiveEquiv = delta !== null ? opt.quantity * 100 * delta : null;

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
          effectiveEquiv,
          intrinsicValue,
          timeValue,
          exerciseEffect: { shares: exerciseShares, cashEffect: exerciseCash },
          optionPrice,
          underlyingPrice,
        });
      });

      // Sort options by expiry, then call/put (calls first), then strike
      optionMetrics.sort((a, b) => compareOptions(
        { expiry: a.position.expiry || "", right: a.position.right || "", strike: a.position.strike || 0 },
        { expiry: b.position.expiry || "", right: b.position.right || "", strike: b.position.strike || 0 }
      ));

      // Calculate subtotals
      let totalEffectiveEquiv = 0;
      let totalIntrinsicValue = 0;
      let totalTimeValue = 0;
      let totalExerciseShares = 0;
      let totalExerciseCash = 0;

      optionMetrics.forEach(m => {
        if (m.effectiveEquiv !== null) totalEffectiveEquiv += m.effectiveEquiv;
        totalIntrinsicValue += m.intrinsicValue;
        totalTimeValue += m.timeValue;
        totalExerciseShares += m.exerciseEffect.shares;
        totalExerciseCash += m.exerciseEffect.cashEffect;
      });

      result.push({
        underlying,
        equityPosition: equity,
        equityShares,
        options: optionMetrics,
        totalEffectiveEquiv,
        totalIntrinsicValue,
        totalTimeValue,
        totalExerciseShares,
        totalExerciseCash,
      });
    });

    return result;
  }, [positions, equityPrices, optionPrices]);

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

  return (
    <div style={container}>
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
              <div style={cellRight}>Delta</div>
              <div style={cellRight}>Eff. Equiv</div>
              <div style={cellRight}>Intrinsic $</div>
              <div style={cellRight}>Time $</div>
              <div style={cellRight}>Exercise → Shares</div>
              <div style={cellRight}>Exercise → Cash</div>
            </div>

            {/* Equity row */}
            <div style={equityRow}>
              <div style={cellLeft}>Shares</div>
              <div style={cellRight}>—</div>
              <div style={cellRight}>{fmtShares(group.equityShares)}</div>
              <div style={cellRight}>1.0000</div>
              <div style={cellRight}>{fmtShares(group.equityShares)}</div>
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

              return (
                <div key={opt.osiSymbol} style={optionRow}>
                  <div style={cellLeft}>
                    <span style={{ fontWeight: 600 }}>{strikeStr} {isCall ? "Call" : "Put"}</span>
                    <span style={{ marginLeft: 8, color: "#666", fontSize: 10 }}>{expiryShort}</span>
                  </div>
                  <div style={cellRight}>{dte}</div>
                  <div style={cellRight}>{fmtShares(p.quantity)}</div>
                  <div style={cellRight}>{fmtDelta(opt.delta)}</div>
                  <div style={cellRight}>
                    {opt.effectiveEquiv !== null ? fmtShares(Math.round(opt.effectiveEquiv)) : "—"}
                  </div>
                  <div style={{ ...cellRight, color: opt.intrinsicValue > 0 ? "#16a34a" : undefined }}>
                    ${fmt(opt.intrinsicValue, 0)}
                  </div>
                  <div style={{ ...cellRight, color: opt.timeValue < 0 ? "#dc2626" : opt.timeValue > 0 ? "#16a34a" : undefined }}>
                    ${fmt(opt.timeValue, 0)}
                  </div>
                  <div style={cellRight}>{fmtShares(opt.exerciseEffect.shares)}</div>
                  <div style={cellRight}>{fmtCash(opt.exerciseEffect.cashEffect)}</div>
                </div>
              );
            })}

            {/* Subtotal row */}
            {group.options.length > 0 && (
              <div style={subtotalRow}>
                <div style={cellLeft}>Subtotals</div>
                <div style={cellRight}>—</div>
                <div style={cellRight}>—</div>
                <div style={cellRight}>—</div>
                <div style={cellRight}>{fmtShares(Math.round(group.totalEffectiveEquiv))}</div>
                <div style={cellRight}>${fmt(group.totalIntrinsicValue, 0)}</div>
                <div style={cellRight}>${fmt(group.totalTimeValue, 0)}</div>
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
                <div style={cellRight}>
                  {fmtShares(group.equityShares + Math.round(group.totalEffectiveEquiv))}
                </div>
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

const gridCols = "180px 40px 50px 70px 80px 80px 80px 100px 100px";

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
