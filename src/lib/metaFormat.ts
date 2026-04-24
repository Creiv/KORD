import type { EnrichedTrack } from "../types"

function pad2(n: number) {
  return String(n).padStart(2, "0")
}

/** Formato visivo: gg-mm-aaaa (giorno-mese-anno, trattini). */
export function fmtDate(d: string | null | undefined): string
export function fmtDate(d: Date): string
export function fmtDate(d: string | null | undefined | Date): string {
  if (d instanceof Date) {
    return `${pad2(d.getDate())}-${pad2(d.getMonth() + 1)}-${d.getFullYear()}`
  }
  if (!d) return "—"
  const v = String(d).trim()
  if (!v) return "—"
  const p = v.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (p) {
    return `${p[3]}-${p[2]}-${p[1]}`
  }
  const dt = new Date(v)
  if (Number.isNaN(dt.getTime())) return v
  return `${pad2(dt.getDate())}-${pad2(dt.getMonth() + 1)}-${dt.getFullYear()}`
}

export function fmtSize(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return "—"
  const u = ["B", "KB", "MB", "GB"]
  let n = bytes
  let i = 0
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024
    i += 1
  }
  const fixed = i < 2 ? 0 : 1
  return `${n.toFixed(fixed)} ${u[i]}`
}

export function trackInfoBadges(t: EnrichedTrack): string[] {
  const out: string[] = []
  if (t.meta?.releaseDate) out.push(`Brano ${fmtDate(t.meta.releaseDate)}`)
  if (t.albumMeta?.releaseDate) out.push(`Album ${fmtDate(t.albumMeta.releaseDate)}`)
  if (t.meta?.genre) out.push(t.meta.genre)
  if (t.albumMeta?.label) out.push(t.albumMeta.label)
  if (t.albumMeta?.country) out.push(t.albumMeta.country)
  return out.filter(Boolean)
}
