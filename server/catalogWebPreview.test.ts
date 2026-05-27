import { describe, expect, it } from "vitest"
import {
  buildCatalogWebPreviewYtdlpArgs,
  isWatchSingleUrl,
  isYoutubePlaylistUrl,
  normalizeCatalogWebUrl,
  parseTracksFromBrowseJson,
  playlistIdFromPageUrl,
  urlForYtdlpFetch,
} from "./catalogWebPreview.mjs"

describe("catalogWebPreview", () => {
  it("normalizeCatalogWebUrl accepts music.youtube and youtube watch URLs", () => {
    expect(
      normalizeCatalogWebUrl(
        "https://music.youtube.com/playlist?list=OLAK5uy_test",
      ),
    ).toContain("music.youtube.com")
    expect(
      normalizeCatalogWebUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
    ).toContain("youtube.com")
    expect(normalizeCatalogWebUrl("https://evil.example/x")).toBe("")
  })

  it("isWatchSingleUrl detects single watch links", () => {
    expect(
      isWatchSingleUrl("https://music.youtube.com/watch?v=abc12345678"),
    ).toBe(true)
    expect(
      isWatchSingleUrl(
        "https://music.youtube.com/playlist?list=OLAK5uy_abcdefghij",
      ),
    ).toBe(false)
  })

  it("normalizeCatalogWebUrl strips RE-KORD accountId from query", () => {
    expect(
      normalizeCatalogWebUrl(
        "https://music.youtube.com/watch?v=abc12345678&accountId=dead-beef",
      ),
    ).toBe("https://music.youtube.com/watch?v=abc12345678")
  })

  it("isYoutubePlaylistUrl detects playlist pages", () => {
    expect(
      isYoutubePlaylistUrl(
        "https://www.youtube.com/playlist?list=OLAK5uy_abcdefghijklmnop",
      ),
    ).toBe(true)
    expect(
      isYoutubePlaylistUrl("https://music.youtube.com/watch?v=abc12345678"),
    ).toBe(false)
  })

  it("buildCatalogWebPreviewYtdlpArgs pipes webm to stdout with fast format", () => {
    const { args, url, contentType } = buildCatalogWebPreviewYtdlpArgs(
      "https://music.youtube.com/watch?v=abc12345678",
      () => [],
    )
    expect(url).toContain("youtube.com/watch")
    expect(contentType).toBe("audio/*")
    expect(args).toContain("-o")
    expect(args).toContain("-")
    expect(args).not.toContain("--download-sections")
    expect(args).toContain("--no-playlist")
    expect(args[args.length - 1]).toContain("youtube.com")
  })

  it("playlistIdFromPageUrl and urlForYtdlpFetch handle music.youtube playlists", () => {
    const page =
      "https://music.youtube.com/playlist?list=OLAK5uy_abcdefghijklmnop"
    expect(playlistIdFromPageUrl(page)).toBe("OLAK5uy_abcdefghijklmnop")
    expect(urlForYtdlpFetch(page)).toBe(
      "https://www.youtube.com/playlist?list=OLAK5uy_abcdefghijklmnop",
    )
  })

  it("parseTracksFromBrowseJson extracts watch tracks", () => {
    const json = {
      contents: {
        singleColumnBrowseResultsRenderer: {
          tabs: [
            {
              tabRenderer: {
                content: {
                  sectionListRenderer: {
                    contents: [
                      {
                        musicPlaylistShelfRenderer: {
                          contents: [
                            {
                              musicResponsiveListItemRenderer: {
                                flexColumns: [
                                  {
                                    musicResponsiveListItemFlexColumnRenderer: {
                                      text: { runs: [{ text: "Song One" }] },
                                    },
                                  },
                                ],
                                navigationEndpoint: {
                                  watchEndpoint: { videoId: "vid11111111a" },
                                },
                              },
                            },
                            {
                              musicResponsiveListItemRenderer: {
                                flexColumns: [
                                  {
                                    musicResponsiveListItemFlexColumnRenderer: {
                                      text: { runs: [{ text: "Song Two" }] },
                                    },
                                  },
                                ],
                                navigationEndpoint: {
                                  watchEndpoint: { videoId: "vid22222222b" },
                                },
                              },
                            },
                          ],
                        },
                      },
                    ],
                  },
                },
              },
            },
          ],
        },
      },
    }
    const tracks = parseTracksFromBrowseJson(json)
    expect(tracks).toHaveLength(2)
    expect(tracks[0].title).toBe("Song One")
    expect(tracks[0].url).toContain("vid11111111a")
  })

  it("parseTracksFromBrowseJson reads playlistVideoRenderer", () => {
    const json = {
      contents: [
        {
          playlistVideoRenderer: {
            title: { runs: [{ text: "Intro" }] },
            videoId: "abcd1234567",
          },
        },
      ],
    }
    const tracks = parseTracksFromBrowseJson(json)
    expect(tracks).toHaveLength(1)
    expect(tracks[0].title).toBe("Intro")
    expect(tracks[0].url).toContain("abcd1234567")
  })
})
