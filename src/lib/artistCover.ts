import type { LibraryIndex } from "../types";

export function buildRandomArtistCoverMap(
  index: LibraryIndex
): Map<string, string | null> {
  const map = new Map<string, string | null>();
  for (const artist of index.artists) {
    const withCover: string[] = [];
    for (const albumId of artist.albums) {
      const al = index.albums.find((a) => a.id === albumId);
      if (al?.coverRelPath) withCover.push(al.relPath);
    }
    if (withCover.length) {
      const pick = withCover[Math.floor(Math.random() * withCover.length)];
      map.set(artist.id, pick ?? null);
    } else {
      map.set(artist.id, null);
    }
  }
  return map;
}
