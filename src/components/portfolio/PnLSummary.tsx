// src/components/portfolio/PnLSummary.tsx
import { useEffect, useState, useMemo } from "react";
import { socketHub } from "../../ws/SocketHub";
import { TimeframeInfo } from "../../services/marketState";

type PnLData = {
  timeframe: string;
  snapshot_date: string;
  snapshot_value: number;
  current_value: number;
  pnl_dollar: number;
  pnl_percent: number;
};

type Props = {
  account: string;
  currentValue: number;
  timeframes: TimeframeInfo[];
};

export default function PnLSummary({ account, currentValue, timeframes }: Props) {
  const [pnlData, setPnlData] = useState<Map<string, PnLData>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Timeframes to fetch P&L for
  const timeframeIds = useMemo(() =>
    timeframes.map(t => t.id).filter(id => ["1d", "1w", "1m", "3m", "ytd"].includes(id)),
    [timeframes]
  );

  // Fetch P&L data when account, currentValue, or timeframes change
  useEffect(() => {
    if (!account || currentValue <= 0 || timeframeIds.length === 0) return;

    setLoading(true);
    setError(null);

    const fetchPnL = async () => {
      const results = new Map<string, PnLData>();

      for (const tf of timeframeIds) {
        try {
          const ack = await socketHub.sendControl("pnl_by_timeframe", {
            account,
            timeframe: tf.toUpperCase(),
            current_value: currentValue,
          }, { target: "calc", timeoutMs: 5000 });

          if (ack.ok && ack.data) {
            const data = (ack.data as any).data || ack.data;
            results.set(tf, {
              timeframe: tf,
              snapshot_date: data.snapshot_date,
              snapshot_value: data.snapshot_value,
              current_value: data.current_value,
              pnl_dollar: data.pnl_dollar,
              pnl_percent: data.pnl_percent,
            });
          }
        } catch (err) {
          console.warn(`[PnLSummary] Failed to fetch P&L for ${tf}:`, err);
        }
      }

      setPnlData(results);
      setLoading(false);
    };

    fetchPnL();
  }, [account, currentValue, timeframeIds.join(",")]);

  if (!account) {
    return null;
  }

  return (
    <div style={container}>
      <div style={header}>
        <span style={{ fontWeight: 600, fontSize: 12 }}>P&L by Timeframe</span>
        {loading && <span style={{ fontSize: 10, color: "#666" }}>Loading...</span>}
        {error && <span style={{ fontSize: 10, color: "#dc2626" }}>{error}</span>}
      </div>
      <div style={grid}>
        {timeframeIds.map(tf => {
          const data = pnlData.get(tf);
          const tfInfo = timeframes.find(t => t.id === tf);
          const label = tfInfo?.label || tf.toUpperCase();

          if (!data) {
            return (
              <div key={tf} style={card}>
                <div style={cardLabel}>{label}</div>
                <div style={cardValue}>—</div>
                <div style={cardSubtext}>No data</div>
              </div>
            );
          }

          const isPositive = data.pnl_dollar >= 0;
          const color = isPositive ? "#16a34a" : "#dc2626";

          return (
            <div key={tf} style={card}>
              <div style={cardLabel}>{label}</div>
              <div style={{ ...cardValue, color }}>
                {isPositive ? "+" : ""}{data.pnl_percent.toFixed(2)}%
              </div>
              <div style={{ ...cardSubtext, color }}>
                {isPositive ? "+" : ""}${data.pnl_dollar.toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const container: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #e5e7eb",
  borderRadius: 8,
  overflow: "hidden",
};

const header: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "8px 12px",
  background: "#f1f5f9",
  borderBottom: "1px solid #e5e7eb",
};

const grid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(5, 1fr)",
  gap: 1,
  background: "#e5e7eb",
};

const card: React.CSSProperties = {
  background: "#fff",
  padding: "10px 12px",
  textAlign: "center",
};

const cardLabel: React.CSSProperties = {
  fontSize: 10,
  color: "#666",
  fontWeight: 600,
  marginBottom: 4,
};

const cardValue: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 700,
  fontFamily: "ui-monospace, monospace",
};

const cardSubtext: React.CSSProperties = {
  fontSize: 11,
  fontFamily: "ui-monospace, monospace",
  marginTop: 2,
};
