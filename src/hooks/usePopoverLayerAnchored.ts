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
};

export type PopoverLayerOptions = {
  /**
   * Larghezza minima stimata del pannello (px). Se l’allineamento a `right`
   * (bordo destro pannello = bordo destro ancora) farebbe uscire il pannello
   * a sinistra dello schermo, si usa `left` ancorato al margine / all’ancora.
   */
  alignMinWidthPx?: number;
  edgeMarginPx?: number;
};

export function popoverPlacementStyle(
  placement: PopoverLayerPlacement | null
): CSSProperties | undefined {
  if (!placement) return undefined;
  if (placement.left != null) {
    return {
      top: placement.top,
      left: placement.left,
      right: "auto",
    };
  }
  return {
    top: placement.top,
    right: placement.right ?? 8,
    left: "auto",
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
    if (!open) {
      setPlacement(null);
      return;
    }
    const el = anchorRef.current;
    if (!el) {
      setPlacement(null);
      return;
    }
    const rect = el.getBoundingClientRect();
    const m = Math.max(0, options?.edgeMarginPx ?? 8);
    const minW = options?.alignMinWidthPx;
    const vw = window.innerWidth;

    if (minW != null && minW > 0 && rect.right - m < minW) {
      const left = Math.max(m, Math.min(rect.left, vw - minW - m));
      setPlacement({ top: rect.bottom + 4, left });
    } else {
      setPlacement({
        top: rect.bottom + 4,
        right: Math.max(m, vw - rect.right),
      });
    }
  }, [open, anchorRef, options?.alignMinWidthPx, options?.edgeMarginPx]);

  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e: globalThis.MouseEvent) => {
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
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", dismissOnScroll, true);
    const dismissOnResize = () => onRequestClose();
    window.addEventListener("resize", dismissOnResize);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", dismissOnScroll, true);
      window.removeEventListener("resize", dismissOnResize);
    };
  }, [open, anchorRef, floatingRef, onRequestClose]);

  return open ? placement : null;
}
