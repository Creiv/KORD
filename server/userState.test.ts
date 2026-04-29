// @vitest-environment node
import fs from "fs/promises"
import os from "os"
import path from "path"
import { describe, expect, it } from "vitest"
import { kordAccountUserStatePath } from "./kordDataStore.mjs"
import { readUserState, writeUserState } from "./userState.mjs"

describe("userState", () => {
  it("writes and rereads sanitized user state", async () => {
    const musicRoot = await fs.mkdtemp(path.join(os.tmpdir(), "kord-user-state-"))
    const state = await writeUserState(
      musicRoot,
      {
        favorites: ["a.mp3", "a.mp3"],
        trackPlayCounts: { "artist/album/song.mp3": 3, bad: -1, "": 2 },
        recent: [
          {
            relPath: "artist/album/song.mp3",
            title: "Song",
            artist: "Artist",
            album: "Album",
          },
        ],
        playlists: [
          {
            name: "Mix",
            tracks: [
              {
                relPath: "artist/album/song.mp3",
                title: "Song",
                artist: "Artist",
                album: "Album",
              },
            ],
          },
        ],
        queue: {
          tracks: [
            {
              relPath: "artist/album/song.mp3",
              title: "Song",
              artist: "Artist",
              album: "Album",
            },
          ],
          currentIndex: 5,
        },
        settings: { theme: "sunset", vizMode: "osc", restoreSession: false, defaultTab: "libreria" },
        migratedLegacy: true,
      },
      "testacct",
    )

    const kordPath = kordAccountUserStatePath(musicRoot, "testacct")
    expect(kordPath).toBeTruthy()
    await expect(fs.access(kordPath!)).resolves.toBeUndefined()

    const reloaded = await readUserState(musicRoot, "testacct")

    expect(state.favorites).toEqual(["a.mp3"])
    expect(reloaded.queue.currentIndex).toBe(0)
    expect(reloaded.settings.theme).toBe("sunset")
    expect(reloaded.settings.locale).toBe("en")
    expect(reloaded.playlists).toHaveLength(1)
    expect(state.trackPlayCounts).toEqual({ "artist/album/song.mp3": 3 })
    expect(reloaded.trackPlayCounts).toEqual({ "artist/album/song.mp3": 3 })
  })
})
