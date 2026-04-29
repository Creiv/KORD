// @vitest-environment node
import fs from "fs/promises"
import os from "os"
import path from "path"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  createSharedFileReference,
  linkSharedAlbumFromDirs,
  shouldFallbackToHardLink,
} from "./libraryLink.mjs"

describe("libraryLink", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("falls back to hard links for Windows symlink permission errors", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kord-link-"))
    const source = path.join(dir, "source.mp3")
    const dest = path.join(dir, "dest.mp3")
    await fs.writeFile(source, "audio")
    const realLink = fs.link.bind(fs)
    const err = Object.assign(new Error("privilege not held"), {
      code: "EPERM",
    })

    vi.spyOn(fs, "symlink").mockRejectedValue(err)
    const linkSpy = vi
      .spyOn(fs, "link")
      .mockImplementation((oldPath, newPath) => realLink(oldPath, newPath))

    await createSharedFileReference(source, dest, "win32")

    expect(linkSpy).toHaveBeenCalledWith(source, dest)
    const [a, b] = await Promise.all([fs.stat(source), fs.stat(dest)])
    expect(a.dev).toBe(b.dev)
    expect(a.ino).toBe(b.ino)
  })

  it("does not fallback to hard links outside Windows", () => {
    expect(shouldFallbackToHardLink({ code: "EPERM" }, "linux")).toBe(false)
    expect(shouldFallbackToHardLink({ code: "EPERM" }, "darwin")).toBe(false)
    expect(shouldFallbackToHardLink({ code: "EPERM" }, "win32")).toBe(true)
  })

  it("treats an existing hard link to the source as already shared", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kord-shared-"))
    const sourceRoot = path.join(root, "source")
    const destRoot = path.join(root, "dest")
    const sourceAlbum = path.join(sourceRoot, "Artist", "Album")
    const destAlbum = path.join(destRoot, "Artist", "Album")
    await fs.mkdir(sourceAlbum, { recursive: true })
    await fs.mkdir(path.join(destAlbum, ".kord"), { recursive: true })
    const sourceTrack = path.join(sourceAlbum, "01 Song.mp3")
    const destTrack = path.join(destAlbum, "01 Song.mp3")
    await fs.writeFile(sourceTrack, "audio")
    await fs.link(sourceTrack, destTrack)
    await fs.writeFile(
      path.join(destAlbum, ".kord", "linked-source.json"),
      JSON.stringify({ v: 1 }),
      "utf8",
    )

    const result = await linkSharedAlbumFromDirs({
      sourceAccountId: "source",
      destAccountId: "dest",
      sourceRoot,
      destRoot,
      relPath: "Artist/Album",
    })

    expect(result.linked).toBe(0)
    expect(result.skipped).toBe(1)
  })
})
