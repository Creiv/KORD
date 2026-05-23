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
  writeUserPlectrBestWithCAS,
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

  it("writeUserPlectrBestWithCAS saves and keeps only if better", async () => {
    const musicRoot = await fs.mkdtemp(path.join(os.tmpdir(), "kord-plectr-cas-"))
    await writeUserState(musicRoot, defaultUserState(), "plectracct")

    const first = {
      score: 1200,
      grade: "A",
      accuracy: 0.92,
      maxCombo: 40,
      hits: 80,
      misses: 3,
    }
    const saved = await writeUserPlectrBestWithCAS(
      musicRoot,
      "plectracct",
      "artist/album/song.mp3",
      first,
    )
    expect(saved.saved).toBe(true)
    expect(saved.best?.score).toBe(1200)

    const reloaded = await readUserState(musicRoot, "plectracct")
    expect(reloaded.plectrBests?.["artist/album/song.mp3"]?.score).toBe(1200)
    expect(reloaded.revision).toBe(3)

    const worse = await writeUserPlectrBestWithCAS(
      musicRoot,
      "plectracct",
      "artist/album/song.mp3",
      { ...first, score: 900, accuracy: 0.5 },
    )
    expect(worse.saved).toBe(false)
    expect(worse.best?.score).toBe(1200)

    const afterWorse = await readUserState(musicRoot, "plectracct")
    expect(afterWorse.plectrBests?.["artist/album/song.mp3"]?.score).toBe(1200)
    expect(afterWorse.revision).toBe(3)

    const better = await writeUserPlectrBestWithCAS(
      musicRoot,
      "plectracct",
      "artist/album/song.mp3",
      { ...first, score: 1500, accuracy: 0.95 },
    )
    expect(better.saved).toBe(true)
    expect(better.best?.score).toBe(1500)

    const afterBetter = await readUserState(musicRoot, "plectracct")
    expect(afterBetter.plectrBests?.["artist/album/song.mp3"]?.score).toBe(1500)
    expect(afterBetter.revision).toBe(4)
  })

  it("mergeUserStateForPut merges plectrBests by relPath", () => {
    const prev = {
      ...defaultUserState(),
      plectrBests: {
        "a.mp3": {
          score: 100,
          grade: "B",
          accuracy: 0.8,
          maxCombo: 5,
          hits: 10,
          misses: 1,
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      },
    }
    const merged = mergeUserStateForPut(prev, {
      plectrBests: {
        "b.mp3": {
          score: 200,
          grade: "A",
          accuracy: 0.9,
          maxCombo: 8,
          hits: 15,
          misses: 0,
        },
      },
    })
    expect(Object.keys(merged.plectrBests ?? {})).toEqual(["a.mp3", "b.mp3"])
  })
})
