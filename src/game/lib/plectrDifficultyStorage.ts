import type { DifficultyId } from "../types";

export const PLECTR_DIFFICULTY_KEY = "kord-plectr-difficulty";

export type PlectrPlayMode = DifficultyId | "extreme";

const VALID_DIFF: readonly DifficultyId[] = ["easy", "normal", "hard"];
function isDifficultyId(raw: string): raw is DifficultyId {
  return (VALID_DIFF as readonly string[]).includes(raw);
}

/** @deprecated use migratePlectrPlayMode */
export function migratePlectrDifficulty(raw: string | null): DifficultyId {
  const mode = migratePlectrPlayMode(raw);
  return mode === "extreme" ? "hard" : mode;
}

export function migratePlectrPlayMode(raw: string | null): PlectrPlayMode {
  if (raw === "extreme") return "extreme";
  if (raw && isDifficultyId(raw)) return raw;
  return "easy";
}

export function loadPlectrPlayMode(): PlectrPlayMode {
  try {
    return migratePlectrPlayMode(localStorage.getItem(PLECTR_DIFFICULTY_KEY));
  } catch {
    return "easy";
  }
}

export function savePlectrPlayMode(id: PlectrPlayMode): void {
  try {
    localStorage.setItem(PLECTR_DIFFICULTY_KEY, id);
  } catch {
    /* ignore quota / private mode */
  }
}

/** @deprecated use loadPlectrPlayMode */
export function loadPlectrDifficulty(): DifficultyId {
  const mode = loadPlectrPlayMode();
  return mode === "extreme" ? "hard" : mode;
}

/** @deprecated use savePlectrPlayMode */
export function savePlectrDifficulty(id: DifficultyId): void {
  savePlectrPlayMode(id);
}
