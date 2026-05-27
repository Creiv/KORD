import { countPlectrTracksPlayed } from "../game/lib/plectrStorage";
import { parseTrackGenres } from "./genres";
import type { LibraryIndex, UserStateV1 } from "../types";

const STREAK_STORAGE_KEY = "rekord-achievements-streak";

/** Soglie XP originali (invariate): ogni fascia vale 2 livelli numerici. */
export type AchievementXpTier = {
  xpMin: number;
  xpMax: number | null;
  title: string;
};

export const ACHIEVEMENT_XP_TIERS: AchievementXpTier[] = [
  { title: "KICKER", xpMin: 0, xpMax: 99 },
  { title: "KRAFTER", xpMin: 100, xpMax: 299 },
  { title: "KURATORE", xpMin: 300, xpMax: 599 },
  { title: "KEEPER OF RE-KORD", xpMin: 600, xpMax: 999 },
  { title: "KONDUCTOR", xpMin: 1000, xpMax: 1499 },
  { title: "KOMPONER", xpMin: 1500, xpMax: 2199 },
  { title: "KREATOR", xpMin: 2200, xpMax: 2999 },
  { title: "KONTROLLER", xpMin: 3000, xpMax: 3999 },
  { title: "RE-KORDMASTER", xpMin: 4000, xpMax: 5499 },
  { title: "KING OF RE-KORD", xpMin: 5500, xpMax: null },
];

/** @deprecated Usa {@link ACHIEVEMENT_XP_TIERS}. */
export const ACHIEVEMENT_RANKS = ACHIEVEMENT_XP_TIERS;

export const ACHIEVEMENT_TITLES = ACHIEVEMENT_XP_TIERS.map((t) => t.title);

export type AchievementRank = {
  level: number;
  title: string;
  xpMin: number;
  xpMax: number;
};

function tierSpan(tier: AchievementXpTier, prevSpan: number): number {
  if (tier.xpMax != null) return tier.xpMax - tier.xpMin + 1;
  return prevSpan;
}

/** XP minimo per livelli 1–20 (ogni fascia originale divisa in due). */
function buildNumericLevelXpMins(): number[] {
  const mins: number[] = [];
  let prevSpan = 100;
  for (const tier of ACHIEVEMENT_XP_TIERS) {
    const span = tierSpan(tier, prevSpan);
    prevSpan = span;
    const half = Math.floor(span / 2);
    mins.push(tier.xpMin, tier.xpMin + half);
  }
  return mins;
}

const NUMERIC_LEVEL_XP_MINS = buildNumericLevelXpMins();

/** XP per salire oltre il livello 20 (metà dell'ultima fascia con tetto). */
const POST_TITLE_LEVEL_SPAN = Math.floor(
  (ACHIEVEMENT_XP_TIERS[8].xpMax! - ACHIEVEMENT_XP_TIERS[8].xpMin + 1) / 2
);

/** >1 rende più difficile salire di livello (soglie XP livello, non badge). */
export const LEVEL_XP_SCALE = 1.25;

function scaledLevelXp(xp: number): number {
  return Math.ceil(xp * LEVEL_XP_SCALE);
}

function scaledPostTitleLevelSpan(): number {
  return Math.ceil(POST_TITLE_LEVEL_SPAN * LEVEL_XP_SCALE);
}

export function titleForNumericLevel(level: number): string {
  const idx = Math.min(
    ACHIEVEMENT_TITLES.length - 1,
    Math.floor((level - 1) / 3)
  );
  return ACHIEVEMENT_TITLES[idx];
}

export function numericLevelForXp(xp: number): number {
  const kingMin = scaledLevelXp(NUMERIC_LEVEL_XP_MINS[18]);
  const postKingMin = scaledLevelXp(NUMERIC_LEVEL_XP_MINS[19]);
  const postSpan = scaledPostTitleLevelSpan();
  if (xp >= postKingMin) {
    return 20 + Math.floor((xp - postKingMin) / postSpan);
  }
  if (xp >= kingMin) return 19;
  for (let i = NUMERIC_LEVEL_XP_MINS.length - 2; i >= 0; i--) {
    if (xp >= scaledLevelXp(NUMERIC_LEVEL_XP_MINS[i])) return i + 1;
  }
  return 1;
}

