import { describe, expect, it } from "vitest"
import {
  buildStudioDownloadConfirm,
  resolveStudioDownloadOutputDir,
  studioDownloadKindForScope,
} from "./studioDownloadDest"

describe("studioDownloadDest", () => {
  const t = (key: string) => key

  it("uses download_single for single scope", () => {
    expect(studioDownloadKindForScope("single")).toBe("download_single")
    expect(studioDownloadKindForScope("playlist")).toBe("download_playlist")
  })

  it("creates album subfolder for playlist under artist dest", () => {
    expect(
      resolveStudioDownloadOutputDir("Artist", "playlist", "Abbey Road"),
    ).toBe("Artist/Abbey Road")
  })

  it("keeps artist dest for single scope", () => {
    expect(resolveStudioDownloadOutputDir("Artist", "single")).toBe("Artist")
  })

  it("marks single outside album folder as danger confirm", () => {
    const opts = buildStudioDownloadConfirm({
      dlPath: "Artist",
      scope: "single",
      trackCount: null,
      t,
    })
    expect(opts.variant).toBe("danger")
    expect(opts.message).toContain("tools.dlConfirmArtistFolderDl")
  })

  it("marks single in album folder as album-folder confirm", () => {
    const opts = buildStudioDownloadConfirm({
      dlPath: "Artist/Album",
      scope: "single",
      trackCount: null,
      t,
    })
    expect(opts.variant).toBe("warning")
    expect(opts.message).toContain("tools.dlConfirmAlbumFolderTracks")
  })
})
