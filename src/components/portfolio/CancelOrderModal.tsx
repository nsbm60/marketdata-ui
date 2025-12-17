// src/components/portfolio/CancelOrderModal.tsx
import { IbOpenOrder } from "../../types/portfolio";
import { socketHub } from "../../ws/SocketHub";
import { modalOverlay, modalContent } from "./styles";

type Props = {
  order: IbOpenOrder;
  onClose: () => void;
};

export default function CancelOrderModal({ order, onClose }: Props) {
  const handleCancel = () => {
    socketHub.send({
      type: "control",
      target: "ibAccount",
      op: "cancel_order",
      orderId: order.orderId,
    });
    onClose();
  };

  return (
    <div style={modalOverlay} onClick={onClose}>
      <div
        style={{ ...modalContent, minWidth: 340 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 16, color: "#dc2626" }}>
          Cancel Order?
        </div>

        <div style={{ background: "#f8fafc", borderRadius: 8, padding: 12, marginBottom: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "80px 1fr", gap: 8, fontSize: 13 }}>
            <div style={{ color: "#666" }}>Order ID:</div>
            <div style={{ fontWeight: 600 }}>#{order.orderId}</div>

            <div style={{ color: "#666" }}>Symbol:</div>
            <div style={{ fontWeight: 600 }}>
              {order.symbol}
              {order.secType === "OPT" && order.strike && (
                <span style={{ fontWeight: 400, color: "#666" }}>
                  {" "}{order.strike} {order.right === "C" || order.right === "Call" ? "Call" : "Put"}
                </span>
              )}
            </div>

            <div style={{ color: "#666" }}>Side:</div>
            <div style={{ fontWeight: 600, color: order.side === "BUY" ? "#16a34a" : "#dc2626" }}>
              {order.side}
            </div>

            <div style={{ color: "#666" }}>Quantity:</div>
            <div style={{ fontWeight: 600 }}>{order.quantity}</div>

            <div style={{ color: "#666" }}>Type:</div>
            <div style={{ fontWeight: 600 }}>{order.orderType}</div>

            {order.lmtPrice !== undefined && (
              <>
                <div style={{ color: "#666" }}>Limit Price:</div>
                <div style={{ fontWeight: 600 }}>${order.lmtPrice.toFixed(2)}</div>
              </>
            )}
          </div>
        </div>

        <div style={{ display: "flex", gap: 12 }}>
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
            Keep Order
          </button>
          <button
            onClick={handleCancel}
            style={{
              flex: 1,
              padding: "10px 16px",
              border: "none",
              borderRadius: 6,
              background: "#dc2626",
              color: "white",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Cancel Order
          </button>
        </div>
      </div>
    </div>
  );
}
