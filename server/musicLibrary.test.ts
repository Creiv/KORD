// @vitest-environment node
import fs from "fs/promises"
import os from "os"
import path from "path"
import { describe, expect, it } from "vitest"
import { buildDashboard, buildLibraryIndex } from "./musicLibrary.mjs"
import { defaultUserState } from "./userState.mjs"

function wavSilence({ seconds, sampleRate = 8000 }: { seconds: number; sampleRate?: number }) {
  const channels = 1
  const bitsPerSample = 16
  const byteRate = sampleRate * channels * (bitsPerSample / 8)
  const dataBytes = seconds * byteRate
  const buf = Buffer.alloc(44 + dataBytes)
  buf.write("RIFF", 0)
  buf.writeUInt32LE(36 + dataBytes, 4)
  buf.write("WAVE", 8)
  buf.write("fmt ", 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(channels, 22)
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(byteRate, 28)
  buf.writeUInt16LE(channels * (bitsPerSample / 8), 32)
  buf.writeUInt16LE(bitsPerSample, 34)
  buf.write("data", 36)
  buf.writeUInt32LE(dataBytes, 40)
  return buf
}

describe("musicLibrary", () => {
  it("indexes albums, loose tracks, and quality alerts", async () => {
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

  it("uses audio file duration instead of track metadata duration", async () => {
    const musicRoot = await fs.mkdtemp(path.join(os.tmpdir(), "kord-library-duration-"))
    const albumDir = path.join(musicRoot, "Artist One", "Album One")
    await fs.mkdir(albumDir, { recursive: true })
    await fs.writeFile(path.join(albumDir, "01 Song.wav"), wavSilence({ seconds: 2 }))
    await fs.writeFile(
      path.join(albumDir, "kord-trackinfo.json"),
      JSON.stringify({ "01 Song.wav": { durationMs: 999000, title: "Song" } }, null, 2),
    )

    const index = await buildLibraryIndex(musicRoot)

    expect(index.tracks[0]?.meta?.durationMs).toBe(2000)
  })
})
