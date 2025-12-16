// src/App.tsx
import { useEffect } from "react";
import { socketHub } from "./ws/SocketHub";
import { getMarketState } from "./services/marketState";
import TwoPane from "./TwoPane";

export default function App() {
  useEffect(() => {
    socketHub.connect();
    // Initialize market state after connection
    // Small delay to ensure socket is ready
    const timer = setTimeout(() => getMarketState(), 500);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div style={root as any}>
      <TwoPane />
    </div>
  );
}

const root = {
  width: "100vw",
  height: "100vh",
  display: "flex",
  flexDirection: "column",
  background: "#f4f4f4",
  overflow: "hidden",
  fontFamily:
    'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
};