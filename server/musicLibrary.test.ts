// @vitest-environment node
import fs from "fs/promises"
import os from "os"
import path from "path"
import { describe, expect, it } from "vitest"
import { buildDashboard, buildLibraryIndex } from "./musicLibrary.mjs"
import { defaultUserState } from "./userState.mjs"

describe("musicLibrary", () => {
  it("indicizza album, tracce sfuse e alert qualità", async () => {
    const musicRoot = await fs.mkdtemp(path.join(os.tmpdir(), "kord-library-"))
    await fs.mkdir(path.join(musicRoot, "Artist One", "Album One"), { recursive: true })
    await fs.writeFile(path.join(musicRoot, "Artist One", "Album One", "01 Song.mp3"), "")
    await fs.writeFile(path.join(musicRoot, "Artist One", "Loose Song.mp3"), "")

    const index = await buildLibraryIndex(musicRoot)
    const dashboard = buildDashboard(index, defaultUserState())

    expect(index.stats.artistCount).toBe(1)
    expect(index.stats.albumCount).toBe(2)
    expect(index.stats.albumsWithoutCover).toBe(1)
    expect(index.stats.looseAlbumCount).toBe(1)
    expect(dashboard.qualityAlerts.find((item) => item.id === "albums-without-cover")?.count).toBe(1)
    const ar = index.artists[0]!
    expect(ar.albumsWithoutFileMetaCount).toBe(1)
    expect(ar.tracksWithoutFileMetaCount).toBe(2)
    const al = index.albums.find((a) => a.name === "Album One")!
    expect(al.tracksWithoutFileMetaCount).toBe(1)
  })
})
