/**
 * MetricToolbar - Toolbar for managing chart indicators.
 * Supports dynamically adding/removing SMAs and EMAs.
 */

import { useState, useRef, useEffect } from "react";
import {
  ChartMetricSettings,
  DEFAULT_METRIC_SETTINGS,
  MA_COLORS,
  MovingAverageSetting,
  generateMAId,
} from "../../utils/chartMetrics";
import { dark, semantic } from "../../theme";

interface MetricToolbarProps {
  settings: ChartMetricSettings;
  onSettingsChange: (settings: ChartMetricSettings) => void;
}

// Popover component
function Popover({
  isOpen,
  onClose,
  anchorRef,
  children,
}: {
  isOpen: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
}) {
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        anchorRef.current &&
        !anchorRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen, onClose, anchorRef]);

  if (!isOpen) return null;

  return (
    <div
      ref={popoverRef}
      style={{
        position: "absolute",
        top: "100%",
        left: 0,
        marginTop: 4,
        backgroundColor: dark.bg.tertiary,
        border: `1px solid ${dark.border.primary}`,
        borderRadius: 6,
        padding: 12,
        zIndex: 100,
        minWidth: 140,
        boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
      }}
    >
      {children}
    </div>
  );
}

// Add MA popover content
function AddMAPopover({
  onAdd,
  onClose,
  nextColor,
}: {
  onAdd: (type: "sma" | "ema", period: number) => void;
  onClose: () => void;
  nextColor: string;
}) {
  const [type, setType] = useState<"sma" | "ema">("sma");
  const [periodStr, setPeriodStr] = useState("20");

  const period = parseInt(periodStr, 10) || 20;
  const isValid = !isNaN(parseInt(periodStr, 10)) && period >= 1 && period <= 500;

  return (
    <div>
      <div style={{ marginBottom: 8 }}>
        <label style={{ display: "block", fontSize: 11, color: dark.text.secondary, marginBottom: 4 }}>
          Type
        </label>
        <div style={{ display: "flex", gap: 4 }}>
          <button
            onClick={() => setType("sma")}
            style={{
              flex: 1,
              padding: "4px 8px",
              borderRadius: 4,
              border: `1px solid ${type === "sma" ? dark.accent.primary : dark.border.primary}`,
              backgroundColor: type === "sma" ? dark.accent.dark : dark.bg.secondary,
              color: type === "sma" ? dark.accent.light : dark.text.secondary,
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            SMA
          </button>
          <button
            onClick={() => setType("ema")}
            style={{
              flex: 1,
              padding: "4px 8px",
              borderRadius: 4,
              border: `1px solid ${type === "ema" ? dark.accent.primary : dark.border.primary}`,
              backgroundColor: type === "ema" ? dark.accent.dark : dark.bg.secondary,
              color: type === "ema" ? dark.accent.light : dark.text.secondary,
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            EMA
          </button>
        </div>
      </div>
      <div style={{ marginBottom: 10 }}>
        <label style={{ display: "block", fontSize: 11, color: dark.text.secondary, marginBottom: 4 }}>
          Period
        </label>
        <input
          type="number"
          value={periodStr}
          onChange={(e) => setPeriodStr(e.target.value)}
          min={1}
          max={500}
          style={{
            width: "100%",
            padding: "4px 8px",
            backgroundColor: dark.bg.secondary,
            border: `1px solid ${isValid ? dark.border.primary : semantic.error.text}`,
            borderRadius: 4,
            color: dark.text.primary,
            fontSize: 13,
          }}
        />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 11, color: dark.text.secondary }}>Color:</span>
        <span
          style={{
            width: 16,
            height: 16,
            borderRadius: 3,
            backgroundColor: nextColor,
          }}
        />
      </div>
      <button
        onClick={() => {
          if (isValid) {
            onAdd(type, period);
            onClose();
          }
        }}
        disabled={!isValid}
        style={{
          width: "100%",
          padding: "6px 12px",
          borderRadius: 4,
          border: "none",
          backgroundColor: isValid ? dark.accent.primary : dark.text.muted,
          color: "#fff",
          cursor: isValid ? "pointer" : "not-allowed",
          fontSize: 12,
          fontWeight: 500,
          opacity: isValid ? 1 : 0.6,
        }}
      >
        Add {type.toUpperCase()}({isValid ? period : "?"})
      </button>
    </div>
  );
}

// MA chip with delete button
function MAChip({
  ma,
  onRemove,
  onEdit,
}: {
  ma: MovingAverageSetting;
  onRemove: () => void;
  onEdit: (period: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(ma.period.toString());
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const handleSubmit = () => {
    const v = parseInt(editValue, 10);
    if (!isNaN(v) && v >= 1 && v <= 500) {
      onEdit(v);
    } else {
      setEditValue(ma.period.toString());
    }
    setEditing(false);
  };

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "3px 6px",
        borderRadius: 4,
        backgroundColor: `${ma.color}20`,
        border: `1px solid ${ma.color}`,
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: 2,
          backgroundColor: ma.color,
        }}
      />
      <span style={{ fontSize: 11, color: ma.color, fontWeight: 500 }}>
        {ma.type.toUpperCase()}
      </span>
      {editing ? (
        <input
          ref={inputRef}
          type="number"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={handleSubmit}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSubmit();
            if (e.key === "Escape") {
              setEditValue(ma.period.toString());
              setEditing(false);
            }
          }}
          style={{
            width: 40,
            padding: "1px 4px",
            backgroundColor: dark.bg.secondary,
            border: `1px solid ${dark.border.primary}`,
            borderRadius: 3,
            color: dark.text.primary,
            fontSize: 11,
          }}
        />
      ) : (
        <span
          onClick={() => setEditing(true)}
          style={{ fontSize: 11, color: dark.text.secondary, cursor: "pointer" }}
          title="Click to edit period"
        >
          ({ma.period})
        </span>
      )}
      <button
        onClick={onRemove}
        style={{
          padding: "0 2px",
          border: "none",
          backgroundColor: "transparent",
          color: dark.text.muted,
          cursor: "pointer",
          fontSize: 12,
          lineHeight: 1,
        }}
        title="Remove"
      >
        ×
      </button>
    </div>
  );
}

