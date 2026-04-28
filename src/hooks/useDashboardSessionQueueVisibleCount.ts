import { useLayoutEffect, useRef, useState, type RefObject } from "react";

const DESKTOP_MAX_TRACKS = 12;
const MOBILE_MAX_TRACKS = 5;
const ROW_FALLBACK_PX = 58;
const STACK_GAP_PX = 16;

function readListStackGapPx(stack: Element | null): number {
  if (!stack || !(stack instanceof HTMLElement)) return STACK_GAP_PX;
  const g = getComputedStyle(stack).gap;
  const n = parseFloat(g);
  return Number.isFinite(n) && n > 0 ? n : STACK_GAP_PX;
}

/** Altezza verticale come la colonna "Ultimi movimenti" (griglia album), non il corpo sessione. */
export function useDashboardSessionQueueVisibleCount(
  listLength: number,
  isMobile: boolean,
  albumsGridBudgetRef: RefObject<HTMLDivElement | null>
) {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [desktopLimit, setDesktopLimit] = useState(DESKTOP_MAX_TRACKS);

  useLayoutEffect(() => {
    if (isMobile || listLength === 0) return;
    const budgetEl = albumsGridBudgetRef.current;
    const sessionEl = bodyRef.current;
    if (!budgetEl || !sessionEl) return;

    const compute = () => {
      const budget = budgetEl.getBoundingClientRect().height;
      if (budget < 40) return;
      const listStack = sessionEl.querySelector(".list-stack");
      const firstRow = listStack?.querySelector(".track-row");
      const rowH =
        firstRow instanceof HTMLElement
          ? firstRow.getBoundingClientRect().height
          : ROW_FALLBACK_PX;
      const gap = readListStackGapPx(listStack);
      const n = Math.floor((budget + gap) / (rowH + gap));
      setDesktopLimit(Math.max(1, Math.min(DESKTOP_MAX_TRACKS, n)));
    };

    const ro = new ResizeObserver(compute);
    ro.observe(budgetEl);
    compute();
    const id = requestAnimationFrame(compute);
    return () => {
      cancelAnimationFrame(id);
      ro.disconnect();
    };
  }, [isMobile, listLength, albumsGridBudgetRef]);

  const visibleCount =
    listLength === 0
      ? 0
      : isMobile
        ? Math.min(MOBILE_MAX_TRACKS, listLength)
        : Math.min(desktopLimit, listLength);

  return { bodyRef, visibleCount };
}
