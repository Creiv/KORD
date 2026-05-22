import { render, screen, waitFor } from "@testing-library/react"
import { useEffect, useRef } from "react"
import { beforeEach, vi } from "vitest"
import { LibrarySyncActivityProvider } from "./LibrarySyncActivityContext"
import { UserStateProvider, useUserState } from "./UserStateContext"
import type { LibraryIndex, LibraryTrackIndex, TrackMeta } from "../types"

const REHYDRATE_TRACK_REL = "Artist One/Album One/01 Song.mp3"

function rehydrateTrackMeta(patch: Partial<TrackMeta> = {}): TrackMeta {
  return {
    fileName: "01 Song.mp3",
    size: 1,
    mtime: 1,
    releaseDate: null,
    genre: null,
    durationMs: null,
    trackNumber: null,
    discNumber: null,
    source: null,
    url: null,
    ...patch,
  }
}

function rehydrateLibraryTrack(
  patch: Partial<LibraryTrackIndex> = {},
): LibraryTrackIndex {
  return {
    id: REHYDRATE_TRACK_REL,
    relPath: REHYDRATE_TRACK_REL,
    title: "Titolo nuovo",
    artist: "Artist One",
    album: "Album One",
    albumId: "al1",
    loose: false,
    addedAt: null,
    updatedAt: Date.now(),
    meta: rehydrateTrackMeta({ genre: "Jazz", releaseDate: "2020" }),
    ...patch,
  }
}

function Probe() {
  const user = useUserState()
  if (!user.ready) return <div>loading</div>
  return (
    <div>
      <span data-testid="favorites">{user.state.favorites.length}</span>
      <span data-testid="recent">{user.state.recent[0]?.title || "none"}</span>
      <span data-testid="playlists">{user.state.playlists.length}</span>
    </div>
  )
}

function SyncRaceProbe() {
  const user = useUserState()
  const {
    error,
    ready,
    state,
    syncUserStateFromServer,
    toggleFavorite,
  } = user
  useEffect(() => {
    const started = window.sessionStorage.getItem("sync-race-started")
    if (!ready || started) return
    window.sessionStorage.setItem("sync-race-started", "1")
    toggleFavorite("Artist One/Album One/02 New Song.mp3")
  }, [ready, toggleFavorite])
  useEffect(() => {
    const synced = window.sessionStorage.getItem("sync-race-synced")
    if (
      !ready ||
      synced ||
      !state.favorites.includes("Artist One/Album One/02 New Song.mp3")
    ) {
      return
    }
    window.sessionStorage.setItem("sync-race-synced", "1")
    void syncUserStateFromServer()
  }, [ready, state.favorites, syncUserStateFromServer])
  if (!ready) return <div>loading</div>
  return (
    <div>
      <span data-testid="race-favorites">{state.favorites.join("|")}</span>
      <span data-testid="race-error">{error || "ok"}</span>
    </div>
  )
}

function RecentMetaRehydrateProbe({ libraryIndex }: { libraryIndex: LibraryIndex }) {
  const user = useUserState()
  const rehydratedRef = useRef(false)
  useEffect(() => {
    if (!user.ready || rehydratedRef.current) return
    rehydratedRef.current = true
    user.rehydrateTrackListsFromLibrary(libraryIndex)
  }, [libraryIndex, user])
  if (!user.ready) return <div>loading</div>
  const recent = user.state.recent[0]
  return (
    <>
      <span data-testid="recent-title">{recent?.title ?? "none"}</span>
      <span data-testid="recent-genre">{recent?.meta?.genre ?? "none"}</span>
    </>
  )
}

function EarlyRehydrateProbe() {
  const user = useUserState()
  const rehydratedRef = useRef(false)
  useEffect(() => {
    if (rehydratedRef.current) return
    rehydratedRef.current = true
    user.rehydrateTrackListsFromLibrary({
      artists: [],
      albums: [],
      tracks: [],
      stats: {
        artistCount: 0,
        albumCount: 0,
        trackCount: 0,
        favoriteCapableCount: 0,
        albumsWithoutCover: 0,
        albumsWithoutMeta: 0,
        tracksWithoutMeta: 0,
        looseAlbumCount: 0,
      },
    } satisfies LibraryIndex)
  }, [user])
  if (!user.ready) return <div>loading</div>
  return <span data-testid="early-playlists">{user.state.playlists.length}</span>
}

