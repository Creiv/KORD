import { useLayoutEffect } from "react";
import { MOBILE_LAYOUT_MQ } from "../lib/breakpoints";

const ROOT = document.documentElement;

/**
 * Sincronizza --bar-h e data-player-dock con l'altezza della sola barra player
 * (`.player-bar2`), non del pannello Plectr sopra di essa.
 */
export function usePlayerDockCssVars(queueLength: number) {
  useLayoutEffect(() => {
    if (queueLength === 0) {
      ROOT.dataset.playerDock = "0";
      ROOT.style.removeProperty("--bar-h");
      return;
    }

    ROOT.dataset.playerDock = "1";

    const applyHeight = (px: number) => {
      const h = Math.max(0, Math.ceil(px));
      ROOT.style.setProperty("--bar-h", `${h}px`);
    };

    const bar = document.querySelector<HTMLElement>(".player-dock2 .player-bar2");
    if (!bar) {
      applyHeight(parseFallbackBarHeight());
      return;
    }

    applyHeight(bar.getBoundingClientRect().height);

    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      applyHeight(entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height);
    });
    ro.observe(bar);

    const onMq = () => applyHeight(bar.getBoundingClientRect().height);
    const mql = window.matchMedia(MOBILE_LAYOUT_MQ);
    mql.addEventListener("change", onMq);

    return () => {
      ro.disconnect();
      mql.removeEventListener("change", onMq);
    };
  }, [queueLength]);
}

function parseFallbackBarHeight(): number {
  const raw = getComputedStyle(ROOT).getPropertyValue("--bar-h").trim();
  if (raw.endsWith("px")) return Number.parseFloat(raw) || 120;
  if (raw.endsWith("rem")) {
    const rem = Number.parseFloat(raw) || 7;
    const base = Number.parseFloat(getComputedStyle(ROOT).fontSize) || 16;
    return rem * base;
  }
  return 120;
}
