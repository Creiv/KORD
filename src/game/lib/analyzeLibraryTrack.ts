import { mediaUrl } from "../../lib/api";
import type { EnrichedTrack } from "../../types";
import { analyzeLibraryBuffer } from "./audioAnalysis";
import { getCachedChart, setCachedChart } from "./chartCache";
import { sanitizeChartSetForRekord } from "./chartSanitize";
import { yieldUi } from "./yieldUi";
import type { ChartSet } from "../types";

export type AnalyzeProgress = (progress: number, message: string) => void;

export class RhythmAnalyzeError extends Error {
  readonly code: "fetch" | "decode" | "sparse" | "timeout";

  constructor(code: "fetch" | "decode" | "sparse" | "timeout") {
    super(code);
    this.name = "RhythmAnalyzeError";
    this.code = code;
  }
}

const MIN_NOTES_PER_DIFFICULTY = 12;
const FETCH_TIMEOUT_MS = 120_000;

function chartIsPlayable(chartSet: ChartSet): boolean {
  return Object.values(chartSet.charts).some(
    (chart) => chart.notes.length >= MIN_NOTES_PER_DIFFICULTY
  );
}

function mediaFetchUrl(relPath: string): string {
  const path = mediaUrl(relPath);
  try {
    return new URL(path, window.location.origin).href;
  } catch {
    return path;
  }
}

const prefetchInFlight = new Set<string>();

/** Precarica la chart in cache (es. prossimo brano in coda). */
export function prefetchRhythmChart(track: EnrichedTrack): void {
  const { relPath } = track;
  if (getCachedChart(relPath) || prefetchInFlight.has(relPath)) return;
  prefetchInFlight.add(relPath);
  void analyzeLibraryTrack(track)
    .catch(() => {
      /* best-effort */
    })
    .finally(() => {
      prefetchInFlight.delete(relPath);
    });
}

export async function analyzeLibraryTrack(
  track: EnrichedTrack,
  onProgress?: AnalyzeProgress,
  signal?: AbortSignal
): Promise<ChartSet> {
  const cached = getCachedChart(track.relPath);
  if (cached) {
    onProgress?.(1, "ready");
    return cached;
  }

  onProgress?.(0.08, "fetch");
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const abortHandler = () => controller.abort();
  signal?.addEventListener("abort", abortHandler);

  try {
    const response = await fetch(mediaFetchUrl(track.relPath), {
      credentials: "same-origin",
      cache: "force-cache",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new RhythmAnalyzeError("fetch");
    }
    onProgress?.(0.28, "fetch");
    const blob = await response.blob();
    onProgress?.(0.35, "decode");
    await yieldUi();
    const arrayBuffer = await blob.arrayBuffer();
    await yieldUi();
    const ctx = new AudioContext();
    try {
      const buffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
      onProgress?.(0.55, "analyze");
      await yieldUi();
      const chartSet = await analyzeLibraryBuffer(
        buffer,
        track.relPath,
        track.title || track.relPath
      );
      const playable = sanitizeChartSetForRekord(chartSet);
      if (!chartIsPlayable(playable)) {
        throw new RhythmAnalyzeError("sparse");
      }
      onProgress?.(1, "ready");
      setCachedChart(track.relPath, chartSet);
      return chartSet;
    } finally {
      void ctx.close();
    }
  } catch (err) {
    if (signal?.aborted) throw err;
    if (err instanceof RhythmAnalyzeError) throw err;
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new RhythmAnalyzeError("timeout");
    }
    throw new RhythmAnalyzeError("decode");
  } finally {
    window.clearTimeout(timeoutId);
    signal?.removeEventListener("abort", abortHandler);
  }
}
