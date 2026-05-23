import type { DifficultyId } from "../types";

export const PLECTR_DIFFICULTY_KEY = "kord-plectr-difficulty";

const VALID: readonly DifficultyId[] = ["easy", "normal", "hard"];

function isDifficultyId(raw: string): raw is DifficultyId {
  return (VALID as readonly string[]).includes(raw);
}

/** Maps legacy saved values; current ids are returned unchanged. */
export function migratePlectrDifficulty(raw: string | null): DifficultyId {
  if (raw === "extreme") return "hard";
  if (raw && isDifficultyId(raw)) return raw;
  return "easy";
}

export function loadPlectrDifficulty(): DifficultyId {
  try {
    return migratePlectrDifficulty(localStorage.getItem(PLECTR_DIFFICULTY_KEY));
  } catch {
    return "easy";
  }
}

export function savePlectrDifficulty(id: DifficultyId): void {
  try {
    localStorage.setItem(PLECTR_DIFFICULTY_KEY, id);
  } catch {
    /* ignore quota / private mode */
  }
}
