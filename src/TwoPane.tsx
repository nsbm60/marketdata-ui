import { useState } from "react";
import EquityPanel from "./EquityPanel";
import OptionPanel from "./OptionPanel";
import { socketHub } from "./ws/SocketHub";

export default function TwoPane() {
  const [selected, setSelected] = useState<string>("");

  const handleSelect = (sym: string) => {
    const u = String(sym || "").toUpperCase();
    setSelected(u);

    // Kick off options discovery + auto-subscribe via control plane
    // UISocket will delta-apply option stream subs for this underlying.
    socketHub.sendControl("find_and_subscribe", {
      underlying: u,
      // you can tweak these defaults if you want only quotes/trades
      trades: true,
      quotes: true,
      // optionally: filter parameters (server may ignore if unsupported)
      // window_pct: 0.2,
      // max_months: 6,
    }).catch(() => {
      // ignore UI errors here; OptionPanel still renders status via control.ack listeners
    });
  };

  return (
    <div style={wrap as any}>
      <div style={leftPane as any}>
        <EquityPanel selected={selected} onSelect={handleSelect} />
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
};

const leftPane = {
  minWidth: 560,
  maxWidth: 560,
};

const rightPane = {
  minWidth: 480,
  width: "100%",
};