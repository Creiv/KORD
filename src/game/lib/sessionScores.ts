import {
  plectrBestFromUserState,
  pickBetterPlectrScore,
} from "./plectrStorage";
import type { GameResult } from "../types";
import type { PlectrBestScore } from "../../types";

/** Miglior risultato per brano (relPath) nella sessione corrente. */
const bestByTrack = new Map<string, GameResult>();

export function getSessionTrackBest(relPath: string): GameResult | null {
  return bestByTrack.get(relPath) ?? null;
}

export function saveSessionTrackBest(relPath: string, result: GameResult): GameResult {
  const current = bestByTrack.get(relPath) ?? null;
  const next = pickBetterPlectrScore(result, current) ?? result;
  bestByTrack.set(relPath, next);
  return next;
}

/** Allinea la sessione con il record salvato per l'account. */
export function hydrateSessionTrackBest(
  relPath: string,
  plectrBests?: Record<string, PlectrBestScore>
): void {
  const seed = plectrBestFromUserState(plectrBests, relPath);
  if (!seed) return;
  const current = bestByTrack.get(relPath) ?? null;
  const merged = pickBetterPlectrScore(seed, current);
  if (merged) bestByTrack.set(relPath, merged);
}

export function clearSessionScores(): void {
  bestByTrack.clear();
}
