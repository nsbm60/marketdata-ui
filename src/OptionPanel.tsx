// src/OptionPanel.tsx
import { Fragment, useEffect, useMemo, useState } from "react";
import { socketHub } from "./ws/SocketHub";
import OptionTradeTicket from "./components/OptionTradeTicket";
import { useChannelUpdates, getChannelPrices, PriceData } from "./hooks/useMarketData";

/** ---------- Types ---------- */
type OptionSide = "call" | "put";

type ParsedOption = {
  underlying: string;
  side: OptionSide;
  strike: number;
  expiration: string; // YYYY-MM-DD
};

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

  // Trade ticket state
  const [showTradeTicket, setShowTradeTicket] = useState(false);
  const [ticketUnderlying, setTicketUnderlying] = useState("");
  const [ticketStrike, setTicketStrike] = useState(0);
  const [ticketExpiry, setTicketExpiry] = useState("");
  const [ticketRight, setTicketRight] = useState<"C" | "P">("C");
  const [ticketSide, setTicketSide] = useState<"BUY" | "SELL">("BUY");
  const [ticketAccount] = useState("DU333427");
  const [ticketMarketData, setTicketMarketData] = useState<any>({});

  // Listen to option channel updates (triggers re-render on any option price change)
  const optionVersion = useChannelUpdates("option", 100);

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
    setLoadingChain(true);
    socketHub.send({
      type: "control",
      target: "marketData",
      op: "get_chain",
      id: `get_chain_${Date.now()}`,
      underlying: und,
      expiry: expiry,
      limit: lim,
    });
  };

  // Handle control messages (find_expiries, get_chain responses)
  useEffect(() => {
    const onMsg = (m: any) => {
      // Handle find_expiries response
      if (m?.type === "control.ack" && m?.op === "find_expiries") {
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
              setLoadingChain(true);
              socketHub.send({
                type: "control",
                target: "marketData",
                op: "get_chain",
                id: `get_chain_${Date.now()}`,
                underlying: und,
                expiry: firstExpiry,
                limit: limit,
              });
            }
          }
        }
      }

      // Handle get_chain response
      if (m?.type === "control.ack" && m?.op === "get_chain") {
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

  // Build rows for SELECTED expiry only using MarketDataBus
  const rows = useMemo(() => {
    if (!ticker || !selectedExpiry) return [];

    // Get all option prices from the bus
    const optionPrices = getChannelPrices("option");

    const strikeMap = new Map<number, { call?: PriceData; put?: PriceData }>();

    for (const [symbol, price] of optionPrices) {
      const p = parseOptionSymbol(symbol);
      if (!p) continue;
      if (p.underlying !== ticker.toUpperCase()) continue;
      if (p.expiration !== selectedExpiry) continue;

      const at = strikeMap.get(p.strike) || {};
      if (p.side === "call") at.call = price;
      else at.put = price;
      strikeMap.set(p.strike, at);
    }

    return Array.from(strikeMap.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([strike, sideMap]) => {
        // Calls prices
        const cl = num(sideMap.call?.last);
        const cb = num(sideMap.call?.bid);
        const ca = num(sideMap.call?.ask);
        const cm = mid(cb, ca, cl);

        // Puts prices
        const pl = num(sideMap.put?.last);
        const pb = num(sideMap.put?.bid);
        const pa = num(sideMap.put?.ask);
        const pm = mid(pb, pa, pl);

        // Call Greeks (from extended price data)
        const callData = sideMap.call as any;
        const cDelta = num(callData?.delta);
        const cGamma = num(callData?.gamma);
        const cTheta = num(callData?.theta);
        const cVega = num(callData?.vega);
        const cIv = num(callData?.iv);

        // Put Greeks
        const putData = sideMap.put as any;
        const pDelta = num(putData?.delta);
        const pGamma = num(putData?.gamma);
        const pTheta = num(putData?.theta);
        const pVega = num(putData?.vega);
        const pIv = num(putData?.iv);

        return {
          strike,
          cLast: cl,
          cBid: cb,
          cMid: cm,
          cAsk: ca,
          cDelta,
          cGamma,
          cTheta,
          cVega,
          cIv,
          pLast: pl,
          pBid: pb,
          pMid: pm,
          pAsk: pa,
          pDelta,
          pGamma,
          pTheta,
          pVega,
          pIv,
        };
      });
  }, [ticker, selectedExpiry, optionVersion]);

  /** ---------- Render ---------- */
  return (
    <div style={shell as any}>
      {/* Panel header */}
      <div style={panelHeader as any}>
        <div style={hdrRow as any}>
          <div style={{ fontWeight: 700 }}>Options</div>
          <span style={{ marginLeft: "auto", fontSize: 12, color: wsOpen ? "#137333" : "#666" }}>
            WS: {wsOpen ? "open" : "…"}
          </span>
        </div>

        {/* Controls row */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 12 }}>
          {underlying ? (
            <>
              <div>
                <b>{underlying}</b>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <label style={{ fontSize: 11, color: "#666" }}>Limit:</label>
                <select
                  value={limit}
                  onChange={(e) => {
                    const newLimit = Number(e.target.value);
                    setLimit(newLimit);
                    if (selectedExpiry) {
                      loadChain(underlying, selectedExpiry, newLimit);
                    }
                  }}
                  style={{ fontSize: 11, padding: "2px 4px", color: "#111", background: "white" }}
                >
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                  <option value={200}>200</option>
                  <option value={500}>500</option>
                </select>
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
            <span style={{ color: "#666" }}>Select a symbol on the left to load options…</span>
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
                {fmtExpiryShort(exp)}
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
                <div style={{ ...thBlock, textAlign: "center" } as any}>Strike</div>
                <div style={{ ...thBlock, textAlign: "center" } as any}>Puts</div>
              </div>
              {/* Level 2 header */}
              <div style={hdrRow2 as any}>
                <div style={subgrid10 as any}>
                  <div style={subTh as any}>Trade</div>
                  <div style={subTh as any}>Last</div>
                  <div style={subTh as any}>Bid</div>
                  <div style={subTh as any}>Mid</div>
                  <div style={subTh as any}>Ask</div>
                  <div style={subTh as any}>Δ</div>
                  <div style={subTh as any}>Γ</div>
                  <div style={subTh as any}>Θ</div>
                  <div style={subTh as any}>Vega</div>
                  <div style={subTh as any}>IV</div>
                </div>
                <div style={subTh as any}>{/* strike subheader empty */}</div>
                <div style={subgrid10 as any}>
                  <div style={subTh as any}>Last</div>
                  <div style={subTh as any}>Bid</div>
                  <div style={subTh as any}>Mid</div>
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
                  background: isSelected ? "#fef3c7" : "#fff",
                } as any;

                return (
                  <Fragment key={rowKey}>
                    {showDivider && <div style={atmDivider as any} />}
                    <div
                      style={{ ...row21, cursor: "pointer" } as any}
                      onClick={() => setSelectedKey(rowKey)}
                    >
                      {/* Call Trade Buttons */}
                      <div style={{ ...baseCell, display: "flex", justifyContent: "center", gap: 4, padding: "1px 2px" }}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            openTradeTicket(underlying, r.strike, selectedExpiry, "C", "BUY", {
                              last: r.cLast, bid: r.cBid, ask: r.cAsk, mid: r.cMid,
                              delta: r.cDelta, gamma: r.cGamma, theta: r.cTheta, vega: r.cVega, iv: r.cIv,
                            });
                          }}
                          style={tradeBtn("BUY")}
                        >
                          B
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            openTradeTicket(underlying, r.strike, selectedExpiry, "C", "SELL", {
                              last: r.cLast, bid: r.cBid, ask: r.cAsk, mid: r.cMid,
                              delta: r.cDelta, gamma: r.cGamma, theta: r.cTheta, vega: r.cVega, iv: r.cIv,
                            });
                          }}
                          style={tradeBtn("SELL")}
                        >
                          S
                        </button>
                      </div>

                      {/* Calls: Last | Bid | Mid | Ask | Greeks */}
                      <div style={{ ...baseCell, textAlign: "right" }}>{fmtPrice(r.cLast)}</div>
                      <div style={{ ...baseCell, textAlign: "right" }}>{fmtPrice(r.cBid)}</div>
                      <div style={{ ...baseCell, textAlign: "right" }}>{fmtPrice(r.cMid)}</div>
                      <div style={{ ...baseCell, textAlign: "right" }}>{fmtPrice(r.cAsk)}</div>
                      <div style={{ ...baseCell, textAlign: "right" }}>{fmtGreek(r.cDelta)}</div>
                      <div style={{ ...baseCell, textAlign: "right" }}>{fmtGreek(r.cGamma)}</div>
                      <div style={{ ...baseCell, textAlign: "right" }}>{fmtGreek(r.cTheta)}</div>
                      <div style={{ ...baseCell, textAlign: "right" }}>{fmtGreek(r.cVega)}</div>
                      <div style={{ ...baseCell, textAlign: "right" }}>{fmtGreek(r.cIv)}</div>

                      {/* Strike */}
                      <div style={{ ...baseCell, textAlign: "center", fontWeight: 700 }}>
                        {isNum(r.strike) ? priceFmt.format(r.strike as number) : "—"}
                      </div>

                      {/* Puts: Last | Bid | Mid | Ask | Greeks */}
                      <div style={{ ...baseCell, textAlign: "right" }}>{fmtPrice(r.pLast)}</div>
                      <div style={{ ...baseCell, textAlign: "right" }}>{fmtPrice(r.pBid)}</div>
                      <div style={{ ...baseCell, textAlign: "right" }}>{fmtPrice(r.pMid)}</div>
                      <div style={{ ...baseCell, textAlign: "right" }}>{fmtPrice(r.pAsk)}</div>
                      <div style={{ ...baseCell, textAlign: "right" }}>{fmtGreek(r.pDelta)}</div>
                      <div style={{ ...baseCell, textAlign: "right" }}>{fmtGreek(r.pGamma)}</div>
                      <div style={{ ...baseCell, textAlign: "right" }}>{fmtGreek(r.pTheta)}</div>
                      <div style={{ ...baseCell, textAlign: "right" }}>{fmtGreek(r.pVega)}</div>
                      <div style={{ ...baseCell, textAlign: "right" }}>{fmtGreek(r.pIv)}</div>

                      {/* Put Trade Buttons */}
                      <div style={{ ...baseCell, display: "flex", justifyContent: "center", gap: 4, padding: "1px 2px" }}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            openTradeTicket(underlying, r.strike, selectedExpiry, "P", "BUY", {
                              last: r.pLast, bid: r.pBid, ask: r.pAsk, mid: r.pMid,
                              delta: r.pDelta, gamma: r.pGamma, theta: r.pTheta, vega: r.pVega, iv: r.pIv,
                            });
                          }}
                          style={tradeBtn("BUY")}
                        >
                          B
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            openTradeTicket(underlying, r.strike, selectedExpiry, "P", "SELL", {
                              last: r.pLast, bid: r.pBid, ask: r.pAsk, mid: r.pMid,
                              delta: r.pDelta, gamma: r.pGamma, theta: r.pTheta, vega: r.pVega, iv: r.pIv,
                            });
                          }}
                          style={tradeBtn("SELL")}
                        >
                          S
                        </button>
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
function isNum(v: any) {
  return typeof v === "number" && Number.isFinite(v);
}
function mid(b?: number, a?: number, last?: number) {
  if (isNum(b) && isNum(a)) return ((b as number) + (a as number)) / 2;
  if (isNum(last)) return last as number;
  return undefined;
}

