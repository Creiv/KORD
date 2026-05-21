import { useLayoutEffect, useRef, useState, type RefObject } from "react";

/** Limite massimo album nella sezione «Ultimi movimenti» della dashboard. */
export const DASHBOARD_UPDATED_ALBUMS_MAX = 20;

const MOBILE_MAX_ALBUMS = 5;
/** Da ~8 tile con ~2 colonne (16:9, card affiancate) salendo fino a 20 quando la griglia è larga. */
const DESKTOP_IDEAL_BASE = 8;
const DESKTOP_IDEAL_SLOPE_PER_COL = 2;
/** Con molte colonne (21:9) non restare solo su 2 righe affiancate. */
const ULTRAWIDE_MIN_ROWS = 3;
const DESKTOP_ROWS_CAP = 6;
/** Allineato a `.library-overview-cols--dashboard` (mintrack 17.5rem, column-gap ~0.95rem). */
const MIN_TRACK_REM = 17.5;
const COLUMN_GAP_REM = 0.95;

function readColumnGapPx(grid: HTMLElement, rootFontPx: number): number {
  const g = getComputedStyle(grid).columnGap;
  const n = parseFloat(g);
  const font = Number.isFinite(rootFontPx) && rootFontPx > 0 ? rootFontPx : 16;
  if (Number.isFinite(n) && n > 0) return n;
  return COLUMN_GAP_REM * font;
}

/** Stima delle colonne `repeat(auto-fill, minmax(min(17.5rem, 100%), 1fr))`. */
function estimateDashboardAlbumGridColumns(grid: HTMLElement): number {
  const width = grid.clientWidth;
  if (width <= 8) return 1;
  const rootFontPx = parseFloat(
    getComputedStyle(document.documentElement).fontSize || "16"
  );
  const minTrackPx = Math.min(
    MIN_TRACK_REM * (Number.isFinite(rootFontPx) ? rootFontPx : 16),
    width
  );
  const gap = readColumnGapPx(grid, rootFontPx);
  return Math.max(1, Math.floor((width + gap) / (minTrackPx + gap)));
}

function dashboardUpdatedAlbumSlotsForDesktop(cols: number): number {
  const c = Math.max(1, cols);
  const idealUncapped =
    DESKTOP_IDEAL_BASE + DESKTOP_IDEAL_SLOPE_PER_COL * Math.max(0, c - 2);
  const ideal = Math.min(
    DASHBOARD_UPDATED_ALBUMS_MAX,
    Math.round(idealUncapped)
  );
  const baseRows = Math.ceil(ideal / c);
  const minRowsWide = c >= 7 ? ULTRAWIDE_MIN_ROWS : 2;
  const rows = Math.min(DESKTOP_ROWS_CAP, Math.max(minRowsWide, baseRows));
  return Math.min(DASHBOARD_UPDATED_ALBUMS_MAX, c * rows);
}

export function dashboardUpdatedAlbumsVisibleCount(
  albumCount: number,
  maxSlots: number | undefined,
  _columns?: number | undefined
): number {
  const cap = Math.max(0, maxSlots ?? DASHBOARD_UPDATED_ALBUMS_MAX);
  return Math.min(Math.max(0, albumCount), cap);
}

export function useDashboardUpdatedAlbumsGrid(isMobile: boolean) {
  const ref: RefObject<HTMLDivElement | null> = useRef(null);
  const [desktopSlots, setDesktopSlots] = useState(8);
  const [columns, setColumns] = useState(1);

  useLayoutEffect(() => {
    if (isMobile) {
      setColumns(1);
      return;
    }
    const el = ref.current;
    if (!el) return;

    const compute = () => {
      const cols = estimateDashboardAlbumGridColumns(el);
      setColumns(cols);
      setDesktopSlots(dashboardUpdatedAlbumSlotsForDesktop(cols));
    };

    const ro = new ResizeObserver(compute);
    ro.observe(el);
    compute();
    const id = requestAnimationFrame(compute);

    return () => {
      cancelAnimationFrame(id);
      ro.disconnect();
    };
  }, [isMobile]);

  const maxSlots = isMobile
    ? MOBILE_MAX_ALBUMS
    : Math.min(DASHBOARD_UPDATED_ALBUMS_MAX, desktopSlots);

  return {
    ref,
    maxSlots,
    columns: isMobile ? 1 : columns,
    /** @deprecated Usa {@link maxSlots}. */
    maxItems: maxSlots,
  };
}
