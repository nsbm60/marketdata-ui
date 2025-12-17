// src/components/portfolio/CashBalances.tsx
import { IbCash } from "../../types/portfolio";
import {
  section, title, table, hdr, rowStyle,
  cellEllipsis, centerBold, rightMonoBold, timeHeader, timeCell, right
} from "./styles";

type Props = {
  cash: IbCash[];
};

export default function CashBalances({ cash }: Props) {
  return (
    <section style={section}>
      <div style={title}>Cash Balances</div>
      <div style={table}>
        <div style={{ ...hdr, gridTemplateColumns: "120px 40px 98px 72px" }}>
          <div>Account</div>
          <div>CCY</div>
          <div style={right}>Amount</div>
          <div style={timeHeader}>Time</div>
        </div>
        {cash.map((c, i) => (
          <div key={i} style={{ ...rowStyle, gridTemplateColumns: "120px 40px 98px 72px" }}>
            <div style={cellEllipsis}>{c.account}</div>
            <div style={centerBold}>{c.currency}</div>
            <div style={rightMonoBold}>
              {c.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div style={timeCell}>
              {new Date(c.lastUpdated).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
