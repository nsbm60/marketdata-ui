import { useMemo } from "react";
import { light } from "./theme";

export default function StreamView({ rows }) {
  const columns = useMemo(
    () => [
      { key: "symbol",   label: "Contract" },
      { key: "last",     label: "Last" },
      { key: "bid",      label: "Bid" },
      { key: "ask",      label: "Ask" },
      { key: "iv",       label: "IV" },
      { key: "delta",    label: "Δ" },
      { key: "gamma",    label: "Γ" },
      { key: "theta",    label: "Θ" },
      { key: "vega",     label: "V" },
      { key: "updatedAt",label: "Time" },
    ],
    []
  );

  return (
    <div style={{ overflow: "auto", border: `1px solid ${light.border.light}`, borderRadius: 8 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
        <thead style={{ position: "sticky", top: 0, background: light.bg.muted }}>
          <tr>
            {columns.map((c) => (
              <th key={c.key} style={{ textAlign: "left", padding: "8px 10px", borderBottom: `1px solid ${light.border.muted}` }}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} style={{ padding: 12, color: light.text.muted }}>
                Connected — waiting for option frames that include a symbol/price...
              </td>
            </tr>
          ) : (
            rows.map((r, i) => (
              <tr key={i}>
                {columns.map((c) => (
                  <td key={c.key} style={{ padding: "6px 10px", borderBottom: `1px solid ${light.bg.hover}` }}>
                    {r[c.key]}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}