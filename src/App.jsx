// marketdata-ui/src/App.jsx

import { useEffect, useRef, useState } from "react";
import { startFeed } from "./services/feed";

import StreamView from "./StreamView";
import RawPanel from "./RawPanel";
import WatchList from "./WatchList";

export default function App() {
  const [rows, setRows] = useState([]);  // newest-first for StreamView
  const [raw,  setRaw]  = useState([]);  // newest-first for RawPanel
  const [tab,  setTab]  = useState("watch"); // "watch" | "stream"

  // Master control for diagnostics feed (affects both StreamView and RawPanel)
  const [diagActive, setDiagActive] = useState(false);

  const stopRef = useRef(null);

  // **Single, surgical CSS override to kill vertical/horizontal centering on common templates**
  useEffect(() => {
    const id = "app-top-anchor-fix-strong";
    if (!document.getElementById(id)) {
      const style = document.createElement("style");
      style.id = id;
      style.textContent = `
        /* Kill flex/grid centering and template centering on body/#root */
        html, body, #root, body > #root {
          height: auto !important;
          min-height: 0 !important;
          display: block !important;
          align-items: initial !important;
          justify-content: initial !important;
          place-items: initial !important;
          place-content: initial !important;
          margin: 0 !important;
          padding: 0 !important;
          text-align: initial !important;
          max-width: none !important;
        }
      `;
      document.head.appendChild(style);
    }
  }, []);

  // Start/stop diagnostics feed only when on the tab AND diagActive is true
  useEffect(() => {
    const shouldRun = tab === "stream" && diagActive;

    if (shouldRun) {
      stopRef.current = startFeed(
        (row)     => setRows((prev) => [row, ...prev].slice(0, 200)),
        (rawLine) => setRaw((prev) => [rawLine, ...prev].slice(0, 500)),
        { fps: 15, maxOut: 150, wsUrl: "ws://localhost:8088/ws" }
      );
    } else {
      if (stopRef.current) {
        try { stopRef.current(); } catch {}
        stopRef.current = null;
      }
      setRows([]);
      setRaw([]);
    }

    return () => {
      if (stopRef.current) {
        try { stopRef.current(); } catch {}
        stopRef.current = null;
      }
    };
  }, [tab, diagActive]);

  return (
    <div
      // local container that *starts at the top* and never centers
      style={{
        padding: 16,
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
        margin: 0,
      }}
    >
      <h2 style={{ marginBottom: 12 }}>MarketData UI</h2>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <TabButton active={tab === "watch"} onClick={() => setTab("watch")}>
          WatchList (Equities)
        </TabButton>
        <TabButton active={tab === "stream"} onClick={() => setTab("stream")}>
          Diagnostics: Stream & Raw
        </TabButton>
      </div>

      {tab === "watch" ? (
        <WatchList />
      ) : (
        <>
          {/* Diagnostics toolbar controls the actual feed (master switch) */}
          <div style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            marginBottom: 8,
            padding: "8px 10px",
            border: "1px solid #eee",
            borderRadius: 8,
            background: "#fafafa"
          }}>
            <strong>Diagnostics Feed:</strong>
            <button
              onClick={() => setDiagActive((v) => !v)}
              style={{
                padding: "6px 10px",
                borderRadius: 8,
                border: diagActive ? "2px solid #1e90ff" : "1px solid #ccc",
                background: diagActive ? "#eef6ff" : "#fff",
                cursor: "pointer"
              }}
            >
              {diagActive ? "Active" : "Paused"}
            </button>
            <span style={{ marginLeft: "auto", fontSize: 12, color: diagActive ? "#137333" : "#b45309" }}>
              {diagActive ? "receiving" : "stopped"}
            </span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12, alignItems: "start" }}>
            <StreamView rows={rows} />
            <RawPanel raw={raw} />
          </div>
        </>
      )}
    </div>
  );
}

function TabButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "8px 12px",
        borderRadius: 8,
        border: active ? "2px solid #1e90ff" : "1px solid #ccc",
        background: active ? "#eef6ff" : "#fff",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}