import { parseTrackGenres } from "./genres";
import type {
  EnrichedTrack,
  LibraryAlbumIndex,
  LibraryEntityDelta,
  LibraryIndex,
  LibraryResponse,
  LibraryTrackIndex,
  TrackMeta,
} from "../types";

function trackMoodsSig(meta?: TrackMeta | null): string {
  const moods = meta?.moods;
  if (!moods?.length) return "";
  return [...moods].sort().join("\0");
}

function trackUpdatedAtMs(track: EnrichedTrack): number {
  const u = (track as EnrichedTrack & { updatedAt?: number | null }).updatedAt;
  return typeof u === "number" ? u : 0;
}

/** True se il brano in coda va sostituito con la copia aggiornata dall'indice libreria. */
export function enrichedTracksNeedPlayerResync(
  queueTrack: EnrichedTrack,
  indexTrack: EnrichedTrack
): boolean {
  if (
    queueTrack.relPath !== indexTrack.relPath ||
    queueTrack.title !== indexTrack.title ||
    queueTrack.artist !== indexTrack.artist ||
    queueTrack.album !== indexTrack.album ||
    queueTrack.id !== indexTrack.id
  ) {
    return true;
  }
  if (trackUpdatedAtMs(queueTrack) !== trackUpdatedAtMs(indexTrack)) return true;
  const qm = queueTrack.meta;
  const im = indexTrack.meta;
  if (qm === im) return false;
  if (!qm || !im) return Boolean(qm) !== Boolean(im);
  if ((qm.genre ?? "") !== (im.genre ?? "")) return true;
  if (trackMoodsSig(qm) !== trackMoodsSig(im)) return true;
  if ((qm.lyrics ?? "") !== (im.lyrics ?? "")) return true;
  if ((qm.releaseDate ?? "") !== (im.releaseDate ?? "")) return true;
  if ((qm.durationMs ?? 0) !== (im.durationMs ?? 0)) return true;
  return false;
}

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

/** Sig per rehydrate playlist/recent/shuffle (cambio struttura libreria). */
export function libraryIndexRehydrateSig(index: LibraryIndex): string {
  return `${index.indexEpoch ?? 0}|${index.tracks.length}|${index.albums.length}|${index.stats.trackCount}`;
}

export function mergeLibraryEntityDeltas(
  acc: LibraryEntityDelta,
  delta: LibraryEntityDelta
): LibraryEntityDelta {
  const next: LibraryEntityDelta = { ...acc, ...delta };
  if (acc.tracks?.length || delta.tracks?.length) {
    const byPath = new Map<string, NonNullable<LibraryEntityDelta["tracks"]>[number]>();
    for (const tr of acc.tracks ?? []) byPath.set(tr.relPath, tr);
    for (const tr of delta.tracks ?? []) byPath.set(tr.relPath, tr);
    next.tracks = [...byPath.values()];
  }
  if (acc.deleted?.length || delta.deleted?.length) {
    next.deleted = [...new Set([...(acc.deleted ?? []), ...(delta.deleted ?? [])])];
  }
  return next;
}

export function applyLibraryDeltasToIndex(
  prev: LibraryIndex | null,
  deltas: LibraryEntityDelta[]
): LibraryIndex | null {
  if (!prev || !deltas.length) return prev;
  return deltas.reduce(
    (acc, delta) => applyLibraryDeltaToIndex(acc, delta) ?? acc,
    prev
  );
}

/**
 * Dopo un refresh completo dall’API: non perdere copertine già applicate in UI se
 * la cache server era ancora stale (file cover.jpg presente, coverRelPath assente).
 */
export function mergeLibraryIndexFromServer(
  prev: LibraryIndex | null,
  next: LibraryIndex,
): LibraryIndex {
  if (!prev) return next;
  const prevAlbums = new Map(prev.albums.map((album) => [album.relPath, album]));
  const albums = next.albums.map((album) => {
    const prior = prevAlbums.get(album.relPath);
    if (!prior?.coverRelPath || album.coverRelPath) return album;
    return {
      ...album,
      coverRelPath: prior.coverRelPath,
      hasCover: true,
      updatedAt: Math.max(prior.updatedAt ?? 0, album.updatedAt ?? 0) || prior.updatedAt,
    };
  });
  const albumById = new Map(albums.map((album) => [album.id, album]));
  const artists = next.artists.map((artist) => {
    const artistAlbums = artist.albums
      .map((id) => albumById.get(id))
      .filter((row): row is LibraryAlbumIndex => Boolean(row));
    const coverRelPath =
      artistAlbums.find((row) => row.coverRelPath)?.coverRelPath ?? null;
    return coverRelPath ? { ...artist, coverRelPath } : artist;
  });
  return recomputeLibraryStats({ ...next, albums, artists });
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
              coverRelPath:
                patch.coverRelPath !== undefined
                  ? patch.coverRelPath
                  : album.coverRelPath,
              hasCover:
                patch.hasCover !== undefined
                  ? patch.hasCover
                  : patch.coverRelPath !== undefined
                    ? Boolean(patch.coverRelPath)
                    : album.hasCover,
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
              updatedAt:
                typeof patch.updatedAt === "number"
                  ? patch.updatedAt
                  : Date.now(),
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
          updatedAt:
            typeof patch.updatedAt === "number" ? patch.updatedAt : Date.now(),
          meta: { ...(track.meta || {}), ...(patch.meta || {}) } as TrackMeta,
        };
      }),
    };
  }
  return recomputeLibraryStats(next);
}
