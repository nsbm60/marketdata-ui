// marketdata-ui/src/App.jsx
import { useEffect, useMemo, useState } from "react";
import { startFeed } from "./services/feed";

export default function App() {
  const [rows, setRows] = useState([]);
  const [raw, setRaw] = useState([]);

  useEffect(() => {
    const stop = startFeed(
      (row) => setRows((prev) => [row, ...prev].slice(0, 200)),
      (rawLine) => setRaw((prev) => [rawLine, ...prev].slice(0, 50)) // keep last 50 frames
    );
    return stop;
  }, []);

  const columns = useMemo(
    () => [
      { key: "symbol", label: "Contract" },
      { key: "last", label: "Last" },
      { key: "bid", label: "Bid" },
      { key: "ask", label: "Ask" },
      { key: "iv", label: "IV" },
      { key: "delta", label: "Δ" },
      { key: "gamma", label: "Γ" },
      { key: "theta", label: "Θ" },
      { key: "vega", label: "V" },
      { key: "updatedAt", label: "Time" },
    ],
    []
  );

  return (
    <div style={{ padding: 16, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif" }}>
      <h2 style={{ marginBottom: 12 }}>MarketData UI (live WS)</h2>

      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
        {/* Table */}
        <div style={{ overflow: "auto", border: "1px solid #ddd", borderRadius: 8 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead style={{ position: "sticky", top: 0, background: "#fafafa" }}>
              <tr>
                {columns.map((c) => (
                  <th key={c.key} style={{ textAlign: "left", padding: "8px 10px", borderBottom: "1px solid #eee" }}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} style={{ padding: 12, color: "#666" }}>
                    Connected — waiting for option frames that include a symbol/price…
                  </td>
                </tr>
              ) : (
                rows.map((r, i) => (
                  <tr key={i}>
                    {columns.map((c) => (
                      <td key={c.key} style={{ padding: "6px 10px", borderBottom: "1px solid #f3f3f3" }}>
                        {r[c.key]}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Raw frames */}
        <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 8 }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Raw messages (latest 50)</div>
          <div style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12, whiteSpace: "pre-wrap", maxHeight: 420, overflow: "auto" }}>
            {raw.length === 0 ? "No frames yet…" : raw.map((line, i) => <div key={i}>{line}</div>)}
          </div>
        </div>
      </div>
    </div>
  );
}