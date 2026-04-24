import type { AlbumMeta, EnrichedTrack, LibTrack } from "../types"

export function enrichTrack(
  artist: string,
  album: string,
  t: LibTrack,
  albumMeta?: AlbumMeta,
): EnrichedTrack {
  return { ...t, artist, album, ...(albumMeta ? { albumMeta } : {}) }
}
