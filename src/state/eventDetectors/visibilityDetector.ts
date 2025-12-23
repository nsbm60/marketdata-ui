/**
 * Visibility Detector
 *
 * Detects when the browser tab becomes visible after being hidden.
 * Used to trigger data refresh when user returns to the app.
 */

export interface VisibilityChangeEvent {
  type: "TAB_VISIBLE" | "TAB_HIDDEN";
  hiddenDuration: number; // ms the tab was hidden (0 for TAB_HIDDEN)
  timestamp: number;
}

export type VisibilityChangeHandler = (event: VisibilityChangeEvent) => void;

/**
 * Creates a visibility detector that tracks tab visibility changes.
 *
 * @param onVisibilityChange - Callback when visibility changes
 * @returns Cleanup function to remove event listener
 *
 * @example
 * ```typescript
 * const cleanup = createVisibilityDetector((event) => {
 *   if (event.type === "TAB_VISIBLE" && event.hiddenDuration > 5 * 60 * 1000) {
 *     console.log("Tab was hidden for over 5 minutes");
 *     dispatch({ type: "TAB_VISIBLE", hiddenDuration: event.hiddenDuration });
 *   }
 * });
 *
 * // Later:
 * cleanup();
 * ```
 */
export function createVisibilityDetector(
  onVisibilityChange: VisibilityChangeHandler
): () => void {
  let hiddenAt: number | null = null;

  const handleVisibilityChange = () => {
    const now = Date.now();

    if (document.hidden) {
      // Tab hidden - record timestamp
      hiddenAt = now;
      onVisibilityChange({
        type: "TAB_HIDDEN",
        hiddenDuration: 0,
        timestamp: now,
      });
    } else {
      // Tab visible - calculate how long it was hidden
      const hiddenDuration = hiddenAt !== null ? now - hiddenAt : 0;
      hiddenAt = null;

      onVisibilityChange({
        type: "TAB_VISIBLE",
        hiddenDuration,
        timestamp: now,
      });
    }
  };

  document.addEventListener("visibilitychange", handleVisibilityChange);

  return () => {
    document.removeEventListener("visibilitychange", handleVisibilityChange);
  };
}

/**
 * React hook for visibility detection.
 * Note: For use within AppStateContext, prefer the raw createVisibilityDetector.
 */
import { useEffect, useRef, useCallback } from "react";

export function useVisibilityDetector(
  onVisible: (hiddenDuration: number) => void,
  thresholdMs: number = 0
): void {
  const hiddenAtRef = useRef<number | null>(null);
  const onVisibleRef = useRef(onVisible);

  // Keep callback ref up to date
  useEffect(() => {
    onVisibleRef.current = onVisible;
  }, [onVisible]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        hiddenAtRef.current = Date.now();
      } else {
        if (hiddenAtRef.current !== null) {
          const hiddenDuration = Date.now() - hiddenAtRef.current;
          hiddenAtRef.current = null;

          if (hiddenDuration >= thresholdMs) {
            onVisibleRef.current(hiddenDuration);
          }
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [thresholdMs]);
}
