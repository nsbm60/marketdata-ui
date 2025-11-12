// marketdata-ui/src/RawPanel.jsx
import { useMemo, useState } from "react";

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
        <span style={{ marginLeft: "auto", fontSize: 12, color: "#333" }}>
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
const wrap = { border: "1px solid #ddd", borderRadius: 8, overflow: "hidden", display: "grid", gridTemplateRows: "auto auto 1fr", background: "#fff" };
const toolbar = { padding: "8px 10px", borderBottom: "1px solid #eee", background: "#fafafa", display: "flex", alignItems: "center", gap: 8 };
const controls = { display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderBottom: "1px dashed #eee", flexWrap: "wrap" };
const label = { fontSize: 12, color: "#333" };
const numInput = { width: 90, fontSize: 12, padding: "4px 6px", border: "1px solid #ddd", borderRadius: 6 };
const preWrap = { overflow: "auto", maxHeight: "70vh", background: "#fff" };
const pre = { margin: 0, padding: "8px 10px", fontFamily: "ui-monospace, Menlo, monospace", fontSize: 11, lineHeight: 1.25, whiteSpace: "pre" };