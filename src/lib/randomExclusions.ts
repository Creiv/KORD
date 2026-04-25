import type { LibraryIndex, LibraryTrackIndex } from "../types"

let albumIdSnapshot: Set<string> = new Set();
let relPathSnapshot: Set<string> = new Set();

export function setShuffleExclusionSnapshot(
  albumIds: readonly string[] | null | undefined,
  trackRelPaths: readonly string[] | null | undefined
) {
  albumIdSnapshot = new Set(albumIds || []);
  relPathSnapshot = new Set(trackRelPaths || []);
}

let trackExclusionEpoch = 0
const TRACK_EXCLUSION_EVT = "kord-track-exclusion-epoch"

export function bumpTrackExclusionEpoch() {
  trackExclusionEpoch += 1
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(TRACK_EXCLUSION_EVT))
  }
}

export function getTrackExclusionEpoch(): number {
  return trackExclusionEpoch
}

export function subscribeTrackExclusionEpoch(
  onStoreChange: () => void
): () => void {
  if (typeof window === "undefined") return () => {}
  const fn = () => onStoreChange()
  window.addEventListener(TRACK_EXCLUSION_EVT, fn)
  return () => window.removeEventListener(TRACK_EXCLUSION_EVT, fn)
}

export function getExcludedTracks(): Set<string> {
  return new Set(relPathSnapshot)
}

export function getExcludedAlbums(): Set<string> {
  return new Set(albumIdSnapshot)
}

export function isTrackAlbumShuffleExcluded(
  t: { albumId?: string; artist: string; album: string },
  exAlbum: Set<string>
): boolean {
  if (t.albumId) return exAlbum.has(t.albumId);
  return exAlbum.has(`${t.artist}/${t.album}`);
}

export function eligibleTracksForIntelligentRandom(
  index: LibraryIndex,
  excludedAlbums: Set<string>,
  excludedTracks: Set<string>
): LibraryTrackIndex[] {
  return index.tracks.filter(
    (track) =>
      !excludedTracks.has(track.relPath) &&
      !isTrackAlbumShuffleExcluded(track, excludedAlbums)
  );
}
