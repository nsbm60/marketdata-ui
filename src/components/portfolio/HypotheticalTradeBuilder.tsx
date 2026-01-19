// src/components/portfolio/HypotheticalTradeBuilder.tsx
import { useState, useEffect, useCallback } from "react";
import { socketHub } from "../../ws/SocketHub";
import { light, semantic, fonts, pnl } from "../../theme";
import Select from "../shared/Select";

export interface HypotheticalTrade {
  osiSymbol?: string;
  symbol?: string;
  quantity: number;
  tradeDate: string;
  tradePrice?: number;
  scenarioPercent?: number;  // Price scenario at trade entry (e.g., -0.02 for -2%)
  iv?: number;  // Implied volatility for pricing (from chain data)
  enabled?: boolean;  // Whether this trade is included in simulation (default true)
}

type Props = {
  underlying: string;
  valuationDate: string;
  maxDate: string;
  trades: HypotheticalTrade[];
  scenarios: number[];  // Available scenarios from parent (e.g., [-0.10, -0.08, ..., 0.10])
  currentPrice: number;  // Current underlying price for estimating trade prices
  calculatedPrices?: Map<string, number>;  // OSI -> calculated entry price from simulation
  onChange: (trades: HypotheticalTrade[]) => void;
};

interface ChainOption {
  strike: number;
  expiry: string;
  callOsi: string;
  putOsi: string;
  callPrice?: number;
  putPrice?: number;
  callIv?: number;
  putIv?: number;
}

