// @vitest-environment node
import fs from "fs/promises"
import os from "os"
import path from "path"
import { describe, expect, it } from "vitest"
import { kordAccountUserStatePath } from "./kordDataStore.mjs"
import {
  mergeUserStateForPut,
  mergeAndWriteUserStatePatch,
  readUserState,
  stripSettingsFromUserStatePatch,
  writeUserState,
  defaultUserState,
} from "./userState.mjs"

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

  it("merge PUT dopo strip non sovrascrive le impostazioni", () => {
    const prev = defaultUserState()
    prev.settings = { ...prev.settings, theme: "sunset" }
    prev.favorites = ["a.mp3"]
    const raw = {
      favorites: [],
      settings: { theme: "ocean" },
      playlists: [],
    }
    const merged = mergeUserStateForPut(prev, stripSettingsFromUserStatePatch(raw))
    expect(merged.settings.theme).toBe("sunset")
    expect(merged.favorites).toEqual([])
  })

  it("PATCH server-side mergea su stato fresco senza expectedRevision", async () => {
    const musicRoot = await fs.mkdtemp(path.join(os.tmpdir(), "kord-user-state-patch-"))
    await writeUserState(
      musicRoot,
      {
        ...defaultUserState(),
        favorites: ["old.mp3"],
        settings: { ...defaultUserState().settings, theme: "sunset" },
      },
      "patchacct",
    )

    const saved = await mergeAndWriteUserStatePatch(musicRoot, "patchacct", {
      favorites: ["new.mp3"],
      settings: { locale: "it" },
    })

    expect(saved.favorites).toEqual(["new.mp3"])
    expect(saved.settings.theme).toBe("sunset")
    expect(saved.settings.locale).toBe("it")
    expect(saved.revision).toBe(3)
  })

  it("serializza PATCH concorrenti senza perdere campi indipendenti", async () => {
    const musicRoot = await fs.mkdtemp(path.join(os.tmpdir(), "kord-user-state-race-"))
    await writeUserState(musicRoot, defaultUserState(), "raceacct")

    await Promise.all([
      mergeAndWriteUserStatePatch(musicRoot, "raceacct", {
        favorites: ["artist/album/a.mp3"],
      }),
      mergeAndWriteUserStatePatch(musicRoot, "raceacct", {
        trackPlayCounts: { "artist/album/b.mp3": 2 },
      }),
      mergeAndWriteUserStatePatch(musicRoot, "raceacct", {
        settings: { locale: "it" },
      }),
    ])

    const saved = await readUserState(musicRoot, "raceacct")
    expect(saved.favorites).toEqual(["artist/album/a.mp3"])
    expect(saved.trackPlayCounts).toEqual({ "artist/album/b.mp3": 2 })
    expect(saved.settings.locale).toBe("it")
    expect(saved.revision).toBe(5)
  })
})
