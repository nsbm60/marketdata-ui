// src/TwoPane.tsx
import { useState } from "react";
import EquityPanel from "./EquityPanel";
import OptionPanel from "./OptionPanel";
import IBPanel from "./IBPanel";
import FidelityPanel from "./FidelityPanel";
import ChartPanel from "./ChartPanel";
import ConnectionStatus from "./components/shared/ConnectionStatus";
import NotificationBanner from "./components/shared/NotificationBanner";
import VixTicker from "./components/shared/VixTicker";
import { socketHub } from "./ws/SocketHub";
import { useAppState } from "./state/useAppState";
import { light } from "./theme";

type TabId = "market" | "portfolio" | "fidelity" | "chart";

export default function TwoPane() {
  const [selected, setSelected] = useState<string>("");
  const [activeTab, setActiveTab] = useState<TabId>("market");

  // Get WebSocket connection status from app state
  const { state } = useAppState();
  const wsConnected = state.connection.websocket === "connected";

  const handleSelect = (symbol: string) => {
    const und = String(symbol || "").toUpperCase();
    setSelected(und);

    // Ask the control plane to find available expiries for this underlying
    // OptionPanel will receive the response and auto-load the first expiry
    socketHub.send({
      type: "control",
      target: "marketData",
      op: "find_expiries",
      id: `find_expiries_${Date.now()}`,
      underlying: und,
      expiry_days_max: 100, // Start with 100 days
    });
  };

  const handleClear = () => {
    setSelected("");
  };

  return (
    <div style={root as any}>
      {/* Global notification banner */}
      <NotificationBanner />

      {/* Tab bar */}
      <div style={tabBar as any}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 4 }}>
          <button
            type="button"
            onClick={() => setActiveTab("market")}
            style={tabButton(activeTab === "market") as any}
          >
            Watchlist &amp; Options
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("portfolio")}
            style={tabButton(activeTab === "portfolio") as any}
          >
            IB Portfolio
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("fidelity")}
            style={tabButton(activeTab === "fidelity") as any}
          >
            Fidelity
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("chart")}
            style={tabButton(activeTab === "chart") as any}
          >
            Chart
          </button>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <VixTicker />
          <ConnectionStatus connected={wsConnected} label="WebSocket" />
        </div>
      </div>

     {/* Tab content */}
      <div style={tabBody as any}>
        {/* Watchlist & Options tab content — keep mounted, just hide/show */}
        <div
          style={{
            ...(marketWrap as any),
            display: activeTab === "market" ? "grid" : "none",
          }}
        >
          <div style={leftPane as any}>
            <EquityPanel onSelect={handleSelect} onClear={handleClear} />
          </div>
          <div style={rightPane as any}>
            <OptionPanel ticker={selected} />
          </div>
        </div>

        {/* Portfolio tab content — also kept mounted */}
        <div
          style={{
            width: "100%",
            height: "100%",
            display: activeTab === "portfolio" ? "block" : "none",
          } as any}
        >
          <IBPanel />
        </div>

        {/* Fidelity tab content — also kept mounted */}
        <div
          style={{
            width: "100%",
            height: "100%",
            display: activeTab === "fidelity" ? "block" : "none",
          } as any}
        >
          <FidelityPanel />
        </div>

        {/* Chart tab content — also kept mounted */}
        <div
          style={{
            width: "100%",
            height: "100%",
            display: activeTab === "chart" ? "block" : "none",
          } as any}
        >
          <ChartPanel selected={selected} />
        </div>
      </div>
    </div>
  );
}

/* ---- layout styles ---- */

const root = {
  display: "flex",
  flexDirection: "column" as const,
  width: "100%",
  height: "100%",
  boxSizing: "border-box" as const,
};

const tabBar = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "8px 12px 0 12px",
  borderBottom: `1px solid ${light.border.primary}`,
  background: light.bg.secondary,
};

function tabButton(active: boolean) {
  return {
    padding: "6px 10px",
    fontSize: 13,
    borderRadius: "6px 6px 0 0",
    border: active ? `1px solid ${light.border.secondary}` : "1px solid transparent",
    borderBottomColor: active ? light.bg.primary : "transparent",
    background: active ? light.bg.primary : "transparent",
    cursor: "pointer",
    color: active ? light.text.primary : light.text.secondary,
    fontWeight: active ? 600 : 500,
  };
}

const tabBody = {
  flex: 1,
  padding: 12,
  boxSizing: "border-box" as const,
  overflow: "hidden",
};

const marketWrap = {
  display: "grid",
  gridTemplateColumns: "680px 1fr", // left fixed, right flexible
  gap: 12,
  alignItems: "start",
  width: "100%",
  height: "100%",
  minHeight: 0,
};

const leftPane = {
  minWidth: 680,
  maxWidth: 680,
  height: "100%",
  minHeight: 0,
  overflow: "hidden",
};

const rightPane = {
  minWidth: 480,
  width: "100%",
  height: "100%",
  minHeight: 0,
  display: "flex",
  flexDirection: "column" as const,
  overflow: "hidden",
};