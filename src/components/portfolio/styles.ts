// src/components/portfolio/styles.ts
// Shared styles for portfolio components

import { CSSProperties } from "react";

export const section: CSSProperties = {
  background: "#fff",
  border: "1px solid #e5e7eb",
  borderRadius: 8,
  overflow: "hidden"
};

export const title: CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  padding: "8px 10px",
  background: "#f1f5f9",
  borderBottom: "1px solid #e5e7eb"
};

export const table: CSSProperties = {
  display: "flex",
  flexDirection: "column"
};

export const hdr: CSSProperties = {
  display: "grid",
  fontWeight: 600,
  fontSize: 10.5,
  color: "#374151",
  padding: "0 10px",
  background: "#f8fafc",
  height: 26,
  alignItems: "center"
};

export const rowStyle: CSSProperties = {
  display: "grid",
  fontSize: 11,
  minHeight: 32,
  alignItems: "center",
  padding: "0 10px",
  borderBottom: "1px solid #f3f4f6"
};

export const cellEllipsis: CSSProperties = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontFamily: "ui-monospace, monospace",
  fontSize: 10
};

export const right: CSSProperties = {
  textAlign: "right"
};

export const rightMono: CSSProperties = {
  ...right,
  fontFamily: "ui-monospace, monospace"
};

export const rightMonoBold: CSSProperties = {
  ...rightMono,
  fontWeight: 600
};

export const center: CSSProperties = {
  textAlign: "center"
};

export const centerBold: CSSProperties = {
  ...center,
  fontWeight: 600
};

export const gray10: CSSProperties = {
  fontSize: 10,
  color: "#666"
};

export const timeHeader: CSSProperties = {
  ...center,
  fontSize: 10,
  color: "#374151"
};

export const timeCell: CSSProperties = {
  ...center,
  fontSize: 10,
  color: "#555",
  fontFeatureSettings: "'tnum'",
  letterSpacing: "0.5px",
};

export const emptyRow: CSSProperties = {
  padding: "8px 10px",
  color: "#888",
  fontSize: 12
};

export const iconBtn: CSSProperties = {
  padding: "4px 10px",
  border: "1px solid #ccc",
  borderRadius: "6px",
  background: "white",
  fontSize: "12px",
  fontWeight: 600,
  cursor: "pointer",
};

// Modal styles
export const modalOverlay: CSSProperties = {
  position: "fixed",
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  background: "rgba(0,0,0,0.5)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1001,
};

export const modalContent: CSSProperties = {
  background: "white",
  borderRadius: 12,
  padding: 20,
  minWidth: 320,
  boxShadow: "0 4px 20px rgba(0,0,0,0.2)",
};
