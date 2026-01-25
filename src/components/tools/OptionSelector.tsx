/**
 * OptionSelector - Component for selecting an option contract.
 *
 * Selection flow:
 * 1. Enter underlying ticker
 * 2. Select expiry from dropdown (fetched via find_expiries)
 * 3. Select strike and right (call/put) from grid
 */

import { useState, useEffect, useMemo } from "react";
import { socketHub } from "../../ws/SocketHub";
import { useOptionsReport, type OptionsReportRow } from "../../hooks/useOptionsReport";
import Select from "../shared/Select";
import { light } from "../../theme";
import { fmtPrice } from "../../utils/formatters";
import { formatExpiryWithDTE } from "../../utils/options";

export interface SelectedOption {
  osiSymbol: string;
  underlying: string;
  expiry: string;
  strike: number;
  right: "C" | "P";
  iv?: number;
  delta?: number;
  gamma?: number;
  theta?: number;
  vega?: number;
  bid?: number;
  ask?: number;
  mid?: number;
  last?: number;
}

interface OptionSelectorProps {
  onSelect: (option: SelectedOption | null) => void;
  initialUnderlying?: string;
}

export default function OptionSelector({ onSelect, initialUnderlying }: OptionSelectorProps) {
  // Selection state
  const [underlying, setUnderlying] = useState(initialUnderlying || "");
  const [inputValue, setInputValue] = useState(initialUnderlying || "");
  const [expiries, setExpiries] = useState<string[]>([]);
  const [selectedExpiry, setSelectedExpiry] = useState<string | null>(null);
  const [selectedStrike, setSelectedStrike] = useState<number | null>(null);
  const [selectedRight, setSelectedRight] = useState<"C" | "P" | null>(null);

  // Loading states
  const [loadingExpiries, setLoadingExpiries] = useState(false);

  // Options report from CalcServer
  const { report: optionsReport, loaded: reportLoaded } = useOptionsReport(
    underlying,
    selectedExpiry || "",
    !!underlying && !!selectedExpiry
  );

  // Fetch expiries when underlying changes
  const fetchExpiries = (ticker: string) => {
    if (!ticker) return;
    const und = ticker.toUpperCase();
    setLoadingExpiries(true);
    setExpiries([]);
    setSelectedExpiry(null);
    setSelectedStrike(null);
    setSelectedRight(null);

    socketHub.send({
      type: "control",
      target: "marketData",
      op: "find_expiries",
      id: `find_expiries_${Date.now()}`,
      underlying: und,
      expiry_days_max: 365,
    });
  };

  // Handle control messages
  useEffect(() => {
    const onMsg = (m: any) => {
      if (m?.type === "control.ack" && m?.op === "find_expiries") {
        setLoadingExpiries(false);
        if (m.ok) {
          const data = m.data?.data || m.data || {};
          const expiryList = Array.isArray(data.expiries) ? data.expiries : [];
          setExpiries(expiryList.map(String).filter(Boolean));

          // Auto-select first expiry
          if (expiryList.length > 0) {
            const firstExpiry = String(expiryList[0]);
            setSelectedExpiry(firstExpiry);
            loadChain(underlying, firstExpiry);
          }
        }
      }
    };

    socketHub.onMessage(onMsg);
    return () => socketHub.offMessage(onMsg);
  }, [underlying]);

  // Load chain for expiry
  const loadChain = (und: string, expiry: string) => {
    if (!und || !expiry) return;

    // Request MarketData to subscribe to option chain
    socketHub.send({
      type: "control",
      target: "marketData",
      op: "get_chain",
      id: `get_chain_${Date.now()}`,
      underlying: und,
      expiry: expiry,
      limit: 200,
    });

    // Request CalcServer to start OptionsReportBuilder
    socketHub.send({
      type: "control",
      target: "calc",
      op: "start_options_report",
      id: `start_options_report_${Date.now()}`,
      underlying: und,
      expiry: expiry,
    });
  };

  // Handle strike/right selection
  const handleSelectStrikeRight = (strike: number, right: "C" | "P") => {
    setSelectedStrike(strike);
    setSelectedRight(right);

    // Find the row and leg data
    const row = optionsReport?.rows.find(r => r.strike === strike);
    const leg = right === "C" ? row?.call : row?.put;

    if (leg?.symbol) {
      onSelect({
        osiSymbol: leg.symbol,
        underlying,
        expiry: selectedExpiry!,
        strike,
        right,
        iv: leg.iv,
        delta: leg.delta,
        gamma: leg.gamma,
        theta: leg.theta,
        vega: leg.vega,
        bid: leg.bid,
        ask: leg.ask,
        mid: leg.mid,
        last: leg.last,
      });
    }
  };

  // Handle underlying input
  const handleUnderlyingSubmit = () => {
    const ticker = inputValue.toUpperCase().trim();
    if (ticker && ticker !== underlying) {
      setUnderlying(ticker);
      fetchExpiries(ticker);
    }
  };

  // Filter rows around ATM for display
  const displayRows = useMemo(() => {
    if (!optionsReport?.rows) return [];
    const atmIndex = optionsReport.atmIndex ?? 0;
    const start = Math.max(0, atmIndex - 10);
    const end = Math.min(optionsReport.rows.length, atmIndex + 11);
    return optionsReport.rows.slice(start, end);
  }, [optionsReport]);

  return (
    <div style={container as any}>
      {/* Underlying input */}
      <div style={section as any}>
        <label style={label as any}>Underlying</label>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === "Enter" && handleUnderlyingSubmit()}
            placeholder="Enter ticker (e.g., NVDA)"
            style={input as any}
          />
          <button
            onClick={handleUnderlyingSubmit}
            disabled={!inputValue || loadingExpiries}
            style={button as any}
          >
            {loadingExpiries ? "Loading..." : "Load"}
          </button>
        </div>
      </div>

      {/* Expiry dropdown */}
      {expiries.length > 0 && (
        <div style={section as any}>
          <label style={label as any}>Expiry</label>
          <Select
            value={selectedExpiry || ""}
            onChange={(e) => {
              const exp = e.target.value;
              setSelectedExpiry(exp);
              setSelectedStrike(null);
              setSelectedRight(null);
              loadChain(underlying, exp);
            }}
            style={{ width: "100%" }}
          >
            {expiries.map((exp) => (
              <option key={exp} value={exp}>
                {formatExpiryWithDTE(exp)}
              </option>
            ))}
          </Select>
        </div>
      )}

      {/* Strike/Right grid */}
      {selectedExpiry && displayRows.length > 0 && (
        <div style={section as any}>
          <label style={label as any}>Strike &amp; Type</label>
          <div style={strikeGrid as any}>
            {/* Header */}
            <div style={gridHeader as any}>
              <div style={gridCell as any}>Call</div>
              <div style={gridCell as any}>Strike</div>
              <div style={gridCell as any}>Put</div>
            </div>

            {/* Rows */}
            {displayRows.map((row) => {
              const isSelected = row.strike === selectedStrike;
              return (
                <div key={row.strike} style={gridRow as any}>
                  <div
                    style={{
                      ...gridCell,
                      ...(isSelected && selectedRight === "C" ? selectedCell : {}),
                      cursor: "pointer",
                    } as any}
                    onClick={() => handleSelectStrikeRight(row.strike, "C")}
                  >
                    {row.call?.mid ? fmtPrice(row.call.mid) : "-"}
                  </div>
                  <div style={{ ...gridCell, fontWeight: 600, background: "#e8f4f8" } as any}>
                    {fmtPrice(row.strike)}
                  </div>
                  <div
                    style={{
                      ...gridCell,
                      ...(isSelected && selectedRight === "P" ? selectedCell : {}),
                      cursor: "pointer",
                    } as any}
                    onClick={() => handleSelectStrikeRight(row.strike, "P")}
                  >
                    {row.put?.mid ? fmtPrice(row.put.mid) : "-"}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Current selection summary */}
          {selectedStrike && selectedRight && (
            <div style={selectionSummary as any}>
              Selected: {underlying} {selectedExpiry} ${selectedStrike} {selectedRight === "C" ? "Call" : "Put"}
            </div>
          )}
        </div>
      )}

      {/* Loading state */}
      {selectedExpiry && !reportLoaded && (
        <div style={{ padding: 12, color: light.text.muted, textAlign: "center" }}>
          Loading option chain...
        </div>
      )}
    </div>
  );
}

/* ---- Styles ---- */
const container = {
  display: "flex",
  flexDirection: "column" as const,
  gap: 16,
  padding: 16,
  background: light.bg.primary,
  borderRadius: 8,
  border: `1px solid ${light.border.primary}`,
};

const section = {
  display: "flex",
  flexDirection: "column" as const,
  gap: 6,
};

const label = {
  fontSize: 12,
  fontWeight: 600,
  color: light.text.secondary,
};

const input = {
  flex: 1,
  padding: "8px 12px",
  fontSize: 14,
  border: `1px solid ${light.border.primary}`,
  borderRadius: 4,
  outline: "none",
};

const button = {
  padding: "8px 16px",
  fontSize: 14,
  fontWeight: 600,
  background: light.bg.tertiary,
  border: `1px solid ${light.border.primary}`,
  borderRadius: 4,
  cursor: "pointer",
};

const strikeGrid = {
  display: "flex",
  flexDirection: "column" as const,
  border: `1px solid ${light.border.primary}`,
  borderRadius: 4,
  maxHeight: 300,
  overflowY: "auto" as const,
};

const gridHeader = {
  display: "grid",
  gridTemplateColumns: "1fr 80px 1fr",
  background: light.bg.tertiary,
  fontWeight: 600,
  fontSize: 11,
  color: light.text.secondary,
  position: "sticky" as const,
  top: 0,
};

const gridRow = {
  display: "grid",
  gridTemplateColumns: "1fr 80px 1fr",
  borderTop: `1px solid ${light.border.muted}`,
};

const gridCell = {
  padding: "6px 8px",
  fontSize: 12,
  textAlign: "center" as const,
  fontVariantNumeric: "tabular-nums",
};

const selectedCell = {
  background: "#d4edda",
  fontWeight: 600,
};

const selectionSummary = {
  marginTop: 8,
  padding: "8px 12px",
  background: light.bg.tertiary,
  borderRadius: 4,
  fontSize: 13,
  fontWeight: 600,
};
