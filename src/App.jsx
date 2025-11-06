// marketdata-ui/src/App.jsx

import { useEffect, useState } from "react";
import { startFeed } from "./services/feed";

import StreamView from "./StreamView";
import RawPanel from "./RawPanel";
import WatchList from "./WatchList";

export default function App() {
  const [rows, setRows] = useState([]);
  const [raw, setRaw] = useState([]);
  const [tab, setTab] = useState("watch"); // "watch" | "stream"

  // Top-anchor override (leave or move to global CSS)
  useEffect(() => {
    const id = "app-top-anchor";
    if (!document.getElementById(id)) {
      const style = document.createElement("style");
      style.id = id;
      style.textContent = `
        html, body, #root { height: 100%; }
        #root, .app-root {
          display: block !important;
          align-items: initial !important;
          justify-content: initial !important;
        }
        body { margin: 0; background: #fff; color: #111; }
      `;
      document.head.appendChild(style);
    }
  }, []);

  // Keep existing pipeline alive for Stream tab
  useEffect(() => {
    const stop = startFeed(
      (row) => setRows((prev) => [row, ...prev].slice(0, 200)),
      (rawLine) => setRaw((prev) => [rawLine, ...prev].slice(0, 50))
    );
    return stop;
  }, []);

  return (
    <div style={{ padding: 16, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif" }}>
      <h2 style={{ marginBottom: 12 }}>MarketData UI</h2>

      {/* Labeled tabs */}
      <div role="tablist" aria-label="Views" style={{ display: "flex", gap: 8, marginBottom: 12, borderBottom: "1px solid #ddd", paddingBottom: 4 }}>
        <TabButton id="tab-watch"  active={tab === "watch"}  onClick={() => setTab("watch")}  ariaControls="panel-watch">
          Watchlist
        </TabButton>
        <TabButton id="tab-stream" active={tab === "stream"} onClick={() => setTab("stream")} ariaControls="panel-stream">
          Raw stream
        </TabButton>
        <div style={{ marginLeft: "auto", fontSize: 12, color: "#666" }}>
          {tab === "watch" ? "Live quotes & trades" : "Latest frames + parsed table"}
        </div>
      </div>

      {/* KEEP-ALIVE PANELS: both mounted, we just hide/show */}
      <section
        id="panel-watch"
        role="tabpanel"
        aria-labelledby="tab-watch"
        aria-hidden={tab !== "watch"}
        style={{ display: tab === "watch" ? "block" : "none" }}
      >
        <WatchList />
      </section>

      <section
        id="panel-stream"
        role="tabpanel"
        aria-labelledby="tab-stream"
        aria-hidden={tab !== "stream"}
        style={{ display: tab === "stream" ? "block" : "none" }}
      >
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
          <StreamView rows={rows} />
          <RawPanel raw={raw} />
        </div>
      </section>
    </div>
  );
}

function TabButton({ active, onClick, children, id, ariaControls }) {
  return (
    <button
      id={id}
      role="tab"
      aria-selected={active}
      aria-controls={ariaControls}
      onClick={onClick}
      style={{
        padding: "8px 12px",
        borderRadius: "8px 8px 0 0",
        border: active ? "2px solid #1e90ff" : "1px solid #ccc",
        borderBottomColor: active ? "#fff" : "#ccc",
        background: active ? "#eef6ff" : "#f7f7f7",
        cursor: "pointer",
        color: "#111",
      }}
    >
      {children}
    </button>
  );
}