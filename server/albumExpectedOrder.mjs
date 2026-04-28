import { prepareTrackTitleForMeta } from "./albumInfo.mjs"

function diceCoefficient(a, b) {
  if (!a.length || !b.length) return 0
  if (a === b) return 1
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0
  const bigrams = new Map()
  for (let i = 0; i < a.length - 1; i++) {
    const bg = a.slice(i, i + 2)
    bigrams.set(bg, (bigrams.get(bg) || 0) + 1)
  }
  let intersections = 0
  for (let i = 0; i < b.length - 1; i++) {
    const bg = b.slice(i, i + 2)
    const c = bigrams.get(bg) || 0
    if (c > 0) {
      intersections += 1
      bigrams.set(bg, c - 1)
    }
  }
  return (2 * intersections) / (a.length + b.length - 2)
}

function normMatch(artist, raw) {
  const s = prepareTrackTitleForMeta(artist, String(raw || "")).toLowerCase().replace(/\s+/g, " ").trim()
  return s
}

function similarity(normExpected, normLocal) {
  if (!normExpected || !normLocal) return 0
  if (normExpected === normLocal) return 1
  const minL = Math.min(normExpected.length, normLocal.length)
  if (minL >= 4) {
    if (normExpected.includes(normLocal) || normLocal.includes(normExpected)) return 0.92
  }
  return diceCoefficient(normExpected, normLocal)
}

/** Sotto soglia non si associa una traccia a una riga della release (evita accoppiamenti casuali). */
const MATCH_MIN = 0.42

function sortExpectedRowsStable(rows) {
  return [...rows].sort((a, b) => {
    const da = Number.isFinite(Number(a.disc)) ? Number(a.disc) : 1
    const db = Number.isFinite(Number(b.disc)) ? Number(b.disc) : 1
    if (da !== db) return da - db
    const pa = Number.isFinite(Number(a.position)) ? Number(a.position) : 0
    const pb = Number.isFinite(Number(b.position)) ? Number(b.position) : 0
    if (pa !== pb) return pa - pb
    return String(a.title || "").localeCompare(String(b.title || ""), undefined, {
      sensitivity: "base",
      numeric: true,
    })
  })
}

/**
 * Riordina i brani secondo `expectedTracks` (release) quando presente in kord-albuminfo.
 * Restituisce `null` se non applicabile; altrimenti un nuovo array (brani accoppiati per titolo simile,
 * poi il resto ordinato con `compareRest`).
 *
 * @param {Array<{ title: string, meta?: object }>} tracks
 * @param {Array<{ disc?: number, position?: number | null, title: string }>} expectedTracks
 * @param {string} artistName
 * @param {(a: object, b: object) => number} compareRest
 */
export function reorderTracksByAlbumExpectedRelease(
  tracks,
  expectedTracks,
  artistName,
  compareRest,
) {
  if (
    !Array.isArray(expectedTracks) ||
    expectedTracks.length < 2 ||
    !Array.isArray(tracks) ||
    tracks.length < 2
  ) {
    return null
  }

  const sortedExp = sortExpectedRowsStable(expectedTracks).filter((row) =>
    String(row.title || "").trim(),
  )
  if (sortedExp.length < 2) return null

  const used = new Set()
  const ordered = []

  for (const exp of sortedExp) {
    const nt = normMatch(artistName, exp.title)
    if (!nt) continue
    let bestIdx = -1
    let bestSc = -1
    for (let i = 0; i < tracks.length; i += 1) {
      if (used.has(i)) continue
      const nl = normMatch(artistName, tracks[i].title)
      const sc = similarity(nt, nl)
      if (sc > bestSc) {
        bestSc = sc
        bestIdx = i
      }
    }
    if (bestIdx >= 0 && bestSc >= MATCH_MIN) {
      used.add(bestIdx)
      ordered.push(tracks[bestIdx])
    }
  }

  const rest = []
  for (let i = 0; i < tracks.length; i += 1) {
    if (!used.has(i)) rest.push(tracks[i])
  }
  rest.sort(compareRest)
  return [...ordered, ...rest]
}
