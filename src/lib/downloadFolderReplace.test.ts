import { describe, expect, it } from "vitest"
import {
  buildFolderReplaceSnapshotForFolder,
  buildFolderReplaceTrackMetaPatches,
} from "./downloadFolderReplace"
import type {
  LibraryIndex,
  LibraryTrackIndex,
  TrackMeta,
  UserStateV1,
} from "../types"

function track(relPath: string, metaPatch: Partial<TrackMeta> = {}): LibraryTrackIndex {
  const meta: TrackMeta = {
    fileName: relPath.split("/").pop() || relPath,
    size: null,
    mtime: null,
    releaseDate: null,
    genre: null,
    durationMs: null,
    trackNumber: null,
    discNumber: null,
    source: null,
    url: null,
    ...metaPatch,
  }
  return {
    id: relPath,
    relPath,
    title: relPath.split("/").pop() || relPath,
    artist: relPath.split("/")[0] || "",
    album: relPath.split("/")[1] || "",
    albumId: "album-1",
    loose: false,
    addedAt: null,
    updatedAt: null,
    meta,
  }
}

function indexWithTracks(tracks: LibraryTrackIndex[]): LibraryIndex {
  return {
    musicRoot: "/music",
    artists: [],
    albums: [
      {
        id: "album-1",
        artistId: "artist-1",
        artist: "Artist",
        name: "Album",
        relPath: "Artist/Album",
        trackCount: tracks.length,
        coverRelPath: null,
        releaseDate: null,
        label: null,
        country: null,
        musicbrainzReleaseId: null,
        expectedTrackCount: null,
        expectedTracks: null,
        hasCover: false,
        hasAlbumMeta: false,
        hasTrackMeta: true,
        tracksWithoutFileMetaCount: 0,
        loose: false,
        addedAt: null,
        updatedAt: null,
        tracks: tracks.map((t) => t.relPath),
      },
    ],
    tracks,
    stats: {
      artistCount: 1,
      albumCount: 1,
      trackCount: tracks.length,
      favoriteCapableCount: tracks.length,
      albumsWithoutCover: 0,
      albumsWithoutMeta: 0,
      tracksWithoutMeta: 0,
      looseAlbumCount: 0,
    },
  }
}

function userState(patch: Partial<UserStateV1> = {}): UserStateV1 {
  return {
    version: 1,
    favorites: [],
    recent: [],
    trackPlayCounts: {},
    playlists: [],
    queue: { tracks: [], currentIndex: 0 },
    settings: {
      theme: "midnight",
      vizMode: "bars",
      restoreSession: true,
      defaultTab: "dashboard",
      locale: "it",
      libBrowse: "artists",
      libOverviewSort: "name",
      artistAlbumSort: "date",
    },
    shuffleExcludedAlbumIds: [],
    shuffleExcludedTrackRelPaths: [],
    migratedLegacy: true,
    ...patch,
  }
}

describe("downloadFolderReplace", () => {
  it("captures genre and moods from tracks in the replace folder only", () => {
    const inside = "Artist/Album/01 Song.mp3"
    const outside = "Other/Album/01 Song.mp3"
    const snap = buildFolderReplaceSnapshotForFolder(
      userState({
        favorites: [inside],
        shuffleExcludedTrackRelPaths: [inside],
        trackPlayCounts: { [inside]: 7 },
      }),
      indexWithTracks([
        track(inside, { genre: "Industrial / Rock", moods: ["dark_tense"] }),
        track(outside, { genre: "Pop", moods: ["party_dance"] }),
      ]),
      "Artist/Album",
    )

    expect(snap.stemMeta.song).toMatchObject({
      favorite: true,
      excluded: true,
      playCount: 7,
      genre: "Industrial / Rock",
      moods: ["dark_tense"],
    })
    expect(Object.keys(snap.stemMeta)).toEqual(["song"])
  })

  it("builds metadata patches for matching replacement tracks", () => {
    const snap = buildFolderReplaceSnapshotForFolder(
      userState(),
      indexWithTracks([
        track("Artist/Album/01 Song.mp3", {
          genre: "Electronic",
          moods: ["focus_study", "dreamy_ethereal"],
        }),
      ]),
      "Artist/Album",
    )
    const patches = buildFolderReplaceTrackMetaPatches(
      snap,
      indexWithTracks([track("Artist/Album/02 - Song.webm")]),
      "Artist/Album",
    )

    expect(patches).toEqual([
      {
        relPath: "Artist/Album/02 - Song.webm",
        patch: {
          genre: "Electronic",
          moods: ["focus_study", "dreamy_ethereal"],
        },
      },
    ])
  })

  it("does not build metadata patches when old tracks have no genre or moods", () => {
    const snap = buildFolderReplaceSnapshotForFolder(
      userState(),
      indexWithTracks([track("Artist/Album/01 Song.mp3")]),
      "Artist/Album",
    )
    const patches = buildFolderReplaceTrackMetaPatches(
      snap,
      indexWithTracks([track("Artist/Album/02 Song.webm")]),
      "Artist/Album",
    )

    expect(patches).toEqual([])
  })
})
