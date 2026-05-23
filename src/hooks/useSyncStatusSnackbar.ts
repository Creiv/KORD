import { useCallback, useEffect, useRef, useState } from "react";

const MIN_VISIBLE_MS = 3000;
const AFTER_BUSY_MS = 2000;

/**
 * Snackbar visibile mentre il pulsante sync/reload è busy
 * (bootstrap, refresh libreria, download Studio, ecc.).
 * Non include salvataggi user-state in background (preferiti, coda).
 */
export function useSyncStatusSnackbar(syncBusy: boolean) {
  const [open, setOpen] = useState(false);
  const hideUntilRef = useRef(0);
  const hideTimerRef = useRef<number | null>(null);
  const hadBusyRef = useRef(false);

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current != null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const scheduleHide = useCallback(function scheduleHideInner() {
    clearHideTimer();
    const wait = hideUntilRef.current - Date.now();
    if (wait <= 0) {
      setOpen(false);
      return;
    }
    hideTimerRef.current = window.setTimeout(() => {
      hideTimerRef.current = null;
      if (syncBusy) {
        setOpen(true);
        return;
      }
      if (Date.now() < hideUntilRef.current) {
        scheduleHideInner();
        return;
      }
      setOpen(false);
    }, wait);
  }, [clearHideTimer, syncBusy]);

  useEffect(() => {
    if (syncBusy) {
      hadBusyRef.current = true;
      clearHideTimer();
      hideUntilRef.current = Math.max(
        hideUntilRef.current,
        Date.now() + MIN_VISIBLE_MS
      );
      const timer = window.setTimeout(() => setOpen(true), 0);
      return () => window.clearTimeout(timer);
    }
    if (!hadBusyRef.current) return;
    hideUntilRef.current = Math.max(
      hideUntilRef.current,
      Date.now() + AFTER_BUSY_MS
    );
    scheduleHide();
  }, [clearHideTimer, scheduleHide, syncBusy]);

  useEffect(() => () => clearHideTimer(), [clearHideTimer]);

  return { open: open || syncBusy };
}
