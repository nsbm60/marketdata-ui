// src/OptionPanel.tsx
import { Fragment, useEffect, useMemo, useState } from "react";
import { socketHub } from "./ws/SocketHub";
import OptionTradeTicket from "./components/OptionTradeTicket";
import TradeButton, { tradeButtonContainerCompact } from "./components/shared/TradeButton";
import { useOptionsReport } from "./hooks/useOptionsReport";
import { isNum, fmtPrice, fmtGreek } from "./utils/formatters";
import { formatExpiryWithDTE } from "./utils/options";
import Select from "./components/shared/Select";
import { light, dark, semantic } from "./theme";

/** ---------- Component ---------- */
export default function OptionPanel({ ticker }: { ticker?: string }) {
  const [underlying, setUnderlying] = useState<string>("");
  const [expiries, setExpiries] = useState<string[]>([]);
  const [selectedExpiry, setSelectedExpiry] = useState<string | null>(null);
  const [expiryDaysMax, setExpiryDaysMax] = useState<number>(100);
  const [limit, setLimit] = useState<number>(200);
  const [wsOpen, setWsOpen] = useState<boolean>(false);
  const [loadingExpiries, setLoadingExpiries] = useState<boolean>(false);
  const [loadingChain, setLoadingChain] = useState<boolean>(false);
  const [atmStrikesBelow, setAtmStrikesBelow] = useState<number>(0);

  // Row selection (expiration + strike)
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  // Open interest by strike (from get_chain response)
  const [openInterest, setOpenInterest] = useState<Map<number, { call?: number; put?: number }>>(new Map());

  // Trade ticket state
  const [showTradeTicket, setShowTradeTicket] = useState(false);
  const [ticketUnderlying, setTicketUnderlying] = useState("");
  const [ticketStrike, setTicketStrike] = useState(0);
  const [ticketExpiry, setTicketExpiry] = useState("");
  const [ticketRight, setTicketRight] = useState<"C" | "P">("C");
  const [ticketSide, setTicketSide] = useState<"BUY" | "SELL">("BUY");
  const [ticketAccount] = useState("DU333427");
  const [ticketMarketData, setTicketMarketData] = useState<any>({});

  // Pre-computed options data from CalcServer
  const { report: optionsReport, loaded: reportLoaded } = useOptionsReport(
    underlying,
    selectedExpiry || "",
    !!underlying && !!selectedExpiry
  );

  // Load expiries when ticker changes
  useEffect(() => {
    if (!ticker) {
      setUnderlying("");
      setExpiries([]);
      setSelectedExpiry(null);
      setAtmStrikesBelow(0);
      setSelectedKey(null);
    } else {
      setUnderlying(ticker.toUpperCase());
      loadExpiries(ticker.toUpperCase(), expiryDaysMax);
    }
  }, [ticker]);

  const openTradeTicket = (
    underlying: string,
    strike: number,
    expiry: string,
    right: "C" | "P",
    side: "BUY" | "SELL",
    marketData: any
  ) => {
    setTicketUnderlying(underlying);
    setTicketStrike(strike);
    setTicketExpiry(expiry);
    setTicketRight(right);
    setTicketSide(side);
    setTicketMarketData(marketData);
    setShowTradeTicket(true);
  };

  const loadExpiries = (und: string, days: number) => {
    if (!und) return;
    console.log("[OptionPanel] loadExpiries:", und, "days:", days);
    setLoadingExpiries(true);
    socketHub.send({
      type: "control",
      target: "marketData",
      op: "find_expiries",
      id: `find_expiries_${Date.now()}`,
      underlying: und,
      expiry_days_max: days,
    });
  };

  const loadChain = (und: string, expiry: string, lim: number) => {
    if (!und || !expiry) return;
    console.log("[OptionPanel] loadChain:", und, "expiry:", expiry, "limit:", lim);
    setLoadingChain(true);

    // Request MarketData to subscribe to option chain ticks
    socketHub.send({
      type: "control",
      target: "marketData",
      op: "get_chain",
      id: `get_chain_${Date.now()}`,
      underlying: und,
      expiry: expiry,
      limit: lim,
    });

    // Request CalcServer to start OptionsReportBuilder for this chain
    socketHub.send({
      type: "control",
      target: "calc",
      op: "start_options_report",
      id: `start_options_report_${Date.now()}`,
      underlying: und,
      expiry: expiry,
    });
  };

  // Handle control messages (find_expiries, get_chain responses)
  useEffect(() => {
    const onMsg = (m: any) => {
      // Handle find_expiries response
      if (m?.type === "control.ack" && m?.op === "find_expiries") {
        console.log("[OptionPanel] find_expiries response:", m.ok, m.data);
        setLoadingExpiries(false);
        if (m.ok) {
          const data = m.data?.data || m.data || {};
          const und = data.underlying ? String(data.underlying) : "";

          if (und) setUnderlying(und);

          const expiryList = Array.isArray(data.expiries) ? data.expiries : [];
          setExpiries(expiryList.map(String).filter(Boolean));

          // Auto-select and load first expiry
          if (expiryList.length > 0) {
            const firstExpiry = String(expiryList[0]);
            setSelectedExpiry(firstExpiry);

            if (und && firstExpiry) {
              loadChain(und, firstExpiry, limit);
            }
          }
        }
      }

      // Handle get_chain response
      if (m?.type === "control.ack" && m?.op === "get_chain") {
        console.log("[OptionPanel] get_chain response:", m.ok, m.data?.underlying || m.data?.data?.underlying);
        setLoadingChain(false);
        if (m.ok) {
          const data = m.data?.data || m.data || {};

          const responseUnderlying = data.underlying ? String(data.underlying) : "";
          if (ticker && responseUnderlying && responseUnderlying !== ticker.toUpperCase()) {
            return; // Ignore responses for other tickers
          }

          if (data.underlying) setUnderlying(String(data.underlying));
          if (data.expiry) setSelectedExpiry(String(data.expiry));
          if (data.strikes_below !== undefined) {
            setAtmStrikesBelow(Number(data.strikes_below) || 0);
          }

          // Extract open interest from contracts
          if (Array.isArray(data.contracts)) {
            const oiMap = new Map<number, { call?: number; put?: number }>();
            for (const c of data.contracts) {
              const strike = Number(c.strike);
              const oi = c.open_interest;
              const type = c.type; // "call" or "put"
              if (!oiMap.has(strike)) {
                oiMap.set(strike, {});
              }
              const entry = oiMap.get(strike)!;
              if (type === "call") {
                entry.call = oi;
              } else if (type === "put") {
                entry.put = oi;
              }
            }
            setOpenInterest(oiMap);
          }
        }
      }

      if (m?.type === "ready") {
        setWsOpen(true);
      }
    };

    socketHub.onMessage(onMsg);
    socketHub.connect();
    return () => socketHub.offMessage(onMsg);
  }, [ticker, limit]);

  // Build rows from CalcServer's OptionsReport
  const rows = useMemo(() => {
    if (!ticker || !selectedExpiry || !optionsReport || !reportLoaded) return [];

    return optionsReport.rows.map((r) => {
      const oi = openInterest.get(r.strike);
      return {
        strike: r.strike,
        cLast: r.call?.last,
        cBid: r.call?.bid,
        cMid: r.call?.mid,
        cAsk: r.call?.ask,
        cDelta: r.call?.delta,
        cGamma: r.call?.gamma,
        cTheta: r.call?.theta,
        cVega: r.call?.vega,
        cIv: r.call?.iv,
        cOI: oi?.call,
        pLast: r.put?.last,
        pBid: r.put?.bid,
        pMid: r.put?.mid,
        pAsk: r.put?.ask,
        pDelta: r.put?.delta,
        pGamma: r.put?.gamma,
        pTheta: r.put?.theta,
        pVega: r.put?.vega,
        pIv: r.put?.iv,
        pOI: oi?.put,
      };
    });
  }, [ticker, selectedExpiry, optionsReport, reportLoaded, openInterest]);

  /** ---------- Render ---------- */
  return (
    <div style={shell as any}>
      {/* Panel header */}
      <div style={panelHeader as any}>
        <div style={hdrRow as any}>
          <div style={{ fontWeight: 700 }}>Options</div>
        </div>

        {/* Controls row */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 12 }}>
          {underlying ? (
            <>
              <div>
                <b>{underlying}</b>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <label style={{ fontSize: 11, color: light.text.muted }}>Limit:</label>
                <Select
                  value={limit}
                  onChange={(e) => {
                    const newLimit = Number(e.target.value);
                    setLimit(newLimit);
                    if (selectedExpiry) {
                      loadChain(underlying, selectedExpiry, newLimit);
                    }
                  }}
                >
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                  <option value={200}>200</option>
                  <option value={500}>500</option>
                </Select>
              </div>
              {expiries.length > 0 && (
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <button
                    onClick={() => {
                      const newDays = expiryDaysMax === 100 ? 365 : expiryDaysMax === 365 ? 730 : 100;
                      setExpiryDaysMax(newDays);
                      loadExpiries(underlying, newDays);
                    }}
                    style={{ fontSize: 11, padding: "2px 8px", cursor: "pointer" }}
                  >
                    {expiryDaysMax === 100 ? "Show 1 year" : expiryDaysMax === 365 ? "Show 2 years" : "Show 100 days"}
                  </button>
                </div>
              )}
            </>
          ) : (
            <span style={{ color: light.text.muted }}>Select a symbol on the left to load options...</span>
          )}
        </div>

        {/* Expiry tabs */}
        {expiries.length > 0 && (
          <div style={expiryTabs as any}>
            {expiries.map((exp) => (
              <button
                key={exp}
                onClick={() => {
                  setSelectedExpiry(exp);
                  loadChain(underlying, exp, limit);
                }}
                style={{
                  ...(selectedExpiry === exp ? expiryTabActive : expiryTab),
                  ...(loadingChain && selectedExpiry === exp ? { opacity: 0.6 } : {}),
                } as any}
              >
                {formatExpiryWithDTE(exp)}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Scroll area with two-level sticky header */}
      <div style={bodyScroll as any}>
        {loadingExpiries ? (
          <div style={empty as any}>Loading expiries...</div>
        ) : loadingChain ? (
          <div style={empty as any}>Loading chain...</div>
        ) : !underlying ? (
          <div style={empty as any}>No underlying selected.</div>
        ) : !selectedExpiry ? (
          <div style={empty as any}>Select an expiry date.</div>
        ) : rows.length === 0 ? (
          <div style={empty as any}>Waiting for option data...</div>
        ) : (
          <>
            {/* Level 1 header: Calls | Strike | Puts (sticky) */}
            <div style={stickyHeader as any}>
              <div style={hdrRow1 as any}>
                <div style={{ ...thBlock, textAlign: "center" } as any}>Calls</div>
                <div style={{ ...thBlock, textAlign: "center", background: "#e8f4f8" } as any}>Strike</div>
                <div style={{ ...thBlock, textAlign: "center" } as any}>Puts</div>
              </div>
              {/* Level 2 header */}
              <div style={hdrRow2 as any}>
                <div style={subgrid10 as any}>
                  <div style={subTh as any}>Trade</div>
                  <div style={subTh as any}>Last</div>
                  <div style={subTh as any}>Bid</div>
                  <div style={subTh as any}>Ask</div>
                  <div style={subTh as any}>Δ</div>
                  <div style={subTh as any}>Γ</div>
                  <div style={subTh as any}>Θ</div>
                  <div style={subTh as any}>Vega</div>
                  <div style={subTh as any}>IV</div>
                  <div style={subTh as any}>OI</div>
                </div>
                <div style={{ ...subTh, background: "#e8f4f8" } as any}>{/* strike subheader empty */}</div>
                <div style={subgrid10 as any}>
                  <div style={subTh as any}>OI</div>
                  <div style={subTh as any}>Last</div>
                  <div style={subTh as any}>Bid</div>
                  <div style={subTh as any}>Ask</div>
                  <div style={subTh as any}>Δ</div>
                  <div style={subTh as any}>Γ</div>
                  <div style={subTh as any}>Θ</div>
                  <div style={subTh as any}>Vega</div>
                  <div style={subTh as any}>IV</div>
                  <div style={subTh as any}>Trade</div>
                </div>
              </div>
            </div>

            {/* Content - single expiry */}
            <div style={{ margin: "6px 0" }}>
              {rows.map((r, idx) => {
                const rowKey = `${selectedExpiry}:${r.strike}`;
                const isSelected = selectedKey === rowKey;
                const showDivider = atmStrikesBelow > 0 && idx === atmStrikesBelow;

                const baseCell = {
                  ...td,
                  background: isSelected ? semantic.highlight.yellow : light.bg.primary,
                } as any;

                return (
                  <Fragment key={rowKey}>
                    {showDivider && <div style={atmDivider as any} />}
                    <div
                      style={{ ...row21, cursor: "pointer" } as any}
                      onClick={() => setSelectedKey(rowKey)}
                    >
                      {/* Call Trade Buttons */}
                      <div style={{ ...baseCell, ...tradeButtonContainerCompact }}>
                        <TradeButton
                          side="BUY"
                          compact
                          onClick={(e) => {
                            e.stopPropagation();
                            openTradeTicket(underlying, r.strike, selectedExpiry, "C", "BUY", {
                              last: r.cLast, bid: r.cBid, ask: r.cAsk, mid: r.cMid,
                              delta: r.cDelta, gamma: r.cGamma, theta: r.cTheta, vega: r.cVega, iv: r.cIv,
                            });
                          }}
                        />
                        <TradeButton
                          side="SELL"
                          compact
                          onClick={(e) => {
                            e.stopPropagation();
                            openTradeTicket(underlying, r.strike, selectedExpiry, "C", "SELL", {
                              last: r.cLast, bid: r.cBid, ask: r.cAsk, mid: r.cMid,
                              delta: r.cDelta, gamma: r.cGamma, theta: r.cTheta, vega: r.cVega, iv: r.cIv,
                            });
                          }}
                        />
                      </div>

                      {/* Calls: Last | Bid | Ask | Greeks | OI */}
                      <div style={{ ...baseCell, textAlign: "right" }}>{fmtPrice(r.cLast)}</div>
                      <div style={{ ...baseCell, textAlign: "right" }}>{fmtPrice(r.cBid)}</div>
                      <div style={{ ...baseCell, textAlign: "right" }}>{fmtPrice(r.cAsk)}</div>
                      <div style={{ ...baseCell, textAlign: "right" }}>{fmtGreek(r.cDelta)}</div>
                      <div style={{ ...baseCell, textAlign: "right" }}>{fmtGreek(r.cGamma)}</div>
                      <div style={{ ...baseCell, textAlign: "right" }}>{fmtGreek(r.cTheta)}</div>
                      <div style={{ ...baseCell, textAlign: "right" }}>{fmtGreek(r.cVega)}</div>
                      <div style={{ ...baseCell, textAlign: "right" }}>{fmtGreek(r.cIv)}</div>
                      <div style={{ ...baseCell, textAlign: "right" }}>{fmtOI(r.cOI)}</div>

                      {/* Strike */}
                      <div style={{ ...baseCell, ...strikeCell }}>
                        {fmtPrice(r.strike)}
                      </div>

                      {/* Puts: OI | Last | Bid | Ask | Greeks */}
                      <div style={{ ...baseCell, textAlign: "right" }}>{fmtOI(r.pOI)}</div>
                      <div style={{ ...baseCell, textAlign: "right" }}>{fmtPrice(r.pLast)}</div>
                      <div style={{ ...baseCell, textAlign: "right" }}>{fmtPrice(r.pBid)}</div>
                      <div style={{ ...baseCell, textAlign: "right" }}>{fmtPrice(r.pAsk)}</div>
                      <div style={{ ...baseCell, textAlign: "right" }}>{fmtGreek(r.pDelta)}</div>
                      <div style={{ ...baseCell, textAlign: "right" }}>{fmtGreek(r.pGamma)}</div>
                      <div style={{ ...baseCell, textAlign: "right" }}>{fmtGreek(r.pTheta)}</div>
                      <div style={{ ...baseCell, textAlign: "right" }}>{fmtGreek(r.pVega)}</div>
                      <div style={{ ...baseCell, textAlign: "right" }}>{fmtGreek(r.pIv)}</div>

                      {/* Put Trade Buttons */}
                      <div style={{ ...baseCell, ...tradeButtonContainerCompact }}>
                        <TradeButton
                          side="BUY"
                          compact
                          onClick={(e) => {
                            e.stopPropagation();
                            openTradeTicket(underlying, r.strike, selectedExpiry, "P", "BUY", {
                              last: r.pLast, bid: r.pBid, ask: r.pAsk, mid: r.pMid,
                              delta: r.pDelta, gamma: r.pGamma, theta: r.pTheta, vega: r.pVega, iv: r.pIv,
                            });
                          }}
                        />
                        <TradeButton
                          side="SELL"
                          compact
                          onClick={(e) => {
                            e.stopPropagation();
                            openTradeTicket(underlying, r.strike, selectedExpiry, "P", "SELL", {
                              last: r.pLast, bid: r.pBid, ask: r.pAsk, mid: r.pMid,
                              delta: r.pDelta, gamma: r.pGamma, theta: r.pTheta, vega: r.pVega, iv: r.pIv,
                            });
                          }}
                        />
                      </div>
                    </div>
                  </Fragment>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Trade Ticket */}
      {showTradeTicket && (
        <div style={{ position: "fixed", bottom: 24, right: 24, zIndex: 1000 }}>
          <OptionTradeTicket
            key={`${ticketUnderlying}-${ticketStrike}-${ticketExpiry}-${ticketRight}`}
            underlying={ticketUnderlying}
            strike={ticketStrike}
            expiry={ticketExpiry}
            right={ticketRight}
            account={ticketAccount}
            defaultSide={ticketSide}
            last={ticketMarketData.last}
            bid={ticketMarketData.bid}
            ask={ticketMarketData.ask}
            mid={ticketMarketData.mid}
            delta={ticketMarketData.delta}
            gamma={ticketMarketData.gamma}
            theta={ticketMarketData.theta}
            vega={ticketMarketData.vega}
            iv={ticketMarketData.iv}
            onClose={() => setShowTradeTicket(false)}
          />
        </div>
      )}
    </div>
  );
}

/** ---------- Helpers ---------- */
function num(v: any): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
function mid(b?: number, a?: number, last?: number) {
  if (isNum(b) && isNum(a)) return ((b as number) + (a as number)) / 2;
  if (isNum(last)) return last as number;
  return undefined;
}
function fmtOI(v?: number): string {
  if (v === undefined || v === null) return "-";
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return v.toString();
}

/** ---------- Styles ---------- */
const shell = {
  display: "flex",
  flexDirection: "column" as const,
  height: "100%",
  background: light.bg.primary,
  color: light.text.primary,
  borderLeft: `1px solid ${light.border.primary}`,
};

const panelHeader = {
  padding: "6px 8px",
  borderBottom: `1px solid ${light.border.muted}`,
  background: light.bg.primary,
  display: "grid",
  gap: 4,
};

const hdrRow = { display: "flex", alignItems: "center", gap: 8 };

const expiryTabs = {
  display: "flex",
  gap: 4,
  overflowX: "auto" as const,
  padding: "4px 0",
};

const expiryTab = {
  padding: "4px 12px",
  fontSize: 11,
  background: light.bg.hover,
  border: `1px solid ${light.border.secondary}`,
  borderRadius: 4,
  cursor: "pointer",
  whiteSpace: "nowrap" as const,
  color: light.text.primary,
};

const expiryTabActive = {
  ...expiryTab,
  background: semantic.highlight.blue,
  border: `1px solid ${dark.accent.primary}`,
  fontWeight: 600,
  color: light.text.primary,
};

const bodyScroll = {
  flex: 1,
  overflow: "auto",
  position: "relative" as const,
  background: light.bg.primary,
};

const stickyHeader = {
  position: "sticky" as const,
  top: 0,
  zIndex: 5,
  background: light.bg.primary,
  borderBottom: `1px solid ${light.border.primary}`,
};

const hdrRow1 = {
  display: "grid",
  gridTemplateColumns: "520px 70px 520px",
  columnGap: 0,
  alignItems: "stretch",
  padding: 0,
};

const thBlock = {
  fontSize: 11,
  fontWeight: 700,
  color: light.text.secondary,
  background: light.bg.tertiary,
  padding: "2px 4px",
  border: `1px solid ${light.border.primary}`,
  borderRadius: 0,
  whiteSpace: "nowrap" as const,
  textAlign: "center" as const,
};

const hdrRow2 = {
  display: "grid",
  gridTemplateColumns: "520px 70px 520px",
  columnGap: 0,
  alignItems: "stretch",
  padding: 0,
  borderBottom: `1px solid ${light.bg.hover}`,
};

const subgrid10 = {
  display: "grid",
  gridTemplateColumns: "repeat(10, 52px)",
  columnGap: 0,
};

const subTh = {
  fontSize: 10,
  fontWeight: 600,
  color: light.text.secondary,
  background: light.bg.muted,
  padding: "1px 2px",
  border: `1px solid ${light.border.light}`,
  borderRadius: 0,
  whiteSpace: "nowrap" as const,
  textAlign: "center" as const,
};

const row21 = {
  display: "grid",
  gridTemplateColumns: "52px repeat(9, 52px) 70px repeat(9, 52px) 52px",
  columnGap: 0,
  alignItems: "stretch",
  padding: 0,
};

const td = {
  fontSize: 11,
  padding: "1px 2px",
  whiteSpace: "nowrap" as const,
  overflow: "hidden",
  textOverflow: "ellipsis",
  fontVariantNumeric: "tabular-nums",
  border: `1px solid ${light.border.primary}`,
  borderRadius: 0,
  background: light.bg.primary,
};

const strikeCell = {
  textAlign: "center" as const,
  fontWeight: 700,
  background: "#e8f4f8", // Pastel blue
};

const atmDivider = {
  borderTop: `2px solid ${dark.text.secondary}`,
  margin: 0,
  height: 0,
};

const empty = {
  padding: "10px",
  fontSize: 12,
  color: light.text.muted,
  textAlign: "center" as const,
};
