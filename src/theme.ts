/**
 * Centralized theme definitions for consistent styling across the app.
 *
 * Usage:
 *   import { dark, light, semantic } from "../theme";
 *   style={{ color: dark.text.primary, background: dark.bg.primary }}
 */

// ─────────────────────────────────────────────────────────────
// Dark Theme (Chart, dark panels)
// ─────────────────────────────────────────────────────────────

export const dark = {
  bg: {
    primary: "#1a1a2e",
    secondary: "#2a2a3e",
    tertiary: "#252535",
    hover: "#333344",
    selected: "#1e3a5f",
  },
  text: {
    primary: "#e5e5e5",
    secondary: "#9ca3af",
    muted: "#6b7280",
    disabled: "#888899",
  },
  border: {
    primary: "#3a3a4e",
    secondary: "#333344",
    muted: "#2a2a3e",
  },
  accent: {
    primary: "#3b82f6",
    light: "#60a5fa",
    dark: "#1e3a5f",
  },
};

// ─────────────────────────────────────────────────────────────
// Light Theme (Portfolio, watchlist, forms)
// ─────────────────────────────────────────────────────────────

export const light = {
  bg: {
    primary: "#ffffff",
    secondary: "#f8fafc",
    tertiary: "#f1f5f9",
    hover: "#f3f4f6",
    muted: "#fafafa",
  },
  text: {
    primary: "#111111",
    secondary: "#374151",
    muted: "#666666",
    disabled: "#999999",
    light: "#888888",
  },
  border: {
    primary: "#e5e7eb",
    secondary: "#d1d5db",
    muted: "#eeeeee",
    light: "#dddddd",
    lighter: "#cccccc",
  },
};

// ─────────────────────────────────────────────────────────────
// Semantic Colors (shared across themes)
// ─────────────────────────────────────────────────────────────

export const semantic = {
  // Success / Positive / Green
  success: {
    text: "#16a34a",
    textDark: "#166534",
    bg: "#f0fdf4",
    bgMuted: "#dcfce7",
  },

  // Error / Negative / Red
  error: {
    text: "#dc2626",
    textDark: "#991b1b",
    bg: "#fef2f2",
    bgMuted: "#fee2e2",
    light: "#fca5a5",
    alt: "#ef5350",
  },

  // Warning / Amber
  warning: {
    text: "#92400e",
    textDark: "#b45309",
    bg: "#fef3c7",
    bgMuted: "#fde68a",
    accent: "#fcd34d",
    alt: "#ff9800",
  },

  // Info / Blue
  info: {
    text: "#2563eb",
    textLight: "#60a5fa",
    bg: "#dbeafe",
    alt: "#2196f3",
  },

  // Neutral highlights
  highlight: {
    yellow: "#fef3c7",
    yellowBorder: "#fde047",
    blue: "#dbeafe",
    blueBorder: "#93c5fd",
    cyan: "#e0f2fe",
    cyanBorder: "#bae6fd",
    pink: "#fce7f3",
  },

  // Special
  purple: "#9c27b0",
  teal: "#26a69a",
};

// ─────────────────────────────────────────────────────────────
// P&L Colors (convenience aliases)
// ─────────────────────────────────────────────────────────────

export const pnl = {
  positive: semantic.success.text,
  negative: semantic.error.text,
  neutral: light.text.muted,
};

// ─────────────────────────────────────────────────────────────
// Component-specific presets
// ─────────────────────────────────────────────────────────────

/** Button styles */
export const button = {
  primary: {
    bg: dark.accent.primary,
    text: "#ffffff",
    border: dark.accent.primary,
  },
  secondary: {
    bg: "transparent",
    text: light.text.secondary,
    border: light.border.lighter,
  },
  disabled: {
    bg: light.bg.tertiary,
    text: light.text.disabled,
    border: light.border.muted,
  },
};

/** Table/grid styles */
export const table = {
  headerBg: light.bg.secondary,
  headerText: light.text.secondary,
  rowBorder: "#f3f4f6",
  rowHover: light.bg.hover,
  rowAlt: light.bg.muted,
};

/** Expiring/alert row highlights */
export const rowHighlight = {
  expiring: semantic.warning.bg,
  expiringBorder: semantic.warning.accent,
  selected: semantic.highlight.blue,
  selectedBorder: semantic.highlight.blueBorder,
  hypothetical: "#f0f4ff", // Light blue for hypothetical positions
};

// ─────────────────────────────────────────────────────────────
// Typography
// ─────────────────────────────────────────────────────────────

export const fonts = {
  /** Standard table/grid sizes */
  table: {
    header: 11,      // Column headers
    cell: 11,        // Data cells
    label: 11,       // Row labels
    small: 9,        // Secondary info (e.g., @$6.40)
  },
  /** UI elements */
  ui: {
    heading: 14,     // Section headings
    body: 12,        // Body text
    button: 11,      // Buttons
    caption: 10,     // Captions, timestamps
  },
};