const priceFmt = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function fmtPrice(v: any) {
  return isNum(v) ? priceFmt.format(v) : "—";
}

const greekFmt = new Intl.NumberFormat(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 });
function fmtGreek(v: any) {
  return isNum(v) ? greekFmt.format(v) : "—";
}

function fmtExpiryShort(s: string) {
  try {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s));
    if (!m) return s;
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    const dt = new Date(y, mo - 1, d);
    return dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return s;
  }
}

// Parse OPRA/OSI option symbol
function parseOptionSymbol(sym: string): ParsedOption | null {
  const S = String(sym || "").toUpperCase().replace(/\s+/g, "");
  // OSI: AAPL250117C00190000
  const m1 = /^([A-Z]+)(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/.exec(S);
  if (m1) {
    const und = m1[1], yy = m1[2], mm = m1[3], dd = m1[4];
    const side: OptionSide = m1[5] === "C" ? "call" : "put";
    const strike = parseInt(m1[6], 10) / 1000;
    const yyyy = Number(yy) + 2000;
    const exp = `${yyyy}-${mm}-${dd}`;
    return { underlying: und, side, strike, expiration: exp };
  }
  // AAPL_011725C_190
  const m2 = /^([A-Z]+)[._-](\d{2})(\d{2})(\d{2})([CP])[._-](\d+(\.\d+)?)$/.exec(S);
  if (m2) {
    const und = m2[1], yy = m2[2], mm = m2[3], dd = m2[4];
    const side: OptionSide = m2[5] === "C" ? "call" : "put";
    const strike = parseFloat(m2[6]);
    const yyyy = Number(yy) + 2000;
    const exp = `${yyyy}-${mm}-${dd}`;
    return { underlying: und, side, strike, expiration: exp };
  }
  // Fallback
  const m3 = /^([A-Z]+)\d{6,8}([CP])(\d+(\.\d+)?)$/.exec(S);
  if (m3) {
    const und = m3[1];
    const side: OptionSide = m3[2] === "C" ? "call" : "put";
    const strike = parseFloat(m3[3]);
    return { underlying: und, side, strike, expiration: "1970-01-01" };
  }
  return null;
}

/** ---------- Styles ---------- */
const shell = {
  display: "flex",
  flexDirection: "column" as const,
  height: "100%",
  background: "#fff",
  color: "#111",
  borderLeft: "1px solid #e5e7eb",
};

const panelHeader = {
  padding: "6px 8px",
  borderBottom: "1px solid #eee",
  background: "#fff",
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
  background: "#f3f4f6",
  border: "1px solid #d1d5db",
  borderRadius: 4,
  cursor: "pointer",
  whiteSpace: "nowrap" as const,
  color: "#111",
};

const expiryTabActive = {
  ...expiryTab,
  background: "#dbeafe",
  border: "1px solid #3b82f6",
  fontWeight: 600,
  color: "#111",
};

const bodyScroll = {
  flex: 1,
  overflow: "auto",
  position: "relative" as const,
  background: "#fff",
};

const stickyHeader = {
  position: "sticky" as const,
  top: 0,
  zIndex: 5,
  background: "white",
  borderBottom: "1px solid #e5e7eb",
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
  color: "#333",
  background: "#f6f6f6",
  padding: "2px 4px",
  border: "1px solid #e5e7eb",
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
  borderBottom: "1px solid #f0f0f0",
};

const subgrid10 = {
  display: "grid",
  gridTemplateColumns: "repeat(10, 52px)",
  columnGap: 0,
};

const subTh = {
  fontSize: 10,
  fontWeight: 600,
  color: "#555",
  background: "#fafafa",
  padding: "1px 2px",
  border: "1px solid #ddd",
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
  border: "1px solid #e5e7eb",
  borderRadius: 0,
  background: "#fff",
};

const atmDivider = {
  borderTop: "2px solid #9ca3af",
  margin: 0,
  height: 0,
};

const empty = {
  padding: "10px",
  fontSize: 12,
  color: "#666",
  textAlign: "center" as const,
};

function tradeBtn(side: "BUY" | "SELL") {
  return {
    padding: "2px 6px",
    fontSize: 9,
    fontWeight: 600,
    background: side === "BUY" ? "#dcfce7" : "#fce7f3",
    color: side === "BUY" ? "#166534" : "#831843",
    border: side === "BUY" ? "1px solid #86efac" : "1px solid #fda4af",
    borderRadius: 3,
    cursor: "pointer",
    lineHeight: 1,
  };
}
