// src/ws/SocketConfig.ts
//
// One canonical place to build the WebSocket URL.
// - Defaults to the current page's host (auto http→ws, https→wss)
// - Optional override via window.__WS_URL__ or ?ws=<full-url> in the querystring

export function resolveWsUrl(path: string = "/ws"): string {
  const w = window.location;

  // Allow easy overrides without code changes:
  //   window.__WS_URL__ = "wss://my-host.example.com/ws"
  //   or add ?ws=wss://my-host.example.com/ws to the page URL
  const override =
    (window as any).__WS_URL__ ||
    new URLSearchParams(w.search).get("ws");

  if (override) return override;

  const scheme = w.protocol === "https:" ? "wss" : "ws";
  // w.host already includes the port if present
  return `${scheme}://${w.host}${path}`;
}

// Convenience constant if you don’t need a custom path
export const WS_URL: string = resolveWsUrl();