/** Valori permessi per `moods` in kord-trackinfo.json (stesso ordinamento dell’UI). */
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
]

export const MAX_TRACK_MOODS = 3

const SET = new Set(TRACK_MOOD_IDS)

/** @param {unknown} v */
export function normalizeTrackMood(v) {
  if (v == null) return null
  const s = String(v).trim()
  if (!s) return null
  return SET.has(s) ? s : null
}

/**
 * @param {unknown} primary Lista da `moods` nel JSON.
 * @param {unknown} legacyMood Vecchio campo singolo `mood`.
 * @returns {string[]} Ordine preservato, unici, max 3.
 */
export function normalizeTrackMoodsList(primary, legacyMood) {
  const out = []
  /** @param {string} id */
  const add = (id) => {
    if (!SET.has(id) || out.includes(id)) return
    if (out.length >= MAX_TRACK_MOODS) return
    out.push(id)
  }
  if (Array.isArray(primary)) {
    for (const x of primary) {
      const id = normalizeTrackMood(x)
      if (id) add(id)
    }
  }
  if (legacyMood != null && out.length < MAX_TRACK_MOODS) {
    const id = normalizeTrackMood(legacyMood)
    if (id) add(id)
  }
  return out
}
