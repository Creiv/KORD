/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  fetchUserState,
  patchUserState,
} from "../lib/api";
import { readLegacyLocalShuffleMigrated, clearLegacyLocalShuffle } from "../lib/legacyShuffleLocal";
import { fmtDate } from "../lib/metaFormat";
import { randomUUID } from "../lib/randomUUID";
import { normalizeShuffleAlbumKeysWithIndex } from "../lib/shuffleExclusionKeys";
import { DEFAULT_CUSTOM_THEME } from "../lib/themeCatalog";
import {
  APP_LOCALES,
  THEME_MODES,
  type AppLocale,
  type CustomThemeSettings,
  type EnrichedTrack,
  type LibraryIndex,
  type QueueState,
  type ThemeMode,
  type UserPlaylist,
  type UserSettings,
  type UserStatePatch,
  type UserStateV1,
} from "../types";

const LEGACY_KEYS = {
  playlists: "kord-playlists",
  favorites: "kord-favorites",
  recent: "kord-recent",
  vizMode: "kord-viz",
};
const WPP_STORAGE = {
  playlists: "wpp-playlists",
  favorites: "wpp-favorites",
  recent: "wpp-recent",
  vizMode: "wpp-viz",
};

function defaultSettings(): UserSettings {
  return {
    theme: "midnight",
    customTheme: DEFAULT_CUSTOM_THEME,
    vizMode: "hmb",
    restoreSession: true,
    defaultTab: "dashboard",
    locale: "en",
    libBrowse: "artists",
    libOverviewSort: "name",
    artistAlbumSort: "date",
  };
}

function normalizeHexColor(raw: unknown, fallback: string): string {
  if (typeof raw !== "string") return fallback;
  const s = raw.trim();
  if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(s)) {
    return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`.toLowerCase();
  }
  return fallback;
}

function normalizeCustomTheme(raw: Partial<CustomThemeSettings> | undefined): CustomThemeSettings {
  return {
    bg: normalizeHexColor(raw?.bg, DEFAULT_CUSTOM_THEME.bg),
    section: normalizeHexColor(raw?.section, DEFAULT_CUSTOM_THEME.section),
    accent: normalizeHexColor(raw?.accent, DEFAULT_CUSTOM_THEME.accent),
    accent2: normalizeHexColor(raw?.accent2, DEFAULT_CUSTOM_THEME.accent2),
  };
}

function normalizeSettings(raw: Partial<UserSettings>): UserSettings {
  const locale: AppLocale = (APP_LOCALES as readonly string[]).includes(
    raw.locale as string
  )
    ? (raw.locale as AppLocale)
    : "en";
  const libBrowse: UserSettings["libBrowse"] =
    raw.libBrowse === "genres"
      ? "genres"
      : raw.libBrowse === "moods"
        ? "moods"
        : "artists";
  const libOverviewSort: UserSettings["libOverviewSort"] =
    raw.libOverviewSort === "plays" ? "plays" : "name";
  const rawAlbumSort = raw.artistAlbumSort;
  const artistAlbumSort: UserSettings["artistAlbumSort"] =
    rawAlbumSort === "name" || rawAlbumSort === "plays" || rawAlbumSort === "date"
      ? rawAlbumSort
      : "date";
  return {
    theme:
      raw.theme != null &&
      (THEME_MODES as readonly string[]).includes(raw.theme as string)
        ? (raw.theme as ThemeMode)
        : "midnight",
    customTheme: normalizeCustomTheme(raw.customTheme),
    vizMode: (() => {
      const legacy = raw.vizMode as string | undefined;
      let m: typeof raw.vizMode = raw.vizMode;
      if (legacy === "soft") m = "signals";
      else if (legacy === "horizon") m = "embers";
      else if (legacy === "prism") m = "bars";
      return m === "mirror" ||
        m === "osc" ||
        m === "oscSoft" ||
        m === "hmb" ||
        m === "bars" ||
        m === "signals" ||
        m === "embers" ||
        m === "karaoke"
        ? m
        : "hmb";
    })(),
    restoreSession: raw.restoreSession !== false,
    defaultTab:
      typeof raw.defaultTab === "string" && raw.defaultTab.trim()
        ? raw.defaultTab
        : "dashboard",
    locale,
    libBrowse,
    libOverviewSort,
    artistAlbumSort,
  };
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = normalizeHexColor(hex, "#000000").slice(1);
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function rgbaFromHex(hex: string, alpha: number): string {
  const c = hexToRgb(hex);
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${alpha})`;
}

