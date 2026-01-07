// src/components/shared/ConnectionStatus.tsx

import { semantic } from "../../theme";

interface ConnectionStatusProps {
  connected: boolean;
  label: string;
}

/**
 * Connection status indicator with colored badge.
 * Shows green when connected, red when disconnected.
 */
export default function ConnectionStatus({ connected, label }: ConnectionStatusProps) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 10px",
        borderRadius: 6,
        fontSize: 11,
        fontWeight: 500,
        border: connected
          ? `2px solid ${semantic.success.text}`
          : `2px solid ${semantic.error.text}`,
        background: connected ? semantic.success.bgMuted : semantic.error.bgMuted,
        color: connected ? semantic.success.textDark : semantic.error.textDark,
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: connected ? semantic.success.text : semantic.error.text,
        }}
      />
      {label} {connected ? "Connected" : "Disconnected"}
    </div>
  );
}
