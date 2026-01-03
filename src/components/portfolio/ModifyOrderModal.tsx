// src/components/portfolio/ModifyOrderModal.tsx
import { useState, useEffect, useRef } from "react";
import { IbOpenOrder } from "../../types/portfolio";
import { socketHub } from "../../ws/SocketHub";
import { modalOverlay, modalContent } from "./styles";
import { buildTopicSymbol } from "../../utils/options";
import Select from "../shared/Select";

const THROTTLE_MS = 200;

type Props = {
  order: IbOpenOrder;
  onClose: () => void;
};

export default function ModifyOrderModal({ order, onClose }: Props) {
  const [quantity, setQuantity] = useState(order.quantity);
  const [price, setPrice] = useState(order.lmtPrice?.toString() ?? "");

  // Live market data
  const [last, setLast] = useState("—");
  const [bid, setBid] = useState("—");
  const [ask, setAsk] = useState("—");
  const [mid, setMid] = useState("—");

  // Greeks for options
  const [delta, setDelta] = useState("—");
  const [gamma, setGamma] = useState("—");
  const [theta, setTheta] = useState("—");
  const [vega, setVega] = useState("—");
  const [iv, setIv] = useState("—");

  // Adaptive algo - initialize from order's current settings
  // Note: IB returns "none" for algoStrategy even for Adaptive orders, so this may not be reliable
  const [useAdaptive, setUseAdaptive] = useState(order.algoStrategy === "Adaptive");
  const [algoPriority, setAlgoPriority] = useState<"Patient" | "Normal" | "Urgent">(
    (order.algoPriority as "Patient" | "Normal" | "Urgent") || "Normal"
  );

  // Throttling refs
  interface PendingUpdates {
    last?: string; bid?: string; ask?: string; mid?: string;
    delta?: string; gamma?: string; theta?: string; vega?: string; iv?: string;
  }
  const pendingRef = useRef<PendingUpdates>({});
  const lastFlushRef = useRef<number>(0);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const isOption = order.secType === "OPT";

  // Build the symbol for market data lookup (hierarchical format for topic matching)
  const marketSymbol = (() => {
    if (isOption && order.strike && order.expiry && order.right) {
      // Convert YYYYMMDD to YYYY-MM-DD for buildTopicSymbol
      const expiry = order.expiry;
      const expiryIso = expiry.length === 8
        ? `${expiry.substring(0, 4)}-${expiry.substring(4, 6)}-${expiry.substring(6, 8)}`
        : expiry;
      return buildTopicSymbol(order.symbol, expiryIso, order.right, order.strike);
    }
    return order.symbol.toUpperCase();
  })();

  useEffect(() => {
    // Subscribe to market data
    if (isOption) {
      socketHub.send({
        type: "subscribe",
        channels: ["md.option.quote", "md.option.trade", "md.option.greeks"],
        symbols: [marketSymbol],
      });
    } else {
      socketHub.send({
        type: "subscribe",
        channels: ["md.equity.quote", "md.equity.trade"],
        symbols: [marketSymbol],
      });
    }

    const flushUpdates = () => {
      const p = pendingRef.current;
      if (p.last !== undefined) setLast(p.last);
      if (p.bid !== undefined) setBid(p.bid);
      if (p.ask !== undefined) setAsk(p.ask);
      if (p.mid !== undefined) setMid(p.mid);
      if (p.delta !== undefined) setDelta(p.delta);
      if (p.gamma !== undefined) setGamma(p.gamma);
      if (p.theta !== undefined) setTheta(p.theta);
      if (p.vega !== undefined) setVega(p.vega);
      if (p.iv !== undefined) setIv(p.iv);
      pendingRef.current = {};
      lastFlushRef.current = Date.now();
      timeoutRef.current = null;
    };

    const handler = (m: any) => {
      const topic = m?.topic;
      if (!topic || typeof topic !== "string") return;

      // Check if this message is for our symbol
      const expectedPrefix = isOption ? "md.option." : "md.equity.";
      if (!topic.startsWith(expectedPrefix)) return;

      const parts = topic.split(".");
      const topicSymbol = parts.length >= 4 ? parts.slice(3).join(".").toUpperCase() : "";
      if (topicSymbol !== marketSymbol) return;

      const d = m.data?.data || m.data || {};

      // Price updates
      const lastPrice = d.lastPrice ?? d.last ?? d.price ?? d.p ?? d.lp;
      if (lastPrice !== undefined && lastPrice !== null) {
        pendingRef.current.last = Number(lastPrice).toFixed(4);
      }

      const bidPrice = d.bidPrice ?? d.bp ?? d.bid;
      if (bidPrice !== undefined && bidPrice !== null) {
        pendingRef.current.bid = Number(bidPrice).toFixed(4);
      }

      const askPrice = d.askPrice ?? d.ap ?? d.ask;
      if (askPrice !== undefined && askPrice !== null) {
        pendingRef.current.ask = Number(askPrice).toFixed(4);
      }

      // Calculate mid
      if (bidPrice !== undefined && askPrice !== undefined) {
        pendingRef.current.mid = ((Number(bidPrice) + Number(askPrice)) / 2).toFixed(4);
      }

      // Greeks (options only)
      if (isOption) {
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
      }

      // Throttle flush
      const now = Date.now();
      const elapsed = now - lastFlushRef.current;
      if (elapsed >= THROTTLE_MS) {
        flushUpdates();
      } else if (!timeoutRef.current) {
        timeoutRef.current = setTimeout(flushUpdates, THROTTLE_MS - elapsed);
      }
    };

    socketHub.onMessage(handler);
    socketHub.onTick(handler);

    return () => {
      socketHub.offMessage(handler);
      socketHub.offTick(handler);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      // Unsubscribe
      if (isOption) {
        socketHub.send({
          type: "unsubscribe",
          channels: ["md.option.quote", "md.option.trade", "md.option.greeks"],
          symbols: [marketSymbol],
        });
      } else {
        socketHub.send({
          type: "unsubscribe",
          channels: ["md.equity.quote", "md.equity.trade"],
          symbols: [marketSymbol],
        });
      }
    };
  }, [marketSymbol, isOption]);

  const handleModify = () => {
    const qty = parseInt(quantity, 10);
    const lmtPrice = parseFloat(price);

    if (isNaN(qty) || qty <= 0) {
      alert("Invalid quantity");
      return;
    }
    if ((order.orderType === "LMT" || order.orderType === "STPLMT") && (isNaN(lmtPrice) || lmtPrice <= 0)) {
      alert("Invalid price");
      return;
    }

    const payload: any = {
      type: "control",
      target: "ibAccount",
      op: "modify_order",
      orderId: order.orderId,
      symbol: order.symbol,
      secType: order.secType,
      side: order.side,
      quantity: qty,
      orderType: order.orderType,
    };

    if (order.orderType === "LMT" || order.orderType === "STPLMT") {
      payload.lmtPrice = lmtPrice;
    }
    if (order.orderType === "STP" || order.orderType === "STPLMT") {
      payload.auxPrice = order.auxPrice;
    }

    // Option fields
    if (order.secType === "OPT") {
      payload.strike = order.strike;
      payload.expiry = order.expiry;
      // Normalize right to "C" or "P" for backend
      const rightVal = order.right;
      payload.right = (rightVal === "Call" || rightVal === "C") ? "C" : "P";
    }

    // Add adaptive algo if enabled (only for limit orders)
    if (useAdaptive && order.orderType !== "MKT") {
      payload.algoStrategy = "Adaptive";
      payload.algoPriority = algoPriority;
    }

    socketHub.send(payload);
    onClose();
  };

  // Format option details for display
  const optionDetails = isOption && order.strike && order.expiry && order.right
    ? `${order.strike} ${order.right === "C" || order.right === "Call" ? "Call" : "Put"} ${order.expiry}`
    : null;

  return (
    <div style={modalOverlay} onClick={onClose}>
      <div style={{ ...modalContent, width: 360 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
          Modify Order #{order.orderId}
        </div>
        <div style={{ fontSize: 13, color: "#666", marginBottom: 4 }}>
          {order.symbol} {order.side} {order.orderType}
        </div>
        {optionDetails && (
          <div style={{ fontSize: 12, color: "#888", marginBottom: 12 }}>
            {optionDetails}
          </div>
        )}

        {/* Live Prices - click bid/mid/ask to populate limit price */}
        <div style={{
          padding: "8px 12px",
          background: "#f0fdf4",
          borderRadius: 6,
          marginBottom: 12,
          fontSize: 12,
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr 1fr",
          gap: 4,
          textAlign: "center",
        }}>
          <div><strong>Last</strong><br />{last}</div>
          <div
            onClick={() => bid !== "—" && setPrice(bid)}
            style={{ cursor: bid !== "—" ? "pointer" : "default" }}
            title="Click to use as limit price"
          ><strong>Bid</strong><br />{bid}</div>
          <div
            onClick={() => mid !== "—" && setPrice(mid)}
            style={{ cursor: mid !== "—" ? "pointer" : "default" }}
            title="Click to use as limit price"
          ><strong>Mid</strong><br />{mid}</div>
          <div
            onClick={() => ask !== "—" && setPrice(ask)}
            style={{ cursor: ask !== "—" ? "pointer" : "default" }}
            title="Click to use as limit price"
          ><strong>Ask</strong><br />{ask}</div>
        </div>

        {/* Greeks for options */}
        {isOption && (
          <div style={{
            padding: "6px 12px",
            background: "#fef3c7",
            borderRadius: 6,
            marginBottom: 12,
            fontSize: 10,
            display: "grid",
            gridTemplateColumns: "repeat(5, 1fr)",
            gap: 4,
            textAlign: "center",
          }}>
            <div><strong>Δ</strong><br />{delta}</div>
            <div><strong>Γ</strong><br />{gamma}</div>
            <div><strong>Θ</strong><br />{theta}</div>
            <div><strong>Vega</strong><br />{vega}</div>
            <div><strong>IV</strong><br />{iv}</div>
          </div>
        )}

        <div style={{ marginBottom: 10 }}>
          <label style={{ display: "block", fontSize: 11, fontWeight: 500, marginBottom: 3 }}>
            Quantity
          </label>
          <input
            type="number"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            style={{
              width: "100%",
              padding: "6px 10px",
              border: "1px solid #d1d5db",
              borderRadius: 6,
              fontSize: 13,
              boxSizing: "border-box",
            }}
          />
        </div>

        {(order.orderType === "LMT" || order.orderType === "STPLMT") && (
          <div style={{ marginBottom: 10 }}>
            <label style={{ display: "block", fontSize: 11, fontWeight: 500, marginBottom: 3 }}>
              Limit Price
            </label>
            <input
              type="number"
              step="0.01"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              style={{
                width: "100%",
                padding: "6px 10px",
                border: "1px solid #d1d5db",
                borderRadius: 6,
                fontSize: 13,
                boxSizing: "border-box",
              }}
            />
          </div>
        )}

        {/* Adaptive Algo - only show for non-market orders */}
        {order.orderType !== "MKT" && (
          <div style={{
            marginBottom: 10,
            padding: "8px 10px",
            background: "#f8fafc",
            borderRadius: 6,
            border: "1px solid #e2e8f0"
          }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={useAdaptive}
                onChange={e => setUseAdaptive(e.target.checked)}
                style={{ width: 14, height: 14 }}
              />
              <span style={{ fontSize: 12, fontWeight: 500 }}>Use Adaptive Algo</span>
            </label>
            {useAdaptive && (
              <Select
                value={algoPriority}
                onChange={e => setAlgoPriority(e.target.value as any)}
                size="sm"
                style={{ marginTop: 6, width: "100%" }}
              >
                <option value="Patient">Patient - Max price improvement</option>
                <option value="Normal">Normal - Balanced</option>
                <option value="Urgent">Urgent - Fast fill</option>
              </Select>
            )}
          </div>
        )}

        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          <button
            onClick={onClose}
            style={{
              flex: 1,
              padding: "8px 12px",
              border: "1px solid #d1d5db",
              borderRadius: 6,
              background: "white",
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleModify}
            style={{
              flex: 1,
              padding: "8px 12px",
              border: "none",
              borderRadius: 6,
              background: "#2563eb",
              color: "white",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Modify Order
          </button>
        </div>
      </div>
    </div>
  );
}