function mixHex(a: string, b: string, t: number): string {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  const ch = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${ch(ca.r * (1 - t) + cb.r * t)}${ch(ca.g * (1 - t) + cb.g * t)}${ch(ca.b * (1 - t) + cb.b * t)}`;
}

const CUSTOM_THEME_VARS = [
  "--bg",
  "--surface",
  "--surface2",
  "--surface3",
  "--border",
  "--border-strong",
  "--text",
  "--muted",
  "--muted-strong",
  "--accent",
  "--accent2",
  "--focus-ring",
  "--page-glow-1",
  "--page-glow-2",
  "--page-lg-1",
  "--page-lg-2",
  "--page-lg-3",
  "--shell-glow-1",
  "--shell-lg-1",
  "--shell-lg-2",
  "--topbar-bg",
  "--surface-elev-a",
  "--surface-elev-b",
  "--hero-rg-1",
  "--hero-rg-2",
  "--hero-lg-1",
  "--hero-lg-2",
  "--art-empty-1",
  "--art-empty-2",
  "--badge-1",
  "--badge-2",
  "--album-fb-1",
  "--album-fb-2",
  "--listen-viz-bg",
  "--glass-1",
  "--glass-2",
  "--nav-active-cool",
  "--segmented-1",
  "--segmented-2",
  "--chip-on",
  "--codebox-bg",
  "--textarea-bg",
  "--text-on-accent",
  "--player-art-fb",
  "--dirlist-hover-bg",
  "--meta-strip-bg",
  "--ghost-input-bg",
  "--shadow-elev-1",
  "--shadow-elev-2",
  "--warning",
  "--danger",
] as const;

function clearCustomThemeVars(root: HTMLElement) {
  for (const name of CUSTOM_THEME_VARS) root.style.removeProperty(name);
  root.style.removeProperty("color-scheme");
}

/** Luminanza relativa WCAG 2.1 (0–1). */
function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const R = lin(r);
  const G = lin(g);
  const B = lin(b);
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

/** Se la sezione è chiara, testo e superfici seguono palette chiara. */
function isLightSection(sectionHex: string): boolean {
  return relativeLuminance(sectionHex) > 0.45;
}

function textOnAccent(accentHex: string): string {
  return relativeLuminance(accentHex) > 0.55
    ? mixHex(accentHex, "#0a0a0a", 0.9)
    : mixHex(accentHex, "#ffffff", 0.94);
}

function applyCustomThemeVars(root: HTMLElement, theme: CustomThemeSettings) {
  const bg = theme.bg;
  const section = theme.section;
  const accent = theme.accent;
  const accent2 = theme.accent2;
  const light = isLightSection(section);
  root.style.colorScheme = light ? "light" : "dark";

  if (light) {
    const ink = mixHex(section, "#0f172a", 0.78);
    const inkMuted = mixHex(section, "#475569", 0.52);
    const inkStrong = mixHex(section, "#0f172a", 0.68);
    root.style.setProperty("--bg", bg);
    root.style.setProperty("--surface", rgbaFromHex(mixHex(bg, section, 0.52), 0.9));
    root.style.setProperty("--surface2", rgbaFromHex(section, 0.93));
    root.style.setProperty("--surface3", rgbaFromHex(mixHex(section, accent2, 0.12), 0.96));
    root.style.setProperty("--border", rgbaFromHex(mixHex(accent2, "#1e293b", 0.38), 0.18));
    root.style.setProperty("--border-strong", rgbaFromHex(mixHex(accent2, "#0f172a", 0.45), 0.3));
    root.style.setProperty("--text", ink);
    root.style.setProperty("--muted", inkMuted);
    root.style.setProperty("--muted-strong", inkStrong);
    root.style.setProperty("--accent", accent);
    root.style.setProperty("--accent2", accent2);
    root.style.setProperty("--warning", "#b45309");
    root.style.setProperty("--danger", "#c53030");
    root.style.setProperty(
      "--focus-ring",
      `color-mix(in srgb, ${accent2} 52%, #0f172a 32%)`,
    );
    root.style.setProperty("--shadow-elev-1", "0 4px 24px rgba(15, 23, 42, 0.08)");
    root.style.setProperty("--shadow-elev-2", "0 22px 48px rgba(15, 23, 42, 0.12)");
    root.style.setProperty("--page-glow-1", rgbaFromHex(accent, 0.11));
    root.style.setProperty("--page-glow-2", rgbaFromHex(accent2, 0.1));
    root.style.setProperty("--page-lg-1", mixHex(bg, "#ffffff", 0.94));
    root.style.setProperty("--page-lg-2", mixHex(bg, "#ffffff", 0.98));
    root.style.setProperty("--page-lg-3", mixHex(mixHex(bg, section, 0.32), "#ffffff", 0.9));
    root.style.setProperty("--shell-glow-1", rgbaFromHex(accent, 0.06));
    root.style.setProperty("--shell-lg-1", rgbaFromHex(mixHex(bg, "#ffffff", 0.06), 0.97));
    root.style.setProperty("--shell-lg-2", mixHex(bg, "#ffffff", 0.02));
    root.style.setProperty("--topbar-bg", rgbaFromHex(mixHex(bg, "#ffffff", 0.14), 0.88));
    root.style.setProperty("--surface-elev-a", rgbaFromHex(mixHex(section, bg, 0.14), 0.94));
    root.style.setProperty("--surface-elev-b", rgbaFromHex(mixHex(bg, section, 0.2), 0.97));
    root.style.setProperty("--hero-rg-1", rgbaFromHex(accent, 0.12));
    root.style.setProperty("--hero-rg-2", rgbaFromHex(accent2, 0.1));
    root.style.setProperty("--hero-lg-1", rgbaFromHex(mixHex(section, bg, 0.1), 0.94));
    root.style.setProperty("--hero-lg-2", rgbaFromHex(mixHex(bg, section, 0.16), 0.97));
    root.style.setProperty("--art-empty-1", rgbaFromHex(accent, 0.16));
    root.style.setProperty("--art-empty-2", rgbaFromHex(accent2, 0.12));
    root.style.setProperty("--badge-1", rgbaFromHex(accent, 0.2));
    root.style.setProperty("--badge-2", rgbaFromHex(accent2, 0.14));
    root.style.setProperty("--album-fb-1", rgbaFromHex(accent, 0.22));
    root.style.setProperty("--album-fb-2", rgbaFromHex(accent2, 0.15));
    root.style.setProperty("--listen-viz-bg", rgbaFromHex(mixHex(bg, "#e2e8f0", 0.5), 0.96));
    root.style.setProperty("--glass-1", rgbaFromHex(mixHex(section, "#ffffff", 0.22), 0.88));
    root.style.setProperty("--glass-2", rgbaFromHex(mixHex(bg, section, 0.22), 0.92));
    root.style.setProperty("--nav-active-cool", rgbaFromHex(accent2, 0.12));
    root.style.setProperty("--segmented-1", rgbaFromHex(accent, 0.12));
    root.style.setProperty("--segmented-2", rgbaFromHex(accent2, 0.09));
    root.style.setProperty("--chip-on", rgbaFromHex(accent, 0.12));
    root.style.setProperty("--codebox-bg", rgbaFromHex(mixHex(bg, "#f8fafc", 0.55), 0.97));
    root.style.setProperty("--textarea-bg", rgbaFromHex(mixHex(bg, "#ffffff", 0.62), 0.96));
    root.style.setProperty("--text-on-accent", textOnAccent(accent));
    root.style.setProperty("--player-art-fb", rgbaFromHex(accent2, 0.1));
    root.style.setProperty("--dirlist-hover-bg", rgbaFromHex(accent2, 0.08));
    root.style.setProperty("--meta-strip-bg", "rgba(15, 23, 42, 0.04)");
    root.style.setProperty("--ghost-input-bg", "rgba(15, 23, 42, 0.045)");
    return;
  }

  root.style.setProperty("--bg", bg);
  root.style.setProperty("--surface", rgbaFromHex(mixHex(bg, section, 0.58), 0.88));
  root.style.setProperty("--surface2", rgbaFromHex(section, 0.94));
  root.style.setProperty("--surface3", rgbaFromHex(mixHex(section, accent2, 0.16), 0.96));
  root.style.setProperty("--border", rgbaFromHex(mixHex(accent2, "#ffffff", 0.2), 0.2));
  root.style.setProperty("--border-strong", rgbaFromHex(mixHex(accent2, "#ffffff", 0.18), 0.36));
  root.style.setProperty("--accent", accent);
  root.style.setProperty("--accent2", accent2);
  root.style.setProperty("--focus-ring", `color-mix(in srgb, ${accent2} 72%, white 18%)`);
  root.style.setProperty("--page-glow-1", rgbaFromHex(accent, 0.14));
  root.style.setProperty("--page-glow-2", rgbaFromHex(accent2, 0.12));
  root.style.setProperty("--page-lg-1", mixHex(bg, "#000000", 0.26));
  root.style.setProperty("--page-lg-2", bg);
  root.style.setProperty("--page-lg-3", mixHex(bg, section, 0.28));
  root.style.setProperty("--shell-glow-1", rgbaFromHex(accent, 0.07));
  root.style.setProperty("--shell-lg-1", rgbaFromHex(mixHex(bg, "#000000", 0.18), 0.98));
  root.style.setProperty("--shell-lg-2", bg);
  root.style.setProperty("--topbar-bg", rgbaFromHex(mixHex(bg, "#000000", 0.2), 0.86));
  root.style.setProperty("--surface-elev-a", rgbaFromHex(mixHex(section, bg, 0.18), 0.94));
  root.style.setProperty("--surface-elev-b", rgbaFromHex(mixHex(bg, section, 0.22), 0.97));
  root.style.setProperty("--hero-rg-1", rgbaFromHex(accent, 0.14));
  root.style.setProperty("--hero-rg-2", rgbaFromHex(accent2, 0.12));
  root.style.setProperty("--hero-lg-1", rgbaFromHex(mixHex(section, bg, 0.12), 0.94));
  root.style.setProperty("--hero-lg-2", rgbaFromHex(mixHex(bg, section, 0.18), 0.97));
  root.style.setProperty("--art-empty-1", rgbaFromHex(accent, 0.22));
  root.style.setProperty("--art-empty-2", rgbaFromHex(accent2, 0.16));
  root.style.setProperty("--badge-1", rgbaFromHex(accent, 0.24));
  root.style.setProperty("--badge-2", rgbaFromHex(accent2, 0.18));
  root.style.setProperty("--album-fb-1", rgbaFromHex(accent, 0.26));
  root.style.setProperty("--album-fb-2", rgbaFromHex(accent2, 0.18));
  root.style.setProperty("--listen-viz-bg", rgbaFromHex(mixHex(bg, "#000000", 0.34), 0.94));
  root.style.setProperty("--glass-1", rgbaFromHex(mixHex(section, bg, 0.24), 0.9));
  root.style.setProperty("--glass-2", rgbaFromHex(mixHex(bg, section, 0.2), 0.94));
  root.style.setProperty("--nav-active-cool", rgbaFromHex(accent2, 0.09));
  root.style.setProperty("--segmented-1", rgbaFromHex(accent, 0.11));
  root.style.setProperty("--segmented-2", rgbaFromHex(accent2, 0.08));
  root.style.setProperty("--chip-on", rgbaFromHex(accent, 0.11));
  root.style.setProperty("--codebox-bg", rgbaFromHex(mixHex(bg, "#000000", 0.35), 0.95));
  root.style.setProperty("--textarea-bg", rgbaFromHex(mixHex(bg, "#000000", 0.25), 0.95));
  root.style.setProperty("--player-art-fb", rgbaFromHex(accent2, 0.08));
  root.style.setProperty("--dirlist-hover-bg", rgbaFromHex(accent2, 0.07));
  root.style.setProperty("--meta-strip-bg", rgbaFromHex(accent2, 0.06));
  root.style.setProperty("--ghost-input-bg", rgbaFromHex("#ffffff", 0.045));
  root.style.removeProperty("--text");
  root.style.removeProperty("--muted");
  root.style.removeProperty("--muted-strong");
  root.style.removeProperty("--text-on-accent");
  root.style.removeProperty("--warning");
  root.style.removeProperty("--danger");
  root.style.removeProperty("--shadow-elev-1");
  root.style.removeProperty("--shadow-elev-2");
}

