// src/components/OptionTradeTicket.tsx
import { useEffect, useState, useRef } from "react";
import { socketHub } from "../ws/SocketHub";
import { formatExpiryWithWeekday } from "../utils/options";

const THROTTLE_MS = 200; // 5 updates/sec for trade tickets

type Props = {
  underlying: string;
  strike: number;
  expiry: string; // YYYY-MM-DD format
  right: "C" | "P"; // Call or Put
  account: string;
  defaultSide?: "BUY" | "SELL";
  
  // Current market data (optional)
  last?: number;
  bid?: number;
  ask?: number;
  mid?: number;
  
  // Greeks (optional)
  delta?: number;
  gamma?: number;
  theta?: number;
  vega?: number;
  iv?: number;
  
  onClose: () => void;
};

export default function OptionTradeTicket({
  underlying,
  strike,
  expiry,
  right,
  account,
  defaultSide = "BUY",
  last,
  bid,
  ask,
  mid,
  delta,
  gamma,
  theta,
  vega,
  iv,
  onClose,
}: Props) {
  const [side, setSide] = useState<"BUY" | "SELL">(defaultSide);
  const [quantity, setQuantity] = useState("");
  const [orderType, setOrderType] = useState<"MKT" | "LMT" | "STP" | "STPLMT">("LMT");
  const [limitPrice, setLimitPrice] = useState("");
  const [stopPrice, setStopPrice] = useState("");

  // Live market data updates (prices)
  const [liveLast, setLiveLast] = useState(last?.toFixed(4) || "—");
  const [liveBid, setLiveBid] = useState(bid?.toFixed(4) || "—");
  const [liveAsk, setLiveAsk] = useState(ask?.toFixed(4) || "—");
  const [liveMid, setLiveMid] = useState(mid?.toFixed(4) || "—");

  // Live Greeks updates
  const [liveDelta, setLiveDelta] = useState(delta?.toFixed(4) || "—");
  const [liveGamma, setLiveGamma] = useState(gamma?.toFixed(4) || "—");
  const [liveTheta, setLiveTheta] = useState(theta?.toFixed(4) || "—");
  const [liveVega, setLiveVega] = useState(vega?.toFixed(4) || "—");
  const [liveIv, setLiveIv] = useState(iv?.toFixed(4) || "—");

  // Format expiry nicely
  const formattedExpiry = formatExpiryWithWeekday(expiry);
  const rightLabel = right === "C" ? "Call" : "Put";

  // Throttling refs
  interface PendingUpdates {
    last?: string; bid?: string; ask?: string; mid?: string;
    delta?: string; gamma?: string; theta?: string; vega?: string; iv?: string;
  }
  const pendingRef = useRef<PendingUpdates>({});
  const lastFlushRef = useRef<number>(0);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // Build the expected option symbol for this specific contract
    // OSI format: UNDERLYING + YYMMDD + C/P + STRIKE (8 digits, strike * 1000)
    const yy = expiry.substring(2, 4);
    const mm = expiry.substring(5, 7);
    const dd = expiry.substring(8, 10);
    const strikeFormatted = String(Math.round(strike * 1000)).padStart(8, "0");
    const expectedSymbol = `${underlying.toUpperCase()}${yy}${mm}${dd}${right}${strikeFormatted}`;

    const flushUpdates = () => {
      const p = pendingRef.current;
      if (p.last !== undefined) setLiveLast(p.last);
      if (p.bid !== undefined) setLiveBid(p.bid);
      if (p.ask !== undefined) setLiveAsk(p.ask);
      if (p.mid !== undefined) setLiveMid(p.mid);
      if (p.delta !== undefined) setLiveDelta(p.delta);
      if (p.gamma !== undefined) setLiveGamma(p.gamma);
      if (p.theta !== undefined) setLiveTheta(p.theta);
      if (p.vega !== undefined) setLiveVega(p.vega);
      if (p.iv !== undefined) setLiveIv(p.iv);
      pendingRef.current = {};
      lastFlushRef.current = Date.now();
      timeoutRef.current = null;
    };

    const handler = (m: any) => {
      const topic = m?.topic;
      if (!topic || typeof topic !== "string") return;
      if (!topic.startsWith("md.option.")) return;

      const parts = topic.split(".");
      const topicSymbol = parts.length >= 4 ? parts.slice(3).join(".").toUpperCase() : "";
      if (topicSymbol !== expectedSymbol) return;

      const d = m.data?.data || m.data || {};

      // Accumulate price updates
      if (d.lastPrice !== undefined) pendingRef.current.last = Number(d.lastPrice).toFixed(4);
      else if (d.last !== undefined) pendingRef.current.last = Number(d.last).toFixed(4);
      else if (d.price !== undefined) pendingRef.current.last = Number(d.price).toFixed(4);

      if (d.bidPrice !== undefined) pendingRef.current.bid = Number(d.bidPrice).toFixed(4);
      else if (d.bid !== undefined) pendingRef.current.bid = Number(d.bid).toFixed(4);

      if (d.askPrice !== undefined) pendingRef.current.ask = Number(d.askPrice).toFixed(4);
      else if (d.ask !== undefined) pendingRef.current.ask = Number(d.ask).toFixed(4);

      // Calculate mid
      const b = d.bidPrice ?? d.bid;
      const a = d.askPrice ?? d.ask;
      if (b !== undefined && a !== undefined) {
        pendingRef.current.mid = ((Number(b) + Number(a)) / 2).toFixed(4);
      }

      // Accumulate Greeks
      const dl = d.delta ?? d.d;
      if (dl !== undefined && dl !== null) pendingRef.current.delta = Number(dl).toFixed(4);

      const gm = d.gamma ?? d.g;
      if (gm !== undefined && gm !== null) pendingRef.current.gamma = Number(gm).toFixed(4);

      const th = d.theta ?? d.th;
      if (th !== undefined && th !== null) pendingRef.current.theta = Number(th).toFixed(4);

      const vg = d.vega;
      if (vg !== undefined && vg !== null) pendingRef.current.vega = Number(vg).toFixed(4);

      const ivVal = d.iv ?? d.impliedVolatility ?? d.impliedVol;
      if (ivVal !== undefined && ivVal !== null) pendingRef.current.iv = Number(ivVal).toFixed(4);

      // Throttle: flush if enough time passed, otherwise schedule
      const now = Date.now();
      const elapsed = now - lastFlushRef.current;
      if (elapsed >= THROTTLE_MS) {
        flushUpdates();
      } else if (!timeoutRef.current) {
        timeoutRef.current = setTimeout(flushUpdates, THROTTLE_MS - elapsed);
      }
    };

    socketHub.onMessage(handler);
    return () => {
      socketHub.offMessage(handler);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [underlying, strike, expiry, right]);

  const sendOrder = () => {
    if (!quantity || Number(quantity) <= 0) return;

    // Build data object with only the fields we need
    const data: any = {
      account,
      symbol: underlying,
      secType: "OPT",
      side,
      quantity: Number(quantity),
      orderType,
      strike,
      expiry: expiry.replace(/-/g, ""), // Convert YYYY-MM-DD to YYYYMMDD
      right,
      currency: "USD",
      exchange: "SMART",
    };

    // Only add price fields if they're required and valid for this order type
    if ((orderType === "LMT" || orderType === "STPLMT") && limitPrice) {
      const lmt = Number(limitPrice);
      if (!isNaN(lmt) && lmt > 0) {
        data.lmtPrice = lmt;
      }
    }

    if ((orderType === "STP" || orderType === "STPLMT") && stopPrice) {
      const aux = Number(stopPrice);
      if (!isNaN(aux) && aux > 0) {
        data.auxPrice = aux;
      }
    }

    socketHub.send({
      type: "control",
      target: "ibAccount",
      op: "place_order",
      data,
    });

    onClose();
  };

  return (
    <div style={{
      width: 380,
      background: "white",
      borderRadius: 12,
      boxShadow: "0 20px 40px rgba(0,0,0,0.15)",
      border: "1px solid #e5e7eb",
      fontFamily: "system-ui, sans-serif",
    }}>
      {/* Header */}
      <div style={{
        padding: "12px 16px",
        borderBottom: "1px solid #e5e7eb",
        fontWeight: 600,
        fontSize: 15,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
      }}>
        <span>Trade Option</span>
        <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer" }}>×</button>
      </div>

      {/* Option Details */}
      <div style={{
        padding: "12px 16px",
        background: "#f8fafc",
        borderBottom: "1px solid #e5e7eb",
      }}>
        <div style={{ fontSize: 13, marginBottom: 6 }}>
          <strong>{underlying}</strong> ${strike.toFixed(2)} {rightLabel}
        </div>
        <div style={{ fontSize: 12, color: "#666" }}>
          Expires: {formattedExpiry}
        </div>
      </div>

      {/* Live Prices */}
      <div style={{
        padding: "10px 16px",
        background: "#f0fdf4",
        borderBottom: "1px solid #bbf7d0",
        fontSize: 12,
        display: "grid",
        gridTemplateColumns: "1fr 1fr 1fr 1fr",
        gap: 8,
        textAlign: "center",
      }}>
        <div><strong>Last</strong><br />{liveLast}</div>
        <div><strong>Bid</strong><br />{liveBid}</div>
        <div><strong>Mid</strong><br />{liveMid}</div>
        <div><strong>Ask</strong><br />{liveAsk}</div>
      </div>

      {/* Greeks (always shown, updates live) */}
      <div style={{
        padding: "10px 16px",
        background: "#fef3c7",
        borderBottom: "1px solid #fde68a",
        fontSize: 11,
        display: "grid",
        gridTemplateColumns: "repeat(5, 1fr)",
        gap: 8,
        textAlign: "center",
      }}>
        <div><strong>Δ</strong><br />{liveDelta}</div>
        <div><strong>Γ</strong><br />{liveGamma}</div>
        <div><strong>Θ</strong><br />{liveTheta}</div>
        <div><strong>Vega</strong><br />{liveVega}</div>
        <div><strong>IV</strong><br />{liveIv}</div>
      </div>

      {/* Order Form */}
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

        <input 
          placeholder="Quantity (contracts)" 
          value={quantity} 
          onChange={e => setQuantity(e.target.value.replace(/[^\d]/g, ""))} 
          style={{ width: "100%", padding: 10, marginBottom: 10, borderRadius: 8, border: "1px solid #ccc" }} 
        />

        <select 
          value={orderType} 
          onChange={e => setOrderType(e.target.value as any)} 
          style={{ width: "100%", padding: 10, marginBottom: 10, borderRadius: 8, border: "1px solid #ccc" }}
        >
          <option value="MKT">Market</option>
          <option value="LMT">Limit</option>
          <option value="STP">Stop</option>
          <option value="STPLMT">Stop Limit</option>
        </select>

        {(orderType === "LMT" || orderType === "STPLMT") && (
          <input 
            placeholder="Limit Price" 
            value={limitPrice} 
            onChange={e => setLimitPrice(e.target.value)} 
            style={{ width: "100%", padding: 10, marginBottom: 10, borderRadius: 8, border: "1px solid #ccc" }} 
          />
        )}

        {(orderType === "STP" || orderType === "STPLMT") && (
          <input 
            placeholder="Stop Price" 
            value={stopPrice} 
            onChange={e => setStopPrice(e.target.value)} 
            style={{ width: "100%", padding: 10, marginBottom: 10, borderRadius: 8, border: "1px solid #ccc" }} 
          />
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button 
            onClick={sendOrder} 
            style={{ 
              flex: 1, 
              padding: 12, 
              background: side === "BUY" ? "#16a34a" : "#dc2626", 
              color: "white", 
              border: "none", 
              borderRadius: 8, 
              fontWeight: 600 
            }}
          >
            Submit {side}
          </button>
          <button 
            onClick={onClose} 
            style={{ 
              padding: 12, 
              border: "1px solid #ccc", 
              background: "white", 
              borderRadius: 8,
              color: "#111"
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}