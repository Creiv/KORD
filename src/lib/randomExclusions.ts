import type { LibraryIndex, LibraryTrackIndex } from "../types"

const K_TRACKS = "kord-random-exclude-tracks"
const K_ALBUMS = "kord-random-exclude-albums"
const WPP_TRACKS = "wpp-random-exclude-tracks"
const WPP_ALBUMS = "wpp-random-exclude-albums"

/** Brani non esclusi dal random (stessa logica della libreria). */
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
  return s
}

export function toggleExcludedAlbum(albumKey: string): Set<string> {
  const s = mergedExclusionSet(K_ALBUMS, WPP_ALBUMS)
  if (s.has(albumKey)) s.delete(albumKey)
  else s.add(albumKey)
  saveSet(K_ALBUMS, s)
  return s
}
