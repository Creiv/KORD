import type { LibraryIndex, LibraryTrackIndex } from "../types"
import { hasParsedGenre, parseTrackGenres, serializeTrackGenres } from "./genres"

export type GenreAutoSource = "album" | "artist"

export type GenreAutoAssignment = {
  relPath: string
  /** Valore da passare a save `genre` (un solo genere canonico). */
  genreSerialized: string
  source: GenreAutoSource
}

type VoteRow = { key: string; label: string; n: number }

function addGenreTokensToCounts(
  raw: string | null | undefined,
  into: Map<string, VoteRow>,
) {
  for (const g of parseTrackGenres(raw)) {
    const key = g.toLowerCase()
    const prev = into.get(key)
    if (prev) prev.n += 1
    else into.set(key, { key, label: g, n: 1 })
  }
}

function buildGlobalGenreSupport(index: LibraryIndex): Map<string, number> {
  const m = new Map<string, number>()
  for (const t of index.tracks) {
    for (const g of parseTrackGenres(t.meta?.genre)) {
      const k = g.toLowerCase()
      m.set(k, (m.get(k) ?? 0) + 1)
    }
  }
  return m
}

function pickWinner(
  counts: Map<string, VoteRow>,
  global: Map<string, number>,
): VoteRow | null {
  let best: VoteRow | null = null
  for (const v of counts.values()) {
    if (!best) {
      best = v
      continue
    }
    if (v.n > best.n) {
      best = v
      continue
    }
    if (v.n < best.n) continue
    const ga = global.get(v.key) ?? 0
    const gb = global.get(best.key) ?? 0
    if (ga > gb) best = v
    else if (ga === gb && v.label.localeCompare(best.label, undefined, { sensitivity: "base" }) < 0)
      best = v
  }
  return best
}

/**
 * Propone un genere per ogni brano **senza** genere in kord-trackinfo:
 * 1) maggioranza tra i brani dello stesso album che hanno già un genere;
 * 2) maggioranza tra i brani dello stesso artista (libreria) che hanno genere.
 */
export function computeGenreAutoAssignments(
  index: LibraryIndex,
): GenreAutoAssignment[] {
  const global = buildGlobalGenreSupport(index)
  const out: GenreAutoAssignment[] = []
  const albumAssigned = new Set<string>()

  const byAlbum = new Map<string, LibraryTrackIndex[]>()
  for (const t of index.tracks) {
    const id = t.albumId || `__solo__${t.relPath}`
    let a = byAlbum.get(id)
    if (!a) {
      a = []
      byAlbum.set(id, a)
    }
    a.push(t)
  }

  for (const tracks of byAlbum.values()) {
    const tagged = tracks.filter((t) => hasParsedGenre(t.meta?.genre))
    const empty = tracks.filter((t) => !hasParsedGenre(t.meta?.genre))
    if (!tagged.length || !empty.length) continue
    const counts = new Map<string, VoteRow>()
    for (const t of tagged) addGenreTokensToCounts(t.meta?.genre, counts)
    const winner = pickWinner(counts, global)
    if (!winner) continue
    const genreSerialized = serializeTrackGenres([winner.label])
    if (!genreSerialized) continue
    for (const t of empty) {
      out.push({
        relPath: t.relPath,
        genreSerialized,
        source: "album",
      })
      albumAssigned.add(t.relPath)
    }
  }

  const byArtist = new Map<string, LibraryTrackIndex[]>()
  for (const t of index.tracks) {
    const ar = t.artist || "—"
    let g = byArtist.get(ar)
    if (!g) {
      g = []
      byArtist.set(ar, g)
    }
    g.push(t)
  }

  for (const tracks of byArtist.values()) {
    const tagged = tracks.filter((t) => hasParsedGenre(t.meta?.genre))
    const empty = tracks.filter(
      (t) =>
        !hasParsedGenre(t.meta?.genre) && !albumAssigned.has(t.relPath),
    )
    if (!tagged.length || !empty.length) continue
    const counts = new Map<string, VoteRow>()
    for (const t of tagged) addGenreTokensToCounts(t.meta?.genre, counts)
    const winner = pickWinner(counts, global)
    if (!winner) continue
    const genreSerialized = serializeTrackGenres([winner.label])
    if (!genreSerialized) continue
    for (const t of empty) {
      out.push({
        relPath: t.relPath,
        genreSerialized,
        source: "artist",
      })
    }
  }

  const seen = new Set<string>()
  return out.filter((r) => {
    if (seen.has(r.relPath)) return false
    seen.add(r.relPath)
    return true
  })
}
