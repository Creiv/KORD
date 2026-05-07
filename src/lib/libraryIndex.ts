import { parseTrackGenres } from "./genres";
import type {
  LibraryAlbumIndex,
  LibraryEntityDelta,
  LibraryIndex,
  LibraryResponse,
  LibraryTrackIndex,
  TrackMeta,
} from "../types";

export function clientLegacyLibrary(
  index: LibraryIndex | null
): LibraryResponse | null {
  if (!index) return null;
  return {
    musicRoot: index.musicRoot ?? "",
    artists: index.artists.map((artist) => ({
      id: artist.id,
      name: artist.name,
      trackCount: artist.trackCount,
      albums: artist.albums
        .map((albumId) => index.albums.find((album) => album.id === albumId))
        .filter((album): album is LibraryAlbumIndex => Boolean(album))
        .map((album) => ({
          id: album.loose ? "__loose__" : album.name,
          name: album.name,
          relPath: album.relPath,
          trackCount: album.trackCount,
          hasAlbumMeta: album.hasAlbumMeta,
          tracks: album.tracks
            .map((relPath) =>
              index.tracks.find((track) => track.relPath === relPath)
            )
            .filter((track): track is LibraryTrackIndex => Boolean(track))
            .map((track) => ({
              id: track.id,
              title: track.title,
              relPath: track.relPath,
              meta: track.meta,
            })),
          ...(album.releaseDate ||
          album.label ||
          album.country ||
          album.musicbrainzReleaseId
            ? {
                meta: {
                  title: album.title,
                  releaseDate: album.releaseDate,
                  label: album.label,
                  country: album.country,
                  musicbrainzReleaseId: album.musicbrainzReleaseId,
                },
              }
            : {}),
        })),
    })),
  };
}

export function recomputeLibraryStats(index: LibraryIndex): LibraryIndex {
  const stats = {
    artistCount: index.artists.length,
    albumCount: index.albums.length,
    trackCount: index.tracks.length,
    favoriteCapableCount: index.tracks.length,
    albumsWithoutCover: index.albums.filter(
      (album) => !album.loose && !album.hasCover
    ).length,
    albumsWithoutMeta: index.albums.filter(
      (album) => !album.loose && !album.hasAlbumMeta
    ).length,
    tracksWithoutMeta: index.tracks.filter(
      (track) =>
        !parseTrackGenres(track.meta?.genre).length && !track.meta?.releaseDate
    ).length,
    looseAlbumCount: index.albums.filter((album) => album.loose).length,
  };
  return { ...index, stats };
}

export function applyLibraryDeltaToIndex(
  prev: LibraryIndex | null,
  delta: LibraryEntityDelta
): LibraryIndex | null {
  if (!prev) return prev;
  let next = prev;
  if (delta.deleted?.length) {
    const deleted = new Set(delta.deleted);
    const deletedFolder = delta.deletedFolder || "";
    const albums = next.albums
      .filter((album) => album.relPath !== deletedFolder)
      .map((album) => ({
        ...album,
        tracks: album.tracks.filter((rel) => !deleted.has(rel)),
        trackCount: album.tracks.filter((rel) => !deleted.has(rel)).length,
      }))
      .filter((album) => album.trackCount > 0);
    const albumIds = new Set(albums.map((album) => album.id));
    const artists = next.artists
      .map((artist) => ({
        ...artist,
        albums: artist.albums.filter((albumId) => albumIds.has(albumId)),
      }))
      .filter((artist) => artist.albums.length > 0)
      .map((artist) => {
        const artistAlbums = albums.filter((album) =>
          artist.albums.includes(album.id)
        );
        return {
          ...artist,
          albumCount: artistAlbums.length,
          trackCount: artistAlbums.reduce(
            (sum, album) => sum + album.trackCount,
            0
          ),
          coverRelPath:
            artistAlbums.find((album) => album.coverRelPath)?.coverRelPath ||
            null,
        };
      });
    next = recomputeLibraryStats({
      ...next,
      artists,
      albums,
      tracks: next.tracks.filter((track) => !deleted.has(track.relPath)),
    });
  }
  if (delta.albumPath && delta.coverRelPath) {
    const coverRelPath = delta.coverRelPath;
    const now = Date.now();
    const albumPrefix = `${delta.albumPath}/`;
    next = {
      ...next,
      albums: next.albums.map((album) =>
        album.relPath === delta.albumPath
          ? { ...album, coverRelPath, hasCover: true, updatedAt: now }
          : album
      ),
      tracks: next.tracks.map((track) =>
        track.relPath.startsWith(albumPrefix)
          ? { ...track, updatedAt: now }
          : track
      ),
      artists: next.artists.map((artist) => {
        const ownsAlbum = next.albums.some(
          (album) =>
            album.relPath === delta.albumPath && album.artistId === artist.id
        );
        return ownsAlbum
          ? { ...artist, coverRelPath: coverRelPath || artist.coverRelPath }
          : artist;
      }),
    };
  }
  if (delta.album?.relPath) {
    const patch = delta.album;
    next = {
      ...next,
      albums: next.albums.map((album) =>
        album.relPath === patch.relPath
          ? {
              ...album,
              ...patch,
              name: patch.name || patch.title || album.name,
              hasAlbumMeta: patch.hasAlbumMeta ?? album.hasAlbumMeta,
            }
          : album
      ),
      tracks: next.tracks.map((track) =>
        track.albumMeta &&
        track.albumId ===
          next.albums.find((album) => album.relPath === patch.relPath)?.id
          ? { ...track, album: patch.name || patch.title || track.album }
          : track
      ),
    };
  }
  if (delta.track?.relPath) {
    const patch = delta.track;
    next = {
      ...next,
      tracks: next.tracks.map((track) =>
        track.relPath === patch.relPath
          ? {
              ...track,
              ...patch,
              title: patch.title || track.title,
              meta: {
                ...(track.meta || {}),
                ...(patch.meta || {}),
              } as TrackMeta,
            }
          : track
      ),
    };
  }
  if (delta.tracks?.length) {
    const patches = new Map(
      delta.tracks.map((track) => [track.relPath, track])
    );
    next = {
      ...next,
      tracks: next.tracks.map((track) => {
        const patch = patches.get(track.relPath);
        if (!patch) return track;
        return {
          ...track,
          ...patch,
          title: patch.title || track.title,
          meta: { ...(track.meta || {}), ...(patch.meta || {}) } as TrackMeta,
        };
      }),
    };
  }
  return recomputeLibraryStats(next);
}
