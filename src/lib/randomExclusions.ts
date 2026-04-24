import type { LibraryIndex, LibraryTrackIndex } from "../types"

const K_TRACKS = "kord-random-exclude-tracks"
const K_ALBUMS = "kord-random-exclude-albums"
const WPP_TRACKS = "wpp-random-exclude-tracks"
const WPP_ALBUMS = "wpp-random-exclude-albums"

/** Tracks not excluded from smart shuffle (same logic as library). */
export function eligibleTracksForIntelligentRandom(
  index: LibraryIndex,
  excludedAlbums: Set<string>,
  excludedTracks: Set<string>
): LibraryTrackIndex[] {
  return index.tracks.filter(
    (track) =>
      !excludedTracks.has(track.relPath) &&
      !excludedAlbums.has(`${track.artist}/${track.album}`)
  )
}

function loadSet(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return new Set()
    const arr = JSON.parse(raw) as string[]
    return new Set(Array.isArray(arr) ? arr : [])
  } catch {
    return new Set()
  }
}

function mergedExclusionSet(primary: string, legacy: string): Set<string> {
  return new Set([...loadSet(primary), ...loadSet(legacy)])
}

function saveSet(key: string, s: Set<string>) {
  try {
    localStorage.setItem(key, JSON.stringify([...s]))
  } catch {
    /* ignore */
  }
}

let trackExclusionEpoch = 0
const TRACK_EXCLUSION_EVT = "kord-track-exclusion-epoch"

function bumpTrackExclusionEpoch() {
  trackExclusionEpoch += 1
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(TRACK_EXCLUSION_EVT))
  }
}

export function getTrackExclusionEpoch(): number {
  return trackExclusionEpoch
}

export function subscribeTrackExclusionEpoch(
  onStoreChange: () => void,
): () => void {
  if (typeof window === "undefined") return () => {}
  const fn = () => onStoreChange()
  window.addEventListener(TRACK_EXCLUSION_EVT, fn)
  return () => window.removeEventListener(TRACK_EXCLUSION_EVT, fn)
}

export function getExcludedTracks(): Set<string> {
  return mergedExclusionSet(K_TRACKS, WPP_TRACKS)
}

export function getExcludedAlbums(): Set<string> {
  return mergedExclusionSet(K_ALBUMS, WPP_ALBUMS)
}

export function toggleExcludedTrack(relPath: string): Set<string> {
  const s = mergedExclusionSet(K_TRACKS, WPP_TRACKS)
  if (s.has(relPath)) s.delete(relPath)
  else s.add(relPath)
  saveSet(K_TRACKS, s)
  bumpTrackExclusionEpoch()
  return s
}

/** Add or remove many track paths from shuffle exclusion (persisted). */
export function setTracksShuffleExcluded(
  relPaths: readonly string[],
  exclude: boolean
): Set<string> {
  const s = mergedExclusionSet(K_TRACKS, WPP_TRACKS)
  for (const rel of relPaths) {
    if (exclude) s.add(rel)
    else s.delete(rel)
  }
  saveSet(K_TRACKS, s)
  bumpTrackExclusionEpoch()
  return s
}

export function toggleExcludedAlbum(albumKey: string): Set<string> {
  const s = mergedExclusionSet(K_ALBUMS, WPP_ALBUMS)
  if (s.has(albumKey)) s.delete(albumKey)
  else s.add(albumKey)
  saveSet(K_ALBUMS, s)
  bumpTrackExclusionEpoch()
  return s
}