function normalizeUserState(s: UserStateV1): UserStateV1 {
  const revRaw = s.revision;
  const revision =
    typeof revRaw === "number" &&
    Number.isFinite(revRaw) &&
    revRaw >= 1
      ? Math.floor(revRaw)
      : 1;
  const rawCounts = s.trackPlayCounts || {};
  const trackPlayCounts = Object.fromEntries(
    Object.entries(rawCounts).filter(
      ([relPath, count]) =>
        Boolean(relPath) && Number.isFinite(count) && Number(count) > 0
    )
  ) as Record<string, number>;
  return {
    ...s,
    revision,
    trackPlayCounts,
    settings: normalizeSettings(s.settings),
    shuffleExcludedAlbumIds: uniqStrings(s.shuffleExcludedAlbumIds || []),
    shuffleExcludedTrackRelPaths: uniqStrings(
      s.shuffleExcludedTrackRelPaths || []
    ),
  };
}

function defaultUserState(): UserStateV1 {
  return {
    version: 1,
    revision: 1,
    favorites: [],
    recent: [],
    trackPlayCounts: {},
    playlists: [],
    queue: { tracks: [], currentIndex: 0 },
    settings: defaultSettings(),
    shuffleExcludedAlbumIds: [],
    shuffleExcludedTrackRelPaths: [],
    migratedLegacy: false,
  };
}