export function xpMinForNumericLevel(level: number): number {
  if (level <= 20) {
    return scaledLevelXp(NUMERIC_LEVEL_XP_MINS[level - 1]);
  }
  const postKingMin = scaledLevelXp(NUMERIC_LEVEL_XP_MINS[19]);
  return postKingMin + (level - 20) * scaledPostTitleLevelSpan();
}

export function xpMaxForNumericLevel(level: number): number {
  return xpMinForNumericLevel(level + 1) - 1;
}

export type AchievementIconKind =
  | "play"
  | "heart"
  | "list"
  | "artist"
  | "genre"
  | "shuffle"
  | "library"
  | "flame"
  | "streak"
  | "plectr";

export type AchievementDefinition = {
  id: string;
  titleKey: string;
  descKey: string;
  xpBonus: number;
  icon: AchievementIconKind;
  check: (signals: AchievementSignals) => boolean;
};

function libraryPctPlayed(signals: AchievementSignals, pct: number): boolean {
  if (signals.libraryTrackCount <= 0) return false;
  const need = Math.max(1, Math.ceil(signals.libraryTrackCount * pct));
  return signals.tracksWithPlays >= need;
}

export const ACHIEVEMENT_DEFINITIONS: AchievementDefinition[] = [
  {
    id: "first_play",
    titleKey: "achievements.badge.firstPlayTitle",
    descKey: "achievements.badge.firstPlayDesc",
    xpBonus: 10,
    icon: "play",
    check: (s) => s.totalPlays >= 1,
  },
  {
    id: "plays_10",
    titleKey: "achievements.badge.plays10Title",
    descKey: "achievements.badge.plays10Desc",
    xpBonus: 15,
    icon: "play",
    check: (s) => s.totalPlays >= 10,
  },
  {
    id: "plays_25",
    titleKey: "achievements.badge.plays25Title",
    descKey: "achievements.badge.plays25Desc",
    xpBonus: 20,
    icon: "play",
    check: (s) => s.totalPlays >= 25,
  },
  {
    id: "plays_50",
    titleKey: "achievements.badge.plays50Title",
    descKey: "achievements.badge.plays50Desc",
    xpBonus: 30,
    icon: "play",
    check: (s) => s.totalPlays >= 50,
  },
  {
    id: "plays_100",
    titleKey: "achievements.badge.plays100Title",
    descKey: "achievements.badge.plays100Desc",
    xpBonus: 50,
    icon: "play",
    check: (s) => s.totalPlays >= 100,
  },
  {
    id: "plays_250",
    titleKey: "achievements.badge.plays250Title",
    descKey: "achievements.badge.plays250Desc",
    xpBonus: 75,
    icon: "play",
    check: (s) => s.totalPlays >= 250,
  },
  {
    id: "plays_500",
    titleKey: "achievements.badge.plays500Title",
    descKey: "achievements.badge.plays500Desc",
    xpBonus: 100,
    icon: "flame",
    check: (s) => s.totalPlays >= 500,
  },
  {
    id: "plays_1000",
    titleKey: "achievements.badge.plays1000Title",
    descKey: "achievements.badge.plays1000Desc",
    xpBonus: 150,
    icon: "flame",
    check: (s) => s.totalPlays >= 1000,
  },
  {
    id: "plays_2500",
    titleKey: "achievements.badge.plays2500Title",
    descKey: "achievements.badge.plays2500Desc",
    xpBonus: 200,
    icon: "flame",
    check: (s) => s.totalPlays >= 2500,
  },
  {
    id: "plays_5000",
    titleKey: "achievements.badge.plays5000Title",
    descKey: "achievements.badge.plays5000Desc",
    xpBonus: 300,
    icon: "flame",
    check: (s) => s.totalPlays >= 5000,
  },
  {
    id: "first_favorite",
    titleKey: "achievements.badge.firstFavoriteTitle",
    descKey: "achievements.badge.firstFavoriteDesc",
    xpBonus: 15,
    icon: "heart",
    check: (s) => s.favoritesCount >= 1,
  },
  {
    id: "favorites_5",
    titleKey: "achievements.badge.favorites5Title",
    descKey: "achievements.badge.favorites5Desc",
    xpBonus: 25,
    icon: "heart",
    check: (s) => s.favoritesCount >= 5,
  },
  {
    id: "favorites_10",
    titleKey: "achievements.badge.favorites10Title",
    descKey: "achievements.badge.favorites10Desc",
    xpBonus: 40,
    icon: "heart",
    check: (s) => s.favoritesCount >= 10,
  },
  {
    id: "favorites_25",
    titleKey: "achievements.badge.favorites25Title",
    descKey: "achievements.badge.favorites25Desc",
    xpBonus: 60,
    icon: "heart",
    check: (s) => s.favoritesCount >= 25,
  },
  {
    id: "favorites_50",
    titleKey: "achievements.badge.favorites50Title",
    descKey: "achievements.badge.favorites50Desc",
    xpBonus: 90,
    icon: "heart",
    check: (s) => s.favoritesCount >= 50,
  },
  {
    id: "favorites_100",
    titleKey: "achievements.badge.favorites100Title",
    descKey: "achievements.badge.favorites100Desc",
    xpBonus: 120,
    icon: "heart",
    check: (s) => s.favoritesCount >= 100,
  },
  {
    id: "playlist_1",
    titleKey: "achievements.badge.playlistTitle",
    descKey: "achievements.badge.playlistDesc",
    xpBonus: 30,
    icon: "list",
    check: (s) => s.playlistsCount >= 1,
  },
  {
    id: "playlists_3",
    titleKey: "achievements.badge.playlists3Title",
    descKey: "achievements.badge.playlists3Desc",
    xpBonus: 50,
    icon: "list",
    check: (s) => s.playlistsCount >= 3,
  },
  {
    id: "playlists_5",
    titleKey: "achievements.badge.playlists5Title",
    descKey: "achievements.badge.playlists5Desc",
    xpBonus: 70,
    icon: "list",
    check: (s) => s.playlistsCount >= 5,
  },
  {
    id: "playlists_10",
    titleKey: "achievements.badge.playlists10Title",
    descKey: "achievements.badge.playlists10Desc",
    xpBonus: 100,
    icon: "list",
    check: (s) => s.playlistsCount >= 10,
  },
  {
    id: "playlists_20",
    titleKey: "achievements.badge.playlists20Title",
    descKey: "achievements.badge.playlists20Desc",
    xpBonus: 140,
    icon: "list",
    check: (s) => s.playlistsCount >= 20,
  },
  {
    id: "artists_3",
    titleKey: "achievements.badge.artists3Title",
    descKey: "achievements.badge.artists3Desc",
    xpBonus: 20,
    icon: "artist",
    check: (s) => s.artistsWithPlays >= 3,
  },
  {
    id: "artists_5",
    titleKey: "achievements.badge.artists5Title",
    descKey: "achievements.badge.artists5Desc",
    xpBonus: 35,
    icon: "artist",
    check: (s) => s.artistsWithPlays >= 5,
  },
  {
    id: "artists_10",
    titleKey: "achievements.badge.artists10Title",
    descKey: "achievements.badge.artists10Desc",
    xpBonus: 55,
    icon: "artist",
    check: (s) => s.artistsWithPlays >= 10,
  },
  {
    id: "artists_20",
    titleKey: "achievements.badge.artists20Title",
    descKey: "achievements.badge.artists20Desc",
    xpBonus: 90,
    icon: "artist",
    check: (s) => s.artistsWithPlays >= 20,
  },
  {
    id: "artists_50",
    titleKey: "achievements.badge.artists50Title",
    descKey: "achievements.badge.artists50Desc",
    xpBonus: 130,
    icon: "artist",
    check: (s) => s.artistsWithPlays >= 50,
  },
  {
    id: "artists_100",
    titleKey: "achievements.badge.artists100Title",
    descKey: "achievements.badge.artists100Desc",
    xpBonus: 180,
    icon: "artist",
    check: (s) => s.artistsWithPlays >= 100,
  },
  {
    id: "genres_3",
    titleKey: "achievements.badge.genres3Title",
    descKey: "achievements.badge.genres3Desc",
    xpBonus: 25,
    icon: "genre",
    check: (s) => s.genresWithPlays >= 3,
  },
  {
    id: "genres_5",
    titleKey: "achievements.badge.genres5Title",
    descKey: "achievements.badge.genres5Desc",
    xpBonus: 45,
    icon: "genre",
    check: (s) => s.genresWithPlays >= 5,
  },
  {
    id: "genres_10",
    titleKey: "achievements.badge.genres10Title",
    descKey: "achievements.badge.genres10Desc",
    xpBonus: 70,
    icon: "genre",
    check: (s) => s.genresWithPlays >= 10,
  },
  {
    id: "genres_15",
    titleKey: "achievements.badge.genres15Title",
    descKey: "achievements.badge.genres15Desc",
    xpBonus: 95,
    icon: "genre",
    check: (s) => s.genresWithPlays >= 15,
  },
  {
    id: "genres_20",
    titleKey: "achievements.badge.genres20Title",
    descKey: "achievements.badge.genres20Desc",
    xpBonus: 120,
    icon: "genre",
    check: (s) => s.genresWithPlays >= 20,
  },
  {
    id: "tracks_10",
    titleKey: "achievements.badge.tracks10Title",
    descKey: "achievements.badge.tracks10Desc",
    xpBonus: 20,
    icon: "library",
    check: (s) => s.tracksWithPlays >= 10,
  },
  {
    id: "tracks_50",
    titleKey: "achievements.badge.tracks50Title",
    descKey: "achievements.badge.tracks50Desc",
    xpBonus: 50,
    icon: "library",
    check: (s) => s.tracksWithPlays >= 50,
  },
  {
    id: "tracks_100",
    titleKey: "achievements.badge.tracks100Title",
    descKey: "achievements.badge.tracks100Desc",
    xpBonus: 80,
    icon: "library",
    check: (s) => s.tracksWithPlays >= 100,
  },
  {
    id: "tracks_500",
    titleKey: "achievements.badge.tracks500Title",
    descKey: "achievements.badge.tracks500Desc",
    xpBonus: 150,
    icon: "library",
    check: (s) => s.tracksWithPlays >= 500,
  },
  {
    id: "shuffle_1",
    titleKey: "achievements.badge.shuffle1Title",
    descKey: "achievements.badge.shuffle1Desc",
    xpBonus: 15,
    icon: "shuffle",
    check: (s) => s.shuffleBlocks >= 1,
  },
  {
    id: "shuffle_3",
    titleKey: "achievements.badge.shuffleTitle",
    descKey: "achievements.badge.shuffleDesc",
    xpBonus: 25,
    icon: "shuffle",
    check: (s) => s.shuffleBlocks >= 3,
  },
  {
    id: "shuffle_5",
    titleKey: "achievements.badge.shuffle5Title",
    descKey: "achievements.badge.shuffle5Desc",
    xpBonus: 40,
    icon: "shuffle",
    check: (s) => s.shuffleBlocks >= 5,
  },
  {
    id: "shuffle_10",
    titleKey: "achievements.badge.shuffle10Title",
    descKey: "achievements.badge.shuffle10Desc",
    xpBonus: 60,
    icon: "shuffle",
    check: (s) => s.shuffleBlocks >= 10,
  },
  {
    id: "shuffle_25",
    titleKey: "achievements.badge.shuffle25Title",
    descKey: "achievements.badge.shuffle25Desc",
    xpBonus: 90,
    icon: "shuffle",
    check: (s) => s.shuffleBlocks >= 25,
  },
  {
    id: "artist_plays_10",
    titleKey: "achievements.badge.artistPlays10Title",
    descKey: "achievements.badge.artistPlays10Desc",
    xpBonus: 35,
    icon: "artist",
    check: (s) => s.topArtistPlays >= 10,
  },
  {
    id: "artist_plays_25",
    titleKey: "achievements.badge.deepTitle",
    descKey: "achievements.badge.deepDesc",
    xpBonus: 80,
    icon: "flame",
    check: (s) => s.topArtistPlays >= 25,
  },
  {
    id: "artist_plays_50",
    titleKey: "achievements.badge.artistPlays50Title",
    descKey: "achievements.badge.artistPlays50Desc",
    xpBonus: 120,
    icon: "flame",
    check: (s) => s.topArtistPlays >= 50,
  },
  {
    id: "artist_plays_100",
    titleKey: "achievements.badge.artistPlays100Title",
    descKey: "achievements.badge.artistPlays100Desc",
    xpBonus: 180,
    icon: "flame",
    check: (s) => s.topArtistPlays >= 100,
  },
  {
    id: "library_5pct",
    titleKey: "achievements.badge.library5Title",
    descKey: "achievements.badge.library5Desc",
    xpBonus: 40,
    icon: "library",
    check: (s) => libraryPctPlayed(s, 0.05),
  },
  {
    id: "library_10pct",
    titleKey: "achievements.badge.explorerTitle",
    descKey: "achievements.badge.explorerDesc",
    xpBonus: 100,
    icon: "library",
    check: (s) => libraryPctPlayed(s, 0.1),
  },
  {
    id: "library_25pct",
    titleKey: "achievements.badge.library25Title",
    descKey: "achievements.badge.library25Desc",
    xpBonus: 160,
    icon: "library",
    check: (s) => libraryPctPlayed(s, 0.25),
  },
  {
    id: "library_50pct",
    titleKey: "achievements.badge.library50Title",
    descKey: "achievements.badge.library50Desc",
    xpBonus: 250,
    icon: "library",
    check: (s) => libraryPctPlayed(s, 0.5),
  },
  {
    id: "streak_3",
    titleKey: "achievements.badge.streak3Title",
    descKey: "achievements.badge.streak3Desc",
    xpBonus: 25,
    icon: "streak",
    check: (s) => s.streak >= 3,
  },
  {
    id: "streak_7",
    titleKey: "achievements.badge.streak7Title",
    descKey: "achievements.badge.streak7Desc",
    xpBonus: 50,
    icon: "streak",
    check: (s) => s.streak >= 7,
  },
  {
    id: "streak_14",
    titleKey: "achievements.badge.streak14Title",
    descKey: "achievements.badge.streak14Desc",
    xpBonus: 90,
    icon: "streak",
    check: (s) => s.streak >= 14,
  },
  {
    id: "streak_30",
    titleKey: "achievements.badge.streak30Title",
    descKey: "achievements.badge.streak30Desc",
    xpBonus: 150,
    icon: "streak",
    check: (s) => s.streak >= 30,
  },
  {
    id: "plays_7500",
    titleKey: "achievements.badge.plays7500Title",
    descKey: "achievements.badge.plays7500Desc",
    xpBonus: 400,
    icon: "flame",
    check: (s) => s.totalPlays >= 7500,
  },
  {
    id: "favorites_200",
    titleKey: "achievements.badge.favorites200Title",
    descKey: "achievements.badge.favorites200Desc",
    xpBonus: 200,
    icon: "heart",
    check: (s) => s.favoritesCount >= 200,
  },
  {
    id: "albums_10",
    titleKey: "achievements.badge.albums10Title",
    descKey: "achievements.badge.albums10Desc",
    xpBonus: 55,
    icon: "library",
    check: (s) => s.albumsWithPlays >= 10,
  },
  {
    id: "albums_50",
    titleKey: "achievements.badge.albums50Title",
    descKey: "achievements.badge.albums50Desc",
    xpBonus: 110,
    icon: "library",
    check: (s) => s.albumsWithPlays >= 50,
  },
  {
    id: "playlist_tracks_30",
    titleKey: "achievements.badge.playlistTracks30Title",
    descKey: "achievements.badge.playlistTracks30Desc",
    xpBonus: 85,
    icon: "list",
    check: (s) => s.playlistTrackCount >= 30,
  },
  {
    id: "track_plays_20",
    titleKey: "achievements.badge.trackPlays20Title",
    descKey: "achievements.badge.trackPlays20Desc",
    xpBonus: 70,
    icon: "play",
    check: (s) => s.topTrackPlays >= 20,
  },
  {
    id: "library_75pct",
    titleKey: "achievements.badge.library75Title",
    descKey: "achievements.badge.library75Desc",
    xpBonus: 320,
    icon: "library",
    check: (s) => libraryPctPlayed(s, 0.75),
  },
  {
    id: "plectr_tracks_10",
    titleKey: "achievements.badge.plectrTracks10Title",
    descKey: "achievements.badge.plectrTracks10Desc",
    xpBonus: 30,
    icon: "plectr",
    check: (s) => s.plectrTracksPlayed >= 10,
  },
  {
    id: "plectr_tracks_50",
    titleKey: "achievements.badge.plectrTracks50Title",
    descKey: "achievements.badge.plectrTracks50Desc",
    xpBonus: 55,
    icon: "plectr",
    check: (s) => s.plectrTracksPlayed >= 50,
  },
  {
    id: "plectr_tracks_100",
    titleKey: "achievements.badge.plectrTracks100Title",
    descKey: "achievements.badge.plectrTracks100Desc",
    xpBonus: 85,
    icon: "plectr",
    check: (s) => s.plectrTracksPlayed >= 100,
  },
  {
    id: "plectr_tracks_250",
    titleKey: "achievements.badge.plectrTracks250Title",
    descKey: "achievements.badge.plectrTracks250Desc",
    xpBonus: 130,
    icon: "plectr",
    check: (s) => s.plectrTracksPlayed >= 250,
  },
  {
    id: "plectr_tracks_500",
    titleKey: "achievements.badge.plectrTracks500Title",
    descKey: "achievements.badge.plectrTracks500Desc",
    xpBonus: 200,
    icon: "plectr",
    check: (s) => s.plectrTracksPlayed >= 500,
  },
];

