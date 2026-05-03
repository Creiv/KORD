// @vitest-environment node
import fs from "fs/promises"
import os from "os"
import path from "path"
import { describe, expect, it } from "vitest"
import {
  saveAlbumFetchedMeta,
  saveAlbumManualMeta,
  saveTrackFetchedMeta,
  saveTrackManualMeta,
} from "./albumInfo.mjs"

describe("albumInfo persistence", () => {
  it("mergea salvataggi concorrenti su metadati traccia senza perdere campi", async () => {
    const albumDir = await fs.mkdtemp(path.join(os.tmpdir(), "kord-track-meta-"))
    const fileName = "01 Song.flac"

    await Promise.all([
      saveTrackManualMeta(albumDir, fileName, { title: "Manual title" }),
      saveTrackManualMeta(albumDir, fileName, { genre: "Rock" }),
      saveTrackFetchedMeta(albumDir, fileName, { source: "musicbrainz" }),
    ])

    const raw = await fs.readFile(path.join(albumDir, "kord-trackinfo.json"), "utf8")
    const json = JSON.parse(raw)
    expect(json[fileName].title).toBe("Manual title")
    expect(json[fileName].genre).toBe("Rock")
    expect(json[fileName].source).toBe("musicbrainz")
  })

  it("mergea salvataggi concorrenti su metadati album senza perdere campi", async () => {
    const albumDir = await fs.mkdtemp(path.join(os.tmpdir(), "kord-album-meta-"))

    await Promise.all([
      saveAlbumManualMeta(albumDir, { title: "Manual album" }),
      saveAlbumManualMeta(albumDir, { label: "Label One" }),
      saveAlbumFetchedMeta(albumDir, {
        country: "IT",
        fetchedAt: "2026-05-02T00:00:00.000Z",
      }),
    ])

    const raw = await fs.readFile(path.join(albumDir, "kord-albuminfo.json"), "utf8")
    const json = JSON.parse(raw)
    expect(json.title).toBe("Manual album")
    expect(json.label).toBe("Label One")
    expect(json.country).toBe("IT")
    expect(json.fetchedAt).toBe("2026-05-02T00:00:00.000Z")
  })
})