function uniqStrings(list: string[]) {
  return [...new Set(list.filter(Boolean))];
}

function compactUserStatePatch(patch: UserStatePatch): UserStatePatch {
  const out: UserStatePatch = {};
  for (const [key, value] of Object.entries(patch) as [keyof UserStatePatch, unknown][]) {
    if (value !== undefined) {
      (out as Record<string, unknown>)[key] = value;
    }
  }
  return out;
}

function mergeUserStatePatches(a: UserStatePatch, b: UserStatePatch): UserStatePatch {
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
  return compactUserStatePatch(next);
}

function isLibraryRequiredError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /Library folder not configured|LIBRARY_REQUIRED|Set it in server Settings/i.test(msg);
}

function applyUserStatePatchLocal(
  base: UserStateV1,
  patch: UserStatePatch
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
    (next as unknown as Record<string, unknown>)[key] = value;
  }
  return normalizeUserState(next);
}

function userStateToPatch(state: UserStateV1, omitPlaylists = false): UserStatePatch {
  return compactUserStatePatch({
    favorites: state.favorites,
    recent: state.recent,
    trackPlayCounts: state.trackPlayCounts,
    ...(omitPlaylists ? {} : { playlists: state.playlists }),
    queue: state.queue,
    settings: state.settings,
    shuffleExcludedAlbumIds: state.shuffleExcludedAlbumIds,
    shuffleExcludedTrackRelPaths: state.shuffleExcludedTrackRelPaths,
    trackMoods: state.trackMoods,
    migratedLegacy: state.migratedLegacy,
    trackMoodsMigrated: state.trackMoodsMigrated,
  });
}

function readJsonKordOrWpp<T>(key: string, wppKey: string, fallback: T): T {
  try {
    const rawK = localStorage.getItem(key);
    if (rawK != null) return JSON.parse(rawK) as T;
    const rawW = localStorage.getItem(wppKey);
    if (rawW != null) return JSON.parse(rawW) as T;
  } catch {
    return fallback;
  }
  return fallback;
}

function legacyImport(): Partial<UserStateV1> {
  const playlists = readJsonKordOrWpp<UserPlaylist[]>(
    LEGACY_KEYS.playlists,
    WPP_STORAGE.playlists,
    [],
  );
  const favorites = readJsonKordOrWpp<string[]>(
    LEGACY_KEYS.favorites,
    WPP_STORAGE.favorites,
    [],
  );
  const recent = readJsonKordOrWpp<EnrichedTrack[]>(
    LEGACY_KEYS.recent,
    WPP_STORAGE.recent,
    [],
  );
  const vizMode =
    localStorage.getItem(LEGACY_KEYS.vizMode) ??
    localStorage.getItem(WPP_STORAGE.vizMode);
  return {
    playlists,
    favorites,
    recent,
    settings:
      vizMode === "bars" ||
      vizMode === "mirror" ||
      vizMode === "osc" ||
      vizMode === "oscSoft" ||
      vizMode === "hmb" ||
      vizMode === "signals" ||
      vizMode === "embers" ||
      vizMode === "karaoke" ||
      vizMode === "kord" ||
      vizMode === "horizon" ||
      vizMode === "soft" ||
      vizMode === "prism"
        ? {
            ...defaultSettings(),
            vizMode:
              vizMode === "soft"
                ? "signals"
                : vizMode === "horizon"
                  ? "embers"
                  : vizMode === "prism"
                    ? "bars"
                    : vizMode === "kord"
                      ? "hmb"
                      : vizMode,
          }
        : undefined,
  };
}

function mergeLegacy(remote: UserStateV1): UserStateV1 {
  if (remote.migratedLegacy) return remote;
  const legacy = legacyImport();
  return {
    ...remote,
    favorites: uniqStrings([
      ...(remote.favorites || []),
      ...((legacy.favorites as string[]) || []),
    ]),
    recent: [...(legacy.recent || []), ...(remote.recent || [])]
      .filter(
        (track, index, arr) =>
          arr.findIndex((item) => item.relPath === track.relPath) === index
      )
      .slice(0, 30),
    playlists:
      remote.playlists.length > 0
        ? remote.playlists
        : (legacy.playlists as UserPlaylist[]) || [],
    settings: normalizeSettings({
      ...remote.settings,
      ...(legacy.settings || {}),
      defaultTab: remote.settings?.defaultTab || "dashboard",
    }),
    migratedLegacy: true,
  };
}

