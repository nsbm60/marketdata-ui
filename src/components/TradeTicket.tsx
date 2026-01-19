// src/components/TradeTicket.tsx
import { useState } from "react";
import { socketHub } from "../ws/SocketHub";
import { useMarketPrice } from "../hooks/useMarketData";
import Select from "./shared/Select";
import Button from "./shared/Button";
import { light, semantic, pnl } from "../theme";

type Props = {
  symbol: string;
  account: string;
  defaultSide?: "BUY" | "SELL";
  last?: number;
  bid?: number;
  ask?: number;
  onClose: () => void;
};

export default function TradeTicket({ symbol, account, defaultSide = "BUY", last: initialLast, bid: initialBid, ask: initialAsk, onClose }: Props) {
  const [side, setSide] = useState<"BUY" | "SELL">(defaultSide);
  const [quantity, setQuantity] = useState("100");
  const [orderType, setOrderType] = useState<"MKT" | "LMT" | "STP" | "STPLMT">("LMT");
  const [limitPrice, setLimitPrice] = useState("");
  const [stopPrice, setStopPrice] = useState("");
  const [session, setSession] = useState<"REGULAR" | "PREMARKET" | "AFTERHOURS">("REGULAR");
  const [useAdaptive, setUseAdaptive] = useState(true);
  const [algoPriority, setAlgoPriority] = useState<"Patient" | "Normal" | "Urgent">("Normal");

  // Use MarketDataBus for price updates (proper reference counting)
  const priceData = useMarketPrice(symbol, "equity");

  // Derive display values from live data or fall back to initial props
  const last = priceData?.last?.toFixed(4) ?? (initialLast !== undefined ? initialLast.toFixed(4) : "—");
  const bid = priceData?.bid?.toFixed(4) ?? (initialBid !== undefined ? initialBid.toFixed(4) : "—");
  const ask = priceData?.ask?.toFixed(4) ?? (initialAsk !== undefined ? initialAsk.toFixed(4) : "—");
  const mid = (priceData?.bid !== undefined && priceData?.ask !== undefined)
    ? ((priceData.bid + priceData.ask) / 2).toFixed(4)
    : (initialBid !== undefined && initialAsk !== undefined)
      ? ((initialBid + initialAsk) / 2).toFixed(4)
      : "—";

  const sendOrder = () => {
    if (!quantity || Number(quantity) <= 0) return;

    // Build data object with only the fields we need
    const data: any = {
      account,
      symbol,
      secType: "STK",
      side,
      quantity: Number(quantity),
      orderType,
      session, // Add session selection
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

    // Add adaptive algo if enabled (only for limit orders)
    if (useAdaptive && orderType !== "MKT") {
      data.algoStrategy = "Adaptive";
      data.algoPriority = algoPriority;
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
      width: 340,
      background: light.bg.primary,
      borderRadius: 12,
      boxShadow: "0 20px 40px rgba(0,0,0,0.15)",
      border: `1px solid ${light.border.primary}`,
      fontFamily: "system-ui, sans-serif",
    }}>
      <div style={{
        padding: "12px 16px",
        borderBottom: `1px solid ${light.border.primary}`,
        fontWeight: 600,
        fontSize: 15,
        display: "flex",
        justifyContent: "space-between",
      }}>
        <span>Trade {symbol}</span>
        <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer" }}>×</button>
      </div>

      {/* LIVE PRICES - click bid/mid/ask to populate limit price */}
      <div style={{
        padding: "10px 16px",
        background: semantic.success.bg,
        borderBottom: `1px solid ${semantic.success.bgMuted}`,
        fontSize: 13,
        display: "grid",
        gridTemplateColumns: "1fr 1fr 1fr 1fr",
        textAlign: "center",
      }}>
        <div><strong>Last</strong><br />{last}</div>
        <div
          onClick={() => bid !== "—" && setLimitPrice(bid)}
          style={{ cursor: bid !== "—" ? "pointer" : "default" }}
          title="Click to use as limit price"
        ><strong>Bid</strong><br />{bid}</div>
        <div
          onClick={() => mid !== "—" && setLimitPrice(mid)}
          style={{ cursor: mid !== "—" ? "pointer" : "default" }}
          title="Click to use as limit price"
        ><strong>Mid</strong><br />{mid}</div>
        <div
          onClick={() => ask !== "—" && setLimitPrice(ask)}
          style={{ cursor: ask !== "—" ? "pointer" : "default" }}
          title="Click to use as limit price"
        ><strong>Ask</strong><br />{ask}</div>
      </div>

      <div style={{ padding: 16 }}>
        {/* Side */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
          <button onClick={() => setSide("BUY")} style={{
            padding: 10,
            borderRadius: 8,
            border: "none",
            fontWeight: 600,
            background: side === "BUY" ? pnl.positive : semantic.success.bg,
            color: side === "BUY" ? light.bg.primary : semantic.success.textDark,
          }}>BUY</button>
          <button onClick={() => setSide("SELL")} style={{
            padding: 10,
            borderRadius: 8,
            border: "none",
            fontWeight: 600,
            background: side === "SELL" ? pnl.negative : semantic.error.bg,
            color: side === "SELL" ? light.bg.primary : semantic.error.textDark,
          }}>SELL</button>
        </div>

        <input placeholder="Quantity" value={quantity} onChange={e => setQuantity(e.target.value.replace(/[^\d]/g, ""))} style={{ width: "100%", padding: 10, marginBottom: 10, borderRadius: 8, border: `1px solid ${light.border.lighter}` }} />
        <Select value={orderType} onChange={e => setOrderType(e.target.value as any)} size="form" style={{ marginBottom: 10 }}>
          <option value="MKT">Market</option>
          <option value="LMT">Limit</option>
          <option value="STP">Stop</option>
          <option value="STPLMT">Stop Limit</option>
        </Select>

        <Select value={session} onChange={e => setSession(e.target.value as any)} size="form" style={{ marginBottom: 10 }}>
          <option value="REGULAR">Regular Hours (9:30 AM - 4:00 PM ET)</option>
          <option value="PREMARKET">Pre-Market (4:00 AM - 9:30 AM ET)</option>
          <option value="AFTERHOURS">After-Hours (4:00 PM - 8:00 PM ET)</option>
        </Select>

        {/* Adaptive Algo - only show for non-market orders */}
        {orderType !== "MKT" && (
          <div style={{
            marginBottom: 10,
            padding: "8px 10px",
            background: light.bg.secondary,
            borderRadius: 8,
            border: `1px solid ${light.border.secondary}`
          }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={useAdaptive}
                onChange={e => setUseAdaptive(e.target.checked)}
                style={{ width: 16, height: 16 }}
              />
              <span style={{ fontSize: 13, fontWeight: 500 }}>Use Adaptive Algo</span>
            </label>
            {useAdaptive && (
              <Select
                value={algoPriority}
                onChange={e => setAlgoPriority(e.target.value as any)}
                size="sm"
                style={{ marginTop: 8, width: "100%" }}
              >
                <option value="Patient">Patient - Max price improvement</option>
                <option value="Normal">Normal - Balanced</option>
                <option value="Urgent">Urgent - Fast fill</option>
              </Select>
            )}
          </div>
        )}

        {(orderType === "LMT" || orderType === "STPLMT") && (
          <input placeholder="Limit Price" value={limitPrice} onChange={e => setLimitPrice(e.target.value)} style={{ width: "100%", padding: 10, marginBottom: 10, borderRadius: 8, border: `1px solid ${light.border.lighter}` }} />
        )}

        {(orderType === "STP" || orderType === "STPLMT") && (
          <input placeholder="Stop Price" value={stopPrice} onChange={e => setStopPrice(e.target.value)} style={{ width: "100%", padding: 10, marginBottom: 10, borderRadius: 8, border: `1px solid ${light.border.lighter}` }} />
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <Button
            onClick={sendOrder}
            size="form"
            style={{
              flex: 1,
              background: side === "BUY" ? pnl.positive : pnl.negative,
              color: light.bg.primary,
              border: "none",
              fontWeight: 600,
            }}
          >
            Submit {side}
          </Button>
          <Button onClick={onClose} variant="secondary" size="form">
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}