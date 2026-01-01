/**
 * NotificationBanner Component
 *
 * Displays global notifications in a compact banner at the top of the app.
 * Shows connection status, warnings, and reminders across all tabs.
 */

import React, { useState } from "react";
import { useNotifications, Notification, NotificationType } from "../../hooks/useNotifications";

export default function NotificationBanner() {
  const { notifications } = useNotifications();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  // Filter out dismissed notifications
  const visible = notifications.filter((n) => !dismissed.has(n.id));

  if (visible.length === 0) return null;

  const handleDismiss = (id: string) => {
    setDismissed((prev) => new Set([...prev, id]));
  };

  return (
    <div style={banner}>
      {visible.map((notification, idx) => (
        <React.Fragment key={notification.id}>
          {idx > 0 && <span style={separator}>|</span>}
          <NotificationItem
            notification={notification}
            onDismiss={
              notification.dismissible
                ? () => handleDismiss(notification.id)
                : undefined
            }
          />
        </React.Fragment>
      ))}
    </div>
  );
}

function NotificationItem({
  notification,
  onDismiss,
}: {
  notification: Notification;
  onDismiss?: () => void;
}) {
  const style = itemStyles[notification.type];

  return (
    <span style={{ ...itemBase, ...style }}>
      <span style={iconStyle}>{icons[notification.type]}</span>
      <span>{notification.message}</span>
      {notification.action && (
        <button
          onClick={notification.action.onClick}
          style={actionButton}
        >
          {notification.action.label}
        </button>
      )}
      {onDismiss && (
        <button onClick={onDismiss} style={dismissButton} title="Dismiss">
          ×
        </button>
      )}
    </span>
  );
}

// Icons for each notification type
const icons: Record<NotificationType, string> = {
  info: "ℹ",
  warning: "⚠",
  error: "✕",
  success: "✓",
};

// Styles
const banner: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "6px 12px",
  background: "#f8fafc",
  borderBottom: "1px solid #e2e8f0",
  fontSize: 12,
  flexWrap: "wrap",
};

const separator: React.CSSProperties = {
  color: "#cbd5e1",
  margin: "0 4px",
};

const itemBase: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "3px 8px",
  borderRadius: 4,
};

const itemStyles: Record<NotificationType, React.CSSProperties> = {
  info: {
    background: "#e0f2fe",
    color: "#0369a1",
    border: "1px solid #7dd3fc",
  },
  warning: {
    background: "#fef3c7",
    color: "#92400e",
    border: "1px solid #fcd34d",
  },
  error: {
    background: "#fee2e2",
    color: "#991b1b",
    border: "1px solid #fca5a5",
  },
  success: {
    background: "#dcfce7",
    color: "#166534",
    border: "1px solid #86efac",
  },
};

const iconStyle: React.CSSProperties = {
  fontWeight: 600,
};

const actionButton: React.CSSProperties = {
  marginLeft: 6,
  padding: "2px 6px",
  fontSize: 11,
  background: "rgba(0,0,0,0.1)",
  border: "none",
  borderRadius: 3,
  cursor: "pointer",
};

const dismissButton: React.CSSProperties = {
  marginLeft: 4,
  padding: "0 4px",
  fontSize: 14,
  lineHeight: 1,
  background: "transparent",
  border: "none",
  cursor: "pointer",
  opacity: 0.6,
};
