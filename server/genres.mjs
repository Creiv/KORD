/**
 * @param {string | null | undefined} raw
 * @returns {string[]}
 */
export function parseTrackGenres(raw) {
  if (raw == null) return []
  const s = String(raw).trim()
  if (!s) return []
  const seen = new Set()
  const out = []
  const add = (t) => {
    const x = String(t).trim()
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

/**
 * @param {string | null | undefined} raw
 * @returns {string | null}
 */
export function normalizeStoredGenreString(raw) {
  if (raw == null) return null
  const s = String(raw).trim()
  if (!s) return null
  const parts = parseTrackGenres(s)
  return parts.length ? parts.join("; ") : null
}
