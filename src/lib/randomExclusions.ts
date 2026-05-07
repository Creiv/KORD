import type { LibraryIndex, LibraryTrackIndex } from "../types";

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
