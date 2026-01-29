/**
 * useIbErrors - Listens for IB error and warning events via WebSocket.
 *
 * This is a focused hook that only handles IB error accumulation.
 * IB connection state and positions are handled by usePositionsReport.
 */

import { useEffect, useState, useCallback } from "react";
import { socketHub } from "../ws/SocketHub";

export interface IbError {
  id: number;
  code: number;
  message: string;
  severity: "error" | "warning";
  ts: string;
}

const MAX_ERRORS = 50;

export interface UseIbErrorsResult {
  ibErrors: IbError[];
  showErrors: boolean;
  setShowErrors: (show: boolean) => void;
  clearErrors: () => void;
}

export function useIbErrors(): UseIbErrorsResult {
  const [ibErrors, setIbErrors] = useState<IbError[]>([]);
  const [showErrors, setShowErrors] = useState(false);

  const clearErrors = useCallback(() => {
    setIbErrors([]);
  }, []);

  useEffect(() => {
    const handler = (m: any) => {
      if (!m) return;

      // Handle ib.error messages
      if (m?.topic === "ib.error") {
        const d = m.data;
        if (!d || d.kind !== "error") return;

        const newError: IbError = {
          id: Number(d.id ?? -1),
          code: Number(d.code ?? 0),
          message: String(d.message ?? "Unknown error"),
          severity: d.severity === "error" ? "error" : "warning",
          ts: String(d.ts ?? new Date().toISOString()),
        };

        setIbErrors((prev) => [newError, ...prev].slice(0, MAX_ERRORS));

        if (d.severity === "error") {
          setShowErrors(true);
        }
      }
    };

    socketHub.onTick(handler);
    return () => {
      socketHub.offTick(handler);
    };
  }, []);

  return { ibErrors, showErrors, setShowErrors, clearErrors };
}
