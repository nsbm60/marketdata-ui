// src/components/portfolio/CancelOrderModal.tsx
import { IbOpenOrder } from "../../types/portfolio";
import { socketHub } from "../../ws/SocketHub";
import { modalOverlay, modalContent } from "./styles";
import { light, semantic, pnl } from "../../theme";
import Button from "../shared/Button";

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
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 16, color: semantic.error.text }}>
          Cancel Order?
        </div>

        <div style={{ background: light.bg.secondary, borderRadius: 8, padding: 12, marginBottom: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "80px 1fr", gap: 8, fontSize: 13 }}>
            <div style={{ color: light.text.muted }}>Order ID:</div>
            <div style={{ fontWeight: 600 }}>#{order.orderId}</div>

            <div style={{ color: light.text.muted }}>Symbol:</div>
            <div style={{ fontWeight: 600 }}>
              {order.symbol}
              {order.secType === "OPT" && order.strike && (
                <span style={{ fontWeight: 400, color: light.text.muted }}>
                  {" "}{order.strike} {order.right === "C" || order.right === "Call" ? "Call" : "Put"}
                </span>
              )}
            </div>

            <div style={{ color: light.text.muted }}>Side:</div>
            <div style={{ fontWeight: 600, color: order.side === "BUY" ? pnl.positive : pnl.negative }}>
              {order.side}
            </div>

            <div style={{ color: light.text.muted }}>Quantity:</div>
            <div style={{ fontWeight: 600 }}>{order.quantity}</div>

            <div style={{ color: light.text.muted }}>Type:</div>
            <div style={{ fontWeight: 600 }}>{order.orderType}</div>

            {order.lmtPrice !== undefined && (
              <>
                <div style={{ color: light.text.muted }}>Limit Price:</div>
                <div style={{ fontWeight: 600 }}>${order.lmtPrice.toFixed(2)}</div>
              </>
            )}
          </div>
        </div>

        <div style={{ display: "flex", gap: 12 }}>
          <Button
            onClick={onClose}
            variant="secondary"
            size="form"
            style={{ flex: 1 }}
          >
            Keep Order
          </Button>
          <Button
            onClick={handleCancel}
            variant="danger"
            size="form"
            style={{ flex: 1, fontWeight: 600 }}
          >
            Cancel Order
          </Button>
        </div>
      </div>
    </div>
  );
}
