// @vitest-environment node
import { describe, expect, it } from "vitest"
import { buildLibraryIndex } from "./musicLibrary.mjs"
import {
  filterLibraryIndexBySelection,
  removeAlbumsFromSelectionSets,
  sanitizeLibrarySelection,
  sanitizeRelPathForSelection,
} from "./librarySelection.mjs"
import fs from "fs/promises"
import os from "os"
import path from "path"

describe("librarySelection", () => {
  it("rejects path traversal in sanitizeRelPathForSelection", () => {
    expect(sanitizeRelPathForSelection("a/../b")).toBeNull()
    expect(sanitizeRelPathForSelection("a/b")).toBe("a/b")
  })

  it("filters index by artist and album selection", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kord-sel-"))
    await fs.mkdir(path.join(root, "A", "B"), { recursive: true })
    await fs.writeFile(path.join(root, "A", "B", "01 x.mp3"), "")
    const full = await buildLibraryIndex(root)
    const sel = sanitizeLibrarySelection({
      includeAll: false,
      artists: ["A"],
      albums: [],
      tracks: [],
    })
    const filtered = filterLibraryIndexBySelection(full, sel, "other")
    expect(filtered.tracks.length).toBe(1)
    expect(filtered.musicRoot).toBe("")
    const empty = filterLibraryIndexBySelection(
      full,
      sanitizeLibrarySelection({ includeAll: false, artists: [], albums: [], tracks: [] }),
      "x",
    )
    expect(empty.tracks.length).toBe(0)
  })

  it("removeAlbums drops one album when artist was selected for whole library", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kord-selRm-"))
    await fs.mkdir(path.join(root, "A", "B1"), { recursive: true })
    await fs.mkdir(path.join(root, "A", "B2"), { recursive: true })
    await fs.writeFile(path.join(root, "A", "B1", "01 a.mp3"), Buffer.from([]))
    await fs.writeFile(path.join(root, "A", "B2", "01 b.mp3"), Buffer.from([]))
    const full = await buildLibraryIndex(root)
    const artists = new Set(["A"])
    const albums = new Set()
    removeAlbumsFromSelectionSets(full, artists, albums, ["A/B1"])
    expect([...artists]).toEqual([])
    expect([...albums].sort()).toEqual(["A/B2"])
    const sel = sanitizeLibrarySelection({
      includeAll: false,
      artists: [...artists],
      albums: [...albums],
      tracks: [],
    })
    const filtered = filterLibraryIndexBySelection(full, sel, "x")
    expect(filtered.albums.map((x) => x.relPath).sort()).toEqual(["A/B2"])
  })
})
