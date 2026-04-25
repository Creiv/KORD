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
import { fetchUserState, saveUserState } from "../lib/api";
import { fmtDate } from "../lib/metaFormat";
import { randomUUID } from "../lib/randomUUID";
import {
  APP_LOCALES,
  THEME_MODES,
  type AppLocale,
  type EnrichedTrack,
  type LibraryIndex,
  type QueueState,
  type ThemeMode,
  type UserPlaylist,
  type UserSettings,
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
    vizMode: "bars",
    restoreSession: true,
    defaultTab: "dashboard",
    locale: "en",
    libBrowse: "artists",
    libOverviewSort: "name",
    artistAlbumSort: "date",
  };
}

function normalizeSettings(raw: Partial<UserSettings>): UserSettings {
  const locale: AppLocale = (APP_LOCALES as readonly string[]).includes(
    raw.locale as string
  )
    ? (raw.locale as AppLocale)
    : "en";
  const libBrowse: UserSettings["libBrowse"] =
    raw.libBrowse === "genres" ? "genres" : "artists";
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
    vizMode: (() => {
      const legacy = raw.vizMode as string | undefined;
      let m: typeof raw.vizMode = raw.vizMode;
      if (legacy === "soft") m = "signals";
      else if (legacy === "horizon") m = "embers";
      return m === "mirror" ||
        m === "osc" ||
        m === "bars" ||
        m === "signals" ||
        m === "embers" ||
        m === "kord"
        ? m
        : "bars";
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

function normalizeUserState(s: UserStateV1): UserStateV1 {
  const rawCounts = s.trackPlayCounts || {};
  const trackPlayCounts = Object.fromEntries(
    Object.entries(rawCounts).filter(
      ([relPath, count]) =>
        Boolean(relPath) && Number.isFinite(count) && Number(count) > 0
    )
  ) as Record<string, number>;
  return { ...s, trackPlayCounts, settings: normalizeSettings(s.settings) };
}

function defaultUserState(): UserStateV1 {
  return {
    version: 1,
    favorites: [],
    recent: [],
    trackPlayCounts: {},
    playlists: [],
    queue: { tracks: [], currentIndex: 0 },
    settings: defaultSettings(),
    migratedLegacy: false,
  };
}

function uniqStrings(list: string[]) {
  return [...new Set(list.filter(Boolean))];
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
      vizMode === "signals" ||
      vizMode === "embers" ||
      vizMode === "kord" ||
      vizMode === "horizon" ||
      vizMode === "soft"
        ? {
            ...defaultSettings(),
            vizMode:
              vizMode === "soft"
                ? "signals"
                : vizMode === "horizon"
                  ? "embers"
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
};

const UserStateContext = createContext<UserStateContextValue | null>(null);

export function UserStateProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<UserStateV1>(defaultUserState);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedPlaylist, setSelectedPlaylist] = useState<string | null>(null);
  const dirtyRef = useRef(false);
  const hydratedRef = useRef(false);
  const saveSeqRef = useRef(0);

  useEffect(() => {
    let active = true;
    fetchUserState()
      .then((remote) => {
        if (!active) return;
        const merged = normalizeUserState(mergeLegacy(remote));
        dirtyRef.current = !remote.migratedLegacy;
        setState(merged);
        setError(null);
        setReady(true);
        hydratedRef.current = true;
      })
      .catch((err: unknown) => {
        if (!active) return;
        const fallback = mergeLegacy(defaultUserState());
        setState(fallback);
        setError(String(err));
        setReady(true);
        hydratedRef.current = true;
        dirtyRef.current = true;
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!ready || !hydratedRef.current || !dirtyRef.current) return;
    const timer = window.setTimeout(() => {
      setSaving(true);
      const seq = ++saveSeqRef.current;
      saveUserState(state)
        .then((next) => {
          if (seq !== saveSeqRef.current) return;
          setState(normalizeUserState(next));
          setError(null);
          dirtyRef.current = false;
        })
        .catch((err: unknown) => {
          setError(String(err));
        })
        .finally(() => {
          if (seq === saveSeqRef.current) setSaving(false);
        });
    }, 240);
    return () => window.clearTimeout(timer);
  }, [ready, state]);

  useEffect(() => {
    document.documentElement.dataset.theme = state.settings.theme;
  }, [state.settings.theme]);

  useEffect(() => {
    document.documentElement.lang =
      state.settings.locale === "it" ? "it" : "en";
  }, [state.settings.locale]);

  const persistNow = useCallback((next: UserStateV1) => {
    const seq = ++saveSeqRef.current;
    setSaving(true);
    saveUserState(next)
      .then((saved) => {
        if (seq !== saveSeqRef.current) return;
        setState(normalizeUserState(saved));
        setError(null);
        dirtyRef.current = false;
      })
      .catch((err: unknown) => {
        if (seq !== saveSeqRef.current) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (seq === saveSeqRef.current) setSaving(false);
      });
  }, []);

  const commit = useCallback(
    (
      updater: (prev: UserStateV1) => UserStateV1,
      options?: { immediate?: boolean }
    ) => {
      dirtyRef.current = true;
      setState((prev) => {
        const next = updater(prev);
        if (options?.immediate) {
          window.setTimeout(() => persistNow(next), 0);
        }
        return next;
      });
    },
    [persistNow]
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
      });
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
      }));
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
      }));
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
      }));
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
      }));
    },
    [commit]
  );

  const updateSettings = useCallback(
    (patch: Partial<UserSettings>) => {
      commit((prev) => ({
        ...prev,
        settings: { ...prev.settings, ...patch },
      }));
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
        { immediate: true }
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
        { immediate: true }
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
        { immediate: true }
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
        { immediate: true }
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
        { immediate: true }
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
        { immediate: true }
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
      rehydrateTrackListsFromLibrary,
      ready,
      removeTrackFromPlaylist,
      renamePlaylist,
      saveQueueAsPlaylist,
      saving,
      selectedPlaylist,
      setQueueSnapshot,
      state,
      toggleFavorite,
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
