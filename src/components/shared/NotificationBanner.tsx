/**
 * NotificationBanner Component
 *
 * Displays global notifications in a compact banner at the top of the app.
 * Shows connection status, warnings, and reminders across all tabs.
 */

import React, { useState } from "react";
import { useNotifications, Notification, NotificationType } from "../../hooks/useNotifications";
import { light, semantic } from "../../theme";

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
  background: light.bg.secondary,
  borderBottom: `1px solid ${light.border.primary}`,
  fontSize: 12,
  flexWrap: "wrap",
};

const separator: React.CSSProperties = {
  color: light.border.secondary,
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
    background: semantic.highlight.cyan,
    color: "#0369a1",
    border: `1px solid ${semantic.highlight.cyanBorder}`,
  },
  warning: {
    background: semantic.warning.bg,
    color: semantic.warning.text,
    border: `1px solid ${semantic.warning.accent}`,
  },
  error: {
    background: semantic.error.bgMuted,
    color: semantic.error.textDark,
    border: `1px solid ${semantic.error.light}`,
  },
  success: {
    background: semantic.success.bgMuted,
    color: semantic.success.textDark,
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
