// src/components/portfolio/OpenOrdersTable.tsx
import { IbOpenOrder } from "../../types/portfolio";
import { formatExpiryYYYYMMDD } from "../../utils/options";
import {
  section, title, table, hdr, rowStyle,
  timeHeader, timeCell, centerBold, right, rightMonoBold, center, emptyRow
} from "./styles";

type Props = {
  orders: IbOpenOrder[];
  onModify: (order: IbOpenOrder) => void;
  onCancel: (order: IbOpenOrder) => void;
};

export default function OpenOrdersTable({ orders, onModify, onCancel }: Props) {
  return (
    <section style={section}>
      <div style={title}>Open Orders ({orders.length})</div>
      {orders.length === 0 ? (
        <div style={emptyRow}>No open orders</div>
      ) : (
        <div style={table}>
          <div style={{ ...hdr, gridTemplateColumns: "70px 130px 46px 50px 46px 80px 80px 65px", gap: 8 }}>
            <div style={timeHeader}>Time</div>
            <div>Symbol</div>
            <div>Side</div>
            <div style={right}>Qty</div>
            <div>Type</div>
            <div style={right}>Price</div>
            <div>Status</div>
            <div style={center}>Action</div>
          </div>
          <div style={{ maxHeight: 200, overflowY: "auto" }}>
            {orders.map((o) => {
              let symbolDisplay: React.ReactNode;
              if (o.secType === "OPT" && o.strike !== undefined && o.expiry !== undefined && o.right !== undefined) {
                const rightLabel = o.right === "C" || o.right === "Call" ? "Call" : "Put";
                const formattedExpiry = formatExpiryYYYYMMDD(o.expiry);
                symbolDisplay = (
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 11 }}>
                      {o.symbol} {o.strike % 1 === 0 ? o.strike.toFixed(0) : o.strike} {rightLabel}
                    </div>
                    <div style={{ fontSize: 9, color: "#666" }}>
                      {formattedExpiry}
                    </div>
                  </div>
                );
              } else {
                symbolDisplay = <div style={{ fontWeight: 600 }}>{o.symbol}</div>;
              }

              return (
                <div key={o.orderId} style={{ ...rowStyle, gridTemplateColumns: "70px 130px 46px 50px 46px 80px 80px 65px", gap: 8 }}>
                  <div style={timeCell}>
                    {new Date(o.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </div>
                  <div>{symbolDisplay}</div>
                  <div style={{ ...centerBold, color: o.side === "BUY" ? "#166534" : "#991b1b" }}>
                    {o.side}
                  </div>
                  <div style={{ ...right, fontWeight: 600 }}>{o.quantity}</div>
                  <div style={{ fontSize: 11 }}>{o.orderType}</div>
                  <div style={rightMonoBold}>
                    {o.lmtPrice !== undefined ? `$${o.lmtPrice.toFixed(2)}` : "—"}
                  </div>
                  <div style={{ fontSize: 10, color: "#666" }}>{o.status}</div>
                  <div style={{ display: "flex", justifyContent: "center", gap: 4 }}>
                    {o.orderType !== "MKT" && (
                      <button
                        onClick={() => onModify(o)}
                        style={{
                          padding: "2px 8px",
                          border: "1px solid #2563eb",
                          borderRadius: "4px",
                          background: "#eff6ff",
                          color: "#2563eb",
                          fontSize: "10px",
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >
                        Mod
                      </button>
                    )}
                    <button
                      onClick={() => onCancel(o)}
                      style={{
                        padding: "2px 8px",
                        border: "1px solid #dc2626",
                        borderRadius: "4px",
                        background: "#fef2f2",
                        color: "#dc2626",
                        fontSize: "10px",
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      Cxl
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
