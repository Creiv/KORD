import type { EnrichedTrack } from "../types"
import { formatTrackGenresForDisplay } from "./genres"

function pad2(n: number) {
  return String(n).padStart(2, "0")
}

/** Visual format: dd-mm-yyyy (day-month-year, hyphens). */
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

export function trackInfoBadges(
  t: EnrichedTrack,
  labels: { track: string; album: string } = { track: "Track", album: "Album" }
): string[] {
  const out: string[] = []
  if (t.meta?.releaseDate) out.push(`${labels.track} ${fmtDate(t.meta.releaseDate)}`)
  if (t.albumMeta?.releaseDate) out.push(`${labels.album} ${fmtDate(t.albumMeta.releaseDate)}`)
  const g = formatTrackGenresForDisplay(t.meta?.genre)
  if (g) out.push(g)
  if (t.albumMeta?.label) out.push(t.albumMeta.label)
  if (t.albumMeta?.country) out.push(t.albumMeta.country)
  return out.filter(Boolean)
}
