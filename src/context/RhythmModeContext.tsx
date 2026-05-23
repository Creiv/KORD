/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  ensurePlectrStyles,
  isPlectrStylesLoaded,
} from "../lib/ensurePlectrStyles";

type RhythmModeCtx = {
  open: boolean;
  /** Stili Plectr pronti (evita flash UI non stilizzata). */
  stylesReady: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
};

const RhythmModeContext = createContext<RhythmModeCtx | null>(null);

export function RhythmModeProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [stylesReady, setStylesReady] = useState(isPlectrStylesLoaded());
  const toggle = useCallback(() => setOpen((v) => !v), []);

  useEffect(() => {
    if (!open) return;
    if (isPlectrStylesLoaded()) {
      const timer = window.setTimeout(() => setStylesReady(true), 0);
      return () => window.clearTimeout(timer);
    }
    let cancelled = false;
    void ensurePlectrStyles().then(() => {
      if (!cancelled) setStylesReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const value = useMemo(
    () => ({ open, stylesReady, setOpen, toggle }),
    [open, stylesReady, toggle]
  );
  return (
    <RhythmModeContext.Provider value={value}>
      {children}
    </RhythmModeContext.Provider>
  );
}

export function useRhythmMode() {
  const ctx = useContext(RhythmModeContext);
  if (!ctx) {
    throw new Error("useRhythmMode must be used within RhythmModeProvider");
  }
  return ctx;
}
