// src/components/portfolio/OrderHistoryTable.tsx
import { IbOrderHistory } from "../../types/portfolio";
import { formatExpiryYYYYMMDD } from "../../utils/options";
import {
  section, title, table, hdr, rowStyle, hdrCell, hdrCellRight, hdrCellCenter, cellBorder,
  timeHeader, timeCell, centerBold, right, rightMonoBold, emptyRow
} from "./styles";
import { light, semantic, pnl } from "../../theme";

type Props = {
  orders: IbOrderHistory[];
};

export default function OrderHistoryTable({ orders }: Props) {
  return (
    <section style={section}>
      <div style={title}>Order History ({orders.length})</div>
      {orders.length === 0 ? (
        <div style={emptyRow}>No order history</div>
      ) : (
        <div style={table}>
          <div style={{ ...hdr, gridTemplateColumns: "70px 130px 46px 50px 80px 80px", gap: 8 }}>
            <div style={timeHeader}>Time</div>
            <div style={hdrCell}>Symbol</div>
            <div style={hdrCellCenter}>Side</div>
            <div style={hdrCellRight}>Qty</div>
            <div style={hdrCellRight}>Price</div>
            <div style={hdrCell}>Status</div>
          </div>
          <div style={{ maxHeight: 200, overflowY: "auto" }}>
            {orders.map((h, idx) => {
              let symbolDisplay: React.ReactNode;
              if (h.secType === "OPT" && h.strike !== undefined && h.expiry !== undefined && h.right !== undefined) {
                const rightLabel = h.right === "C" || h.right === "Call" ? "Call" : "Put";
                const formattedExpiry = formatExpiryYYYYMMDD(h.expiry);
                symbolDisplay = (
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 11 }}>
                      {h.symbol} {h.strike % 1 === 0 ? h.strike.toFixed(0) : h.strike} {rightLabel}
                    </div>
                    <div style={{ fontSize: 9, color: light.text.muted }}>
                      {formattedExpiry}
                    </div>
                  </div>
                );
              } else {
                symbolDisplay = <div style={{ fontWeight: 600 }}>{h.symbol}</div>;
              }

              const statusColor = h.status === "Cancelled" ? semantic.error.text : h.status === "Filled" ? semantic.success.text : light.text.muted;
              // Show fill price for Filled, limit price for Cancelled
              // Only show price if > 0 (market orders have 0 price)
              const rawPrice = h.status === "Filled" && h.price !== undefined && h.price > 0
                ? h.price
                : (h.lmtPrice !== undefined && h.lmtPrice > 0 ? h.lmtPrice : undefined);
              const displayPrice = rawPrice;
              const isMktOrder = h.orderType === "MKT";

              return (
                <div key={`${h.orderId}-${h.ts}-${idx}`} style={{ ...rowStyle, gridTemplateColumns: "70px 130px 46px 50px 80px 80px", gap: 8 }}>
                  <div style={timeCell}>
                    {new Date(h.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </div>
                  <div style={cellBorder}>{symbolDisplay}</div>
                  <div style={{ ...centerBold, color: h.side === "BUY" ? semantic.success.textDark : semantic.error.textDark }}>
                    {h.side}
                  </div>
                  <div style={{ ...right, fontWeight: 600 }}>{h.quantity !== "0" ? h.quantity : "—"}</div>
                  <div style={rightMonoBold}>
                    {displayPrice !== undefined ? `$${displayPrice.toFixed(2)}` : (isMktOrder ? "MKT" : "—")}
                  </div>
                  <div style={{ ...cellBorder, fontSize: 10, fontWeight: 600, color: statusColor }}>{h.status}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
