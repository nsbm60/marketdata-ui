export default function RawPanel({ raw }) {
  return (
    <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 8 }}>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>Raw messages (latest 50)</div>
      <div
        style={{
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 12,
          whiteSpace: "pre-wrap",
          maxHeight: 420,
          overflow: "auto",
        }}
      >
        {raw.length === 0 ? "No frames yet…" : raw.map((line, i) => <div key={i}>{line}</div>)}
      </div>
    </div>
  );
}