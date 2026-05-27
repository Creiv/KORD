// @vitest-environment node
import fs from "fs/promises"
import os from "os"
import path from "path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { atomicWriteFileUtf8 } from "./rekordDataStore.mjs"

describe("rekordDataStore", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("ritenta rename temporaneamente bloccati durante la scrittura atomica", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rekord-atomic-"))
    const target = path.join(dir, "state.json")
    const realRename = fs.rename.bind(fs)
    const renameSpy = vi.spyOn(fs, "rename")
    renameSpy
      .mockRejectedValueOnce(Object.assign(new Error("locked"), { code: "EPERM" }))
      .mockImplementation((from, to) => realRename(from, to))

    await atomicWriteFileUtf8(target, JSON.stringify({ ok: true }))

    await expect(fs.readFile(target, "utf8")).resolves.toBe('{"ok":true}')
    expect(renameSpy).toHaveBeenCalledTimes(2)
  })
})
