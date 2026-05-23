import { savePlectrBestScore } from "../../lib/api";
import type {
  LibraryEntityDelta,
  PlectrBestScore,
} from "../../types";
import type { GameResult } from "../types";
import { buildGameResult } from "./runResult";

export function hasPlectrPlayRecord(
  raw: PlectrBestScore | null | undefined
): raw is PlectrBestScore {
  if (!raw || typeof raw.score !== "number" || !Number.isFinite(raw.score)) {
    return false;
  }
  return raw.score > 0 || (raw.hits ?? 0) > 0;
}

export function plectrBestFromRaw(
  raw: PlectrBestScore | null | undefined
): GameResult | null {
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

export function plectrBestFromUserState(
  plectrBests: Record<string, PlectrBestScore> | undefined,
  relPath: string
): GameResult | null {
  if (!plectrBests) return null;
  return plectrBestFromRaw(plectrBests[relPath]);
}

export function gameResultToPlectrBest(result: GameResult): PlectrBestScore {
  return {
    score: result.score,
    grade: result.grade,
    accuracy: result.accuracy,
    maxCombo: result.maxCombo,
    hits: result.hits,
    misses: result.misses,
    updatedAt: new Date().toISOString(),
  };
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

/** Brani distinti con almeno un record Plectr salvato nell'account. */
export function countPlectrTracksPlayed(
  plectrBests: Record<string, PlectrBestScore> | undefined
): number {
  if (!plectrBests) return 0;
  let n = 0;
  for (const best of Object.values(plectrBests)) {
    if (hasPlectrPlayRecord(best)) n += 1;
  }
  return n;
}

export async function persistPlectrBest(
  relPath: string,
  result: GameResult,
  current: GameResult | null
): Promise<{ saved: GameResult; delta: LibraryEntityDelta | null }> {
  if (!isBetterPlectrScore(result, current)) {
    return { saved: current ?? result, delta: null };
  }
  const payload = gameResultToPlectrBest(result);
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
