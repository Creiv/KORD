import { useLayoutEffect, useRef, useState } from "react";

const MIN_CARD_PX = 200;
const DASHBOARD_UPDATED_ALBUMS_MAX = 24;
const VISIBLE_ROWS = 2;
const GAP_FALLBACK_PX = 15;

function colsForWidth(w: number, gapPx: number) {
  if (w <= 0) return 1;
  const g = Number.isFinite(gapPx) && gapPx > 0 ? gapPx : GAP_FALLBACK_PX;
  const n = Math.floor((w + g) / (MIN_CARD_PX + g));
  return Math.max(1, n);
}

function readColumnGapPx(el: HTMLElement) {
  const g = getComputedStyle(el).columnGap;
  const n = parseFloat(g);
  return Number.isFinite(n) && n > 0 ? n : GAP_FALLBACK_PX;
}

export function useDashboardUpdatedAlbumsGrid() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [cols, setCols] = useState(2);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const w = el.getBoundingClientRect().width;
      setCols(colsForWidth(w, readColumnGapPx(el)));
    };
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setCols(colsForWidth(w, readColumnGapPx(el)));
    });
    ro.observe(el);
    update();
    return () => ro.disconnect();
  }, []);
  const maxItems = Math.min(
    DASHBOARD_UPDATED_ALBUMS_MAX,
    VISIBLE_ROWS * cols
  );
  return { ref, cols, maxItems };
}
