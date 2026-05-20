import { describe, expect, it } from "vitest";
import {
  applyLibraryDeltasToIndex,
  enrichedTracksNeedPlayerResync,
  libraryIndexRehydrateSig,
} from "./libraryIndex";
import type { EnrichedTrack } from "../types";
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

  it("enrichedTracksNeedPlayerResync rileva genere e mood", () => {
    const base = {
      id: "Artist/Album/01.mp3",
      relPath: "Artist/Album/01.mp3",
      title: "Song",
      artist: "Artist",
      album: "Album",
      albumId: "al1",
      loose: false,
      addedAt: 1,
      updatedAt: 1,
      meta: { genre: "Rock", moods: ["calm"] },
    } as EnrichedTrack;
    expect(
      enrichedTracksNeedPlayerResync(base, {
        ...base,
        meta: { ...base.meta, genre: "Jazz" },
      })
    ).toBe(true);
    expect(
      enrichedTracksNeedPlayerResync(base, {
        ...base,
        meta: { ...base.meta, moods: ["energetic"] },
      })
    ).toBe(true);
    expect(enrichedTracksNeedPlayerResync(base, { ...base })).toBe(false);
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
