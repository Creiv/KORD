import { resultGrade } from "./format";
import type { GameResult } from "../types";

export interface RunStats {
  score: number;
  maxCombo: number;
  hits: number;
  misses: number;
}

export function buildGameResult(stats: RunStats, failed = false): GameResult {
  const totalJudged = stats.hits + stats.misses;
  const accuracy = totalJudged ? stats.hits / totalJudged : 0;
  return {
    failed,
    score: stats.score,
    maxCombo: stats.maxCombo,
    hits: stats.hits,
    misses: stats.misses,
    accuracy,
    grade: resultGrade(accuracy, failed),
  };
}
