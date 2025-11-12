// src/TwoPane.tsx
import { useState } from "react";
import EquityPanel from "./EquityPanel";
import OptionPanel from "./OptionPanel";
import { socketHub } from "./ws/SocketHub";

export default function TwoPane() {
  const [selected, setSelected] = useState<string>("");

  const handleSelect = (symbol: string) => {
    const und = String(symbol || "").toUpperCase();
    setSelected(und);

    // Ask the control plane to find & subscribe the option contracts for this underlying
    socketHub.send({
      type: "control",
      op: "find_and_subscribe",
      underlying: und,
      trades: true,
      quotes: true,
      // room for future knobs:
      // expiry_days_max: 180, strikes_window: 10, etc.
    });
  };

  return (
    <div style={wrap as any}>
      <div style={leftPane as any}>
        <EquityPanel onSelect={handleSelect} />
      </div>
      <div style={rightPane as any}>
        <OptionPanel />
      </div>
    </div>
  );
}

const wrap = {
  display: "grid",
  gridTemplateColumns: "560px 1fr", // left fixed, right flexible
  gap: 12,
  alignItems: "start",
  padding: 12,
  boxSizing: "border-box" as const,
  width: "100%",
  height: "100%",
  minHeight: 0, // allow children to size/scroll correctly
};

const leftPane = {
  minWidth: 560,
  maxWidth: 560,
};

const rightPane = {
  minWidth: 480,
  width: "100%",
  height: "100%",
  minHeight: 0,       // critical so OptionPanel can run its own scroller
  display: "flex",
  flexDirection: "column" as const,
  overflow: "hidden", // contain OptionPanel’s internal scroll area
};