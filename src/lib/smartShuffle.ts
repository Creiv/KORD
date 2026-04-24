import type { EnrichedTrack } from "../types";

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
