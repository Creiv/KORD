import type { Chart, ChartMap, ChartSet, DifficultyId } from "../types";

/** Chart KORD: solo tap (niente hold, swipe o slide). */
export function sanitizeChartForKord(chart: Chart): Chart {
  const notes = chart.notes
    .filter((raw) => raw.type !== "swipe")
    .map((raw, id) => ({
      ...raw,
      id,
      type: "tap" as const,
      direction: null,
      endLane: null,
      duration: 0,
      hit: false,
      missed: false,
      holding: false,
      completed: false,
    }));
  return { ...chart, notes };
}

export function sanitizeChartSetForKord(chartSet: ChartSet): ChartSet {
  const charts = {} as ChartMap;
  for (const id of Object.keys(chartSet.charts) as DifficultyId[]) {
    charts[id] = sanitizeChartForKord(chartSet.charts[id]);
  }
  return { ...chartSet, charts };
}