describe("UserStateProvider", () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
  })

  it("imports legacy data from localStorage and promotes to user-state", async () => {
    window.localStorage.setItem("wpp-favorites", JSON.stringify(["Artist One/Album One/01 Song.mp3"]))
    window.localStorage.setItem(
      "wpp-recent",
      JSON.stringify([
        {
          id: "Artist One/Album One/01 Song.mp3",
          relPath: "Artist One/Album One/01 Song.mp3",
          title: "Legacy Song",
          artist: "Artist One",
          album: "Album One",
        },
      ]),
    )

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            data: {
              version: 1,
              favorites: [],
              recent: [],
              playlists: [],
              queue: { tracks: [], currentIndex: 0 },
              shuffleExcludedAlbumIds: [],
              shuffleExcludedTrackRelPaths: [],
              settings: {
                theme: "midnight",
                vizMode: "bars",
                restoreSession: true,
                defaultTab: "dashboard",
                locale: "en",
              },
              migratedLegacy: false,
            },
            error: null,
          }),
        ),
      )
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            ok: true,
            data: {
              version: 1,
              favorites: ["Artist One/Album One/01 Song.mp3"],
              recent: [
                {
                  id: "Artist One/Album One/01 Song.mp3",
                  relPath: "Artist One/Album One/01 Song.mp3",
                  title: "Legacy Song",
                  artist: "Artist One",
                  album: "Album One",
                },
              ],
              playlists: [],
              queue: { tracks: [], currentIndex: 0 },
              shuffleExcludedAlbumIds: [],
              shuffleExcludedTrackRelPaths: [],
              settings: {
                theme: "midnight",
                vizMode: "bars",
                restoreSession: true,
                defaultTab: "dashboard",
                locale: "en",
              },
              migratedLegacy: true,
            },
            error: null,
          }),
        ),
      )

    globalThis.fetch = fetchMock as typeof fetch

    render(
      <LibrarySyncActivityProvider>
        <UserStateProvider>
          <Probe />
        </UserStateProvider>
      </LibrarySyncActivityProvider>,
    )

    await waitFor(() => expect(screen.getByTestId("favorites")).toHaveTextContent("1"))
    expect(screen.getByTestId("recent")).toHaveTextContent("Legacy Song")
    expect(fetchMock).toHaveBeenCalled()
  })

  it("importa playlist legacy anche per account già migrati e le salva nello stato utente", async () => {
    window.localStorage.setItem(
      "wpp-playlists",
      JSON.stringify([
        {
          id: "legacy-mix",
          name: "Legacy Mix",
          tracks: [
            {
              relPath: "Artist One/Album One/01 Song.mp3",
              title: "Legacy Song",
              artist: "Artist One",
              album: "Album One",
            },
          ],
        },
      ]),
    )

    const remoteState = {
      version: 1,
      revision: 7,
      favorites: ["Artist One/Album One/01 Song.mp3"],
      recent: [],
      playlists: [],
      queue: { tracks: [], currentIndex: 0 },
      shuffleExcludedAlbumIds: [],
      shuffleExcludedTrackRelPaths: [],
      trackPlayCounts: {},
      settings: {
        theme: "midnight",
        vizMode: "bars",
        restoreSession: true,
        defaultTab: "dashboard",
        locale: "en",
        libBrowse: "artists",
        libOverviewSort: "name",
        artistAlbumSort: "date",
      },
      migratedLegacy: true,
    }
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/accounts") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              ok: true,
              data: {
                defaultAccountId: "default",
                accounts: [{ id: "default", name: "Default" }],
                lockedByEnv: false,
              },
              error: null,
            }),
          ),
        )
      }
      if (url.startsWith("/api/user-state") && init?.method === "PATCH") {
        const body = JSON.parse(String(init.body || "{}")) as {
          state?: { playlists?: unknown[]; playlistsMigrated?: boolean }
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              ok: true,
              data: {
                ...remoteState,
                revision: 8,
                playlists: body.state?.playlists || [],
                playlistsMigrated: body.state?.playlistsMigrated,
              },
              error: null,
            }),
          ),
        )
      }
      if (url.startsWith("/api/user-state")) {
        return Promise.resolve(
          new Response(JSON.stringify({ ok: true, data: remoteState, error: null })),
        )
      }
      return Promise.reject(new Error(`Unexpected request: ${url}`))
    })
    globalThis.fetch = fetchMock as typeof fetch

    render(
      <LibrarySyncActivityProvider>
        <UserStateProvider>
          <Probe />
        </UserStateProvider>
      </LibrarySyncActivityProvider>,
    )

    await waitFor(() => expect(screen.getByTestId("playlists")).toHaveTextContent("1"))
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([, init]) => {
          if (init?.method !== "PATCH") return false
          const body = JSON.parse(String(init.body || "{}")) as {
            state?: { playlists?: unknown[]; playlistsMigrated?: boolean }
          }
          return body.state?.playlists?.length === 1 && body.state.playlistsMigrated === true
        }),
      ).toBe(true),
    )
  })

  it("non accoda playlist vuote se la reidratazione libreria parte prima dello user-state", async () => {
    const userStateRequest: {
      resolve?: (value: Response) => void
    } = {}
    const remoteState = {
      version: 1,
      revision: 4,
      favorites: [],
      recent: [],
      playlists: [
        {
          id: "server-mix",
          name: "Server Mix",
          tracks: [],
        },
      ],
      queue: { tracks: [], currentIndex: 0 },
      shuffleExcludedAlbumIds: [],
      shuffleExcludedTrackRelPaths: [],
      trackPlayCounts: {},
      settings: {
        theme: "midnight",
        vizMode: "bars",
        restoreSession: true,
        defaultTab: "dashboard",
        locale: "en",
        libBrowse: "artists",
        libOverviewSort: "name",
        artistAlbumSort: "date",
      },
      migratedLegacy: true,
      playlistsMigrated: true,
    }
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/accounts") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              ok: true,
              data: {
                defaultAccountId: "default",
                accounts: [{ id: "default", name: "Default" }],
                lockedByEnv: false,
              },
              error: null,
            }),
          ),
        )
      }
      if (url.startsWith("/api/user-state") && init?.method === "PATCH") {
        const body = JSON.parse(String(init.body || "{}")) as {
          state?: { playlists?: unknown[] }
        }
        if (body.state?.playlists?.length === 0) {
          return Promise.reject(new Error("PATCH should not save empty playlists before hydration"))
        }
        return Promise.resolve(
          new Response(JSON.stringify({ ok: true, data: remoteState, error: null })),
        )
      }
      if (url.startsWith("/api/user-state")) {
        return new Promise<Response>((resolve) => {
          userStateRequest.resolve = resolve
        })
      }
      return Promise.reject(new Error(`Unexpected request: ${url}`))
    })
    globalThis.fetch = fetchMock as typeof fetch

    render(
      <LibrarySyncActivityProvider>
        <UserStateProvider>
          <EarlyRehydrateProbe />
        </UserStateProvider>
      </LibrarySyncActivityProvider>,
    )

    await waitFor(() => expect(userStateRequest.resolve).toBeDefined())
    userStateRequest.resolve?.(
      new Response(JSON.stringify({ ok: true, data: remoteState, error: null })),
    )

    await waitFor(() => expect(screen.getByTestId("early-playlists")).toHaveTextContent("1"))
    expect(
      fetchMock.mock.calls.some(([, init]) => {
        if (init?.method !== "PATCH") return false
        const body = JSON.parse(String(init.body || "{}")) as {
          state?: { playlists?: unknown[] }
        }
        return body.state?.playlists?.length === 0
      }),
    ).toBe(false)
  })

  it("reidrata i recenti con titolo e metadati aggiornati dall'indice libreria", async () => {
    const staleRecent = {
      id: REHYDRATE_TRACK_REL,
      relPath: REHYDRATE_TRACK_REL,
      title: "Titolo vecchio",
      artist: "Artist One",
      album: "Album One",
      meta: { genre: "Rock" },
    }
    const libraryTrack = rehydrateLibraryTrack()
    const libraryIndex: LibraryIndex = {
      artists: [],
      albums: [],
      tracks: [libraryTrack],
      stats: {
        artistCount: 1,
        albumCount: 1,
        trackCount: 1,
        favoriteCapableCount: 1,
        albumsWithoutCover: 0,
        albumsWithoutMeta: 0,
        tracksWithoutMeta: 0,
        looseAlbumCount: 0,
      },
    }
    const remoteState = {
      version: 1,
      revision: 2,
      favorites: [],
      recent: [staleRecent],
      playlists: [],
      queue: { tracks: [], currentIndex: 0 },
      shuffleExcludedAlbumIds: [],
      shuffleExcludedTrackRelPaths: [],
      trackPlayCounts: {},
      settings: {
        theme: "midnight",
        vizMode: "bars",
        restoreSession: true,
        defaultTab: "dashboard",
        locale: "en",
        libBrowse: "artists",
        libOverviewSort: "name",
        artistAlbumSort: "date",
      },
      migratedLegacy: true,
    }
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === "/api/accounts") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              ok: true,
              data: {
                defaultAccountId: "default",
                accounts: [{ id: "default", name: "Default" }],
                lockedByEnv: false,
              },
              error: null,
            }),
          ),
        )
      }
      if (url.startsWith("/api/user-state")) {
        return Promise.resolve(
          new Response(JSON.stringify({ ok: true, data: remoteState, error: null })),
        )
      }
      return Promise.reject(new Error(`Unexpected request: ${url}`))
    })
    globalThis.fetch = fetchMock as typeof fetch

    render(
      <LibrarySyncActivityProvider>
        <UserStateProvider>
          <RecentMetaRehydrateProbe libraryIndex={libraryIndex} />
        </UserStateProvider>
      </LibrarySyncActivityProvider>,
    )

    await waitFor(() =>
      expect(screen.getByTestId("recent-title")).toHaveTextContent("Titolo nuovo"),
    )
    expect(screen.getByTestId("recent-genre")).toHaveTextContent("Jazz")
  })

  it("non perde patch locali quando un sync riceve stato server vecchio", async () => {
    window.sessionStorage.clear()
    const remoteState = {
      version: 1,
      revision: 2,
      favorites: [],
      recent: [],
      playlists: [],
      queue: { tracks: [], currentIndex: 0 },
      shuffleExcludedAlbumIds: [],
      shuffleExcludedTrackRelPaths: [],
      trackPlayCounts: {},
      settings: {
        theme: "midnight",
        vizMode: "bars",
        restoreSession: true,
        defaultTab: "dashboard",
        locale: "en",
        libBrowse: "artists",
        libOverviewSort: "name",
        artistAlbumSort: "date",
      },
      migratedLegacy: true,
    }
    const savedState = {
      ...remoteState,
      revision: 3,
      favorites: ["Artist One/Album One/02 New Song.mp3"],
    }
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/accounts") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              ok: true,
              data: {
                defaultAccountId: "default",
                accounts: [{ id: "default", name: "Default" }],
                lockedByEnv: false,
              },
              error: null,
            }),
          ),
        )
      }
      if (url.startsWith("/api/user-state") && init?.method === "PATCH") {
        return Promise.resolve(
          new Response(JSON.stringify({ ok: true, data: savedState, error: null })),
        )
      }
      if (url.startsWith("/api/user-state")) {
        return Promise.resolve(
          new Response(JSON.stringify({ ok: true, data: remoteState, error: null })),
        )
      }
      return Promise.reject(new Error(`Unexpected request: ${url}`))
    })
    globalThis.fetch = fetchMock as typeof fetch

    render(
      <LibrarySyncActivityProvider>
        <UserStateProvider>
          <SyncRaceProbe />
        </UserStateProvider>
      </LibrarySyncActivityProvider>,
    )

    await waitFor(() =>
      expect(screen.getByTestId("race-favorites")).toHaveTextContent(
        "Artist One/Album One/02 New Song.mp3",
      ),
    )
    expect(screen.getByTestId("race-error")).toHaveTextContent("ok")
  })

  it("non sovrascrive lo stato remoto con fallback se il bootstrap fallisce", async () => {
    const remoteState = {
      version: 1,
      revision: 2,
      favorites: ["Artist One/Album One/01 Song.mp3"],
      recent: [],
      playlists: [],
      queue: { tracks: [], currentIndex: 0 },
      shuffleExcludedAlbumIds: [],
      shuffleExcludedTrackRelPaths: [],
      trackPlayCounts: {},
      settings: {
        theme: "midnight",
        vizMode: "bars",
        restoreSession: true,
        defaultTab: "dashboard",
        locale: "en",
        libBrowse: "artists",
        libOverviewSort: "name",
        artistAlbumSort: "date",
      },
      migratedLegacy: true,
    }

    let userStateGetCalls = 0
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/accounts") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              ok: true,
              data: {
                defaultAccountId: "default",
                accounts: [{ id: "default", name: "Default" }],
                lockedByEnv: false,
              },
              error: null,
            }),
          ),
        )
      }
      if (url.startsWith("/api/user-state") && init?.method === "PATCH") {
        return Promise.reject(new Error("PATCH should not be called on bootstrap error"))
      }
      if (url.startsWith("/api/user-state")) {
        userStateGetCalls += 1
        if (userStateGetCalls === 1) {
          return Promise.reject(new Error("Network error"))
        }
        return Promise.resolve(
          new Response(JSON.stringify({ ok: true, data: remoteState, error: null })),
        )
      }
      return Promise.reject(new Error(`Unexpected request: ${url}`))
    })
    globalThis.fetch = fetchMock as typeof fetch

    render(
      <LibrarySyncActivityProvider>
        <UserStateProvider>
          <Probe />
        </UserStateProvider>
      </LibrarySyncActivityProvider>,
    )

    await waitFor(() => expect(screen.getByTestId("favorites")).toHaveTextContent("0"))
    await waitFor(
      () => expect(screen.getByTestId("favorites")).toHaveTextContent("1"),
      { timeout: 2500 },
    )
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(false)
  })
})
