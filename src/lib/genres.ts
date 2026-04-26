/**
 * kord-trackinfo: campo `genre` come stringa serializzata con `"; "`.
 * Accetta anche stili legacy: "a/b", "a, b".
 */
export function parseTrackGenres(raw: string | null | undefined): string[] {
  if (raw == null) return []
  const s = String(raw).trim()
  if (!s) return []
  const seen = new Set<string>()
  const out: string[] = []
  const add = (t: string) => {
    const x = t.trim()
    if (!x) return
    const k = x.toLowerCase()
    if (seen.has(k)) return
    seen.add(k)
    out.push(x)
  }
  for (const seg of s.split(/;/)) {
    for (const p of seg.split(/(?:\s*\/\s*|\s*,\s*)/)) {
      add(p)
    }
  }
  return out
}

export function serializeTrackGenres(genres: readonly string[] | null | undefined) {
  if (!genres?.length) return null
  const s = parseTrackGenres(genres.join("; ")).join("; ")
  return s || null
}

export function hasParsedGenre(raw: string | null | undefined): boolean {
  return parseTrackGenres(raw).length > 0
}

export function trackBelongsToGenreKey(
  raw: string | null | undefined,
  genreKey: string
): boolean {
  if (genreKey === "__none__") return !hasParsedGenre(raw)
  return parseTrackGenres(raw).some((g) => g.toLowerCase() === genreKey)
}

export function formatTrackGenresForDisplay(
  raw: string | null | undefined
): string {
  const g = parseTrackGenres(raw)
  return g.length ? g.join(" · ") : ""
}
