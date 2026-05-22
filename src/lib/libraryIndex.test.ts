import { describe, expect, it } from "vitest";
import {
  applyLibraryDeltasToIndex,
  enrichedTracksNeedPlayerResync,
  libraryIndexRehydrateSig,
  mergeLibraryIndexFromServer,
} from "./libraryIndex";
import type { LibraryTrackIndex, TrackMeta } from "../types";

function sampleMeta(patch: Partial<TrackMeta> = {}): TrackMeta {
  return {
    fileName: "01.mp3",
    size: 1,
    mtime: 1,
    releaseDate: null,
    genre: null,
    durationMs: null,
    trackNumber: null,
    discNumber: null,
    source: null,
    url: null,
    ...patch,
  };
}

function sampleTrack(
  patch: Partial<LibraryTrackIndex> = {}
): LibraryTrackIndex {
  return {
    id: "Artist/Album/01.mp3",
    relPath: "Artist/Album/01.mp3",
    title: "Song",
    artist: "Artist",
    album: "Album",
    albumId: "al1",
    loose: false,
    addedAt: null,
    updatedAt: 1,
    meta: sampleMeta({ genre: "Rock", moods: ["calm"] }),
    ...patch,
  };
}
import type { LibraryEntityDelta, LibraryIndex } from "../types";

function miniIndex(): LibraryIndex {
  return {
    indexEpoch: 1,
    artists: [
      {
        id: "a1",
        name: "Artist",
        albumCount: 1,
        trackCount: 1,
        releaseDate: null,
        coverRelPath: null,
        albums: ["al1"],
        albumsWithoutFileMetaCount: 0,
        tracksWithoutFileMetaCount: 0,
      },
    ],
    albums: [
      {
        id: "al1",
        name: "Album",
        title: "Album",
        relPath: "Artist/Album",
        artistId: "a1",
        artist: "Artist",
        trackCount: 1,
        tracks: ["Artist/Album/01.mp3"],
        hasCover: true,
        hasAlbumMeta: false,
        hasTrackMeta: false,
        tracksWithoutFileMetaCount: 1,
        loose: false,
        coverRelPath: null,
        releaseDate: null,
        label: null,
        country: null,
        musicbrainzReleaseId: null,
        expectedTrackCount: null,
        expectedTracks: null,
        addedAt: null,
        updatedAt: 0,
      },
    ],
    tracks: [
      {
        id: "Artist/Album/01.mp3",
        relPath: "Artist/Album/01.mp3",
        title: "One",
        artist: "Artist",
        album: "Album",
        albumId: "al1",
        loose: false,
        addedAt: null,
        updatedAt: 0,
      },
    ],
    stats: {
      artistCount: 1,
      albumCount: 1,
      trackCount: 1,
      favoriteCapableCount: 1,
      albumsWithoutCover: 0,
      albumsWithoutMeta: 1,
      tracksWithoutMeta: 1,
      looseAlbumCount: 0,
    },
  };
}

describe("libraryIndex", () => {
  it("libraryIndexRehydrateSig includes indexEpoch", () => {
    const a = libraryIndexRehydrateSig(miniIndex());
    const b = libraryIndexRehydrateSig({ ...miniIndex(), indexEpoch: 2 });
    expect(a).not.toBe(b);
  });

  it("enrichedTracksNeedPlayerResync rileva genere, mood e lyrics", () => {
    const base = sampleTrack();
    const meta = base.meta!;
    expect(
      enrichedTracksNeedPlayerResync(base, {
        ...base,
        meta: sampleMeta({ ...meta, genre: "Jazz" }),
      })
    ).toBe(true);
    expect(
      enrichedTracksNeedPlayerResync(base, {
        ...base,
        meta: sampleMeta({ ...meta, moods: ["energetic"] }),
      })
    ).toBe(true);
    expect(enrichedTracksNeedPlayerResync(base, { ...base })).toBe(false);
    expect(
      enrichedTracksNeedPlayerResync(base, {
        ...base,
        meta: sampleMeta({ ...meta, lyrics: "[00:01.00] Hello" }),
      })
    ).toBe(true);
  });

  it("mergeLibraryIndexFromServer keeps cover when server index is stale", () => {
    const prev = miniIndex();
    prev.albums[0] = {
      ...prev.albums[0]!,
      coverRelPath: "Artist/Album/cover.jpg",
      hasCover: true,
      updatedAt: 9_000,
    };
    const next = miniIndex();
    next.albums[0] = {
      ...next.albums[0]!,
      coverRelPath: null,
      hasCover: false,
      updatedAt: 1_000,
    };
    const merged = mergeLibraryIndexFromServer(prev, next);
    expect(merged.albums[0]?.coverRelPath).toBe("Artist/Album/cover.jpg");
    expect(merged.albums[0]?.hasCover).toBe(true);
  });

  it("applyLibraryDeltasToIndex applies multiple album patches in one pass", () => {
    const base = miniIndex();
    const deltas: LibraryEntityDelta[] = [
      {
        album: {
          relPath: "Artist/Album",
          hasAlbumMeta: true,
          name: "Album",
        },
      },
    ];
    const next = applyLibraryDeltasToIndex(base, deltas);
    expect(next?.albums[0]?.hasAlbumMeta).toBe(true);
  });
});