export type AchievementSignals = {
  totalPlays: number;
  favoritesCount: number;
  playlistsCount: number;
  artistsWithPlays: number;
  genresWithPlays: number;
  tracksWithPlays: number;
  shuffleBlocks: number;
  libraryTrackCount: number;
  topArtistPlays: number;
  topTrackPlays: number;
  albumsWithPlays: number;
  playlistTrackCount: number;
  streak: number;
  /** Brani distinti con record Plectr salvato (libreria + localStorage). */
  plectrTracksPlayed: number;
};

export function sumTrackPlayCounts(counts: Record<string, number>): number {
  let n = 0;
  for (const v of Object.values(counts)) n += v;
  return n;
}

export function computeAchievementSignals(
  state: Pick<
    UserStateV1,
    | "trackPlayCounts"
    | "favorites"
    | "playlists"
    | "shuffleExcludedAlbumIds"
    | "shuffleExcludedTrackRelPaths"
    | "plectrBests"
  >,
  index: LibraryIndex | null,
  streak = 0
): AchievementSignals {
  const counts = state.trackPlayCounts || {};
  const totalPlays = sumTrackPlayCounts(counts);
  const favoritesCount = state.favorites?.length ?? 0;
  const playlistsCount = state.playlists?.length ?? 0;
  const shuffleBlocks =
    (state.shuffleExcludedAlbumIds?.length ?? 0) +
    (state.shuffleExcludedTrackRelPaths?.length ?? 0);

  const artistPlayMap = new Map<string, number>();
  const genrePlayMap = new Map<string, number>();
  const albumsWithPlaysSet = new Set<string>();
  let tracksWithPlays = 0;
  let topTrackPlays = 0;

  if (index) {
    for (const tr of index.tracks) {
      const n = counts[tr.relPath] ?? 0;
      if (n <= 0) continue;
      tracksWithPlays += 1;
      if (n > topTrackPlays) topTrackPlays = n;
      albumsWithPlaysSet.add(tr.albumId);
      artistPlayMap.set(tr.artist, (artistPlayMap.get(tr.artist) ?? 0) + n);
      for (const raw of parseTrackGenres(tr.meta?.genre)) {
        const key = raw.toLowerCase();
        genrePlayMap.set(key, (genrePlayMap.get(key) ?? 0) + n);
      }
    }
  } else {
    tracksWithPlays = Object.values(counts).filter((n) => n > 0).length;
    for (const n of Object.values(counts)) {
      if (n > topTrackPlays) topTrackPlays = n;
    }
  }

  let topArtistPlays = 0;
  for (const n of artistPlayMap.values()) {
    if (n > topArtistPlays) topArtistPlays = n;
  }

  let playlistTrackCount = 0;
  for (const pl of state.playlists ?? []) {
    playlistTrackCount += pl.tracks?.length ?? 0;
  }

  return {
    totalPlays,
    favoritesCount,
    playlistsCount,
    artistsWithPlays: artistPlayMap.size,
    genresWithPlays: genrePlayMap.size,
    tracksWithPlays,
    shuffleBlocks,
    libraryTrackCount: index?.stats.trackCount ?? 0,
    topArtistPlays,
    topTrackPlays,
    albumsWithPlays: albumsWithPlaysSet.size,
    playlistTrackCount,
    streak,
    plectrTracksPlayed: countPlectrTracksPlayed(state.plectrBests),
  };
}

