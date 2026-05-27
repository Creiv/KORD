import type { Chart, ChartMap, ChartSet, DifficultyId } from "../types";

/** Chart RE-KORD: tap + hold mantenute su tutte le difficoltà. Niente swipe. */
export function sanitizeChartForKord(chart: Chart): Chart {
  const notes = chart.notes
    .filter((raw) => raw.type !== "swipe")
    .map((raw, id) => {
      const dur = raw.duration ?? 0;
      const isHold = dur > 0 && (raw.type === "hold" || raw.type === "tap");
      return {
        ...raw,
        id,
        type: (isHold ? "hold" : "tap") as "tap" | "hold",
        direction: null,
        endLane: null,
        duration: isHold ? raw.duration : 0,
        hit: false,
        missed: false,
        holding: false,
        completed: false,
      };
    });
  return { ...chart, notes };
}

export function sanitizeChartSetForRekord(chartSet: ChartSet): ChartSet {
  const charts = {} as ChartMap;
  for (const id of Object.keys(chartSet.charts) as DifficultyId[]) {
    charts[id] = sanitizeChartForKord(chartSet.charts[id]);
  }
  return { ...chartSet, charts };
}
