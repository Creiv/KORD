import type { EnrichedTrack } from "../types";
import { parseTrackGenres } from "./genres";
import { parseTrackMoods } from "./trackMoods";

const CARD_QUEUE_CAP = 500;

export function fisherYatesShuffle<T>(items: readonly T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j] as T, a[i] as T];
  }
  return a;
}

function spreadConsecutiveArtists(tracks: EnrichedTrack[]): void {
  const n = tracks.length;
  if (n < 2) return;
  let guard = 0;
  const maxGuard = n * n;
  while (guard < maxGuard) {
    guard += 1;
    let swapped = false;
    for (let i = 0; i < n - 1; i += 1) {
      if (tracks[i].artist !== tracks[i + 1].artist) continue;
      let j = i + 2;
      while (j < n && tracks[j].artist === tracks[i].artist) j += 1;
      if (j >= n) continue;
      [tracks[i + 1], tracks[j]] = [tracks[j], tracks[i + 1]];
      swapped = true;
    }
    if (!swapped) break;
  }
}

export type SmartShuffleOpts = {
  currentRelPath?: string;
  currentArtist?: string;
  recentRelPaths?: ReadonlySet<string>;
};

function moodOverlaps(seed: EnrichedTrack, t: EnrichedTrack): boolean {
  const s = parseTrackMoods(seed.meta);
  if (s.length === 0) return false;
  const set = new Set(s);
  return parseTrackMoods(t.meta).some((m) => set.has(m));
}

function genreOverlaps(seed: EnrichedTrack, t: EnrichedTrack): boolean {
  const sg = parseTrackGenres(seed.meta?.genre).map((g) => g.toLowerCase());
  if (sg.length === 0) return false;
  const tgSet = new Set(
    parseTrackGenres(t.meta?.genre).map((g) => g.toLowerCase())
  );
  return sg.some((g) => tgSet.has(g));
}

function artistMatches(seed: EnrichedTrack, t: EnrichedTrack): boolean {
  return (
    seed.artist.trim().toLowerCase() === t.artist.trim().toLowerCase()
  );
}

export function buildCardPlayQueueFromSeed(
  seed: EnrichedTrack,
  libraryTracks: readonly EnrichedTrack[],
  opts?: { maxLength?: number }
): EnrichedTrack[] {
  const maxLen =
    opts?.maxLength !== undefined ? opts.maxLength : CARD_QUEUE_CAP;
  const cap = Math.max(1, Math.min(maxLen, CARD_QUEUE_CAP));
  const seedCanon =
    libraryTracks.find((t) => t.relPath === seed.relPath) ?? seed;
  const pool = libraryTracks.filter((t) => t.relPath !== seedCanon.relPath);

  const mood: EnrichedTrack[] = [];
  const genre: EnrichedTrack[] = [];
  const artistTier: EnrichedTrack[] = [];
  const rest: EnrichedTrack[] = [];

  for (const t of pool) {
    if (moodOverlaps(seedCanon, t)) {
      mood.push(t);
      continue;
    }
    if (genreOverlaps(seedCanon, t)) {
      genre.push(t);
      continue;
    }
    if (artistMatches(seedCanon, t)) {
      artistTier.push(t);
      continue;
    }
    rest.push(t);
  }

  const tail = [
    ...fisherYatesShuffle(mood),
    ...fisherYatesShuffle(genre),
    ...fisherYatesShuffle(artistTier),
    ...fisherYatesShuffle(rest),
  ];
  const full = [seedCanon, ...tail];
  return full.slice(0, cap);
}

export function buildSmartRandomQueue(
  tracks: readonly EnrichedTrack[],
  opts: SmartShuffleOpts = {}
): EnrichedTrack[] {
  if (!tracks.length) return [];
  let a = fisherYatesShuffle(tracks);

  const recent = opts.recentRelPaths;
  if (recent && recent.size > 0) {
    const fresh = a.filter((t) => !recent.has(t.relPath));
    const stale = a.filter((t) => recent.has(t.relPath));
    if (fresh.length > 0) a = [...fresh, ...stale];
  }

  spreadConsecutiveArtists(a);

  const avoidPath = opts.currentRelPath;
  if (avoidPath && a[0]?.relPath === avoidPath) {
    const k = a.findIndex((t) => t.relPath !== avoidPath);
    if (k > 0) [a[0], a[k]] = [a[k], a[0]];
  }

  const avoidArtist = opts.currentArtist;
  if (avoidArtist && a.length > 1 && a[0].artist === avoidArtist) {
    const k = a.findIndex((t) => t.artist !== avoidArtist);
    if (k > 0) {
      [a[0], a[k]] = [a[k], a[0]];
      spreadConsecutiveArtists(a);
    }
  }

  return a;
}
