// src/components/TradeTicket.tsx
import { useEffect, useState } from "react";
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
  const [orderType, setOrderType] = useState<"MKT" | "LMT" | "STP" | "STPLMT">("LMT");  const [limitPrice, setLimitPrice] = useState("");
  const [stopPrice, setStopPrice] = useState("");

  const [last, setLast] = useState("—");
  const [bid, setBid] = useState("—");
  const [ask, setAsk] = useState("—");

  useEffect(() => {
    const handler = (m: any) => {
      // Accept ANY topic that contains the symbol — quote, trade, whatever
      const topic = m?.topic;
      if (!topic || typeof topic !== "string") return;
      if (!topic.toUpperCase().includes(symbol.toUpperCase())) return;

      const d = m.data?.data || m.data || {};

      // Last can come from many possible fields
      if (d.lastPrice !== undefined) setLast(d.lastPrice.toFixed(4));
      else if (d.last !== undefined) setLast(d.last.toFixed(4));
      else if (d.price !== undefined) setLast(d.price.toFixed(4));
      else if (d.p !== undefined) setLast(d.p.toFixed(4));

      // Bid/Ask — already working
      if (d.bidPrice !== undefined) setBid(d.bidPrice.toFixed(4));
      if (d.askPrice !== undefined) setAsk(d.askPrice.toFixed(4));
    };

    socketHub.onMessage(handler);
    return () => socketHub.offMessage(handler);
  }, [symbol]);

  const sendOrder = () => {
    if (!quantity || Number(quantity) <= 0) return;

    socketHub.send({
      type: "control",
      target: "ibOrder",
      op: "place_order",
      data: {
        account,
        symbol,
        secType: "STK",
        side,
        quantity: Number(quantity),
        orderType,
        lmtPrice: ["LMT", "STPLMT"].includes(orderType) ? Number(limitPrice) || null : null,
        auxPrice: ["STP", "STPLMT"].includes(orderType) ? Number(stopPrice) || null : null,
      },
    });

    onClose();
  };

  return (
    <div style={{
      width: 340,
      background: "white",
      borderRadius: 12,
      boxShadow: "0 20px 40px rgba(0,0,0,0.15)",
      border: "1px solid #e5e7eb",
      fontFamily: "system-ui, sans-serif",
    }}>
      <div style={{
        padding: "12px 16px",
        borderBottom: "1px solid #e5e7eb",
        fontWeight: 600,
        fontSize: 15,
        display: "flex",
        justifyContent: "space-between",
      }}>
        <span>Trade {symbol}</span>
        <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer" }}>×</button>
      </div>

      {/* LIVE PRICES */}
      <div style={{
        padding: "10px 16px",
        background: "#f0fdf4",
        borderBottom: "1px solid #bbf7d0",
        fontSize: 13,
        display: "grid",
        gridTemplateColumns: "1fr 1fr 1fr",
        textAlign: "center",
      }}>
        <div><strong>Last</strong><br />{last}</div>
        <div><strong>Bid</strong><br />{bid}</div>
        <div><strong>Ask</strong><br />{ask}</div>
      </div>

      <div style={{ padding: 16 }}>
        {/* Side */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
          <button onClick={() => setSide("BUY")} style={{
            padding: 10,
            borderRadius: 8,
            border: "none",
            fontWeight: 600,
            background: side === "BUY" ? "#16a34a" : "#f0fdf4",
            color: side === "BUY" ? "white" : "#166534",
          }}>BUY</button>
          <button onClick={() => setSide("SELL")} style={{
            padding: 10,
            borderRadius: 8,
            border: "none",
            fontWeight: 600,
            background: side === "SELL" ? "#dc2626" : "#fef2f2",
            color: side === "SELL" ? "white" : "#991b1b",
          }}>SELL</button>
        </div>

        <input placeholder="Quantity" value={quantity} onChange={e => setQuantity(e.target.value.replace(/[^\d]/g, ""))} style={{ width: "100%", padding: 10, marginBottom: 10, borderRadius: 8, border: "1px solid #ccc" }} />
        <select value={orderType} onChange={e => setOrderType(e.target.value as any)} style={{ width: "100%", padding: 10, marginBottom: 10, borderRadius: 8, border: "1px solid #ccc" }}>
          <option value="MKT">Market</option>
          <option value="LMT">Limit</option>
          <option value="STP">Stop</option>
          <option value="STPLMT">Stop Limit</option>
        </select>

        {(orderType === "LMT" || orderType === "STPLMT") && (
          <input placeholder="Limit Price" value={limitPrice} onChange={e => setLimitPrice(e.target.value)} style={{ width: "100%", padding: 10, marginBottom: 10, borderRadius: 8, border: "1px solid #ccc" }} />
        )}

        {(orderType === "STP" || orderType === "STPLMT") && (
          <input placeholder="Stop Price" value={stopPrice} onChange={e => setStopPrice(e.target.value)} style={{ width: "100%", padding: 10, marginBottom: 10, borderRadius: 8, border: "1px solid #ccc" }} />
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button onClick={sendOrder} style={{ flex: 1, padding: 12, background: side === "BUY" ? "#16a34a" : "#dc2626", color: "white", border: "none", borderRadius: 8, fontWeight: 600 }}>
            Submit {side}
          </button>
          <button onClick={onClose} style={{ padding: 12, border: "1px solid #ccc", background: "white", borderRadius: 8 }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}