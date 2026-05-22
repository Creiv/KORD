import { describe, expect, it } from "vitest"
import {
  classifyYoutubeReleaseEntry,
  partitionYoutubeReleaseEntries,
} from "./youtubeReleases"

describe("classifyYoutubeReleaseEntry", () => {
  it("classifies by track count", () => {
    expect(
      classifyYoutubeReleaseEntry({
        title: "My Album",
        url: "https://music.youtube.com/playlist?list=OLAK5uy_abc",
        trackCount: 12,
      }),
    ).toBe("album")
    expect(
      classifyYoutubeReleaseEntry({
        title: "Hit",
        url: "https://www.youtube.com/watch?v=abc12345678",
        trackCount: 1,
      }),
    ).toBe("song")
  })

  it("classifies watch URLs without playlist as singles", () => {
    expect(
      classifyYoutubeReleaseEntry({
        title: "Song Title",
        url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        trackCount: null,
      }),
    ).toBe("song")
  })

  it("classifies YTM subtitle-style titles", () => {
    expect(
      classifyYoutubeReleaseEntry({
        title: "Single • Artist Name",
        url: "https://music.youtube.com/playlist?list=PLx",
        trackCount: null,
      }),
    ).toBe("song")
    expect(
      classifyYoutubeReleaseEntry({
        title: "EP • Artist Name",
        url: "https://music.youtube.com/playlist?list=PLx",
        trackCount: null,
      }),
    ).toBe("album")
  })
})

describe("partitionYoutubeReleaseEntries", () => {
  it("splits albums and songs", () => {
    const { albums, songs } = partitionYoutubeReleaseEntries([
      {
        title: "LP",
        url: "https://music.youtube.com/playlist?list=OLAK5uy_x",
        trackCount: 8,
      },
      {
        title: "One",
        url: "https://www.youtube.com/watch?v=abcdefghijk",
        trackCount: 1,
      },
    ])
    expect(albums).toHaveLength(1)
    expect(songs).toHaveLength(1)
  })
})
