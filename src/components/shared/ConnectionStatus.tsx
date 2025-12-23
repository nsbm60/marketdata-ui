// src/components/shared/ConnectionStatus.tsx

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
        border: connected ? "2px solid #16a34a" : "2px solid #dc2626",
        background: connected ? "#dcfce7" : "#fee2e2",
        color: connected ? "#166534" : "#991b1b",
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: connected ? "#16a34a" : "#dc2626",
        }}
      />
      {label} {connected ? "Connected" : "Disconnected"}
    </div>
  );
}
