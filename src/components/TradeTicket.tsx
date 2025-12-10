// src/components/TradeTicket.tsx
import { useState } from "react";
import { socketHub } from "../ws/SocketHub";

type Props = {
  symbol: string;
  account: string;
  defaultSide?: "BUY" | "SELL";
  onClose: () => void;
};

export default function TradeTicket({ symbol, account, defaultSide = "BUY", onClose }: Props) {
  const [side, setSide] = useState<"BUY" | "SELL">(defaultSide);
  const [quantity, setQuantity] = useState("");
  const [orderType, setOrderType] = useState<"MKT" | "LMT" | "STP" | "STPLMT">("LMT");
  const [limitPrice, setLimitPrice] = useState("");
  const [stopPrice, setStopPrice] = useState("");

  const sendOrder = () => {
    if (!quantity || Number(quantity) <= 0) return;

    const order = {
      type: "control",
      target: "ibOrder",
      op: "place_order",
      data: {
        account,
        symbol,
        secType: "STK", // change to OPT later when you add options
        side,
        quantity: Number(quantity),
        orderType,
        lmtPrice: ["LMT", "STPLMT"].includes(orderType) ? Number(limitPrice) || null : null,
        auxPrice: ["STP", "STPLMT"].includes(orderType) ? Number(stopPrice) || null : null,
      },
    };

    socketHub.send(order);
    onClose();
  };

  return (
    <div style={{
      width: 340,
      background: "white",
      borderRadius: 12,
      boxShadow: "0 20px 40px rgba(0,0,0,0.15)",
      border: "1px solid #e5e7eb solid",
      fontFamily: "system-ui, sans-serif",
    }}>
      <div style={{ padding: "12px 16px", borderBottom: "1px #e5e7eb solid", fontWeight: 600, fontSize: 15 }}>
        Trade {symbol}
        <button
          onClick={onClose}
          style={{ float: "right", background: "none", border: "none", fontSize: 20, cursor: "pointer" }}
        >
          ×
        </button>
      </div>

      <div style={{ padding: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
          <button
            onClick={() => setSide("BUY")}
            style={{
              padding: "10px",
              borderRadius: 8,
              border: "none",
              fontWeight: 600,
              background: side === "BUY" ? "#16a34a" : "#f0fdf4",
              color: side === "BUY" ? "white" : "#166534",
              cursor: "pointer",
            }}
          >
            BUY
          </button>
          <button
            onClick={() => setSide("SELL")}
            style={{
              padding: "10px",
              borderRadius: 8,
              border: "none",
              fontWeight: 600,
              background: side === "SELL" ? "#dc2626" : "#fef2f2",
              color: side === "SELL" ? "white" : "#991b1b",
              cursor: "pointer",
            }}
          >
            SELL
          </button>
        </div>

        <input
          type="text"
          placeholder="Quantity"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value.replace(/[^\d]/g, ""))}
          style={inputStyle}
        />

        <select value={orderType} onChange={(e) => setOrderType(e.target.value as any)} style={inputStyle}>
          <option value="MKT">Market</option>
          <option value="LMT">Limit</option>
          <option value="STP">Stop</option>
          <option value="STPLMT">Stop Limit</option>
        </select>

        {(orderType === "LMT" || orderType === "STPLMT") && (
          <input
            type="text"
            placeholder="Limit Price"
            value={limitPrice}
            onChange={(e) => setLimitPrice(e.target.value)}
            style={inputStyle}
          />
        )}

        {(orderType === "STP" || orderType === "STPLMT") && (
          <input
            type="text"
            placeholder="Stop Price"
            value={stopPrice}
            onChange={(e) => setStopPrice(e.target.value)}
            style={inputStyle}
          />
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button
            onClick={sendOrder}
            style={{
              flex: 1,
              padding: "12px",
              borderRadius: 8,
              border: "none",
              background: side === "BUY" ? "#16a34a" : "#dc2626",
              color: "white",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Submit {side}
          </button>
          <button
            onClick={onClose}
            style={{
              padding: "12px 20px",
              borderRadius: 8,
              border: "1px #e5e7eb solid",
              background: "white",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

const inputStyle = {
  width: "100%",
  padding: "10px 12px",
  marginBottom: 10,
  borderRadius: 8,
  border: "1px solid #d1d5db",
  fontSize: 14,
};