export function computeBaseXp(signals: AchievementSignals): number {
  return (
    signals.totalPlays +
    signals.favoritesCount * 5 +
    signals.playlistsCount * 10 +
    signals.artistsWithPlays * 3 +
    signals.shuffleBlocks * 2
  );
}

export function computeAchievementXpBonus(signals: AchievementSignals): number {
  let bonus = 0;
  for (const ach of ACHIEVEMENT_DEFINITIONS) {
    if (ach.check(signals)) bonus += ach.xpBonus;
  }
  return bonus;
}

export function computeTotalXp(signals: AchievementSignals): number {
  return computeBaseXp(signals) + computeAchievementXpBonus(signals);
}

export function levelForXp(xp: number): AchievementRank {
  const level = numericLevelForXp(xp);
  const xpMin = xpMinForNumericLevel(level);
  const xpMax = xpMaxForNumericLevel(level);
  return {
    level,
    title: titleForNumericLevel(level),
    xpMin,
    xpMax,
  };
}

export function xpProgressInLevel(
  xp: number,
  tier: AchievementRank
): { current: number; span: number; pct: number } {
  const span = Math.max(1, tier.xpMax - tier.xpMin + 1);
  const current = Math.min(span, Math.max(0, xp - tier.xpMin));
  const pct = Math.min(100, Math.max(0, Math.round((current / span) * 100)));
  return { current, span, pct };
}

