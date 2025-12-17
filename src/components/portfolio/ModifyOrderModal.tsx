// src/components/portfolio/ModifyOrderModal.tsx
import { useState } from "react";
import { IbOpenOrder } from "../../types/portfolio";
import { socketHub } from "../../ws/SocketHub";
import { modalOverlay, modalContent } from "./styles";

type Props = {
  order: IbOpenOrder;
  onClose: () => void;
};

export default function ModifyOrderModal({ order, onClose }: Props) {
  const [quantity, setQuantity] = useState(order.quantity);
  const [price, setPrice] = useState(order.lmtPrice?.toString() ?? "");

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

    socketHub.send(payload);
    onClose();
  };

  return (
    <div style={modalOverlay} onClick={onClose}>
      <div style={modalContent} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>
          Modify Order #{order.orderId}
        </div>
        <div style={{ fontSize: 13, color: "#666", marginBottom: 12 }}>
          {order.symbol} {order.side} {order.orderType}
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={{ display: "block", fontSize: 12, fontWeight: 500, marginBottom: 4 }}>
            Quantity
          </label>
          <input
            type="number"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            style={{
              width: "100%",
              padding: "8px 12px",
              border: "1px solid #d1d5db",
              borderRadius: 6,
              fontSize: 14,
            }}
          />
        </div>

        {(order.orderType === "LMT" || order.orderType === "STPLMT") && (
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 500, marginBottom: 4 }}>
              Limit Price
            </label>
            <input
              type="number"
              step="0.01"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              style={{
                width: "100%",
                padding: "8px 12px",
                border: "1px solid #d1d5db",
                borderRadius: 6,
                fontSize: 14,
              }}
            />
          </div>
        )}

        <div style={{ display: "flex", gap: 12, marginTop: 20 }}>
          <button
            onClick={onClose}
            style={{
              flex: 1,
              padding: "10px 16px",
              border: "1px solid #d1d5db",
              borderRadius: 6,
              background: "white",
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleModify}
            style={{
              flex: 1,
              padding: "10px 16px",
              border: "none",
              borderRadius: 6,
              background: "#2563eb",
              color: "white",
              fontSize: 14,
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
