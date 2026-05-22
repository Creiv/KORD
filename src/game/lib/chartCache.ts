import type { ChartSet } from "../types";

const MAX_ENTRIES = 8;
const cache = new Map<string, ChartSet>();

export function getCachedChart(relPath: string): ChartSet | null {
  const hit = cache.get(relPath);
  if (!hit) return null;
  cache.delete(relPath);
  cache.set(relPath, hit);
  return hit;
}

export function setCachedChart(relPath: string, chartSet: ChartSet): void {
  if (cache.has(relPath)) cache.delete(relPath);
  cache.set(relPath, chartSet);
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export function clearChartCache(): void {
  cache.clear();
}
