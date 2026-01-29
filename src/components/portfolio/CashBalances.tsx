// src/components/portfolio/CashBalances.tsx
import type { ReportCash } from "../../hooks/usePositionsReport";
import {
  section, title, table, hdr, rowStyle,
  centerBold, rightMonoBold, right
} from "./styles";

type Props = {
  cash: ReportCash[];
};

export default function CashBalances({ cash }: Props) {
  return (
    <section style={section}>
      <div style={title}>Cash Balances</div>
      <div style={table}>
        <div style={{ ...hdr, gridTemplateColumns: "60px 140px" }}>
          <div>CCY</div>
          <div style={right}>Amount</div>
        </div>
        {cash.map((c, i) => (
          <div key={i} style={{ ...rowStyle, gridTemplateColumns: "60px 140px" }}>
            <div style={centerBold}>{c.currency}</div>
            <div style={rightMonoBold}>
              {c.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