type UserStateContextValue = {
  state: UserStateV1;
  ready: boolean;
  saving: boolean;
  error: string | null;
  favorites: Set<string>;
  selectedPlaylist: string | null;
  setSelectedPlaylist: (id: string | null) => void;
  toggleFavorite: (relPath: string) => void;
  isFavorite: (relPath: string) => boolean;
  pushRecent: (track: EnrichedTrack) => void;
  getTrackPlayCount: (relPath: string) => number;
  incrementTrackPlayCount: (relPath: string) => void;
  setQueueSnapshot: (queue: QueueState) => void;
  updateSettings: (patch: Partial<UserSettings>) => void;
  createPlaylist: (name: string) => string;
  renamePlaylist: (id: string, name: string) => void;
  deletePlaylist: (id: string) => void;
  addTrackToPlaylist: (id: string, track: EnrichedTrack) => void;
  removeTrackFromPlaylist: (id: string, relPath: string) => void;
  saveQueueAsPlaylist: (name: string, queue: EnrichedTrack[]) => string;
  rehydrateTrackListsFromLibrary: (index: LibraryIndex) => void;
  toggleShuffleExcludedAlbum: (albumId: string) => void;
  toggleShuffleExcludedTrack: (relPath: string) => void;
  setShuffleTracksExcludedBulk: (relPaths: readonly string[], exclude: boolean) => void;
  rehydrateShuffleExclusionsFromIndex: (index: LibraryIndex) => void;
  stripUserStateForRelPaths: (deletedRelPaths: string[]) => void;
  syncUserStateFromServer: () => Promise<void>;
};

const UserStateContext = createContext<UserStateContextValue | null>(null);

