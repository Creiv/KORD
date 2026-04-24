import type { EnrichedTrack, UserPlaylist } from "../types"

const P_PLAY = "kord-playlists"
const P_FAV = "kord-favorites"
const P_RECENT = "kord-recent"
const P_VOL = "kord-vol"
const WPP_PLAY = "wpp-playlists"
const WPP_FAV = "wpp-favorites"
const WPP_RECENT = "wpp-recent"
const WPP_VOL = "wpp-vol"

const MAX_RECENT = 30

function load<T>(k: string, legacy: string, d: T): T {
  try {
    const s = localStorage.getItem(k)
    if (s) return JSON.parse(s) as T
    const w = localStorage.getItem(legacy)
    if (w) return JSON.parse(w) as T
  } catch {
    return d
  }
  return d
}

function save<T>(k: string, v: T) {
  try {
    localStorage.setItem(k, JSON.stringify(v))
  } catch {
    /* ignore */
  }
}

export function getPlaylists(): UserPlaylist[] {
  return load(P_PLAY, WPP_PLAY, [] as UserPlaylist[])
}

export function setPlaylists(p: UserPlaylist[]) {
  save(P_PLAY, p)
}

export function getFavorites(): string[] {
  return load(P_FAV, WPP_FAV, [] as string[])
}

export function setFavorites(r: string[]) {
  save(P_FAV, r)
}

export function getRecent(): EnrichedTrack[] {
  return load(P_RECENT, WPP_RECENT, [] as EnrichedTrack[])
}

export function pushRecent(t: EnrichedTrack) {
  const v = getRecent().filter((x) => x.relPath !== t.relPath)
  v.unshift(t)
  save(P_RECENT, v.slice(0, MAX_RECENT))
}

export function getVolume(): number {
  const n =
    localStorage.getItem(P_VOL) ?? localStorage.getItem(WPP_VOL) ?? null
  if (n == null) return 0.85
  const v = parseFloat(n)
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.85
}

export function setVolumePref(v: number) {
  const x = Math.min(1, Math.max(0, v))
  localStorage.setItem(P_VOL, String(x))
}
