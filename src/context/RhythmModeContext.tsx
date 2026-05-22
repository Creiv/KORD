/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { ensurePlectrStyles } from "../lib/ensurePlectrStyles";

type RhythmModeCtx = {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
};

const RhythmModeContext = createContext<RhythmModeCtx | null>(null);

export function RhythmModeProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((v) => !v), []);

  useEffect(() => {
    if (open) ensurePlectrStyles();
  }, [open]);
  const value = useMemo(
    () => ({ open, setOpen, toggle }),
    [open, toggle]
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
