import { describe, expect, it } from "vitest"
import {
  studioDownloadSourceForArtistUrl,
  urlMatchesStudioDlMode,
} from "./youtubeUrl"

describe("youtubeUrl", () => {
  it("accepts both releases and browse URLs for artist releases mode", () => {
    expect(
      urlMatchesStudioDlMode(
        "https://www.youtube.com/channel/UC123/releases",
        "video",
        "releases",
      ),
    ).toBe(true)
    expect(
      urlMatchesStudioDlMode(
        "https://music.youtube.com/browse/UC123",
        "video",
        "releases",
      ),
    ).toBe(true)
  })

  it("keeps single and playlist modes separate from artist browse URLs", () => {
    const browse = "https://music.youtube.com/browse/UC123"

    expect(urlMatchesStudioDlMode(browse, "video", "single")).toBe(false)
    expect(urlMatchesStudioDlMode(browse, "video", "playlist")).toBe(false)
  })

  it("infers the existing download command kind source from artist URLs", () => {
    expect(studioDownloadSourceForArtistUrl("https://music.youtube.com/browse/UC123")).toBe(
      "music",
    )
    expect(studioDownloadSourceForArtistUrl("https://www.youtube.com/channel/UC123/releases")).toBe(
      "video",
    )
  })
})