export type StreakState = {
  count: number;
  lastDate: string;
};

function localDateKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function yesterdayKey(d = new Date()): string {
  const prev = new Date(d);
  prev.setDate(prev.getDate() - 1);
  return localDateKey(prev);
}

const LEGACY_STREAK_STORAGE_KEY = "rekord-resonance-streak";
const LEGACY_KORD_STREAK_KEY = "kord-achievements-streak";
const LEGACY_KORD_RESONANCE_KEY = "kord-resonance-streak";

export function readStreakState(): StreakState {
  try {
    const raw =
      localStorage.getItem(STREAK_STORAGE_KEY) ??
      localStorage.getItem(LEGACY_STREAK_STORAGE_KEY) ??
      localStorage.getItem(LEGACY_KORD_STREAK_KEY) ??
      localStorage.getItem(LEGACY_KORD_RESONANCE_KEY);
    if (!raw) return { count: 0, lastDate: "" };
    const parsed = JSON.parse(raw) as Partial<StreakState>;
    const count =
      typeof parsed.count === "number" && parsed.count >= 0
        ? Math.floor(parsed.count)
        : 0;
    const lastDate =
      typeof parsed.lastDate === "string" ? parsed.lastDate : "";
    return { count, lastDate };
  } catch {
    return { count: 0, lastDate: "" };
  }
}

