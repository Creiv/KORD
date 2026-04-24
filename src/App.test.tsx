import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import App from "./App";
import type { DashboardPayload, LibraryIndex, UserStateV1 } from "./types";

const sampleTrack = {
  id: "Artist One/Album One/01 Song.mp3",
  relPath: "Artist One/Album One/01 Song.mp3",
  title: "01 Song",
  artist: "Artist One",
  album: "Album One",
  albumId: "Artist One::Album One",
  loose: false,
  addedAt: 1,
  updatedAt: 1,
  meta: {
    fileName: "01 Song.mp3",
    size: 100,
    mtime: 1,
    releaseDate: "2024-01-01",
    genre: "Synthwave",
    durationMs: 1000,
    trackNumber: 1,
    discNumber: 1,
    source: "test",
    url: null,
  },
  albumMeta: {
    releaseDate: "2024-01-01",
    label: "Label",
    country: "IT",
    musicbrainzReleaseId: null,
  },
};

const libraryIndex: LibraryIndex = {
  musicRoot: "/music",
  artists: [
    {
      id: "Artist One",
      name: "Artist One",
      albumCount: 1,
      trackCount: 1,
      releaseDate: "2024-01-01",
      coverRelPath: null,
      albums: ["Artist One::Album One"],
      albumsWithoutFileMetaCount: 0,
      tracksWithoutFileMetaCount: 0,
    },
  ],
  albums: [
    {
      id: "Artist One::Album One",
      artistId: "Artist One",
      artist: "Artist One",
      name: "Album One",
      relPath: "Artist One/Album One",
      trackCount: 1,
      coverRelPath: null,
      releaseDate: "2024-01-01",
      label: "Label",
      country: "IT",
      musicbrainzReleaseId: null,
      hasCover: false,
      hasAlbumMeta: true,
      hasTrackMeta: true,
      tracksWithoutFileMetaCount: 0,
      loose: false,
      addedAt: 1,
      updatedAt: 1,
      tracks: [sampleTrack.relPath],
    },
  ],
  tracks: [sampleTrack],
  stats: {
    artistCount: 1,
    albumCount: 1,
    trackCount: 1,
    favoriteCapableCount: 1,
    albumsWithoutCover: 1,
    albumsWithoutMeta: 0,
    tracksWithoutMeta: 0,
    looseAlbumCount: 0,
  },
};

const dashboard: DashboardPayload = {
  stats: libraryIndex.stats,
  continueListening: [sampleTrack],
  recentTracks: [sampleTrack],
  favoriteTracks: [sampleTrack],
  recentlyUpdatedAlbums: [libraryIndex.albums[0]],
  qualityAlerts: [
    {
      id: "albums-without-cover",
      label: "Albums without cover art",
      count: 1,
      severity: "warning",
    },
  ],
};

const userState: UserStateV1 = {
  version: 1,
  favorites: [sampleTrack.relPath],
  recent: [sampleTrack],
  trackPlayCounts: {},
  playlists: [],
  queue: { tracks: [sampleTrack], currentIndex: 0 },
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
};

function mockApi() {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/library-index")) {
      return new Response(
        JSON.stringify({ ok: true, data: libraryIndex, error: null })
      );
    }
    if (url.includes("/api/dashboard")) {
      return new Response(
        JSON.stringify({ ok: true, data: dashboard, error: null })
      );
    }
    if (url.includes("/api/user-state")) {
      return new Response(
        JSON.stringify({ ok: true, data: userState, error: null })
      );
    }
    return new Response(JSON.stringify({ ok: true, data: {}, error: null }));
  }) as typeof fetch;
}

describe("App", () => {
  it("renders dashboard and navigates to library", async () => {
    mockApi();
    render(<App />);

    expect(
      await screen.findByText(/Library, listening, and tools/i)
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Library" }));

    const artistInGrid = (await screen.findAllByText("Artist One")).find((el) =>
      el.closest(".artist-card")
    );
    expect(artistInGrid).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Random all" })
    ).toBeInTheDocument();
  });

  it("supports deep link to an album", async () => {
    window.history.pushState(
      {},
      "",
      "/libreria?artist=Artist%20One&album=Album%20One"
    );
    mockApi();

    render(<App />);

    expect(await screen.findByText("Album One")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Play album" })
    ).toBeInTheDocument();
  });
});