export default function HypotheticalTradeBuilder({
  underlying,
  valuationDate,
  maxDate,
  trades,
  scenarios,
  currentPrice,
  calculatedPrices,
  onChange,
}: Props) {
  const [expiries, setExpiries] = useState<string[]>([]);
  const [selectedExpiry, setSelectedExpiry] = useState<string>("");
  const [strikes, setStrikes] = useState<ChainOption[]>([]);
  const [selectedStrike, setSelectedStrike] = useState<number | null>(null);
  const [selectedRight, setSelectedRight] = useState<"C" | "P">("C");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [quantity, setQuantity] = useState<number>(1);
  const [tradeDate, setTradeDate] = useState<string>(valuationDate);
  const [selectedScenario, setSelectedScenario] = useState<number>(0);  // Default: 0% (current price)
  const [loading, setLoading] = useState(false);

  // Fetch expiries on mount
  useEffect(() => {
    if (!underlying) return;

    setLoading(true);
    socketHub.send({
      type: "control",
      target: "marketData",
      op: "find_expiries",
      id: `find_expiries_hyp_${Date.now()}`,
      underlying: underlying.toUpperCase(),
      expiry_days_max: 365,
    });

    const onMsg = (m: any) => {
      if (m?.type === "control.ack" && m?.op === "find_expiries") {
        setLoading(false);
        if (m.ok) {
          const data = m.data?.data || m.data || {};
          const und = data.underlying ? String(data.underlying) : "";
          if (und.toUpperCase() === underlying.toUpperCase()) {
            const expList: string[] = (data.expiries || []).map((e: any) =>
              String(e).replace(/\//g, "-")
            );
            setExpiries(expList);
            if (expList.length > 0 && !selectedExpiry) {
              setSelectedExpiry(expList[0]);
            }
          }
        }
      }
    };

    socketHub.onMessage(onMsg);
    return () => socketHub.offMessage(onMsg);
  }, [underlying, selectedExpiry]);

  // Fetch chain when expiry selected
  useEffect(() => {
    if (!underlying || !selectedExpiry) return;

    setLoading(true);
    socketHub.send({
      type: "control",
      target: "marketData",
      op: "get_chain",
      id: `get_chain_hyp_${Date.now()}`,
      underlying: underlying.toUpperCase(),
      expiry: selectedExpiry,
      limit: 50,
    });

    const onMsg = (m: any) => {
      if (m?.type === "control.ack" && m?.op === "get_chain") {
        setLoading(false);
        if (m.ok) {
          const data = m.data?.data || m.data || {};
          const und = data.underlying ? String(data.underlying) : "";
          if (und.toUpperCase() === underlying.toUpperCase()) {
            // Build strike list from contracts array
            const contracts: any[] = data.contracts || [];
            const strikeMap = new Map<number, ChainOption>();

            contracts.forEach((c: any) => {
              const strike = Number(c.strike);
              const type = c.type; // "call" or "put"
              const symbol = c.symbol || "";
              const price = c.lastPrice || c.theo || 0;

              if (!strikeMap.has(strike)) {
                strikeMap.set(strike, {
                  strike,
                  expiry: selectedExpiry,
                  callOsi: type === "call" ? symbol : "",
                  putOsi: type === "put" ? symbol : "",
                  callPrice: type === "call" ? price : undefined,
                  putPrice: type === "put" ? price : undefined,
                });
              } else {
                const opt = strikeMap.get(strike)!;
                if (type === "call") {
                  opt.callOsi = symbol;
                  opt.callPrice = price;
                } else if (type === "put") {
                  opt.putOsi = symbol;
                  opt.putPrice = price;
                }
              }
            });

            const sorted = Array.from(strikeMap.values()).sort(
              (a, b) => a.strike - b.strike
            );
            setStrikes(sorted);
            if (sorted.length > 0 && selectedStrike === null) {
              // Select ATM strike (middle)
              const midIdx = Math.floor(sorted.length / 2);
              setSelectedStrike(sorted[midIdx].strike);
            }
          }
        }
      }
    };

    socketHub.onMessage(onMsg);
    return () => socketHub.offMessage(onMsg);
  }, [underlying, selectedExpiry, selectedStrike]);

  // Update trade date when valuation date changes
  useEffect(() => {
    setTradeDate(valuationDate);
  }, [valuationDate]);

  const handleAdd = useCallback(() => {
    if (selectedStrike === null || quantity <= 0) return;

    const opt = strikes.find((s) => s.strike === selectedStrike);
    if (!opt) return;

    const osiSymbol = selectedRight === "C" ? opt.callOsi : opt.putOsi;
    if (!osiSymbol) return;

    // Get the option price from chain data
    const chainPrice = selectedRight === "C" ? opt.callPrice : opt.putPrice;

    // Apply sign based on buy/sell
    const signedQuantity = side === "buy" ? quantity : -quantity;

    const newTrade: HypotheticalTrade = {
      osiSymbol,
      quantity: signedQuantity,
      tradeDate,
      tradePrice: chainPrice,
      scenarioPercent: selectedScenario,
      enabled: true,
    };

    onChange([...trades, newTrade]);

    // Reset quantity
    setQuantity(1);
  }, [selectedStrike, selectedRight, side, quantity, tradeDate, selectedScenario, strikes, trades, onChange]);

  const handleRemove = useCallback(
    (index: number) => {
      onChange(trades.filter((_, i) => i !== index));
    },
    [trades, onChange]
  );

  const handleToggle = useCallback(
    (index: number) => {
      onChange(trades.map((t, i) =>
        i === index ? { ...t, enabled: !(t.enabled ?? true) } : t
      ));
    },
    [trades, onChange]
  );

  const formatOsi = (osi: string) => {
    // NVDA250221C00200000 -> NVDA 200C Feb21
    if (!osi || osi.length < 21) return osi;
    const symbol = osi.replace(/\d.*/, "");
    const dateStr = osi.substring(symbol.length, symbol.length + 6);
    const right = osi.charAt(symbol.length + 6);
    const strikeStr = osi.substring(symbol.length + 7);
    const strike = parseInt(strikeStr, 10) / 1000;

    const month = parseInt(dateStr.substring(2, 4), 10);
    const day = dateStr.substring(4, 6);
    const months = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

    return `${symbol} ${strike}${right} ${months[month]}${day}`;
  };

  const formatScenario = (pct: number) => {
    if (pct === 0) return "0%";
    return `${pct > 0 ? "+" : ""}${(pct * 100).toFixed(0)}%`;
  };

  const getSelectedPrice = () => {
    if (selectedStrike === null) return null;
    const opt = strikes.find((s) => s.strike === selectedStrike);
    if (!opt) return null;
    return selectedRight === "C" ? opt.callPrice : opt.putPrice;
  };

  const estimatedPrice = getSelectedPrice();

  return (
    <div style={container}>
      <div style={headerRow}>
        <span style={{ fontWeight: 500, fontSize: fonts.ui.body }}>
          Hypothetical Trades
        </span>
        {trades.length > 0 && (
          <span style={{ color: light.text.muted, fontSize: fonts.ui.caption }}>
            ({trades.length})
          </span>
        )}
      </div>

      <div style={content}>
        {/* Add trade form */}
        <div style={formRow}>
          <Select
            value={selectedExpiry}
            onChange={(e) => {
              setSelectedExpiry(e.target.value);
              setSelectedStrike(null);
            }}
            size="sm"
            disabled={loading}
          >
            <option value="">Expiry</option>
            {expiries.map((exp) => (
              <option key={exp} value={exp}>
                {formatExpiry(exp)}
              </option>
            ))}
          </Select>

          <Select
            value={selectedStrike ?? ""}
            onChange={(e) => setSelectedStrike(Number(e.target.value))}
            size="sm"
            disabled={loading || strikes.length === 0}
          >
            <option value="">Strike</option>
            {strikes.map((opt) => (
              <option key={opt.strike} value={opt.strike}>
                ${opt.strike}
              </option>
            ))}
          </Select>

          <div style={rightToggle}>
            <label style={rightLabel}>
              <input
                type="radio"
                checked={selectedRight === "C"}
                onChange={() => setSelectedRight("C")}
              />
              C
            </label>
            <label style={rightLabel}>
              <input
                type="radio"
                checked={selectedRight === "P"}
                onChange={() => setSelectedRight("P")}
              />
              P
            </label>
          </div>

          <div style={sideToggle}>
            <label style={{
              ...sideLabel,
              background: side === "buy" ? pnl.positive : undefined,
              color: side === "buy" ? "#fff" : undefined,
            }}>
              <input
                type="radio"
                checked={side === "buy"}
                onChange={() => setSide("buy")}
                style={{ display: "none" }}
              />
              Buy
            </label>
            <label style={{
              ...sideLabel,
              background: side === "sell" ? pnl.negative : undefined,
              color: side === "sell" ? "#fff" : undefined,
            }}>
              <input
                type="radio"
                checked={side === "sell"}
                onChange={() => setSide("sell")}
                style={{ display: "none" }}
              />
              Sell
            </label>
          </div>

          <input
            type="number"
            value={quantity}
            min={1}
            onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value, 10) || 1))}
            style={quantityInput}
            title="Quantity"
          />

          <input
            type="date"
            value={tradeDate}
            min={valuationDate}
            max={maxDate}
            onChange={(e) => setTradeDate(e.target.value)}
            style={dateInput}
            title="Trade date"
          />

          {/* Scenario selector */}
          <Select
            value={selectedScenario}
            onChange={(e) => setSelectedScenario(Number(e.target.value))}
            size="sm"
            style={{ minWidth: 50 }}
            title="Price scenario at trade entry"
          >
            {scenarios.map((pct) => (
              <option key={pct} value={pct}>
                {formatScenario(pct)}
              </option>
            ))}
          </Select>

          <button
            onClick={handleAdd}
            disabled={selectedStrike === null || quantity === 0}
            style={addButton}
          >
            Add
          </button>
        </div>

        {/* Estimated price display */}
        {estimatedPrice !== null && estimatedPrice > 0 && (
          <div style={priceHint}>
            Est. price: ${estimatedPrice.toFixed(2)} per contract
          </div>
        )}

        {/* Trade list */}
        {trades.length > 0 && (
          <div style={tradeList}>
            {trades.map((trade, idx) => {
              // Get calculated price from simulation results using composite key (osi:tradeDate)
              // This supports multiple trades of same option with different trade dates
              const priceKey = trade.osiSymbol ? `${trade.osiSymbol}:${trade.tradeDate}` : null;
              const displayPrice = priceKey
                ? calculatedPrices?.get(priceKey) ?? trade.tradePrice
                : trade.tradePrice;
              const isEnabled = trade.enabled ?? true;

              return (
                <div key={idx} style={{
                  ...tradeRow,
                  opacity: isEnabled ? 1 : 0.5,
                  textDecoration: isEnabled ? "none" : "line-through",
                }}>
                  <input
                    type="checkbox"
                    checked={isEnabled}
                    onChange={() => handleToggle(idx)}
                    style={{ marginRight: 4 }}
                    title={isEnabled ? "Disable trade" : "Enable trade"}
                  />
                  <span style={{ flex: 1, fontStyle: "italic" }}>
                    <span style={{ color: trade.quantity > 0 ? semantic.success.text : semantic.error.text }}>
                      {trade.quantity > 0 ? "Buy" : "Sell"}
                    </span>
                    {" "}{Math.abs(trade.quantity)} {trade.osiSymbol ? formatOsi(trade.osiSymbol) : trade.symbol}
                    {displayPrice !== undefined && displayPrice > 0 && (
                      <span style={{ color: semantic.info.text, marginLeft: 4 }}>
                        @${displayPrice.toFixed(2)}
                      </span>
                    )}
                    {trade.scenarioPercent !== undefined && trade.scenarioPercent !== 0 && (
                      <span style={{ color: light.text.muted, marginLeft: 4 }}>
                        ({formatScenario(trade.scenarioPercent)})
                      </span>
                    )}
                  </span>
                  <span style={{ color: light.text.muted, fontSize: fonts.table.small }}>
                    {trade.tradeDate}
                  </span>
                  <button
                    onClick={() => handleRemove(idx)}
                    style={removeButton}
                    title="Remove trade"
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function formatExpiry(dateStr: string): string {
  const [year, month, day] = dateStr.split("-");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const m = parseInt(month, 10) - 1;
  return `${months[m]} ${parseInt(day, 10)}`;
}

// Styles
const container: React.CSSProperties = {
  borderRadius: 4,
  border: `1px solid ${light.border.primary}`,
  background: light.bg.secondary,
};

const headerRow: React.CSSProperties = {
  padding: "4px 8px",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  borderBottom: `1px solid ${light.border.primary}`,
};

const content: React.CSSProperties = {
  padding: "6px 8px 8px",
};

const formRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  flexWrap: "wrap",
};

const rightToggle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 4,
};

const rightLabel: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
};

const sideToggle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  border: `1px solid ${light.border.primary}`,
  borderRadius: 3,
  overflow: "hidden",
};

const sideLabel: React.CSSProperties = {
  padding: "2px 6px",
  fontSize: fonts.ui.caption,
  cursor: "pointer",
  fontWeight: 500,
};

const quantityInput: React.CSSProperties = {
  width: 50,
  padding: "2px 4px",
  fontSize: fonts.ui.caption,
  borderRadius: 3,
  border: `1px solid ${light.border.primary}`,
  textAlign: "center",
};

const dateInput: React.CSSProperties = {
  padding: "2px 4px",
  fontSize: fonts.ui.caption,
  borderRadius: 3,
  border: `1px solid ${light.border.primary}`,
};

const addButton: React.CSSProperties = {
  padding: "2px 10px",
  fontSize: fonts.ui.caption,
  background: semantic.info.bg,
  border: `1px solid ${semantic.info.text}`,
  borderRadius: 3,
  cursor: "pointer",
  color: semantic.info.text,
  fontWeight: 600,
};

const priceHint: React.CSSProperties = {
  marginTop: 4,
  fontSize: fonts.table.small,
  color: light.text.muted,
  fontStyle: "italic",
};

const tradeList: React.CSSProperties = {
  marginTop: 6,
  display: "flex",
  flexDirection: "column",
  gap: 2,
};

const tradeRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "2px 4px",
  background: light.bg.muted,
  borderRadius: 3,
  fontSize: fonts.table.cell,
};

const removeButton: React.CSSProperties = {
  width: 18,
  height: 18,
  padding: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 14,
  background: "transparent",
  border: "none",
  cursor: "pointer",
  color: semantic.error.text,
  fontWeight: 700,
};
