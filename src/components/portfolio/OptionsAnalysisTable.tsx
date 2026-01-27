// src/components/portfolio/OptionsAnalysisTable.tsx
import { useMemo } from "react";
import type { ReportPosition, UnderlyingGroupSubtotal, ExpirySubtotal } from "../../hooks/usePositionsReport";
import { formatExpiryShort, compareOptions } from "../../utils/options";
import { light, semantic, pnl } from "../../theme";

/**
 * Calculate days to expiry from YYYYMMDD expiry string.
 * (Display-only formatting — not a domain calculation.)
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
  /** All positions from the server-computed positions report */
  positions: ReportPosition[];
  /** Server-computed per-underlying groups with per-expiry subtotals */
  underlyingGroups: UnderlyingGroupSubtotal[];
  /** Version counter to trigger re-renders when report updates */
  version?: number;
};

/** A group of positions for one underlying, organized for display. */
interface DisplayGroup {
  underlying: string;
  /** Server-computed subtotals for this underlying */
  groupSubtotal: UnderlyingGroupSubtotal | null;
  /** Equity position (if any) */
  equityPosition: ReportPosition | null;
  /** Option positions sorted by expiry/right/strike */
  options: ReportPosition[];
}

export default function OptionsAnalysisTable({ positions, underlyingGroups, version }: Props) {

  // Group positions by underlying for display
  const groups = useMemo(() => {
    const equities = positions.filter(p => p.secType === "STK");
    const options = positions.filter(p => p.secType === "OPT");

    // Index server subtotals by underlying for lookup
    const subtotalsByUnderlying = new Map<string, UnderlyingGroupSubtotal>();
    for (const g of underlyingGroups) {
      subtotalsByUnderlying.set(g.underlying.toUpperCase(), g);
    }

    // Collect unique underlyings
    const underlyings = new Set<string>();
    options.forEach(p => underlyings.add(p.symbol.toUpperCase()));
    equities.forEach(p => underlyings.add(p.symbol.toUpperCase()));

    const result: DisplayGroup[] = [];

    Array.from(underlyings).sort().forEach(underlying => {
      const equity = equities.find(p => p.symbol.toUpperCase() === underlying) || null;
      const underlyingOptions = options
        .filter(p => p.symbol.toUpperCase() === underlying)
        .sort((a, b) => compareOptions(
          { expiry: a.expiry || "", right: a.right || "", strike: a.strike || 0 },
          { expiry: b.expiry || "", right: b.right || "", strike: b.strike || 0 },
        ));

      result.push({
        underlying,
        groupSubtotal: subtotalsByUnderlying.get(underlying) || null,
        equityPosition: equity,
        options: underlyingOptions,
      });
    });

    return result;
  }, [positions, underlyingGroups, version]);

  // Format helpers
  const fmt = (n: number, decimals = 2) =>
    n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

  const fmtDelta = (d: number | undefined) =>
    d !== undefined ? d.toFixed(4) : "—";

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
      {groups.map(group => {
        const gs = group.groupSubtotal;
        const equityShares = gs?.equityShares ?? group.equityPosition?.quantity ?? 0;
        const underlyingPrice = gs?.underlyingPrice ?? group.equityPosition?.currentPrice;

        return (
          <div key={group.underlying} style={groupContainer}>
            {/* Underlying header */}
            <div style={groupHeader}>
              <span style={{ fontWeight: 700, fontSize: 13 }}>{group.underlying}</span>
              <span style={{ marginLeft: 12, color: light.text.muted, fontSize: 12 }}>
                Last: ${underlyingPrice?.toFixed(2) || "—"}
              </span>
              {equityShares !== 0 && (
                <span style={{ marginLeft: 8, color: light.text.light, fontSize: 11 }}>
                  ({equityShares.toLocaleString()} shares)
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
                <div style={cellRight}>{fmtShares(equityShares)}</div>
                <div style={cellRight}>{underlyingPrice?.toFixed(2) || "—"}</div>
                <div style={cellRight}>{equityShares !== 0 && underlyingPrice ? `$${fmt(equityShares * underlyingPrice, 0)}` : "—"}</div>
                <div style={cellRight}>1.0000</div>
                <div style={cellRight}>—</div>
                <div style={cellRight}>{fmtShares(equityShares)}</div>
                <div style={cellRight}>—</div>
                <div style={cellRight}>—</div>
                <div style={cellRight}>—</div>
                <div style={cellRight}>—</div>
                <div style={cellRight}>—</div>
              </div>

              {/* Option rows grouped by expiry with server-computed per-expiry subtotals */}
              {renderOptionsByExpiry(group, gs, fmt, fmtDelta, fmtShares, fmtCash)}

              {/* Total row from server subtotals */}
              {group.options.length > 0 && gs && (
                <div style={subtotalRow}>
                  <div style={cellLeft}>Total</div>
                  <div style={cellRight}>—</div>
                  <div style={cellRight}>—</div>
                  <div style={cellRight}>—</div>
                  <div style={cellRight}>—</div>
                  <div style={cellRight}>—</div>
                  <div style={cellRight}>—</div>
                  <div style={cellRight}>{fmtShares(Math.round(gs.totalDeltaEquivalent))}</div>
                  <div style={{ ...cellRight, color: gs.totalIntrinsicValue > 0 ? pnl.positive : undefined }}>
                    ${fmt(gs.totalIntrinsicValue, 0)}
                  </div>
                  <div style={{ ...cellRight, color: gs.totalTimeValue < 0 ? pnl.negative : gs.totalTimeValue > 0 ? pnl.positive : undefined }}>
                    ${fmt(gs.totalTimeValue, 0)}
                  </div>
                  <div style={{ ...cellRight, color: gs.totalThetaDaily > 0 ? pnl.positive : gs.totalThetaDaily < 0 ? pnl.negative : undefined }}>
                    ${fmt(gs.totalThetaDaily, 0)}
                  </div>
                  <div style={cellRight}>{fmtShares(gs.totalExerciseShares)}</div>
                  <div style={cellRight}>{fmtCash(gs.totalExerciseCash)}</div>
                </div>
              )}

              {/* Net position row (shares + exercise effect) */}
              {group.options.length > 0 && gs && (
                <div style={netRow}>
                  <div style={cellLeft}>Net After Exercise</div>
                  <div style={cellRight}>—</div>
                  <div style={cellRight}>—</div>
                  <div style={cellRight}>—</div>
                  <div style={cellRight}>—</div>
                  <div style={cellRight}>—</div>
                  <div style={cellRight}>—</div>
                  <div style={cellRight}>
                    {fmtShares(equityShares + Math.round(gs.totalDeltaEquivalent))}
                  </div>
                  <div style={cellRight}>—</div>
                  <div style={cellRight}>—</div>
                  <div style={cellRight}>—</div>
                  <div style={{ ...cellRight, fontWeight: 600 }}>
                    {fmtShares(equityShares + gs.totalExerciseShares)}
                  </div>
                  <div style={{ ...cellRight, fontWeight: 600 }}>
                    {fmtCash(gs.totalExerciseCash)}
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Render option rows grouped by expiry, with server-computed per-expiry subtotals.
 */
function renderOptionsByExpiry(
  group: DisplayGroup,
  gs: UnderlyingGroupSubtotal | null,
  fmt: (n: number, d?: number) => string,
  fmtDelta: (d: number | undefined) => string,
  fmtShares: (n: number) => string,
  fmtCash: (n: number) => string,
) {
  // Group options by expiry for display
  const byExpiry = new Map<string, ReportPosition[]>();
  for (const opt of group.options) {
    const exp = opt.expiry || "unknown";
    if (!byExpiry.has(exp)) byExpiry.set(exp, []);
    byExpiry.get(exp)!.push(opt);
  }

  // Index server expiry subtotals for lookup
  const expirySubtotalMap = new Map<string, ExpirySubtotal>();
  if (gs) {
    for (const es of gs.expirySubtotals) {
      expirySubtotalMap.set(es.expiry, es);
    }
  }

  return Array.from(byExpiry.entries()).map(([expiry, expiryOpts]) => {
    const expiryShort = expiry !== "unknown"
      ? formatExpiryShort(`${expiry.substring(0, 4)}-${expiry.substring(4, 6)}-${expiry.substring(6, 8)}`)
      : "?";
    const dte = expiry !== "unknown" ? calcDTE(expiry) : 0;

    // Look up server-computed subtotal for this expiry
    const es = expirySubtotalMap.get(expiry);

    return (
      <div key={expiry}>
        {/* Expiry section header */}
        <div style={expirySectionHeader}>
          <div style={cellLeft}>{expiryShort} ({dte}d)</div>
        </div>

        {/* Option rows for this expiry */}
        {expiryOpts.map(opt => {
          const isCall = opt.right === "C" || opt.right === "Call";
          const strikeStr = opt.strike !== undefined
            ? (opt.strike % 1 === 0 ? opt.strike.toFixed(0) : opt.strike.toString())
            : "?";

          return (
            <div key={opt.osiSymbol || opt.key} style={optionRow}>
              <div style={cellLeft}>
                <span style={{ fontWeight: 600 }}>{strikeStr} {isCall ? "Call" : "Put"}</span>
              </div>
              <div style={cellRight}>{dte}</div>
              <div style={cellRight}>{fmtShares(opt.quantity)}</div>
              <div style={cellRight}>{opt.currentPrice !== undefined ? opt.currentPrice.toFixed(2) : "—"}</div>
              <div style={cellRight}>{opt.currentValue !== undefined ? `$${fmt(opt.currentValue, 0)}` : "—"}</div>
              <div style={cellRight}>{fmtDelta(opt.delta)}</div>
              <div style={cellRight}>{opt.theta !== undefined ? opt.theta.toFixed(4) : "—"}</div>
              <div style={cellRight}>
                {opt.deltaEquivalent !== undefined ? fmtShares(Math.round(opt.deltaEquivalent)) : "—"}
              </div>
              <div style={{ ...cellRight, color: (opt.intrinsicValue ?? 0) > 0 ? pnl.positive : undefined }}>
                {opt.intrinsicValue !== undefined ? `$${fmt(opt.intrinsicValue, 0)}` : "—"}
              </div>
              <div style={{ ...cellRight, color: (opt.timeValue ?? 0) < 0 ? pnl.negative : (opt.timeValue ?? 0) > 0 ? pnl.positive : undefined }}>
                {opt.timeValue !== undefined ? `$${fmt(opt.timeValue, 0)}` : "—"}
              </div>
              <div style={{ ...cellRight, color: (opt.thetaDaily ?? 0) > 0 ? pnl.positive : (opt.thetaDaily ?? 0) < 0 ? pnl.negative : undefined }}>
                {opt.thetaDaily !== undefined ? `$${fmt(opt.thetaDaily, 0)}` : "—"}
              </div>
              <div style={cellRight}>{opt.exerciseShares !== undefined ? fmtShares(opt.exerciseShares) : "0"}</div>
              <div style={cellRight}>{opt.exerciseCash !== undefined ? fmtCash(opt.exerciseCash) : "$0"}</div>
            </div>
          );
        })}

        {/* Per-expiry subtotal from server */}
        {es && (
          <div style={expirySubtotalRow}>
            <div style={cellLeft}>{expiryShort} Subtotal</div>
            <div style={cellRight}>—</div>
            <div style={cellRight}>—</div>
            <div style={cellRight}>—</div>
            <div style={cellRight}>—</div>
            <div style={cellRight}>—</div>
            <div style={cellRight}>—</div>
            <div style={cellRight}>{fmtShares(Math.round(es.deltaEquivalent))}</div>
            <div style={{ ...cellRight, color: es.intrinsicValue > 0 ? pnl.positive : undefined }}>
              ${fmt(es.intrinsicValue, 0)}
            </div>
            <div style={{ ...cellRight, color: es.timeValue < 0 ? pnl.negative : es.timeValue > 0 ? pnl.positive : undefined }}>
              ${fmt(es.timeValue, 0)}
            </div>
            <div style={{ ...cellRight, color: es.thetaDaily > 0 ? pnl.positive : es.thetaDaily < 0 ? pnl.negative : undefined }}>
              ${fmt(es.thetaDaily, 0)}
            </div>
            <div style={cellRight}>{fmtShares(es.exerciseShares)}</div>
            <div style={cellRight}>{fmtCash(es.exerciseCash)}</div>
          </div>
        )}
      </div>
    );
  });
}

// Styles
const container: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 20,
};

const groupContainer: React.CSSProperties = {
  background: light.bg.primary,
  borderRadius: 8,
  border: `1px solid ${light.border.primary}`,
  overflow: "hidden",
};

const groupHeader: React.CSSProperties = {
  padding: "10px 12px",
  background: light.bg.secondary,
  borderBottom: `1px solid ${light.border.primary}`,
};

const table: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  fontSize: 11,
};

const gridCols = "140px 35px 45px 55px 55px 60px 70px 70px 65px 65px 70px 80px 80px";

const headerRow: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: gridCols,
  padding: "8px 12px",
  background: light.bg.tertiary,
  fontWeight: 600,
  borderBottom: `1px solid ${light.border.primary}`,
  position: "sticky",
  top: 0,
  zIndex: 1,
};

const equityRow: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: gridCols,
  padding: "6px 12px",
  background: semantic.success.bg,
  borderBottom: `1px solid ${light.border.primary}`,
};

const optionRow: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: gridCols,
  padding: "6px 12px",
  borderBottom: `1px solid ${light.bg.hover}`,
};

const expirySectionHeader: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: gridCols,
  padding: "4px 12px",
  background: light.bg.tertiary,
  fontWeight: 600,
  fontSize: 10,
  color: light.text.secondary,
  borderBottom: `1px solid ${light.border.primary}`,
  borderTop: `1px solid ${light.border.primary}`,
};

const expirySubtotalRow: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: gridCols,
  padding: "5px 12px",
  background: semantic.highlight.yellow,
  fontWeight: 500,
  fontSize: 10,
  borderBottom: `1px solid ${light.border.primary}`,
};

const subtotalRow: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: gridCols,
  padding: "8px 12px",
  background: semantic.warning.bg,
  fontWeight: 600,
  borderBottom: `1px solid ${light.border.primary}`,
};

const netRow: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: gridCols,
  padding: "8px 12px",
  background: semantic.highlight.blue,
  fontWeight: 500,
};

const cellLeft: React.CSSProperties = {
  textAlign: "left",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  borderRight: `1px solid ${light.border.muted}`,
  paddingRight: 4,
};

const cellRight: React.CSSProperties = {
  textAlign: "right",
  fontFamily: "ui-monospace, monospace",
  borderRight: `1px solid ${light.border.muted}`,
  paddingRight: 4,
};

const emptyStyle: React.CSSProperties = {
  padding: 40,
  textAlign: "center",
  color: light.text.muted,
  fontSize: 14,
};
