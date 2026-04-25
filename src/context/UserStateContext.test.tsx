import { render, screen, waitFor } from "@testing-library/react"
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
})
