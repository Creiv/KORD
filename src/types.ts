export type TrackMeta = {
  fileName: string;
  /** From kord-trackinfo (or legacy wpp-*): title shown instead of file name */
  title?: string | null;
  size: number | null;
  mtime: number | null;
  releaseDate: string | null;
  genre: string | null;
  /** kord-trackinfo: fino a 3 chiavi mood canoniche (es. energy_boost). */
  moods?: string[] | null;
  /** Legacy: singolo mood; lettura solo migrazione. */
  mood?: string | null;
  durationMs: number | null;
  trackNumber: number | null;
  discNumber: number | null;
  source: string | null;
  url: string | null;
};

export type LibTrack = {
  id: string;
  title: string;
  relPath: string;
  meta?: TrackMeta;
};
export type AlbumMeta = {
  title?: string | null;
  releaseDate: string | null;
  label: string | null;
  country: string | null;
  musicbrainzReleaseId: string | null;
  expectedTrackCount?: number | null;
  expectedTracks?: {
    disc?: number;
    position?: number | null;
    title: string;
  }[] | null;
};

export type LibAlbum = {
  id: string;
  name: string;
  relPath?: string;
  trackCount: number;
  tracks: LibTrack[];
  meta?: AlbumMeta;
  /** From index: kord-albuminfo.json (or legacy) present in folder */
  hasAlbumMeta?: boolean;
};
export type LibArtist = {
  id: string;
  name: string;
  trackCount: number;
  albums: LibAlbum[];
};
export type LibraryResponse = { musicRoot: string; artists: LibArtist[] };

export type EnrichedTrack = LibTrack & {
  artist: string;
  album: string;
  /** Stable from library index (`artist::folder`); for shuffle exclusion. */
  albumId?: string;
  albumMeta?: AlbumMeta;
};

export type UserPlaylist = {
  id: string;
  name: string;
  tracks: { relPath: string; title: string; artist: string; album: string }[];
};

export const THEME_MODES = [
  "midnight",
  "sunset",
  "aurora",
  "ember",
  "forest",
  "neon",
  "ocean",
  "rose",
  "slate",
  "aubergine",
  "tangerine",
  "carmine",
] as const;
export type ThemeMode = (typeof THEME_MODES)[number];
export type VizMode = "bars" | "mirror" | "osc" | "signals" | "embers" | "kord";

export const APP_LOCALES = ["en", "it"] as const;
export type AppLocale = (typeof APP_LOCALES)[number];

export type LibraryBrowseMode = "artists" | "genres" | "moods";
export type LibraryOverviewSortMode = "name" | "plays";
export type ArtistAlbumSortMode = "date" | "name" | "plays";

export type UserSettings = {
  theme: ThemeMode;
  vizMode: VizMode;
  restoreSession: boolean;
  defaultTab: string;
  locale: AppLocale;
  libBrowse: LibraryBrowseMode;
  libOverviewSort: LibraryOverviewSortMode;
  artistAlbumSort: ArtistAlbumSortMode;
};

export type QueueState = {
  tracks: EnrichedTrack[];
  currentIndex: number;
};

export type UserStateV1 = {
  version: 1;
  favorites: string[];
  recent: EnrichedTrack[];
  trackPlayCounts: Record<string, number>;
  playlists: UserPlaylist[];
  queue: QueueState;
  settings: UserSettings;
  /** Album ids (stable `artist::folder`) esclusi dal random intelligente. */
  shuffleExcludedAlbumIds: string[];
  /** relPath tracce escluse singolarmente. */
  shuffleExcludedTrackRelPaths: string[];
  migratedLegacy?: boolean;
};

export type LibraryArtistIndex = {
  id: string;
  name: string;
  albumCount: number;
  trackCount: number;
  releaseDate: string | null;
  coverRelPath: string | null;
  albums: string[];
  /** Album folders without kord-albuminfo (or legacy), excluding loose “Tracks” */
  albumsWithoutFileMetaCount: number;
  /** Tracks missing date or genre in kord-trackinfo (or absent) */
  tracksWithoutFileMetaCount: number;
};

export type LibraryAlbumIndex = {
  id: string;
  artistId: string;
  artist: string;
  name: string;
  title?: string | null;
  relPath: string;
  trackCount: number;
  coverRelPath: string | null;
  releaseDate: string | null;
  label: string | null;
  country: string | null;
  musicbrainzReleaseId: string | null;
  expectedTrackCount: number | null;
  expectedTracks:
    | { disc?: number; position?: number | null; title: string }[]
    | null;
  hasCover: boolean;
  hasAlbumMeta: boolean;
  hasTrackMeta: boolean;
  /** Tracks missing date or genre in file metadata */
  tracksWithoutFileMetaCount: number;
  loose: boolean;
  addedAt: number | null;
  updatedAt: number | null;
  tracks: string[];
};

export type LibraryTrackIndex = EnrichedTrack & {
  albumId: string;
  loose: boolean;
  addedAt: number | null;
  updatedAt: number | null;
};

export type LibraryStats = {
  artistCount: number;
  albumCount: number;
  trackCount: number;
  favoriteCapableCount: number;
  albumsWithoutCover: number;
  albumsWithoutMeta: number;
  tracksWithoutMeta: number;
  looseAlbumCount: number;
};

export type LibraryIndex = {
  musicRoot: string;
  artists: LibraryArtistIndex[];
  albums: LibraryAlbumIndex[];
  tracks: LibraryTrackIndex[];
  stats: LibraryStats;
};

export type DashboardAlert = {
  id: string;
  label: string;
  count: number;
  severity: "ok" | "info" | "warning";
};

export type DashboardPayload = {
  stats: LibraryStats;
  continueListening: EnrichedTrack[];
  recentTracks: LibraryTrackIndex[];
  favoriteTracks: LibraryTrackIndex[];
  recentlyUpdatedAlbums: LibraryAlbumIndex[];
  qualityAlerts: DashboardAlert[];
};

/** Sezioni route principali (URL / shell). */
export type AppSection =
  | "dashboard"
  | "ascolta"
  | "libreria"
  | "studio"
  | "queue"
  | "playlists"
  | "favorites"
  | "recent"
  | "settings"
  | "statistics";

export type AppTab =
  | "library"
  | "favorites"
  | "playlists"
  | "queue"
  | "recent"
  | "tools";
export type RepeatMode = "off" | "all" | "one";
