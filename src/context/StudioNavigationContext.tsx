/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext } from "react";

export const REKORD_STUDIO_PANE = "rekord-studio-pane";
export const STUDIO_PANE_EVENT = "rekord-studio-pane";

export type StudioPaneId =
  | "listen"
  | "catalog"
  | "download"
  | "meta"
  | "covers";

const StudioNavigationContext = createContext<{
  openStudioListen: () => void;
  openStudioMeta: () => void;
} | null>(null);

export function StudioNavigationProvider({
  openStudioListen,
  openStudioMeta,
  children,
}: {
  openStudioListen: () => void;
  openStudioMeta: () => void;
  children: React.ReactNode;
}) {
  return (
    <StudioNavigationContext.Provider value={{ openStudioListen, openStudioMeta }}>
      {children}
    </StudioNavigationContext.Provider>
  );
}

export function useStudioNavigation() {
  return useContext(StudioNavigationContext);
}

export function stashStudioPane(pane: StudioPaneId) {
  try {
    localStorage.setItem(REKORD_STUDIO_PANE, pane);
  } catch {
    /* ignore */
  }
}

export function emitStudioPane(pane: StudioPaneId) {
  stashStudioPane(pane);
  window.dispatchEvent(
    new CustomEvent<StudioPaneId>(STUDIO_PANE_EVENT, { detail: pane }),
  );
}
