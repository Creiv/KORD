import type { UserSettings, UserStatePatch, UserStateV1, PlectrBestScore } from "../types";

export const FLUSH_DELAY_DEFAULT_MS = 400;
export const FLUSH_DELAY_QUEUE_MS = 3000;

export function compactUserStatePatch(patch: UserStatePatch): UserStatePatch {
  const out: UserStatePatch = {};
  for (const [key, value] of Object.entries(patch) as [
    keyof UserStatePatch,
    unknown,
  ][]) {
    if (value !== undefined) {
      (out as Record<string, unknown>)[key] = value;
    }
  }
  return out;
}

export function mergeUserStatePatches(
  a: UserStatePatch,
  b: UserStatePatch
): UserStatePatch {
  const next: UserStatePatch = { ...a, ...b };
  if (a.settings || b.settings) {
    next.settings = {
      ...(a.settings || {}),
      ...(b.settings || {}),
    };
  }
  if (a.trackMoods || b.trackMoods) {
    next.trackMoods = {
      ...(a.trackMoods || {}),
      ...(b.trackMoods || {}),
    };
  }
  if (a.plectrBests || b.plectrBests) {
    next.plectrBests = {
      ...(a.plectrBests || {}),
      ...(b.plectrBests || {}),
    };
  }
  return compactUserStatePatch(next);
}

/** Ritardo flush in base al contenuto della coda pending (solo queue → 3s). */
export function flushDelayMsForPending(pending: UserStatePatch): number {
  const compact = compactUserStatePatch(pending);
  const keys = Object.keys(compact);
  if (keys.length === 1 && compact.queue !== undefined) {
    return FLUSH_DELAY_QUEUE_MS;
  }
  return FLUSH_DELAY_DEFAULT_MS;
}

/**
 * Dopo PATCH: conserva in RAM i campi non inclusi nel patch (evita risposta server stale).
 * Stesso schema JSON su disco — solo strategia merge lato client.
 */
export function mergeSavedUserState(
  prev: UserStateV1,
  saved: UserStateV1,
  savedPatch: UserStatePatch,
  normalize: (s: UserStateV1) => UserStateV1
): UserStateV1 {
  const compact = compactUserStatePatch(savedPatch);
  const keys = Object.keys(compact) as (keyof UserStatePatch)[];
  if (keys.length === 0) return saved;
  const next: UserStateV1 = { ...saved };
  const keepPrevUnlessPatched = (key: keyof UserStatePatch) => {
    if (!(key in compact)) {
      (next as unknown as Record<string, unknown>)[key] =
        prev[key as keyof UserStateV1] as unknown;
    }
  };
  keepPrevUnlessPatched("favorites");
  keepPrevUnlessPatched("recent");
  keepPrevUnlessPatched("trackPlayCounts");
  keepPrevUnlessPatched("playlists");
  keepPrevUnlessPatched("queue");
  keepPrevUnlessPatched("shuffleExcludedAlbumIds");
  keepPrevUnlessPatched("shuffleExcludedTrackRelPaths");
  keepPrevUnlessPatched("trackMoods");
  keepPrevUnlessPatched("plectrBests");
  keepPrevUnlessPatched("migratedLegacy");
  keepPrevUnlessPatched("trackMoodsMigrated");
  keepPrevUnlessPatched("playlistsMigrated");
  if (!("settings" in compact)) next.settings = prev.settings;
  return normalize(next);
}

export function applyUserStatePatchFields(
  base: UserStateV1,
  patch: UserStatePatch,
  normalizeSettings: (raw: Partial<UserSettings>) => UserSettings,
  normalize: (s: UserStateV1) => UserStateV1
): UserStateV1 {
  const compact = compactUserStatePatch(patch);
  if (Object.keys(compact).length === 0) return base;
  const next: UserStateV1 = { ...base };
  for (const [key, value] of Object.entries(compact) as [
    keyof UserStatePatch,
    unknown,
  ][]) {
    if (value === undefined) continue;
    if (key === "settings") {
      next.settings = normalizeSettings({
        ...next.settings,
        ...(value as Partial<UserSettings>),
      });
      continue;
    }
    if (key === "trackMoods") {
      next.trackMoods = {
        ...(next.trackMoods || {}),
        ...(value as Record<string, string[]>),
      };
      continue;
    }
    if (key === "plectrBests") {
      next.plectrBests = {
        ...(next.plectrBests || {}),
        ...(value as Record<string, PlectrBestScore>),
      };
      continue;
    }
    (next as unknown as Record<string, unknown>)[key] = value;
  }
  return normalize(next);
}
