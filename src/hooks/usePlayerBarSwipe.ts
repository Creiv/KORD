import { useCallback, useRef } from "react";

const SWIPE_THRESHOLD_PX = 48;
const SWIPE_MAX_VERTICAL_PX = 40;

type SwipeHandlers = {
  onPointerDown: (event: React.PointerEvent) => void;
  onPointerMove: (event: React.PointerEvent) => void;
  onPointerUp: (event: React.PointerEvent) => void;
  onPointerCancel: (event: React.PointerEvent) => void;
};

export function usePlayerBarSwipe(
  onPrev: () => void,
  onNext: () => void,
  enabled: boolean,
): SwipeHandlers {
  const startRef = useRef<{ x: number; y: number; id: number } | null>(null);
  const firedRef = useRef(false);

  const reset = useCallback(() => {
    startRef.current = null;
    firedRef.current = false;
  }, []);

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (!enabled) return;
      const target = event.target as HTMLElement;
      if (
        target.closest(
          "button, input, .progress2, .player-bar2__byline, .player-bar2__mobile-menu-wrap",
        )
      ) {
        return;
      }
      startRef.current = { x: event.clientX, y: event.clientY, id: event.pointerId };
      firedRef.current = false;
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [enabled],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      const start = startRef.current;
      if (!start || start.id !== event.pointerId || firedRef.current) return;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if (Math.abs(dy) > SWIPE_MAX_VERTICAL_PX) {
        reset();
        return;
      }
      if (Math.abs(dx) < SWIPE_THRESHOLD_PX) return;
      firedRef.current = true;
      if (dx > 0) onPrev();
      else onNext();
      reset();
    },
    [onNext, onPrev, reset],
  );

  const onPointerUp = useCallback(
    (event: React.PointerEvent) => {
      if (startRef.current?.id === event.pointerId) reset();
    },
    [reset],
  );

  const onPointerCancel = useCallback(
    (event: React.PointerEvent) => {
      if (startRef.current?.id === event.pointerId) reset();
    },
    [reset],
  );

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel };
}
