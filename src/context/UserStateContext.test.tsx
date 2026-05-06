import { render, screen, waitFor } from "@testing-library/react"
import { useEffect } from "react"
import { vi } from "vitest"
import { UserStateProvider, useUserState } from "./UserStateContext"

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

describe("UserStateProvider", () => {
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
      <UserStateProvider>
        <Probe />
      </UserStateProvider>,
    )

    await waitFor(() => expect(screen.getByTestId("favorites")).toHaveTextContent("1"))
    expect(screen.getByTestId("recent")).toHaveTextContent("Legacy Song")
    expect(fetchMock).toHaveBeenCalled()
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
      <UserStateProvider>
        <SyncRaceProbe />
      </UserStateProvider>,
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
      <UserStateProvider>
        <Probe />
      </UserStateProvider>,
    )

    await waitFor(() => expect(screen.getByTestId("favorites")).toHaveTextContent("0"))
    await waitFor(
      () => expect(screen.getByTestId("favorites")).toHaveTextContent("1"),
      { timeout: 2500 },
    )
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(false)
  })
})
