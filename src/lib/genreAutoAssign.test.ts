import { describe, expect, it } from "vitest"
import type { LibraryIndex, LibraryTrackIndex } from "../types"
import { computeGenreAutoAssignments } from "./genreAutoAssign"

function tr(
  relPath: string,
  artist: string,
  album: string,
  albumId: string,
  genre: string | null,
): LibraryTrackIndex {
  return {
    id: relPath,
    title: relPath,
    relPath,
    artist,
    album,
    albumId,
    loose: false,
    addedAt: null,
    updatedAt: null,
    meta: {
      fileName: relPath.split("/").pop() || relPath,
      size: null,
      mtime: null,
      releaseDate: null,
      genre,
      durationMs: null,
      trackNumber: null,
      discNumber: null,
      source: null,
      url: null,
    },
  }
}

const emptyStats = {
  artistCount: 0,
  albumCount: 0,
  trackCount: 0,
  favoriteCapableCount: 0,
  albumsWithoutCover: 0,
  albumsWithoutMeta: 0,
  tracksWithoutMeta: 0,
  looseAlbumCount: 0,
}

describe("computeGenreAutoAssignments", () => {
  it("fills empty from album majority", () => {
    const index: LibraryIndex = {
      musicRoot: "/m",
      artists: [],
      albums: [],
      tracks: [
        tr("A/Alb/01.mp3", "A", "Alb", "al1", "Rock"),
        tr("A/Alb/02.mp3", "A", "Alb", "al1", "Rock"),
        tr("A/Alb/03.mp3", "A", "Alb", "al1", null),
      ],
      stats: emptyStats,
    }
    const r = computeGenreAutoAssignments(index)
    expect(r).toHaveLength(1)
    expect(r[0]!.relPath).toBe("A/Alb/03.mp3")
    expect(r[0]!.genreSerialized).toBe("Rock")
    expect(r[0]!.source).toBe("album")
  })

  it("uses artist when album has no tagged tracks", () => {
    const index: LibraryIndex = {
      musicRoot: "/m",
      artists: [],
      albums: [],
      tracks: [
        tr("A/One/01.mp3", "A", "One", "a1", null),
        tr("A/Two/01.mp3", "A", "Two", "a2", "Jazz"),
        tr("A/Two/02.mp3", "A", "Two", "a2", "Jazz"),
      ],
      stats: emptyStats,
    }
    const r = computeGenreAutoAssignments(index)
    const one = r.find((x) => x.relPath === "A/One/01.mp3")
    expect(one).toBeDefined()
    expect(one!.genreSerialized).toBe("Jazz")
    expect(one!.source).toBe("artist")
  })

  it("scope all assigns album winner to every track in album", () => {
    const index: LibraryIndex = {
      musicRoot: "/m",
      artists: [],
      albums: [],
      tracks: [
        tr("A/Alb/01.mp3", "A", "Alb", "al1", "Rock"),
        tr("A/Alb/02.mp3", "A", "Alb", "al1", "Rock"),
        tr("A/Alb/03.mp3", "A", "Alb", "al1", null),
      ],
      stats: emptyStats,
    }
    const r = computeGenreAutoAssignments(index, { scope: "all" })
    expect(r).toHaveLength(3)
    expect(new Set(r.map((x) => x.genreSerialized))).toEqual(new Set(["Rock"]))
    expect(r.every((x) => x.source === "album")).toBe(true)
  })
})
