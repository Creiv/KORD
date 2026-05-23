import { clamp } from "./math";
import type { Chart, ChartNote } from "../types";

const HOLD_MIN_GAP = 0.58;
const HOLD_MIN_DUR = 0.44;
const HOLD_MAX_DUR = 1.75;
/** Ogni N note tap eleggibili → hold (map Extreme distinta da Hard). */
const HOLD_EVERY = 3;

function resetNote(note: ChartNote, id: number): ChartNote {
  return {
    ...note,
    id,
    type: "tap",
    direction: null,
    duration: 0,
    endLane: null,
    hit: false,
    missed: false,
    holding: false,
    completed: false,
  };
}

/**
 * Chart Extreme: stessa densità di Hard (tap) ma hold su note scelte per spaziatura,
 * non la stessa mappa con note “allungate” a caso.
 */
export function buildExtremeChart(tapChart: Chart): Chart {
  const sorted = tapChart.notes
    .map((n, i) => resetNote(n, i))
    .sort((a, b) => a.time - b.time || a.lane - b.lane);

  let lastHoldTime = -999;
  let holdOrdinal = 0;
  const out: ChartNote[] = [];

  for (let i = 0; i < sorted.length; i += 1) {
    const note = { ...sorted[i] };
    const next = sorted[i + 1];
    const gapAfter = next ? next.time - note.time : 999;
    const gapBefore = i > 0 ? note.time - sorted[i - 1].time : 999;

    holdOrdinal += 1;
    const eligible =
      holdOrdinal % HOLD_EVERY === 0 &&
      note.time - lastHoldTime >= HOLD_MIN_GAP &&
      gapBefore >= 0.12 &&
      gapAfter >= HOLD_MIN_DUR + 0.12;

    if (eligible) {
      const dur = clamp(
        Math.min(gapAfter * 0.78, HOLD_MAX_DUR),
        HOLD_MIN_DUR,
        HOLD_MAX_DUR,
      );
      note.type = "hold";
      note.duration = Number(dur.toFixed(3));
      note.endLane = note.lane;
      lastHoldTime = note.time;
    }

    out.push(note);
  }

  out.sort((a, b) => a.time - b.time || a.lane - b.lane);
  return {
    ...tapChart,
    songId: `${tapChart.baseSongId}:extreme`,
    notes: out.map((n, id) => ({ ...n, id })),
  };
}
