// src/components/portfolio/SimulatorDateNav.tsx
import { useState, useEffect, useCallback } from "react";
import { socketHub } from "../../ws/SocketHub";
import { light, fonts } from "../../theme";

type Props = {
  date: string; // YYYY-MM-DD
  minDate: string;
  maxDate: string;
  onChange: (date: string) => void;
};

interface TradingDayInfo {
  prevTradingDay: string;
  nextTradingDay: string;
  isTradingDay: boolean;
}

export default function SimulatorDateNav({ date, minDate, maxDate, onChange }: Props) {
  const [tradingDayInfo, setTradingDayInfo] = useState<TradingDayInfo | null>(null);

  // Fetch trading day info from backend when date changes
  useEffect(() => {
    let cancelled = false;

    socketHub.sendControl("get_trading_day_info", {
      target: "calc",
      date,
    }).then(response => {
      if (cancelled) return;
      if (response.ok && response.data) {
        // Handle potential double-nesting: response.data may contain { data: {...} }
        const outerData = response.data as any;
        const data = outerData?.data ?? outerData;
        setTradingDayInfo({
          prevTradingDay: data.prevTradingDay,
          nextTradingDay: data.nextTradingDay,
          isTradingDay: data.isTradingDay,
        });
      }
    }).catch(() => {
      // Fallback to simple weekend check if backend unavailable
      if (cancelled) return;
      const prev = findTradingDayFallback(date, -1);
      const next = findTradingDayFallback(date, 1);
      setTradingDayInfo({
        prevTradingDay: prev,
        nextTradingDay: next,
        isTradingDay: !isWeekendFallback(date),
      });
    });

    return () => { cancelled = true; };
  }, [date]);

  // Fallback functions if backend is unavailable
  const isWeekendFallback = (dateStr: string): boolean => {
    const d = new Date(dateStr + "T12:00:00");
    const day = d.getDay();
    return day === 0 || day === 6;
  };

  const findTradingDayFallback = (fromDate: string, direction: 1 | -1): string => {
    const d = new Date(fromDate + "T12:00:00");
    let iterations = 0;
    do {
      d.setDate(d.getDate() + direction);
      iterations++;
    } while (isWeekendFallback(d.toISOString().split("T")[0]) && iterations < 10);
    return d.toISOString().split("T")[0];
  };

  const prevTradingDay = tradingDayInfo?.prevTradingDay ?? findTradingDayFallback(date, -1);
  const nextTradingDay = tradingDayInfo?.nextTradingDay ?? findTradingDayFallback(date, 1);

  const canGoBack = prevTradingDay >= minDate;
  const canGoForward = nextTradingDay <= maxDate;

  const handleBack = useCallback(() => {
    if (canGoBack) {
      onChange(prevTradingDay);
    }
  }, [canGoBack, prevTradingDay, onChange]);

  const handleForward = useCallback(() => {
    if (canGoForward) {
      onChange(nextTradingDay);
    }
  }, [canGoForward, nextTradingDay, onChange]);

  const formatDate = (dateStr: string): string => {
    const d = new Date(dateStr + "T12:00:00"); // Noon to avoid timezone issues
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };

  return (
    <div style={container}>
      <button
        onClick={handleBack}
        disabled={!canGoBack}
        style={{ ...navButton, opacity: canGoBack ? 1 : 0.3 }}
        title="Previous day"
      >
        ←
      </button>
      <span style={dateDisplay}>{formatDate(date)}</span>
      <button
        onClick={handleForward}
        disabled={!canGoForward}
        style={{ ...navButton, opacity: canGoForward ? 1 : 0.3 }}
        title="Next day"
      >
        →
      </button>
    </div>
  );
}

const container: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 4,
};

const navButton: React.CSSProperties = {
  padding: "2px 8px",
  fontSize: fonts.ui.body,
  background: light.bg.tertiary,
  border: `1px solid ${light.border.primary}`,
  borderRadius: 4,
  cursor: "pointer",
};

const dateDisplay: React.CSSProperties = {
  fontSize: fonts.ui.body,
  fontWeight: 500,
  minWidth: 100,
  textAlign: "center",
};
