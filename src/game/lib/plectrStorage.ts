import { savePlectrBestScore } from "../../lib/api";
import type {
  EnrichedTrack,
  LibraryEntityDelta,
  LibraryIndex,
  PlectrBestScore,
} from "../../types";
import type { GameResult } from "../types";
import { buildGameResult } from "./runResult";

export const PLECTR_BEST_LS_PREFIX = "kord-plectr-best:";
const LS_PREFIX = PLECTR_BEST_LS_PREFIX;

function lsKey(relPath: string): string {
  return `${LS_PREFIX}${relPath}`;
}

export function hasPlectrPlayRecord(
  raw: PlectrBestScore | null | undefined
): raw is PlectrBestScore {
  if (!raw || typeof raw.score !== "number" || !Number.isFinite(raw.score)) {
    return false;
  }
  return raw.score > 0 || (raw.hits ?? 0) > 0;
}

function plectrBestFromRaw(raw: PlectrBestScore | null | undefined): GameResult | null {
  if (!hasPlectrPlayRecord(raw)) {
    return null;
  }
  return buildGameResult({
    score: Math.max(0, Math.round(raw.score)),
    maxCombo: raw.maxCombo ?? 0,
    hits: raw.hits ?? 0,
    misses: raw.misses ?? 0,
  });
}

export function plectrBestFromLocal(relPath: string): GameResult | null {
  try {
    const raw = localStorage.getItem(lsKey(relPath));
    if (!raw) return null;
    return plectrBestFromRaw(JSON.parse(raw) as PlectrBestScore);
  } catch {
    return null;
  }
}

export function writePlectrBestLocal(relPath: string, best: PlectrBestScore): void {
  try {
    localStorage.setItem(lsKey(relPath), JSON.stringify(best));
  } catch {
    /* ignore */
  }
}

export function plectrBestFromTrack(track: EnrichedTrack | null): GameResult | null {
  const fromMeta = plectrBestFromRaw(track?.meta?.plectrBest ?? null);
  const fromLocal = track ? plectrBestFromLocal(track.relPath) : null;
  return pickBetterPlectrScore(fromMeta, fromLocal);
}

export function isBetterPlectrScore(
  next: GameResult,
  current: GameResult | null
): boolean {
  if (!current) return next.score > 0 || next.hits > 0;
  if (next.score !== current.score) return next.score > current.score;
  return next.accuracy > current.accuracy;
}

export function pickBetterPlectrScore(
  a: GameResult | null,
  b: GameResult | null
): GameResult | null {
  if (!a) return b;
  if (!b) return a;
  return isBetterPlectrScore(a, b) ? a : b;
}

/** Solo browser (nessuna chiamata API): aggiorna subito il record in UI. */
export function cachePlectrBestLocal(
  relPath: string,
  result: GameResult,
  current: GameResult | null
): boolean {
  if (!isBetterPlectrScore(result, current)) return false;
  writePlectrBestLocal(relPath, {
    score: result.score,
    grade: result.grade,
    accuracy: result.accuracy,
    maxCombo: result.maxCombo,
    hits: result.hits,
    misses: result.misses,
    updatedAt: new Date().toISOString(),
  });
  return true;
}

/** Brani con almeno un record Plectr (meta libreria + localStorage). */
export function collectPlectrPlayedRelPaths(
  index: LibraryIndex | null
): Set<string> {
  const paths = new Set<string>();
  if (index) {
    for (const tr of index.tracks) {
      if (hasPlectrPlayRecord(tr.meta?.plectrBest)) {
        paths.add(tr.relPath);
      }
    }
  }
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key?.startsWith(LS_PREFIX)) continue;
      const relPath = key.slice(LS_PREFIX.length);
      if (!relPath) continue;
      try {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        if (hasPlectrPlayRecord(JSON.parse(raw) as PlectrBestScore)) {
          paths.add(relPath);
        }
      } catch {
        /* ignore malformed entry */
      }
    }
  } catch {
    /* private mode / quota */
  }
  return paths;
}

export function countPlectrTracksPlayed(index: LibraryIndex | null): number {
  return collectPlectrPlayedRelPaths(index).size;
}

export async function persistPlectrBest(
  relPath: string,
  result: GameResult,
  current: GameResult | null
): Promise<{ saved: GameResult; delta: LibraryEntityDelta | null }> {
  if (!isBetterPlectrScore(result, current)) {
    return { saved: current ?? result, delta: null };
  }
  const payload: PlectrBestScore = {
    score: result.score,
    grade: result.grade,
    accuracy: result.accuracy,
    maxCombo: result.maxCombo,
    hits: result.hits,
    misses: result.misses,
    updatedAt: new Date().toISOString(),
  };
  writePlectrBestLocal(relPath, payload);
  try {
    const res = await savePlectrBestScore(relPath, payload);
    return {
      saved: result,
      delta: res.track ? { track: res.track } : null,
    };
  } catch {
    return { saved: result, delta: null };
  }
}
