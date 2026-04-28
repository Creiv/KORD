import {
  useCallback,
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from "react";

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}

function clamp100(x: number) {
  return Math.max(0, Math.min(100, x));
}

export function PlayerProgressTrack({
  percent,
  seekRatio,
}: {
  percent: number;
  seekRatio: (r: number) => void;
}) {
  const railRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef(false);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!dragRef.current || !railRef.current) return;
      const rect = railRef.current.getBoundingClientRect();
      seekRatio(clamp01((e.clientX - rect.left) / rect.width));
    };
    const onUp = () => {
      dragRef.current = false;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [seekRatio]);

  const startSeekFromEvent = useCallback(
    (e: Pick<ReactPointerEvent, "clientX" | "pointerId" | "currentTarget">) => {
      dragRef.current = true;
      const rail = railRef.current;
      if (!rail) return;
      const rect = rail.getBoundingClientRect();
      seekRatio(clamp01((e.clientX - rect.left) / rect.width));
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    },
    [seekRatio]
  );

  const onRailPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      startSeekFromEvent(e);
    },
    [startSeekFromEvent]
  );

  const onThumbPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      startSeekFromEvent(e);
    },
    [startSeekFromEvent]
  );

  return (
    <div
      className="progress2"
      role="slider"
      aria-valuenow={Math.round(percent)}
      aria-valuemin={0}
      aria-valuemax={100}
      tabIndex={0}
      onPointerDown={onRailPointerDown}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
          e.preventDefault();
          seekRatio(clamp01(percent / 100 - 0.02));
        } else if (e.key === "ArrowRight" || e.key === "ArrowUp") {
          e.preventDefault();
          seekRatio(clamp01(percent / 100 + 0.02));
        }
      }}
    >
      <div ref={railRef} className="progress2__track-slot">
        <div className="progress2__rail" aria-hidden>
          <div
            className="progress2__fill"
            style={{ width: `${clamp100(percent)}%` }}
          />
        </div>
        <span
          className="progress2__thumb"
          style={{ left: `${clamp100(percent)}%` }}
          aria-hidden="true"
          onPointerDown={onThumbPointerDown}
        />
      </div>
    </div>
  );
}