export function writeStreakState(state: StreakState): void {
  try {
    localStorage.setItem(STREAK_STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* quota / private mode */
  }
}

export function touchListeningActivity(at = new Date()): StreakState {
  const today = localDateKey(at);
  const prev = readStreakState();
  if (prev.lastDate === today) return prev;
  const next: StreakState = {
    lastDate: today,
    count: prev.lastDate === yesterdayKey(at) ? prev.count + 1 : 1,
  };
  writeStreakState(next);
  return next;
}

export function effectiveStreakCount(
  stored: StreakState,
  at = new Date()
): number {
  const today = localDateKey(at);
  if (stored.lastDate === today) return stored.count;
  if (stored.lastDate === yesterdayKey(at)) return stored.count;
  return 0;
}

export type AchievementsSnapshot = {
  signals: AchievementSignals;
  baseXp: number;
  achievementXp: number;
  totalXp: number;
  level: AchievementRank;
  progress: ReturnType<typeof xpProgressInLevel>;
  achievements: { def: AchievementDefinition; unlocked: boolean }[];
  streak: number;
};

export function buildAchievementsSnapshot(
  state: Pick<
    UserStateV1,
    | "trackPlayCounts"
    | "favorites"
    | "playlists"
    | "shuffleExcludedAlbumIds"
    | "shuffleExcludedTrackRelPaths"
    | "plectrBests"
  >,
  index: LibraryIndex | null,
  streakState = readStreakState()
): AchievementsSnapshot {
  const streak = effectiveStreakCount(streakState);
  const signals = computeAchievementSignals(state, index, streak);
  const baseXp = computeBaseXp(signals);
  const achievementXp = computeAchievementXpBonus(signals);
  const totalXp = baseXp + achievementXp;
  const level = levelForXp(totalXp);
  return {
    signals,
    baseXp,
    achievementXp,
    totalXp,
    level,
    progress: xpProgressInLevel(totalXp, level),
    achievements: ACHIEVEMENT_DEFINITIONS.map((def) => ({
      def,
      unlocked: def.check(signals),
    })),
    streak,
  };
}

export function isAchievementUnlocked(
  id: string,
  signals: AchievementSignals
): boolean {
  const def = ACHIEVEMENT_DEFINITIONS.find((a) => a.id === id);
  return def ? def.check(signals) : false;
}
