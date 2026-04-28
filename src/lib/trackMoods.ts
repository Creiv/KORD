import type { TrackMeta } from "../types";

export const TRACK_MOOD_IDS = [
  "energy_boost",
  "party_dance",
  "chill_relax",
  "focus_study",
  "romantic_intimacy",
  "sad_melancholy",
  "dark_tense",
  "aggressive_heavy",
  "dreamy_ethereal",
  "epic_cinematic",
  "nostalgia_retro",
  "fun_quirky",
  "soulful_groovy",
] as const;

export type TrackMoodId = (typeof TRACK_MOOD_IDS)[number];

export const MAX_TRACK_MOODS = 3;

/** Colore identificativo (bordo / accento pulsanti e chip). */
export const TRACK_MOOD_COLORS: Record<TrackMoodId, string> = {
  energy_boost: "#f59e0b",
  party_dance: "#ec4899",
  chill_relax: "#22c55e",
  focus_study: "#6366f1",
  romantic_intimacy: "#fb7185",
  sad_melancholy: "#38bdf8",
  dark_tense: "#7c3aed",
  aggressive_heavy: "#dc2626",
  dreamy_ethereal: "#06b6d4",
  epic_cinematic: "#eab308",
  nostalgia_retro: "#b45309",
  fun_quirky: "#84cc16",
  soulful_groovy: "#ea580c",
};

const SET = new Set<string>(TRACK_MOOD_IDS);

function isMoodId(s: string): s is TrackMoodId {
  return SET.has(s);
}

/** Legge da `moods` o migra dal vecchio `mood` singolo. Ordine preservato, max 3. */
export function parseTrackMoods(meta?: TrackMeta | null): TrackMoodId[] {
  if (!meta) return [];
  const out: TrackMoodId[] = [];
  const add = (raw: string) => {
    const s = raw.trim();
    if (!s || !isMoodId(s) || out.includes(s)) return;
    if (out.length >= MAX_TRACK_MOODS) return;
    out.push(s);
  };
  if (Array.isArray(meta.moods)) {
    for (const x of meta.moods) {
      if (typeof x === "string") add(x);
    }
  }
  if (out.length < MAX_TRACK_MOODS && typeof meta.mood === "string") {
    add(meta.mood);
  }
  return out;
}
