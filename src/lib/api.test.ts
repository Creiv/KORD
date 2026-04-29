import { beforeEach, describe, expect, it, vi } from "vitest"

function wrapped(data: unknown) {
  return new Response(JSON.stringify({ ok: true, data, error: null }))
}

const accountsPayload = {
  defaultAccountId: "acc-default",
  accounts: [
    {
      id: "acc-default",
      name: "Default",
    },
    {
      id: "acc-alt",
      name: "Alt",
    },
  ],
  lockedByEnv: false,
}

const userStatePayload = {
  version: 1,
  favorites: ["Artist/Album/01 Track.flac"],
  recent: [],
  trackPlayCounts: {},
  playlists: [],
  queue: { tracks: [], currentIndex: 0 },
  settings: {
    theme: "ember",
    vizMode: "kord",
    restoreSession: true,
    defaultTab: "dashboard",
    locale: "it",
    libBrowse: "artists",
    libOverviewSort: "plays",
    artistAlbumSort: "date",
  },
  shuffleExcludedAlbumIds: ["Artist::Album"],
  shuffleExcludedTrackRelPaths: [],
  migratedLegacy: true,
}

describe("api account bootstrap", () => {
  beforeEach(() => {
    vi.resetModules()
    window.localStorage.clear()
  })

  it("selects the configured default account before loading user-state", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === "/api/accounts") return Promise.resolve(wrapped(accountsPayload))
      if (url === "/api/user-state?accountId=acc-default") {
        return Promise.resolve(wrapped(userStatePayload))
      }
      return Promise.reject(new Error(`Unexpected request: ${url}`))
    })
    globalThis.fetch = fetchMock as typeof fetch

    const { fetchUserState, getSelectedAccountId } = await import("./api")

    const state = await fetchUserState()

    expect(state.favorites).toEqual(["Artist/Album/01 Track.flac"])
    expect(getSelectedAccountId()).toBe("acc-default")
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      "/api/accounts",
      "/api/user-state?accountId=acc-default",
    ])
  })

  it("replaces a stale selected account before loading user-state", async () => {
    window.localStorage.setItem("kord-session-account-id", "removed-account")
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === "/api/accounts") return Promise.resolve(wrapped(accountsPayload))
      if (url === "/api/user-state?accountId=acc-default") {
        return Promise.resolve(wrapped(userStatePayload))
      }
      return Promise.reject(new Error(`Unexpected request: ${url}`))
    })
    globalThis.fetch = fetchMock as typeof fetch

    const { fetchUserState, getSelectedAccountId } = await import("./api")

    await fetchUserState()

    expect(getSelectedAccountId()).toBe("acc-default")
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      "/api/accounts",
      "/api/user-state?accountId=acc-default",
    ])
  })
})
