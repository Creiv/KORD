export type TrackMeta = {
  fileName: string;
  /** Da kord-trackinfo (o legacy wpp-): titolo mostrato al posto del nome file */
  title?: string | null;
  size: number | null;
  mtime: number | null;
  releaseDate: string | null;
  genre: string | null;
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
  releaseDate: string | null;
  label: string | null;
  country: string | null;
  musicbrainzReleaseId: string | null;
};

export type LibAlbum = {
  id: string;
  name: string;
  trackCount: number;
  tracks: LibTrack[];
  meta?: AlbumMeta;
  /** da index: kord-albuminfo.json (o legacy) presente in cartella */
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
export type VizMode = "bars" | "mirror" | "osc";

export type UserSettings = {
  theme: ThemeMode;
  vizMode: VizMode;
  restoreSession: boolean;
  defaultTab: string;
};

export type QueueState = {
  tracks: EnrichedTrack[];
  currentIndex: number;
};

export type UserStateV1 = {
  version: 1;
  favorites: string[];
  recent: EnrichedTrack[];
  playlists: UserPlaylist[];
  queue: QueueState;
  settings: UserSettings;
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
  /** Album (cartelle) senza kord-albuminfo (o legacy), escluse “Tracce” */
  albumsWithoutFileMetaCount: number;
  /** Brani senza data o genere in kord-trackinfo (o assenti) */
  tracksWithoutFileMetaCount: number;
};

export type LibraryAlbumIndex = {
  id: string;
  artistId: string;
  artist: string;
  name: string;
  relPath: string;
  trackCount: number;
  coverRelPath: string | null;
  releaseDate: string | null;
  label: string | null;
  country: string | null;
  musicbrainzReleaseId: string | null;
  hasCover: boolean;
  hasAlbumMeta: boolean;
  hasTrackMeta: boolean;
  /** Brani senza data o genere in metadato file */
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

export type AppTab =
  | "library"
  | "favorites"
  | "playlists"
  | "queue"
  | "recent"
  | "tools";
export type RepeatMode = "off" | "all" | "one";
