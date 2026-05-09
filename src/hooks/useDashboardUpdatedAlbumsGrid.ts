import { useRef } from "react";

/** Limite massimo album nella sezione “Ultimi aggiornamenti” della dashboard. */
export const DASHBOARD_UPDATED_ALBUMS_MAX = 20;

export function useDashboardUpdatedAlbumsGrid() {
  const ref = useRef<HTMLDivElement | null>(null);
  return { ref, maxItems: DASHBOARD_UPDATED_ALBUMS_MAX };
}
