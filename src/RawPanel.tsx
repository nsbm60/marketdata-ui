// marketdata-ui/src/RawPanel.jsx
import { useMemo, useState } from "react";
import { light } from "./theme";

/**
 * RawPanel — shows newest-first raw JSON lines passed from App.jsx.
 * No separate internal "render on/off" anymore — the master switch
 * lives in App.jsx (Diagnostics Active/Paused).
 *
 * Props:
 *   raw: string[]  // newest-first
 */
export default function RawPanel({ raw = [] }) {
  const [maxLines, setMaxLines] = useState(500);

  const text = useMemo(() => {
    return raw.slice(0, maxLines).join("\n");
  }, [raw, maxLines]);

  return (
    <div style={wrap}>
      <div style={toolbar}>
        <span style={{ fontWeight: 600 }}>Diagnostics · Raw Messages</span>
        <span style={{ marginLeft: "auto", fontSize: 12, color: light.text.secondary }}>
          showing {Math.min(raw.length, maxLines)}/{raw.length}
        </span>
      </div>

      <div style={controls}>
        <label style={label}>
          Max lines:&nbsp;
          <input
            type="number"
            min={50}
            step={50}
            value={maxLines}
            onChange={(e) => setMaxLines(Math.max(50, Number(e.target.value) || 50))}
            style={numInput}
          />
        </label>
      </div>

      <div style={preWrap}>
        <pre style={pre}>{text}</pre>
      </div>
    </div>
  );
}


/* styles */

import type { CSSProperties } from "react";

const wrap = { border: `1px solid ${light.border.light}`, borderRadius: 8, overflow: "hidden", display: "grid", gridTemplateRows: "auto auto 1fr", background: light.bg.primary };
const toolbar = { padding: "8px 10px", borderBottom: `1px solid ${light.border.muted}`, background: light.bg.muted, display: "flex", alignItems: "center", gap: 8 };
const controls: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "8px 10px",
  borderBottom: `1px dashed ${light.border.muted}`,
  flexWrap: "wrap",
};const label = { fontSize: 12, color: light.text.secondary };
const numInput = { width: 90, fontSize: 12, padding: "4px 6px", border: `1px solid ${light.border.light}`, borderRadius: 6 };
const preWrap = { overflow: "auto", maxHeight: "70vh", background: light.bg.primary };
const pre = { margin: 0, padding: "8px 10px", fontFamily: "ui-monospace, Menlo, monospace", fontSize: 11, lineHeight: 1.25, whiteSpace: "pre" };