export function UserStateProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<UserStateV1>(defaultUserState);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedPlaylist, setSelectedPlaylist] = useState<string | null>(null);
  const dirtyRef = useRef(false);
  const playlistDirtyRef = useRef(false);
  const hydratedRef = useRef(false);
  const saveSeqRef = useRef(0);
  const pendingPatchRef = useRef<UserStatePatch>({});
  const inFlightPatchRef = useRef<UserStatePatch>({});
  const flushTimerRef = useRef<number | null>(null);
  const flushPendingPatchRef = useRef<(() => void) | null>(null);
  const flushingRef = useRef(false);

  useEffect(() => {
    let active = true;
    let retryTimer: number | null = null;
    let retryAttempts = 0;

    const clearRetry = () => {
      if (retryTimer != null) {
        window.clearTimeout(retryTimer);
        retryTimer = null;
      }
    };

    const applyRemote = (remote: UserStateV1) => {
      if (!active) return;
      clearRetry();

      if (!remote.migratedLegacy) playlistDirtyRef.current = true;
      let merged = normalizeUserState(mergeLegacy(remote));

      const fromLocal = readLegacyLocalShuffleMigrated();
      if (fromLocal.albumKeys.length > 0 || fromLocal.trackPaths.length > 0) {
        merged = normalizeUserState({
          ...merged,
          shuffleExcludedAlbumIds: uniqStrings([
            ...merged.shuffleExcludedAlbumIds,
            ...fromLocal.albumKeys,
          ]),
          shuffleExcludedTrackRelPaths: uniqStrings([
            ...merged.shuffleExcludedTrackRelPaths,
            ...fromLocal.trackPaths,
          ]),
        });
        clearLegacyLocalShuffle();
      }

      const needsInitialPersist =
        fromLocal.albumKeys.length > 0 ||
        fromLocal.trackPaths.length > 0 ||
        !remote.migratedLegacy;
      if (needsInitialPersist) {
        pendingPatchRef.current = mergeUserStatePatches(
          pendingPatchRef.current,
          userStateToPatch(merged)
        );
      }

      const localUnsaved = mergeUserStatePatches(
        inFlightPatchRef.current,
        pendingPatchRef.current
      );
      const hasLocalUnsaved = Object.keys(localUnsaved).length > 0;
      dirtyRef.current = needsInitialPersist || hasLocalUnsaved;

      setState((prev) => {
        if (!hasLocalUnsaved) return merged;
        const preserved = applyUserStatePatchLocal(merged, localUnsaved);
        return {
          ...preserved,
          revision: Math.max(
            Number(merged.revision || 1),
            Number(prev.revision || 1)
          ),
        };
      });
      setError(null);
      setReady(true);
      hydratedRef.current = true;
    };

    const scheduleRetry = () => {
      if (!active) return;
      if (retryAttempts >= 6) return;
      clearRetry();
      const delay = Math.min(2500, 600 * Math.pow(1.6, retryAttempts));
      retryAttempts += 1;
      retryTimer = window.setTimeout(() => {
        retryTimer = null;
        fetchUserState()
          .then((remote) => applyRemote(remote))
          .catch((err: unknown) => {
            if (!active) return;
            if (isLibraryRequiredError(err)) return;
            scheduleRetry();
          });
      }, delay);
    };

    fetchUserState()
      .then((remote) => applyRemote(remote))
      .catch((err: unknown) => {
        if (!active) return;
        const fallback = mergeLegacy(defaultUserState());
        playlistDirtyRef.current = true;
        setState(fallback);
        setError(isLibraryRequiredError(err) ? null : String(err));
        setReady(true);
        hydratedRef.current = true;

        // IMPORTANT: non accodare patch col fallback (vuoto). Un errore transient
        // durante il reload potrebbe altrimenti sovrascrivere lo user-state remoto.
        dirtyRef.current = false;
        pendingPatchRef.current = {};
        inFlightPatchRef.current = {};

        if (!isLibraryRequiredError(err)) scheduleRetry();
      });
    return () => {
      active = false;
      clearRetry();
    };
  }, []);

  const flushPendingPatch = useCallback(() => {
    if (!ready || !hydratedRef.current || flushingRef.current) return;
    const patch = compactUserStatePatch(pendingPatchRef.current);
    if (Object.keys(patch).length === 0) {
      dirtyRef.current = false;
      return;
    }
    pendingPatchRef.current = {};
    inFlightPatchRef.current = patch;
    flushingRef.current = true;
    const seq = ++saveSeqRef.current;
    setSaving(true);
    patchUserState(patch)
      .then((saved) => {
        if (seq !== saveSeqRef.current) return;
        const normalized = normalizeUserState(saved);
        const hasNewerPending = Object.keys(pendingPatchRef.current).length > 0;
        setState((prev) =>
          hasNewerPending
            ? {
                ...prev,
                revision: normalized.revision,
              }
            : normalized
        );
        setError(null);
        dirtyRef.current = hasNewerPending;
        if (patch.playlists) playlistDirtyRef.current = false;
        inFlightPatchRef.current = {};
      })
      .catch((err: unknown) => {
        if (seq !== saveSeqRef.current) return;
        pendingPatchRef.current = mergeUserStatePatches(
          patch,
          pendingPatchRef.current
        );
        inFlightPatchRef.current = {};
        dirtyRef.current = true;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (seq === saveSeqRef.current) setSaving(false);
        flushingRef.current = false;
        if (Object.keys(pendingPatchRef.current).length > 0) {
          if (flushTimerRef.current != null) window.clearTimeout(flushTimerRef.current);
          flushTimerRef.current = window.setTimeout(() => {
            flushTimerRef.current = null;
            flushPendingPatchRef.current?.();
          }, 240);
        }
      });
  }, [ready]);
  useEffect(() => {
    flushPendingPatchRef.current = flushPendingPatch;
  }, [flushPendingPatch]);

  useEffect(() => {
    if (!ready || !hydratedRef.current || !dirtyRef.current) return;
    if (flushTimerRef.current != null) window.clearTimeout(flushTimerRef.current);
    flushTimerRef.current = window.setTimeout(() => {
      flushTimerRef.current = null;
      flushPendingPatch();
    }, 240);
    return () => {
      if (flushTimerRef.current != null) {
        window.clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
    };
  }, [flushPendingPatch, ready, state]);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = state.settings.theme;
    if (state.settings.theme === "custom") {
      applyCustomThemeVars(root, state.settings.customTheme ?? DEFAULT_CUSTOM_THEME);
    } else {
      clearCustomThemeVars(root);
    }
  }, [state.settings.customTheme, state.settings.theme]);

  useEffect(() => {
    document.documentElement.lang =
      state.settings.locale === "it" ? "it" : "en";
  }, [state.settings.locale]);

  const syncUserStateFromServer = useCallback(() => {
    return Promise.resolve()
      .then(() => fetchUserState())
      .then((remote) => {
        const mergedRemote = normalizeUserState(mergeLegacy(remote));
        const localUnsaved = mergeUserStatePatches(
          inFlightPatchRef.current,
          pendingPatchRef.current
        );
        const hasLocalUnsaved = Object.keys(localUnsaved).length > 0;
        setState((prev) => {
          if (
            !hasLocalUnsaved &&
            Number(mergedRemote.revision || 1) < Number(prev.revision || 1)
          ) {
            return prev;
          }
          if (!hasLocalUnsaved) return mergedRemote;
          const preserved = applyUserStatePatchLocal(mergedRemote, localUnsaved);
          return {
            ...preserved,
            revision: Math.max(
              Number(mergedRemote.revision || 1),
              Number(prev.revision || 1)
            ),
          };
        });
        dirtyRef.current = hasLocalUnsaved;
        playlistDirtyRef.current = hasLocalUnsaved && Boolean(localUnsaved.playlists);
        setError(null);
      })
      .catch((err: unknown) => {
        setError(String(err));
      });
  }, []);

  const commit = useCallback(
    (
      updater: (prev: UserStateV1) => UserStateV1,
      options?: {
        immediate?: boolean;
        patch?: (next: UserStateV1, prev: UserStateV1) => UserStatePatch;
      }
    ) => {
      dirtyRef.current = true;
      setState((prev) => {
        const next = updater(prev);
        if (next.playlists !== prev.playlists) playlistDirtyRef.current = true;
        const omitPlaylists = !playlistDirtyRef.current;
        const patch =
          options?.patch?.(next, prev) ?? userStateToPatch(next, omitPlaylists);
        pendingPatchRef.current = mergeUserStatePatches(
          pendingPatchRef.current,
          patch
        );
        if (options?.immediate) {
          window.setTimeout(() => flushPendingPatch(), 0);
        }
        return next;
      });
    },
    [flushPendingPatch]
  );

  const toggleFavorite = useCallback(
    (relPath: string) => {
      commit((prev) => {
        const on = prev.favorites.includes(relPath);
        return {
          ...prev,
          favorites: on
            ? prev.favorites.filter((item) => item !== relPath)
            : [...prev.favorites, relPath],
        };
      }, { patch: (next) => ({ favorites: next.favorites }) });
    },
    [commit]
  );

  const pushRecent = useCallback(
    (track: EnrichedTrack) => {
      commit((prev) => ({
        ...prev,
        recent: [
          track,
          ...prev.recent.filter((item) => item.relPath !== track.relPath),
        ].slice(0, 30),
      }), { patch: (next) => ({ recent: next.recent }) });
    },
    [commit]
  );

  const rehydrateTrackListsFromLibrary = useCallback(
    (libraryIndex: LibraryIndex) => {
      const byPath = new Map(
        libraryIndex.tracks.map((t) => [t.relPath, t])
      );
      commit((prev) => ({
        ...prev,
        recent: prev.recent.map((t) => byPath.get(t.relPath) ?? t),
        playlists: prev.playlists.map((pl) => ({
          ...pl,
          tracks: pl.tracks.map((tr) => {
            const full = byPath.get(tr.relPath);
            if (!full) return tr;
            return {
              relPath: full.relPath,
              title: full.title,
              artist: full.artist,
              album: full.album,
            };
          }),
        })),
      }), { patch: (next) => ({ recent: next.recent, playlists: next.playlists }) });
    },
    [commit]
  );

  const rehydrateShuffleExclusionsFromIndex = useCallback(
    (libraryIndex: LibraryIndex) => {
      commit(
        (prev) => {
          const next = normalizeShuffleAlbumKeysWithIndex(
            libraryIndex,
            prev.shuffleExcludedAlbumIds
          );
          const s = prev.shuffleExcludedAlbumIds;
          const a = [...s].sort().join("\0");
          const b = [...next].sort().join("\0");
          if (a === b) return prev;
          return { ...prev, shuffleExcludedAlbumIds: next };
        },
        { immediate: true, patch: (next) => ({ shuffleExcludedAlbumIds: next.shuffleExcludedAlbumIds }) }
      );
    },
    [commit]
  );

  const toggleShuffleExcludedAlbum = useCallback(
    (albumId: string) => {
      commit(
        (prev) => {
          const list = prev.shuffleExcludedAlbumIds || [];
          const on = list.includes(albumId);
          return {
            ...prev,
            shuffleExcludedAlbumIds: on
              ? list.filter((x) => x !== albumId)
              : [...list, albumId],
          };
        },
        { immediate: true, patch: (next) => ({ shuffleExcludedAlbumIds: next.shuffleExcludedAlbumIds }) }
      );
    },
    [commit]
  );

  const toggleShuffleExcludedTrack = useCallback(
    (relPath: string) => {
      if (!relPath) return;
      commit(
        (prev) => {
          const list = prev.shuffleExcludedTrackRelPaths || [];
          const on = list.includes(relPath);
          return {
            ...prev,
            shuffleExcludedTrackRelPaths: on
              ? list.filter((x) => x !== relPath)
              : [...list, relPath],
          };
        },
        { immediate: true, patch: (next) => ({ shuffleExcludedTrackRelPaths: next.shuffleExcludedTrackRelPaths }) }
      );
    },
    [commit]
  );

  const setShuffleTracksExcludedBulk = useCallback(
    (relPaths: readonly string[], exclude: boolean) => {
      const paths = relPaths.filter(Boolean);
      if (!paths.length) return;
      commit(
        (prev) => {
          const set = new Set(prev.shuffleExcludedTrackRelPaths || []);
          for (const p of paths) {
            if (exclude) set.add(p);
            else set.delete(p);
          }
          return { ...prev, shuffleExcludedTrackRelPaths: [...set] };
        },
        { immediate: true, patch: (next) => ({ shuffleExcludedTrackRelPaths: next.shuffleExcludedTrackRelPaths }) }
      );
    },
    [commit]
  );

  const stripUserStateForRelPaths = useCallback(
    (deletedRelPaths: string[]) => {
      const deleted = new Set(deletedRelPaths.filter(Boolean));
      if (!deleted.size) return;
      commit(
        (prev) => {
          const nextQueueTracks = prev.queue.tracks.filter(
            (tr) => !deleted.has(tr.relPath)
          );
          const oldCurrent = prev.queue.tracks[prev.queue.currentIndex];
          const nextCurrent = oldCurrent
            ? nextQueueTracks.findIndex((tr) => tr.relPath === oldCurrent.relPath)
            : -1;
          return {
            ...prev,
            favorites: prev.favorites.filter((rel) => !deleted.has(rel)),
            shuffleExcludedTrackRelPaths:
              prev.shuffleExcludedTrackRelPaths.filter((rel) => !deleted.has(rel)),
            trackPlayCounts: Object.fromEntries(
              Object.entries(prev.trackPlayCounts || {}).filter(
                ([rel]) => !deleted.has(rel)
              )
            ) as UserStateV1["trackPlayCounts"],
            recent: prev.recent.filter((tr) => !deleted.has(tr.relPath)),
            playlists: prev.playlists.map((pl) => ({
              ...pl,
              tracks: pl.tracks.filter((tr) => !deleted.has(tr.relPath)),
            })),
            queue: {
              tracks: nextQueueTracks,
              currentIndex:
                nextQueueTracks.length === 0
                  ? 0
                  : Math.max(
                      0,
                      Math.min(
                        nextCurrent >= 0 ? nextCurrent : 0,
                        nextQueueTracks.length - 1
                      )
                    ),
            },
          };
        },
        { immediate: true }
      );
    },
    [commit]
  );

  const setQueueSnapshot = useCallback(
    (queue: QueueState) => {
      commit((prev) => ({
        ...prev,
        queue: {
          tracks: queue.tracks,
          currentIndex: Math.min(
            Math.max(queue.currentIndex, 0),
            Math.max(queue.tracks.length - 1, 0)
          ),
        },
      }), { patch: (next) => ({ queue: next.queue }) });
    },
    [commit]
  );

  const getTrackPlayCount = useCallback(
    (relPath: string) => state.trackPlayCounts?.[relPath] ?? 0,
    [state.trackPlayCounts]
  );

  const incrementTrackPlayCount = useCallback(
    (relPath: string) => {
      if (!relPath) return;
      commit((prev) => ({
        ...prev,
        trackPlayCounts: {
          ...(prev.trackPlayCounts || {}),
          [relPath]: ((prev.trackPlayCounts || {})[relPath] ?? 0) + 1,
        },
      }), { patch: (next) => ({ trackPlayCounts: next.trackPlayCounts }) });
    },
    [commit]
  );

  const updateSettings = useCallback(
    (patch: Partial<UserSettings>) => {
      commit(
        (prev) => ({
          ...prev,
          settings: normalizeSettings({ ...prev.settings, ...patch }),
        }),
        { immediate: true, patch: () => ({ settings: patch }) }
      );
    },
    [commit]
  );

  const createPlaylist = useCallback(
    (name: string) => {
      const id = randomUUID();
      commit(
        (prev) => ({
          ...prev,
          playlists: [
            ...prev.playlists,
            {
              id,
              name: name.trim() || "New playlist",
              tracks: [],
            },
          ],
        }),
        { immediate: true, patch: (next) => ({ playlists: next.playlists }) }
      );
      setSelectedPlaylist(id);
      return id;
    },
    [commit]
  );

  const renamePlaylist = useCallback(
    (id: string, name: string) => {
      commit(
        (prev) => ({
          ...prev,
          playlists: prev.playlists.map((playlist) =>
            playlist.id === id
              ? { ...playlist, name: name.trim() || playlist.name }
              : playlist
          ),
        }),
        { immediate: true, patch: (next) => ({ playlists: next.playlists }) }
      );
    },
    [commit]
  );

  const deletePlaylist = useCallback(
    (id: string) => {
      commit(
        (prev) => ({
          ...prev,
          playlists: prev.playlists.filter((playlist) => playlist.id !== id),
        }),
        { immediate: true, patch: (next) => ({ playlists: next.playlists }) }
      );
      setSelectedPlaylist((current) => (current === id ? null : current));
    },
    [commit]
  );

  const addTrackToPlaylist = useCallback(
    (id: string, track: EnrichedTrack) => {
      commit(
        (prev) => ({
          ...prev,
          playlists: prev.playlists.map((playlist) =>
            playlist.id !== id
              ? playlist
              : {
                  ...playlist,
                  tracks: playlist.tracks.some(
                    (item) => item.relPath === track.relPath
                  )
                    ? playlist.tracks
                    : [
                        ...playlist.tracks,
                        {
                          relPath: track.relPath,
                          title: track.title,
                          artist: track.artist,
                          album: track.album,
                        },
                      ],
                }
          ),
        }),
        { immediate: true, patch: (next) => ({ playlists: next.playlists }) }
      );
    },
    [commit]
  );

  const removeTrackFromPlaylist = useCallback(
    (id: string, relPath: string) => {
      commit(
        (prev) => ({
          ...prev,
          playlists: prev.playlists.map((playlist) =>
            playlist.id === id
              ? {
                  ...playlist,
                  tracks: playlist.tracks.filter(
                    (track) => track.relPath !== relPath
                  ),
                }
              : playlist
          ),
        }),
        { immediate: true, patch: (next) => ({ playlists: next.playlists }) }
      );
    },
    [commit]
  );

  const saveQueueAsPlaylist = useCallback(
    (name: string, queue: EnrichedTrack[]) => {
      const id = randomUUID();
      commit(
        (prev) => ({
          ...prev,
          playlists: [
            ...prev.playlists,
            {
              id,
              name: name.trim() || `Queue ${fmtDate(new Date())}`,
              tracks: queue.map((track) => ({
                relPath: track.relPath,
                title: track.title,
                artist: track.artist,
                album: track.album,
              })),
            },
          ],
        }),
        { immediate: true, patch: (next) => ({ playlists: next.playlists }) }
      );
      setSelectedPlaylist(id);
      return id;
    },
    [commit]
  );

  const favorites = useMemo(() => new Set(state.favorites), [state.favorites]);

  const value = useMemo<UserStateContextValue>(
    () => ({
      state,
      ready,
      saving,
      error,
      favorites,
      selectedPlaylist,
      setSelectedPlaylist,
      toggleFavorite,
      isFavorite: (relPath: string) => favorites.has(relPath),
      pushRecent,
      getTrackPlayCount,
      incrementTrackPlayCount,
      setQueueSnapshot,
      updateSettings,
      createPlaylist,
      renamePlaylist,
      deletePlaylist,
      addTrackToPlaylist,
      removeTrackFromPlaylist,
      saveQueueAsPlaylist,
      rehydrateTrackListsFromLibrary,
      toggleShuffleExcludedAlbum,
      toggleShuffleExcludedTrack,
      setShuffleTracksExcludedBulk,
      rehydrateShuffleExclusionsFromIndex,
      stripUserStateForRelPaths,
      syncUserStateFromServer,
    }),
    [
      addTrackToPlaylist,
      createPlaylist,
      deletePlaylist,
      error,
      favorites,
      getTrackPlayCount,
      incrementTrackPlayCount,
      pushRecent,
      rehydrateShuffleExclusionsFromIndex,
      rehydrateTrackListsFromLibrary,
      ready,
      removeTrackFromPlaylist,
      renamePlaylist,
      saveQueueAsPlaylist,
      saving,
      selectedPlaylist,
      setQueueSnapshot,
      setShuffleTracksExcludedBulk,
      state,
      toggleFavorite,
      toggleShuffleExcludedAlbum,
      toggleShuffleExcludedTrack,
      stripUserStateForRelPaths,
      syncUserStateFromServer,
      updateSettings,
    ]
  );

  return (
    <UserStateContext.Provider value={value}>
      {children}
    </UserStateContext.Provider>
  );
}

export function useUserState() {
  const ctx = useContext(UserStateContext);
  if (!ctx) throw new Error("useUserState");
  return ctx;
}
