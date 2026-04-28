import { describe, expect, it, vi } from "vitest";
import { buildRandomArtistCoverMap } from "./artistCover";
import type { LibraryIndex } from "../types";

const baseIndex = (): LibraryIndex => ({
  musicRoot: "/m",
  artists: [
    {
      id: "A",
      name: "A",
      albumCount: 1,
      trackCount: 1,
      releaseDate: null,
      coverRelPath: null,
      albums: ["A::X"],
      albumsWithoutFileMetaCount: 1,
      tracksWithoutFileMetaCount: 1,
    },
  ],
  albums: [
    {
      id: "A::X",
      artistId: "A",
      artist: "A",
      name: "X",
      relPath: "A/X",
      trackCount: 1,
      coverRelPath: "A/X/cover.jpg",
      releaseDate: null,
      label: null,
      country: null,
      musicbrainzReleaseId: null,
      expectedTrackCount: null,
      expectedTracks: null,
      hasCover: true,
      hasAlbumMeta: false,
      hasTrackMeta: false,
      tracksWithoutFileMetaCount: 1,
      loose: false,
      addedAt: 1,
      updatedAt: 1,
      tracks: ["A/X/1.mp3"],
    },
  ],
  tracks: [],
  stats: { artistCount: 1, albumCount: 1, trackCount: 1, favoriteCapableCount: 1, albumsWithoutCover: 0, albumsWithoutMeta: 0, tracksWithoutMeta: 0, looseAlbumCount: 0 },
});

describe("buildRandomArtistCoverMap", () => {
  it("picks an album with cover art when available", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const m = buildRandomArtistCoverMap(baseIndex());
    expect(m.get("A")).toBe("A/X");
    vi.mocked(Math.random).mockRestore();
  });

  it("returns null when no album has cover art", () => {
    const ix = baseIndex();
    ix.albums[0]!.coverRelPath = null;
    ix.albums[0]!.hasCover = false;
    const m = buildRandomArtistCoverMap(ix);
    expect(m.get("A")).toBeNull();
  });
});
