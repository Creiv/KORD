import type { ChartSet } from "../types";

const MAX_ENTRIES = 8;
/** Bump per invalidare chart obsolete (es. hold inline su Hard). */
const CHART_CACHE_GENERATION = 3;
const cache = new Map<string, { gen: number; chartSet: ChartSet }>();

export function getCachedChart(relPath: string): ChartSet | null {
  const hit = cache.get(relPath);
  if (!hit || hit.gen !== CHART_CACHE_GENERATION) {
    if (hit) cache.delete(relPath);
    return null;
  }
  cache.delete(relPath);
  cache.set(relPath, hit);
  return hit.chartSet;
}

export function setCachedChart(relPath: string, chartSet: ChartSet): void {
  if (cache.has(relPath)) cache.delete(relPath);
  cache.set(relPath, { gen: CHART_CACHE_GENERATION, chartSet });
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export function clearChartCache(): void {
  cache.clear();
}
