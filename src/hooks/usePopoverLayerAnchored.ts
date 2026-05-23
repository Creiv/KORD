import {
  type CSSProperties,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useState,
} from "react";

export type PopoverLayerPlacement = {
  top: number;
  /** Esclusivo con `left`: distanza dal bordo destro del viewport. */
  right?: number;
  /** Esclusivo con `right`: distanza dal bordo sinistro del viewport. */
  left?: number;
  /** Ancora sopra l’elemento (`translateY(-100%)` nel CSS del menu). */
  above?: boolean;
};

export type PopoverLayerOptions = {
  /**
   * Larghezza minima stimata del pannello (px). Se l’allineamento a `right`
   * (bordo destro pannello = bordo destro ancora) farebbe uscire il pannello
   * a sinistra dello schermo, si usa `left` ancorato al margine / all’ancora.
   */
  alignMinWidthPx?: number;
  edgeMarginPx?: number;
  /** Menu verso l’alto (es. playbar mobile). */
  preferAbove?: boolean;
};

export function popoverPlacementStyle(
  placement: PopoverLayerPlacement | null
): CSSProperties | undefined {
  if (!placement) return undefined;
  const aboveShift =
    placement.above ? { transform: "translateY(calc(-100% - 6px))" } : undefined;
  if (placement.left != null) {
    return {
      top: placement.top,
      left: placement.left,
      right: "auto",
      ...aboveShift,
    };
  }
  return {
    top: placement.top,
    right: placement.right ?? 8,
    left: "auto",
    ...aboveShift,
  };
}

/**
 * Dropdown ancorato all’elemento (coordinate `fixed`), sopra dock/shell.
 * Stesso schema di chiusura delle card brano: fuori click, Esc, scroll (capture), resize.
 */
export function usePopoverLayerAnchored(
  open: boolean,
  anchorRef: RefObject<HTMLElement | null>,
  onRequestClose: () => void,
  floatingRef?: RefObject<HTMLElement | null>,
  options?: PopoverLayerOptions
): PopoverLayerPlacement | null {
  const [placement, setPlacement] = useState<PopoverLayerPlacement | null>(
    null
  );

  useLayoutEffect(() => {
    let cancelled = false;
    const commitPlacement = (next: PopoverLayerPlacement | null) => {
      queueMicrotask(() => {
        if (!cancelled) setPlacement(next);
      });
    };
    if (!open) {
      commitPlacement(null);
      return () => {
        cancelled = true;
      };
    }
    const el = anchorRef.current;
    if (!el) {
      commitPlacement(null);
      return () => {
        cancelled = true;
      };
    }
    const rect = el.getBoundingClientRect();
    const m = Math.max(0, options?.edgeMarginPx ?? 8);
    const minW = options?.alignMinWidthPx;
    const vw = window.innerWidth;

    const preferAbove = options?.preferAbove === true;
    if (preferAbove) {
      if (minW != null && minW > 0 && rect.right - m < minW) {
        const left = Math.max(m, Math.min(rect.left, vw - minW - m));
        commitPlacement({ top: rect.top, left, above: true });
      } else {
        commitPlacement({
          top: rect.top,
          right: Math.max(m, vw - rect.right),
          above: true,
        });
      }
      return;
    }
    if (minW != null && minW > 0 && rect.right - m < minW) {
      const left = Math.max(m, Math.min(rect.left, vw - minW - m));
      commitPlacement({ top: rect.bottom + 4, left });
    } else {
      commitPlacement({
        top: rect.bottom + 4,
        right: Math.max(m, vw - rect.right),
      });
    }
    return () => {
      cancelled = true;
    };
  }, [
    open,
    anchorRef,
    options?.alignMinWidthPx,
    options?.edgeMarginPx,
    options?.preferAbove,
  ]);

  useEffect(() => {
    if (!open) return;
    /** `click` (non `mousedown`) così la voce del menu riceve il click prima della chiusura. */
    const onDocClick = (e: globalThis.MouseEvent) => {
      const t = e.target as Node;
      if (anchorRef.current?.contains(t)) return;
      if (floatingRef?.current?.contains(t)) return;
      onRequestClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onRequestClose();
    };
    const dismissOnScroll = (e: Event) => {
      const t = e.target;
      if (t instanceof Node && floatingRef?.current?.contains(t)) return;
      if (
        t instanceof Element &&
        t.closest(".popover-layer-fixed, .track-row__overflow-menu")
      ) {
        return;
      }
      if (
        t instanceof Element &&
        t.closest(
          ".viz-lyrics-overlay, .listen-recent-lyrics, .listen-recent-lyrics__plain"
        )
      ) {
        return;
      }
      onRequestClose();
    };
    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", dismissOnScroll, true);
    const dismissOnResize = () => onRequestClose();
    window.addEventListener("resize", dismissOnResize);
    return () => {
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", dismissOnScroll, true);
      window.removeEventListener("resize", dismissOnResize);
    };
  }, [open, anchorRef, floatingRef, onRequestClose]);

  return open ? placement : null;
}
