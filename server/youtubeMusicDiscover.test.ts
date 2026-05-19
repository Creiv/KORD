import { describe, expect, it } from "vitest"
import {
  isSingleReleaseSubtitle,
  parseDiscoverSubtitleLine,
  parseTrackCountHint,
  releaseTypeToKind,
} from "./youtubeMusicDiscover.mjs"

describe("youtubeMusicDiscover helpers", () => {
  it("parses track counts from subtitle hints", () => {
    expect(parseTrackCountHint("Artist · 12 songs")).toBe(12)
    expect(parseTrackCountHint("Album · 1 song")).toBe(1)
    expect(parseTrackCountHint("9 brani")).toBe(9)
    expect(parseTrackCountHint("Artist only")).toBeNull()
  })

  it("detects single release subtitles", () => {
    expect(isSingleReleaseSubtitle("Single • Artist")).toBe(true)
    expect(isSingleReleaseSubtitle("Album • Artist")).toBe(false)
  })

  it("parses YTM new-releases subtitle lines", () => {
    expect(parseDiscoverSubtitleLine("Album • Black Veil Brides")).toEqual({
      releaseType: "Album",
      artistName: "Black Veil Brides",
    })
    expect(parseDiscoverSubtitleLine("EP • Mc Staff")).toEqual({
      releaseType: "EP",
      artistName: "Mc Staff",
    })
    expect(parseDiscoverSubtitleLine("Single • Ado")).toEqual({
      releaseType: "Single",
      artistName: "Ado",
    })
    expect(releaseTypeToKind("EP")).toBe("album")
    expect(releaseTypeToKind("Single")).toBe("song")
  })
})