export default function MetricToolbar({ settings, onSettingsChange }: MetricToolbarProps) {
  const [showAddMA, setShowAddMA] = useState(false);
  const [showRibbon, setShowRibbon] = useState(false);
  const [showRSI, setShowRSI] = useState(false);
  const [showMACD, setShowMACD] = useState(false);

  const addButtonRef = useRef<HTMLButtonElement>(null);
  const ribbonRef = useRef<HTMLButtonElement>(null);
  const rsiRef = useRef<HTMLButtonElement>(null);
  const macdRef = useRef<HTMLButtonElement>(null);

  // Get next color for new MA
  const nextColor = MA_COLORS[settings.movingAverages.length % MA_COLORS.length];

  // Add a new moving average
  const addMA = (type: "sma" | "ema", period: number) => {
    const newMA: MovingAverageSetting = {
      id: generateMAId(),
      type,
      period,
      color: nextColor,
    };
    onSettingsChange({
      ...settings,
      movingAverages: [...settings.movingAverages, newMA],
    });
  };

  // Remove a moving average
  const removeMA = (id: string) => {
    onSettingsChange({
      ...settings,
      movingAverages: settings.movingAverages.filter((ma) => ma.id !== id),
    });
  };

  // Edit MA period
  const editMA = (id: string, period: number) => {
    onSettingsChange({
      ...settings,
      movingAverages: settings.movingAverages.map((ma) =>
        ma.id === id ? { ...ma, period } : ma
      ),
    });
  };

  // Update other settings
  const updateSetting = <K extends "ribbon" | "rsi" | "macd">(
    key: K,
    updates: Partial<ChartMetricSettings[K]>
  ) => {
    onSettingsChange({
      ...settings,
      [key]: { ...settings[key], ...updates },
    });
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        padding: "6px 12px",
        backgroundColor: dark.bg.tertiary,
        borderBottom: `1px solid ${dark.border.primary}`,
        flexWrap: "wrap",
        gap: 6,
        minHeight: 36,
      }}
    >
      {/* Add MA button */}
      <div style={{ position: "relative" }}>
        <button
          ref={addButtonRef}
          onClick={() => setShowAddMA(!showAddMA)}
          style={{
            padding: "4px 10px",
            borderRadius: 4,
            border: `1px solid ${dark.accent.primary}`,
            backgroundColor: dark.accent.dark,
            color: dark.accent.light,
            cursor: "pointer",
            fontSize: 11,
            fontWeight: 500,
            display: "flex",
            alignItems: "center",
            gap: 4,
          }}
        >
          <span style={{ fontSize: 14, lineHeight: 1 }}>+</span>
          MA
        </button>
        <Popover
          isOpen={showAddMA}
          onClose={() => setShowAddMA(false)}
          anchorRef={addButtonRef}
        >
          <AddMAPopover
            onAdd={addMA}
            onClose={() => setShowAddMA(false)}
            nextColor={nextColor}
          />
        </Popover>
      </div>

      {/* List of active MAs */}
      {settings.movingAverages.map((ma) => (
        <MAChip
          key={ma.id}
          ma={ma}
          onRemove={() => removeMA(ma.id)}
          onEdit={(period) => editMA(ma.id, period)}
        />
      ))}

      {settings.movingAverages.length === 0 && (
        <span style={{ fontSize: 11, color: dark.text.muted, fontStyle: "italic" }}>
          Click +MA to add indicators
        </span>
      )}

      <div style={{ width: 1, height: 16, backgroundColor: dark.border.primary, margin: "0 4px" }} />

      {/* Ribbon (EMA-based) */}
      <div style={{ position: "relative", display: "inline-flex" }}>
        <button
          ref={ribbonRef}
          onClick={() => updateSetting("ribbon", { enabled: !settings.ribbon.enabled })}
          style={{
            padding: "4px 8px",
            borderRadius: "4px 0 0 4px",
            border: `1px solid ${settings.ribbon.enabled ? dark.accent.primary : dark.border.primary}`,
            backgroundColor: settings.ribbon.enabled ? dark.accent.dark : dark.bg.secondary,
            color: settings.ribbon.enabled ? dark.accent.light : dark.text.secondary,
            cursor: "pointer",
            fontSize: 11,
          }}
        >
          EMA Ribbon({settings.ribbon.count})
        </button>
        <button
          onClick={() => setShowRibbon(!showRibbon)}
          style={{
            padding: "4px 6px",
            borderRadius: "0 4px 4px 0",
            border: `1px solid ${settings.ribbon.enabled ? dark.accent.primary : dark.border.primary}`,
            borderLeft: "none",
            backgroundColor: settings.ribbon.enabled ? dark.accent.dark : dark.bg.secondary,
            color: settings.ribbon.enabled ? dark.accent.light : dark.text.secondary,
            cursor: "pointer",
            fontSize: 9,
          }}
        >
          ▼
        </button>
        <Popover isOpen={showRibbon} onClose={() => setShowRibbon(false)} anchorRef={ribbonRef}>
          <div style={{ marginBottom: 8 }}>
            <label style={{ display: "block", fontSize: 11, color: dark.text.secondary, marginBottom: 4 }}>Number of EMAs</label>
            <input
              type="number"
              value={settings.ribbon.count}
              onChange={(e) => updateSetting("ribbon", { count: parseInt(e.target.value) || 3 })}
              min={2}
              max={12}
              style={{ width: "100%", padding: "4px 8px", backgroundColor: dark.bg.secondary, border: `1px solid ${dark.border.primary}`, borderRadius: 4, color: dark.text.primary, fontSize: 13 }}
            />
          </div>
          <div style={{ marginBottom: 8 }}>
            <label style={{ display: "block", fontSize: 11, color: dark.text.secondary, marginBottom: 4 }}>Base Period</label>
            <input
              type="number"
              value={settings.ribbon.base}
              onChange={(e) => updateSetting("ribbon", { base: parseInt(e.target.value) || 9 })}
              min={1}
              max={200}
              style={{ width: "100%", padding: "4px 8px", backgroundColor: dark.bg.secondary, border: `1px solid ${dark.border.primary}`, borderRadius: 4, color: dark.text.primary, fontSize: 13 }}
            />
          </div>
          <div style={{ marginBottom: 8 }}>
            <label style={{ display: "block", fontSize: 11, color: dark.text.secondary, marginBottom: 4 }}>Step Between EMAs</label>
            <input
              type="number"
              value={settings.ribbon.step}
              onChange={(e) => updateSetting("ribbon", { step: parseInt(e.target.value) || 3 })}
              min={1}
              max={50}
              style={{ width: "100%", padding: "4px 8px", backgroundColor: dark.bg.secondary, border: `1px solid ${dark.border.primary}`, borderRadius: 4, color: dark.text.primary, fontSize: 13 }}
            />
          </div>
          <div style={{ fontSize: 10, color: dark.text.muted, marginTop: 4 }}>
            EMAs: {Array.from({ length: settings.ribbon.count }, (_, i) => settings.ribbon.base + i * settings.ribbon.step).join(", ")}
          </div>
        </Popover>
      </div>

      {/* RSI */}
      <div style={{ position: "relative", display: "inline-flex" }}>
        <button
          ref={rsiRef}
          onClick={() => updateSetting("rsi", { enabled: !settings.rsi.enabled })}
          style={{
            padding: "4px 8px",
            borderRadius: "4px 0 0 4px",
            border: `1px solid ${settings.rsi.enabled ? semantic.purple : dark.border.primary}`,
            backgroundColor: settings.rsi.enabled ? "#3d1f47" : dark.bg.secondary,
            color: settings.rsi.enabled ? "#ce93d8" : dark.text.secondary,
            cursor: "pointer",
            fontSize: 11,
          }}
        >
          RSI({settings.rsi.period})
        </button>
        <button
          onClick={() => setShowRSI(!showRSI)}
          style={{
            padding: "4px 6px",
            borderRadius: "0 4px 4px 0",
            border: `1px solid ${settings.rsi.enabled ? semantic.purple : dark.border.primary}`,
            borderLeft: "none",
            backgroundColor: settings.rsi.enabled ? "#3d1f47" : dark.bg.secondary,
            color: settings.rsi.enabled ? "#ce93d8" : dark.text.secondary,
            cursor: "pointer",
            fontSize: 9,
          }}
        >
          ▼
        </button>
        <Popover isOpen={showRSI} onClose={() => setShowRSI(false)} anchorRef={rsiRef}>
          <div>
            <label style={{ display: "block", fontSize: 11, color: dark.text.secondary, marginBottom: 4 }}>Period</label>
            <input
              type="number"
              value={settings.rsi.period}
              onChange={(e) => updateSetting("rsi", { period: parseInt(e.target.value) || 14 })}
              min={2}
              max={100}
              style={{ width: "100%", padding: "4px 8px", backgroundColor: dark.bg.secondary, border: `1px solid ${dark.border.primary}`, borderRadius: 4, color: dark.text.primary, fontSize: 13 }}
            />
          </div>
        </Popover>
      </div>

      {/* MACD */}
      <div style={{ position: "relative", display: "inline-flex" }}>
        <button
          ref={macdRef}
          onClick={() => updateSetting("macd", { enabled: !settings.macd.enabled })}
          style={{
            padding: "4px 8px",
            borderRadius: "4px 0 0 4px",
            border: `1px solid ${settings.macd.enabled ? semantic.info.alt : dark.border.primary}`,
            backgroundColor: settings.macd.enabled ? dark.accent.dark : dark.bg.secondary,
            color: settings.macd.enabled ? semantic.info.textLight : dark.text.secondary,
            cursor: "pointer",
            fontSize: 11,
          }}
        >
          MACD({settings.macd.fast},{settings.macd.slow},{settings.macd.signal})
        </button>
        <button
          onClick={() => setShowMACD(!showMACD)}
          style={{
            padding: "4px 6px",
            borderRadius: "0 4px 4px 0",
            border: `1px solid ${settings.macd.enabled ? semantic.info.alt : dark.border.primary}`,
            borderLeft: "none",
            backgroundColor: settings.macd.enabled ? dark.accent.dark : dark.bg.secondary,
            color: settings.macd.enabled ? semantic.info.textLight : dark.text.secondary,
            cursor: "pointer",
            fontSize: 9,
          }}
        >
          ▼
        </button>
        <Popover isOpen={showMACD} onClose={() => setShowMACD(false)} anchorRef={macdRef}>
          <div style={{ marginBottom: 8 }}>
            <label style={{ display: "block", fontSize: 11, color: dark.text.secondary, marginBottom: 4 }}>Fast EMA</label>
            <input
              type="number"
              value={settings.macd.fast}
              onChange={(e) => updateSetting("macd", { fast: parseInt(e.target.value) || 12 })}
              min={1}
              max={100}
              style={{ width: "100%", padding: "4px 8px", backgroundColor: dark.bg.secondary, border: `1px solid ${dark.border.primary}`, borderRadius: 4, color: dark.text.primary, fontSize: 13 }}
            />
          </div>
          <div style={{ marginBottom: 8 }}>
            <label style={{ display: "block", fontSize: 11, color: dark.text.secondary, marginBottom: 4 }}>Slow EMA</label>
            <input
              type="number"
              value={settings.macd.slow}
              onChange={(e) => updateSetting("macd", { slow: parseInt(e.target.value) || 26 })}
              min={1}
              max={100}
              style={{ width: "100%", padding: "4px 8px", backgroundColor: dark.bg.secondary, border: `1px solid ${dark.border.primary}`, borderRadius: 4, color: dark.text.primary, fontSize: 13 }}
            />
          </div>
          <div>
            <label style={{ display: "block", fontSize: 11, color: dark.text.secondary, marginBottom: 4 }}>Signal Line</label>
            <input
              type="number"
              value={settings.macd.signal}
              onChange={(e) => updateSetting("macd", { signal: parseInt(e.target.value) || 9 })}
              min={1}
              max={100}
              style={{ width: "100%", padding: "4px 8px", backgroundColor: dark.bg.secondary, border: `1px solid ${dark.border.primary}`, borderRadius: 4, color: dark.text.primary, fontSize: 13 }}
            />
          </div>
        </Popover>
      </div>

      {/* Clear all */}
      {settings.movingAverages.length > 0 && (
        <button
          onClick={() => onSettingsChange({ ...settings, movingAverages: [] })}
          style={{
            marginLeft: "auto",
            padding: "4px 8px",
            borderRadius: 4,
            border: `1px solid ${dark.border.primary}`,
            backgroundColor: "transparent",
            color: dark.text.muted,
            cursor: "pointer",
            fontSize: 11,
          }}
        >
          Clear MAs
        </button>
      )}
    </div>
  );
}
