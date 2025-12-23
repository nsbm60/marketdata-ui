/**
 * useTradeTicket Hook
 *
 * Manages trade ticket UI state:
 * - Trade ticket visibility and parameters
 * - Option-specific ticket data
 * - Modify/cancel order modals
 */

import { useState, useCallback } from "react";
import { IbOpenOrder } from "../types/portfolio";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface TradeTicketMarketData {
  last?: number;
  bid?: number;
  ask?: number;
  mid?: number;
  delta?: number;
  gamma?: number;
  theta?: number;
  vega?: number;
  iv?: number;
}

export interface OptionTicketData {
  underlying: string;
  strike: number;
  expiry: string;
  right: "C" | "P";
}

export interface UseTradeTicketResult {
  // Trade ticket state
  showTradeTicket: boolean;
  ticketSymbol: string;
  ticketAccount: string;
  ticketSide: "BUY" | "SELL";
  ticketSecType: "STK" | "OPT";
  ticketMarketData: TradeTicketMarketData;
  ticketOptionData: OptionTicketData | null;

  // Modify/cancel order state
  modifyingOrder: IbOpenOrder | null;
  cancellingOrder: IbOpenOrder | null;

  // Actions
  openTradeTicket: (
    symbol: string,
    account: string,
    side: "BUY" | "SELL",
    secType: string,
    optionDetails?: { strike: number; expiry: string; right: string },
    marketData?: TradeTicketMarketData
  ) => void;
  closeTradeTicket: () => void;
  setModifyingOrder: (order: IbOpenOrder | null) => void;
  setCancellingOrder: (order: IbOpenOrder | null) => void;
}

// ─────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────

export function useTradeTicket(): UseTradeTicketResult {
  // Trade ticket state
  const [showTradeTicket, setShowTradeTicket] = useState(false);
  const [ticketSymbol, setTicketSymbol] = useState("");
  const [ticketAccount, setTicketAccount] = useState("");
  const [ticketSide, setTicketSide] = useState<"BUY" | "SELL">("BUY");
  const [ticketSecType, setTicketSecType] = useState<"STK" | "OPT">("STK");
  const [ticketMarketData, setTicketMarketData] = useState<TradeTicketMarketData>({});
  const [ticketOptionData, setTicketOptionData] = useState<OptionTicketData | null>(null);

  // Modify/cancel order modals
  const [modifyingOrder, setModifyingOrder] = useState<IbOpenOrder | null>(null);
  const [cancellingOrder, setCancellingOrder] = useState<IbOpenOrder | null>(null);

  const openTradeTicket = useCallback(
    (
      symbol: string,
      account: string,
      side: "BUY" | "SELL",
      secType: string,
      optionDetails?: { strike: number; expiry: string; right: string },
      marketData?: TradeTicketMarketData
    ) => {
      setTicketSymbol(symbol);
      setTicketAccount(account);
      setTicketSide(side);
      setTicketMarketData(marketData || {});

      if (secType === "OPT" && optionDetails) {
        setTicketSecType("OPT");
        const rightChar = optionDetails.right === "Call" || optionDetails.right === "C" ? "C" : "P";
        // Convert YYYYMMDD to YYYY-MM-DD
        const expiry =
          optionDetails.expiry.length === 8
            ? `${optionDetails.expiry.substring(0, 4)}-${optionDetails.expiry.substring(4, 6)}-${optionDetails.expiry.substring(6, 8)}`
            : optionDetails.expiry;

        setTicketOptionData({
          underlying: symbol,
          strike: optionDetails.strike,
          expiry: expiry,
          right: rightChar as "C" | "P",
        });
      } else {
        setTicketSecType("STK");
        setTicketOptionData(null);
      }

      setShowTradeTicket(true);
    },
    []
  );

  const closeTradeTicket = useCallback(() => {
    setShowTradeTicket(false);
  }, []);

  return {
    showTradeTicket,
    ticketSymbol,
    ticketAccount,
    ticketSide,
    ticketSecType,
    ticketMarketData,
    ticketOptionData,
    modifyingOrder,
    cancellingOrder,
    openTradeTicket,
    closeTradeTicket,
    setModifyingOrder,
    setCancellingOrder,
  };
}
