// src/OptionPanel.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { socketHub } from "./ws/SocketHub";
import type { ControlAck, TickEnvelope } from "./ws/ws-types";

/** ---------- Types ---------- */
type ExpiryMeta = {
  expiration: string;
  strikes_below: number;
  strikes_above: number;
  min_strike: number | null;
  max_strike: number | null;
  contracts_count: number;
};

type QuoteRow = {
  symbol: string;
  kind: "quote" | "trade";
  last?: number;
  bid?: number;
  ask?: number;
  ts?: string;
};

type OptionSide = "call" | "put";

type ParsedOption = {
  underlying: string;
  side: OptionSide;
  strike: number;
  expiration: string; // YYYY-MM-DD or "—"
};

/** ---------- Component ---------- */
export default function OptionPanel() {
  const [underlying, setUnderlying] = useState<string>("");
  const [expiries, setExpiries] = useState<ExpiryMeta[]>([]);
  const [wsOpen, setWsOpen] = useState<boolean>(false);

  // price book keyed by option symbol
  const bookRef = useRef<Map<string, QuoteRow>>(new Map());

  useEffect(() => {
    const onMsg = (m: any) => {
      if (m?.type === "control.ack" && m?.op === "find_and_subscribe") {
        if (m.ok) {
          const data = m.data || {};
          if (data.underlying) setUnderlying(String(data.underlying));
          const arr = Array.isArray(data.expiries) ? data.expiries : [];
          setExpiries(
            arr
              .map((o: any) => ({
                expiration: String(o.expiration || ""),
                strikes_below: toNumOrNull(o.strikes_below) ?? 0,
                strikes_above: toNumOrNull(o.strikes_above) ?? 0,
                min_strike: toNumOrNull(o.min_strike),
                max_strike: toNumOrNull(o.max_strike),
                contracts_count: toNumOrNull(o.contracts_count) ?? 0,
              }))
              .filter((e: ExpiryMeta) => e.expiration)
          );
        }
      } else if (m?.type === "ready") {
        setWsOpen(true);
      }
    };

    const onTick = (t: TickEnvelope) => {
      if (typeof t?.topic !== "string" || !t.topic.startsWith("md.option.")) return;
      const info = fastExtract(t.topic, t.data);
      if (!info) return;

      const prev = bookRef.current.get(info.symbol) || { symbol: info.symbol, kind: info.kind } as QuoteRow;
      const next: QuoteRow =
        info.kind === "quote"
          ? { ...prev, kind: "quote", bid: info.bid ?? prev.bid, ask: info.ask ?? prev.ask, ts: info.ts ?? prev.ts }
          : { ...prev, kind: "trade", last: info.last ?? prev.last, ts: info.ts ?? prev.ts };

      bookRef.current.set(info.symbol, next);
      schedule();
    };

    socketHub.onMessage(onMsg);
    socketHub.onTick(onTick);
    socketHub.connect();
    return () => {
      socketHub.offTick(onTick);
      socketHub.offMessage(onMsg);
    };
  }, []);

  // throttle renders
  const [version, setVersion] = useState(0);
  const rafRef = useRef<number>(0 as any);
  const schedule = () => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0 as any;
      setVersion((v) => (v + 1) & 0xffff);
    });
  };

  // Build rows: [C.last, C.bid, C.mid, C.ask, strike, P.last, P.bid, P.mid, P.ask]
  const groups = useMemo(() => {
    if (!underlying) return [];

    const byExpiry = new Map<string, Map<number, { call?: QuoteRow; put?: QuoteRow }>>();

    for (const row of bookRef.current.values()) {
      const p = parseOptionSymbol(row.symbol);
      if (!p) continue;
      if (p.underlying !== underlying) continue;

      let strikes = byExpiry.get(p.expiration);
      if (!strikes) {
        strikes = new Map();
        byExpiry.set(p.expiration, strikes);
      }
      const at = strikes.get(p.strike) || {};
      if (p.side === "call") at.call = row;
      else at.put = row;
      strikes.set(p.strike, at);
    }

    return Array.from(byExpiry.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([exp, strikes]) => {
        const rows = Array.from(strikes.entries())
          .sort((a, b) => a[0] - b[0])
          .map(([strike, sideMap]) => {
            const cl = num(sideMap.call?.last);
            const cb = num(sideMap.call?.bid);
            const ca = num(sideMap.call?.ask);
            const cm = mid(cb, ca, cl);

            const pl = num(sideMap.put?.last);
            const pb = num(sideMap.put?.bid);
            const pa = num(sideMap.put?.ask);
            const pm = mid(pb, pa, pl);

            return {
              strike,
              cLast: cl, cBid: cb, cMid: cm, cAsk: ca,
              pLast: pl, pBid: pb, pMid: pm, pAsk: pa,
            };
          });
        return { expiration: exp, rows };
      });
  }, [underlying, version]);

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
        <div style={{ fontSize: 12, color: "#333" }}>
          {underlying ? (
            <>
              Underlying:&nbsp;<b>{underlying}</b>
              {expiries.length ? <span style={{ marginLeft: 12 }}>Expiries:&nbsp;<b>{expiries.length}</b></span> : null}
            </>
          ) : (
            <span style={{ color: "#666" }}>Select a symbol on the left to load options…</span>
          )}
        </div>
      </div>

      {/* Scroll area with two-level sticky header */}
      <div style={bodyScroll as any}>
        {/* Level 1 header: Calls | Strike | Puts (sticky) */}
        <div style={stickyHeader as any}>
          <div style={hdrRow1 as any}>
            <div style={{ ...thBlock, textAlign: "left" } as any}>Calls</div>
            <div style={{ ...thBlock, textAlign: "center" } as any}>Strike</div>
            <div style={{ ...thBlock, textAlign: "right" } as any}>Puts</div>
          </div>
          {/* Level 2 header: under Calls & Puts show Last | Bid | Mid | Ask */}
          <div style={hdrRow2 as any}>
            <div style={subgrid4 as any}>
              <div style={{ ...subTh, textAlign: "left" } as any}>Last</div>
              <div style={{ ...subTh, textAlign: "left" } as any}>Bid</div>
              <div style={{ ...subTh, textAlign: "center" } as any}>Mid</div>
              <div style={{ ...subTh, textAlign: "right" } as any}>Ask</div>
            </div>
            <div style={{ ...subTh, textAlign: "center" } as any}>{/* strike subheader empty */}</div>
            <div style={subgrid4 as any}>
              <div style={{ ...subTh, textAlign: "left" } as any}>Last</div>
              <div style={{ ...subTh, textAlign: "left" } as any}>Bid</div>
              <div style={{ ...subTh, textAlign: "center" } as any}>Mid</div>
              <div style={{ ...subTh, textAlign: "right" } as any}>Ask</div>
            </div>
          </div>
        </div>

        {/* Content */}
        {!underlying ? (
          <div style={empty as any}>No underlying selected.</div>
        ) : groups.length === 0 ? (
          <div style={empty as any}>Waiting for option streams…</div>
        ) : (
          <div>
            {groups.map((g) => (
              <div key={g.expiration} style={group as any}>
                <div style={expiryHead as any}>
                  <div style={{ fontWeight: 600 }}>{fmtExpiry(g.expiration)}</div>
                </div>

                {g.rows.map((r) => (
                  <div key={g.expiration + ":" + r.strike} style={row9 as any}>
                    {/* Calls: Last | Bid | Mid | Ask */}
                    <div style={{ ...td, textAlign: "left" } as any}>{fmtPrice(r.cLast)}</div>
                    <div style={{ ...td, textAlign: "left" } as any}>{fmtPrice(r.cBid)}</div>
                    <div style={{ ...td, textAlign: "center" } as any}>{fmtPrice(r.cMid)}</div>
                    <div style={{ ...td, textAlign: "right" } as any}>{fmtPrice(r.cAsk)}</div>

                    {/* Strike */}
                    <div style={{ ...td, textAlign: "center", fontVariantNumeric: "tabular-nums" } as any}>
                      {isNum(r.strike) ? priceFmt.format(r.strike as number) : "—"}
                    </div>

                    {/* Puts: Last | Bid | Mid | Ask */}
                    <div style={{ ...td, textAlign: "left" } as any}>{fmtPrice(r.pLast)}</div>
                    <div style={{ ...td, textAlign: "left" } as any}>{fmtPrice(r.pBid)}</div>
                    <div style={{ ...td, textAlign: "center" } as any}>{fmtPrice(r.pMid)}</div>
                    <div style={{ ...td, textAlign: "right" } as any}>{fmtPrice(r.pAsk)}</div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** ---------- Helpers ---------- */
function toNumOrNull(v: any): number | null { const n = Number(v); return Number.isFinite(n) ? n : null; }
function num(v: any): number | undefined { const n = Number(v); return Number.isFinite(n) ? n : undefined; }
function isNum(v: any) { return typeof v === "number" && Number.isFinite(v); }
function mid(b?: number, a?: number, last?: number) {
  if (isNum(b) && isNum(a)) return ((b as number) + (a as number)) / 2;
  if (isNum(last)) return last as number;
  return undefined;
}
const priceFmt = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function fmtPrice(v: any) { return isNum(v) ? priceFmt.format(v) : "—"; }

function fmtExpiry(s: string) {
  try {
    // Match YYYY-MM-DD explicitly
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s));
    if (!m) return s;

    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);

    // Construct LOCAL date (not UTC midnight)
    const dt = new Date(y, mo - 1, d);

    // Format in local time — no more off-by-one-day shift
    return dt.toLocaleDateString(undefined, {
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "2-digit",
    });
  } catch {
    return s;
  }
}

// Parse OPRA/OSI-like option symbol
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
  // Fallback (no reliable expiry)
  const m3 = /^([A-Z]+)\d{6,8}([CP])(\d+(\.\d+)?)$/.exec(S);
  if (m3) {
    const und = m3[1];
    const side: OptionSide = m3[2] === "C" ? "call" : "put";
    const strike = parseFloat(m3[3]);
    return { underlying: und, side, strike, expiration: "—" };
  }
  return null;
}

// Normalize incoming option tick
function fastExtract(topic: string, data: any) {
  // topics: md.option.quote.SYM  |  md.option.trade.SYM
  const parts = topic.split(".");
  if (parts.length < 4) return null;
  const kind = parts[2] === "quote" ? "quote" : parts[2] === "trade" ? "trade" : "";
  const symbolFromTopic = parts.slice(3).join(".");
  const inner = data && typeof data.data === "object" ? data.data : data;

  const symbol = (data?.symbol || inner?.symbol || symbolFromTopic || "").toString().toUpperCase();
  if (!symbol) return null;

  let ts: any = inner?.timestamp ?? data?.timestamp;
  if (typeof ts === "number") ts = numberToISO(ts);
  if (typeof ts === "string" && /^\d+$/.test(ts)) ts = numberToISO(Number(ts));

  if (kind === "quote") {
    const bid = num(inner?.bidPrice ?? inner?.bp ?? inner?.bid);
    const ask = num(inner?.askPrice ?? inner?.ap ?? inner?.ask);
    return { kind, symbol, bid, ask, ts };
  }
  if (kind === "trade") {
    const last = num(inner?.lastPrice ?? inner?.price ?? inner?.lp ?? inner?.p ?? inner?.close ?? inner?.last);
    return { kind, symbol, last, ts };
  }

  const bid = num(inner?.bidPrice ?? inner?.bp ?? inner?.bid);
  const ask = num(inner?.askPrice ?? inner?.ap ?? inner?.ask);
  const last = num(inner?.lastPrice ?? inner?.price ?? inner?.lp ?? inner?.p ?? inner?.close ?? inner?.last);
  if (bid != null || ask != null) return { kind: "quote", symbol, bid, ask, ts };
  if (last != null) return { kind: "trade", symbol, last, ts };
  return null;
}

function numberToISO(n: number) {
  const ms = n < 2e10 ? n * 1000 : n;
  return new Date(ms).toISOString();
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
  padding: "8px 10px",
  borderBottom: "1px solid #eee",
  background: "#fff",
  display: "grid",
  gap: 6,
};

const hdrRow = { display: "flex", alignItems: "center", gap: 12 };

const bodyScroll = {
  flex: 1,
  overflow: "auto",
  position: "relative" as const,
  background: "#fff",
};

/* Sticky wrapper for two header levels */
const stickyHeader = {
  position: "sticky" as const,
  top: 0,
  zIndex: 5,
  background: "white",
  borderBottom: "1px solid #e5e7eb",
};

/* Level 1 header: Calls | Strike | Puts */
const hdrRow1 = {
  display: "grid",
  gridTemplateColumns: "4fr 110px 4fr",
  columnGap: 8,
  alignItems: "center",
  padding: "6px 8px",
};

const thBlock = {
  fontSize: 11,
  fontWeight: 800,
  color: "#333",
  background: "#f6f6f6",
  padding: "6px 8px",
  border: "1px solid #e5e7eb",
  borderRadius: 6,
  whiteSpace: "nowrap" as const,
};

/* Level 2 header: Last | Bid | Mid | Ask  (Calls side) | (Strike blank) | (Puts side) */
const hdrRow2 = {
  display: "grid",
  gridTemplateColumns: "4fr 110px 4fr",
  columnGap: 8,
  alignItems: "center",
  padding: "6px 8px 8px 8px",
  borderBottom: "1px solid #f0f0f0",
};

const subgrid4 = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr 1fr 1fr",
  columnGap: 8,
};

const subTh = {
  fontSize: 11,
  fontWeight: 700,
  color: "#555",
  background: "#fafafa",
  padding: "4px 6px",
  border: "1px solid #eee",
  borderRadius: 6,
  whiteSpace: "nowrap" as const,
};

const group = {
  border: "1px solid #eee",
  borderRadius: 8,
  background: "#fff",
  margin: "10px 8px",
  overflow: "hidden",
};

const expiryHead = {
  padding: "6px 8px",
  borderBottom: "1px solid #eee",
  background: "#f8fafc",
  fontSize: 12,
  display: "flex",
  alignItems: "center",
  gap: 8,
};

/* 9-cell row: C.last | C.bid | C.mid | C.ask | strike | P.last | P.bid | P.mid | P.ask */
const row9 = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr 1fr 1fr 110px 1fr 1fr 1fr 1fr",
  columnGap: 8,
  alignItems: "center",
  padding: "6px 8px",
  borderBottom: "1px solid #f8f8f8",
};

const td = {
  fontSize: 12,
  padding: "4px 6px",
  whiteSpace: "nowrap" as const,
  overflow: "hidden",
  textOverflow: "ellipsis",
  fontVariantNumeric: "tabular-nums",
};

const empty = {
  padding: "12px",
  fontSize: 12,
  color: "#666",
};