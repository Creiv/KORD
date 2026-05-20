import { useCallback, useEffect, useRef, useState } from "react";

const MIN_VISIBLE_MS = 4000;
const AFTER_BUSY_MS = 2500;

/**
 * Snackbar solo dopo clic sul pulsante sync/reload.
 * Non si lega a salvataggi in background (coda, preferenze, ecc.).
 */
export function useSyncStatusSnackbar(librarySyncBusy: boolean) {
  const [open, setOpen] = useState(false);
  const sessionActiveRef = useRef(false);
  const hideUntilRef = useRef(0);
  const hideTimerRef = useRef<number | null>(null);

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current != null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const extendVisible = useCallback((ms: number) => {
    hideUntilRef.current = Math.max(hideUntilRef.current, Date.now() + ms);
    setOpen(true);
  }, []);

  const scheduleHide = useCallback(() => {
    clearHideTimer();
    if (librarySyncBusy && sessionActiveRef.current) return;
    const wait = hideUntilRef.current - Date.now();
    if (wait <= 0) {
      setOpen(false);
      sessionActiveRef.current = false;
      return;
    }
    hideTimerRef.current = window.setTimeout(() => {
      hideTimerRef.current = null;
      if (librarySyncBusy && sessionActiveRef.current) {
        scheduleHide();
        return;
      }
      if (Date.now() < hideUntilRef.current) {
        scheduleHide();
        return;
      }
      setOpen(false);
      sessionActiveRef.current = false;
    }, wait);
  }, [clearHideTimer, librarySyncBusy]);

  useEffect(() => {
    if (!sessionActiveRef.current) return;
    if (librarySyncBusy) {
      clearHideTimer();
      setOpen(true);
      return;
    }
    extendVisible(Math.max(AFTER_BUSY_MS, MIN_VISIBLE_MS));
    scheduleHide();
  }, [clearHideTimer, extendVisible, librarySyncBusy, scheduleHide]);

  useEffect(() => () => clearHideTimer(), [clearHideTimer]);

  const notifySyncClick = useCallback(() => {
    sessionActiveRef.current = true;
    extendVisible(MIN_VISIBLE_MS);
    scheduleHide();
  }, [extendVisible, scheduleHide]);

  return { open, notifySyncClick };
}
