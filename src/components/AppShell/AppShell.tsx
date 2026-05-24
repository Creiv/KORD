import {
  lazy,
  startTransition,
  Suspense,
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CSSProperties, RefObject } from "react";
import { useAppConfirm } from "../../context/AppConfirmContext";
import { usePlayer } from "../../context/PlayerContext";
import { useRhythmMode } from "../../context/RhythmModeContext";
import {
  emitStudioPane,
  StudioNavigationProvider,
} from "../../context/StudioNavigationContext";
import { useLibrarySyncActivity } from "../../context/LibrarySyncActivityContext";
import { useToolsActivity } from "../../context/ToolsActivityContext";
import { useUserState } from "../../context/UserStateContext";
import { useMatchMedia } from "../../hooks/useMatchMedia";
import { usePlayerDockCssVars } from "../../hooks/usePlayerDockCssVars";
import { useSyncStatusSnackbar } from "../../hooks/useSyncStatusSnackbar";
import { MOBILE_LAYOUT_MQ } from "../../lib/breakpoints";
import { useI18n } from "../../i18n/useI18n";
import {
  fetchDashboard,
  fetchLibraryIndex,
  isBackendUnreachableError,
} from "../../lib/api";
import { clientLegacyLibrary } from "../../lib/libraryIndex";
import {
  applyLibraryDeltaToIndex,
  applyLibraryDeltasToIndex,
  mergeLibraryIndexFromServer,
  libraryIndexRehydrateSig,
} from "../../lib/libraryIndex";
import type { LibraryReconcileOptions } from "../../lib/libraryReconcile";
import { parseTrackGenres } from "../../lib/genres";
import { isStandaloneDisplayMode, useAppRoute } from "../../lib/routing";
import { KordSplashLoader } from "../KordSplashLoader";
import { KordViewLoadingFallback } from "../KordViewLoadingFallback";
import { PlayerDock } from "../PlayerDock/PlayerDock";
import { MobileBottomNav } from "../MobileBottomNav/MobileBottomNav";
import { SideBar } from "./SideBar/SideBar";
import { SyncStatusSnackbar } from "./SyncStatusSnackbar";
import { TopBar } from "./TopBar/TopBar";
import {
  AlbumMetaEditProvider,
} from "../AlbumMetaEditor";
import {
  TrackMetaEditProvider,
} from "../TrackMetaEditor";
import {
  UiFavorite,
  UiHistory,
} from "../KordUiIcons";
import type {
  AppSection,
  DashboardPayload,
  LibraryEntityDelta,
  LibraryIndex,
  LibraryTrackIndex,
} from "../../types";
import styles from "./AppShell.module.css";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

const LazyDashboardView = lazy(() => import("../../views/DashboardView/DashboardView"));
const LazyLibraryView = lazy(() => import("../../views/LibraryView/LibraryView"));
const LazyDiscoWallView = lazy(() => import("../../views/DiscoWallView"));
const LazyQueueViewNew = lazy(() => import("../../views/QueueViewNew"));
const LazyPlaylistsViewNew = lazy(() => import("../../views/PlaylistsViewNew"));
const LazyTrackCollectionView = lazy(() => import("../../views/TrackCollectionView"));
const LazyStatisticsView = lazy(() => import("../../views/StatisticsView"));
const LazyAchievementsView = lazy(
  () => import("../../views/AchievementsView/AchievementsView")
);
const LazySettingsView = lazy(() => import("../../views/SettingsView"));
const LazyToolsView = lazy(() =>
  import("../ToolsView").then((m) => ({ default: m.ToolsView }))
);
/** Dopo modifiche ai metadati il server ricostruisce l'indice; evitiamo tsunami di GET /library-index. */
const LIBRARY_RECONCILE_DEBOUNCE_MS = 1400;

export function AppShell() {
  const { route, navigate } = useAppRoute();
  const p = usePlayer();
  const { setOpen: setRhythmOpen } = useRhythmMode();
  usePlayerDockCssVars(p.queue.length);
  const isMobileLayout = useMatchMedia(MOBILE_LAYOUT_MQ);
  const user = useUserState();
  const syncUserStateFromServer = user.syncUserStateFromServer;
  const {
    beginActivity: beginLibrarySyncActivity,
    busy: librarySyncBusy,
    primaryActivity: librarySyncPrimaryActivity,
  } = useLibrarySyncActivity();
  const { t } = useI18n();
  const formatLoadError = useCallback(
    (message: string | null) => {
      if (!message) return null;
      if (message === "errors.backendUnreachable") {
        return t("errors.backendUnreachable");
      }
      if (isBackendUnreachableError(message)) {
        return t("errors.backendUnreachable");
      }
      return message;
    },
    [t]
  );
  const { alert: appAlert } = useAppConfirm();
  const toolsActivity = useToolsActivity();

  const [index, setIndex] = useState<LibraryIndex | null>(null);
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [librarySearchBarOpen, setLibrarySearchBarOpen] = useState(false);
  const [libraryHomeTick, setLibraryHomeTick] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null) as RefObject<HTMLInputElement | null>;
  const prevSectionForSearchRef = useRef<AppSection | null>(null);
  const syncTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshSeqRef = useRef(0);
  const indexRef = useRef<LibraryIndex | null>(null);
  const indexLibrarySigRef = useRef("");
  const backgroundRefreshRef = useRef<Promise<void> | null>(null);
  const libraryRefreshQueuedAfterFlightRef = useRef(false);
  const libraryReconcileDebounceRef = useRef<ReturnType<
    typeof globalThis.setTimeout
  > | null>(null);
  const [syncTapAnim, setSyncTapAnim] = useState(false);
  const [installPrompt, setInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [installDismissed, setInstallDismissed] = useState(false);
  const [standalone, setStandalone] = useState(() => isStandaloneDisplayMode());
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try {
      const v = localStorage.getItem("kord.sidebar.collapsed");
      return v === null ? true : v === "1";
    } catch {
      return true;
    }
  });

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("kord.sidebar.collapsed", next ? "1" : "0");
      } catch {
        /* ignore storage failures */
      }
      return next;
    });
  }, []);

  const refreshLibrary = useCallback(
    (mode: "manual" | "background" = "manual", syncUser = false) => {
      const seq = ++refreshSeqRef.current;
      const endActivity = beginLibrarySyncActivity(
        mode === "manual"
          ? "sync.activity.reloadLibrary"
          : "sync.activity.refreshIndex"
      );
      const blockUi = mode === "manual" && !indexRef.current;
      if (blockUi) setLoading(true);
      const task = Promise.all([fetchLibraryIndex(), fetchDashboard()])
        .then(async ([libraryData, dashboardData]) => {
          if (seq !== refreshSeqRef.current) return;
          setIndex((prev) => mergeLibraryIndexFromServer(prev, libraryData));
          setDashboard(dashboardData);
          setError(null);
          if (mode === "manual" && syncUser) await syncUserStateFromServer();
        })
        .catch((err: unknown) => {
          if (seq !== refreshSeqRef.current) return;
          setError(
            isBackendUnreachableError(err)
              ? "errors.backendUnreachable"
              : String(err)
          );
        })
        .finally(() => {
          endActivity();
          if (blockUi) setLoading(false);
        });
      return task;
    },
    [beginLibrarySyncActivity, syncUserStateFromServer]
  );

  const runCoalescedBackgroundRefresh = useCallback(() => {
    if (backgroundRefreshRef.current) {
      libraryRefreshQueuedAfterFlightRef.current = true;
      return backgroundRefreshRef.current;
    }
    libraryRefreshQueuedAfterFlightRef.current = false;
    const task = (async () => {
      await refreshLibrary("background");
      while (libraryRefreshQueuedAfterFlightRef.current) {
        libraryRefreshQueuedAfterFlightRef.current = false;
        await refreshLibrary("background");
      }
    })();
    backgroundRefreshRef.current = task;
    void task.finally(() => {
      if (backgroundRefreshRef.current !== task) return;
      backgroundRefreshRef.current = null;
    });
    return task;
  }, [refreshLibrary]);

  const scheduleDebouncedLibraryReconcile = useCallback(() => {
    if (libraryReconcileDebounceRef.current != null) {
      globalThis.clearTimeout(libraryReconcileDebounceRef.current);
    }
    libraryReconcileDebounceRef.current = globalThis.setTimeout(() => {
      libraryReconcileDebounceRef.current = null;
      void runCoalescedBackgroundRefresh();
    }, LIBRARY_RECONCILE_DEBOUNCE_MS);
  }, [runCoalescedBackgroundRefresh]);

  const refreshManual = useCallback(
    (syncUser = false) => {
      if (libraryReconcileDebounceRef.current != null) {
        globalThis.clearTimeout(libraryReconcileDebounceRef.current);
        libraryReconcileDebounceRef.current = null;
      }
      libraryRefreshQueuedAfterFlightRef.current = false;
      return refreshLibrary("manual", syncUser);
    },
    [refreshLibrary]
  );

  /** Refresh indice in background, accodato e debounced (studio / metadati rapidi). */
  const refreshBackground = useCallback((): Promise<void> => {
    scheduleDebouncedLibraryReconcile();
    return Promise.resolve();
  }, [scheduleDebouncedLibraryReconcile]);

  /** Dopo download o scan massivi: refresh subito, una richiesta alla volta. */
  const refreshLibraryNow = useCallback(() => {
    if (libraryReconcileDebounceRef.current != null) {
      globalThis.clearTimeout(libraryReconcileDebounceRef.current);
      libraryReconcileDebounceRef.current = null;
    }
    return runCoalescedBackgroundRefresh();
  }, [runCoalescedBackgroundRefresh]);

  /**
   * Unico ingresso per riconciliare indice libreria + dashboard.
   * @see src/lib/libraryReconcile.ts
   */
  const reconcileLibrary = useCallback(
    (opts?: LibraryReconcileOptions): Promise<void> => {
      const mode = opts?.mode ?? "debounced";
      if (mode === "manual") {
        return refreshManual(Boolean(opts?.syncUser));
      }
      if (mode === "now") {
        return refreshLibraryNow();
      }
      return refreshBackground();
    },
    [refreshBackground, refreshLibraryNow, refreshManual]
  );

  const applyLibraryDelta = useCallback(
    (delta: LibraryEntityDelta, reconcile = true) => {
      const endActivity = beginLibrarySyncActivity(
        "sync.activity.updatingLibrary"
      );
      setIndex((prev) => applyLibraryDeltaToIndex(prev, delta));
      endActivity();
      if (reconcile) scheduleDebouncedLibraryReconcile();
    },
    [beginLibrarySyncActivity, scheduleDebouncedLibraryReconcile]
  );

  const applyLibraryDeltas = useCallback(
    (deltas: LibraryEntityDelta[], reconcile = false) => {
      if (!deltas.length) return;
      const endActivity = beginLibrarySyncActivity(
        "sync.activity.updatingLibrary"
      );
      setIndex((prev) => applyLibraryDeltasToIndex(prev, deltas));
      endActivity();
      if (reconcile) scheduleDebouncedLibraryReconcile();
    },
    [beginLibrarySyncActivity, scheduleDebouncedLibraryReconcile]
  );

  const refreshAfterAlbumMetaSaved = useCallback(
    (delta?: LibraryEntityDelta) => {
      if (delta) {
        applyLibraryDelta(delta, false);
        return;
      }
      void reconcileLibrary({ mode: "debounced" });
    },
    [applyLibraryDelta, reconcileLibrary]
  );

  const refreshAfterTrackMetaSaved = useCallback(
    (delta?: LibraryEntityDelta) => {
      if (delta) {
        applyLibraryDelta(delta, false);
        return;
      }
      void reconcileLibrary({ mode: "debounced" });
    },
    [applyLibraryDelta, reconcileLibrary]
  );

  const bootstrapLoading = loading && !index;

  const syncBusy =
    bootstrapLoading ||
    librarySyncBusy ||
    toolsActivity.toolsAnyBusy;

  const syncStatusTitle = useMemo(() => {
    const primary = librarySyncPrimaryActivity;
    if (primary) {
      return t(
        primary.labelKey as Parameters<typeof t>[0],
        primary.labelParams
      );
    }
    if (bootstrapLoading) return t("sync.activity.reloadLibrary");
    if (toolsActivity.toolsAnyBusy) return t("topbar.toolsBusyTitle");
    return t("topbar.refreshTitle");
  }, [librarySyncPrimaryActivity, bootstrapLoading, t, toolsActivity.toolsAnyBusy]);

  const { open: syncSnackbarOpen } = useSyncStatusSnackbar(syncBusy);

  const onSyncButtonClick = useCallback(() => {
    setSyncTapAnim(true);
    if (syncTapTimerRef.current) clearTimeout(syncTapTimerRef.current);
    syncTapTimerRef.current = setTimeout(() => {
      setSyncTapAnim(false);
      syncTapTimerRef.current = null;
    }, 500);
    void reconcileLibrary({ mode: "manual", syncUser: true });
  }, [reconcileLibrary]);

  useEffect(
    () => () => {
      if (syncTapTimerRef.current) clearTimeout(syncTapTimerRef.current);
      if (libraryReconcileDebounceRef.current != null) {
        globalThis.clearTimeout(libraryReconcileDebounceRef.current);
      }
    },
    []
  );

  useEffect(() => {
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
      setInstallDismissed(false);
    };
    const onInstalled = () => {
      setInstallPrompt(null);
      setStandalone(true);
    };
    const standaloneQuery = window.matchMedia("(display-mode: standalone)");
    const fullscreenQuery = window.matchMedia("(display-mode: fullscreen)");
    const onStandaloneChange = () => {
      setStandalone(isStandaloneDisplayMode());
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);
    standaloneQuery.addEventListener?.("change", onStandaloneChange);
    fullscreenQuery.addEventListener?.("change", onStandaloneChange);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
      standaloneQuery.removeEventListener?.("change", onStandaloneChange);
      fullscreenQuery.removeEventListener?.("change", onStandaloneChange);
    };
  }, []);

  const isIosBrowser = useMemo(() => {
    const ua = navigator.userAgent || "";
    const platform = navigator.platform || "";
    return (
      /iPad|iPhone|iPod/.test(ua) ||
      (platform === "MacIntel" && navigator.maxTouchPoints > 1)
    );
  }, []);

  const showInstallAppButton =
    isMobileLayout &&
    !standalone &&
    !installDismissed &&
    (installPrompt != null || isIosBrowser || !window.isSecureContext);

  const installApp = useCallback(async () => {
    if (installPrompt) {
      const prompt = installPrompt;
      setInstallPrompt(null);
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice.outcome === "dismissed") setInstallDismissed(true);
      return;
    }
    await appAlert({
      message: isIosBrowser
        ? t("topbar.installIosHint")
        : t("topbar.installSecureContextHint"),
    });
    setInstallDismissed(true);
  }, [installPrompt, isIosBrowser, t, appAlert]);

  useLayoutEffect(() => {
    document.documentElement.dataset.playerDock =
      p.queue.length > 0 ? "1" : "0";
  }, [p.queue.length]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void reconcileLibrary({ mode: "manual" });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [reconcileLibrary]);

  useEffect(() => {
    const w = window as unknown as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout?: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    const prefetch = () => {
      void import("../../views/DashboardView/DashboardView");
      void import("../../views/ListenView/ListenView");
      void import("../../views/LibraryView/LibraryView");
      void import("../../views/DiscoWallView");
    };
    const id =
      typeof w.requestIdleCallback === "function"
        ? w.requestIdleCallback(prefetch, { timeout: 2000 })
        : window.setTimeout(prefetch, 900);
    return () => {
      if (typeof w.cancelIdleCallback === "function") w.cancelIdleCallback(id);
      else window.clearTimeout(id as unknown as number);
    };
  }, []);

  useEffect(() => {
    indexRef.current = index;
  }, [index]);

  useEffect(() => {
    if (!index || !user.ready) return;
    p.resyncTracksFromIndex(index);
    user.rehydrateTrackListsFromLibrary(index);
    const sig = libraryIndexRehydrateSig(index);
    if (sig === indexLibrarySigRef.current) return;
    indexLibrarySigRef.current = sig;
    user.rehydrateShuffleExclusionsFromIndex(index);
  }, [
    index,
    p.resyncTracksFromIndex,
    user.ready,
    user.rehydrateTrackListsFromLibrary,
    user.rehydrateShuffleExclusionsFromIndex,
  ]);

  useEffect(() => {
    const prev = prevSectionForSearchRef.current;
    if (prev === "libreria" && route.section !== "libreria") {
      const id = window.requestAnimationFrame(() => {
        setSearch("");
        setLibrarySearchBarOpen(false);
      });
      prevSectionForSearchRef.current = route.section;
      return () => window.cancelAnimationFrame(id);
    }
    prevSectionForSearchRef.current = route.section;
  }, [route.section]);

  const closeLibrarySearch = useCallback(() => {
    setSearch("");
    setLibrarySearchBarOpen(false);
  }, []);

  const goLibraryOverview = useCallback(() => {
    closeLibrarySearch();
    navigate({ section: "libreria", artist: null, album: null });
  }, [navigate, closeLibrarySearch]);

  /** Home libreria senza artista/album; resetta anche filtri overview (tick). */
  const goLibraryRootForBrowse = useCallback(() => {
    if (route.section !== "libreria") {
      setLibraryHomeTick((n) => n + 1);
      navigate({ section: "libreria", artist: null, album: null });
      return;
    }
    if (route.artist != null || route.album != null) {
      setLibraryHomeTick((n) => n + 1);
      navigate({ section: "libreria", artist: null, album: null });
    }
  }, [navigate, route.section, route.artist, route.album]);

  const focusLibrarySearchInput = useCallback(() => {
    const el = searchInputRef.current;
    if (!el) return false;
    el.focus({ preventScroll: true });
    el.select();
    return true;
  }, []);

  const openLibrarySearch = useCallback(() => {
    setLibrarySearchBarOpen(true);
    goLibraryRootForBrowse();
  }, [goLibraryRootForBrowse]);

  const toggleLibrarySearchBar = useCallback(() => {
    if (librarySearchBarOpen) {
      closeLibrarySearch();
    } else {
      openLibrarySearch();
    }
  }, [librarySearchBarOpen, closeLibrarySearch, openLibrarySearch]);

  useLayoutEffect(() => {
    if (!librarySearchBarOpen || route.section !== "libreria") return;
    if (focusLibrarySearchInput()) return;
    const id = window.setTimeout(() => {
      focusLibrarySearchInput();
    }, 0);
    return () => window.clearTimeout(id);
  }, [
    librarySearchBarOpen,
    route.section,
    route.artist,
    route.album,
    libraryHomeTick,
    focusLibrarySearchInput,
  ]);

  const legacyLibrary = useMemo(() => {
    if (!index || route.section !== "studio") return null;
    return clientLegacyLibrary(index);
  }, [index, route.section]);

  const favoriteTracks = useMemo(() => {
    if (!index || route.section !== "favorites") return [];
    return user.state.favorites
      .map((relPath) => index.tracks.find((track) => track.relPath === relPath))
      .filter((track): track is LibraryTrackIndex => Boolean(track))
      .sort(
        (a, b) =>
          (user.state.trackPlayCounts?.[b.relPath] ?? 0) -
            (user.state.trackPlayCounts?.[a.relPath] ?? 0) ||
          a.title.localeCompare(b.title, undefined, { numeric: true })
      );
  }, [index, route.section, user.state.favorites, user.state.trackPlayCounts]);

  const [libraryGenreOptions, setLibraryGenreOptions] = useState<
    readonly string[]
  >([]);

  useEffect(() => {
    let cancelled = false;
    if (!index) {
      const clearId = window.setTimeout(() => {
        if (!cancelled) setLibraryGenreOptions([]);
      }, 0);
      return () => {
        cancelled = true;
        window.clearTimeout(clearId);
      };
    }
    const compute = () => {
      const s = new Set<string>();
      for (const tr of index.tracks) {
        for (const g of parseTrackGenres(tr.meta?.genre)) s.add(g);
      }
      const next = [...s].sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: "base" })
      );
      if (!cancelled) setLibraryGenreOptions(next);
    };
    const w = window as unknown as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout?: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    const idleId =
      typeof w.requestIdleCallback === "function"
        ? w.requestIdleCallback(compute, { timeout: 1500 })
        : window.setTimeout(compute, 0);
    return () => {
      cancelled = true;
      if (typeof w.cancelIdleCallback === "function" && typeof idleId === "number") {
        w.cancelIdleCallback(idleId);
      } else {
        window.clearTimeout(idleId as unknown as number);
      }
    };
  }, [index]);

  useEffect(() => {
    if (route.section !== "gioco") return;
    if (p.queue.length > 0) setRhythmOpen(true);
    startTransition(() => navigate({ section: "dashboard" }));
  }, [navigate, p.queue.length, route.section, setRhythmOpen]);

  const navToSection = useCallback(
    (section: AppSection) => navigate({ section }),
    [navigate]
  );
  const navToLibraryArtist = useCallback(
    (artist: string) => {
      closeLibrarySearch();
      navigate({ section: "libreria", artist: artist || null, album: null });
    },
    [navigate, closeLibrarySearch]
  );
  const navToLibraryAlbum = useCallback(
    (artist: string, album: string) => {
      closeLibrarySearch();
      navigate({ section: "libreria", artist, album });
    },
    [navigate, closeLibrarySearch]
  );
  const navToPlaylist = useCallback(
    (id: string | null) => navigate({ section: "playlists", playlist: id }),
    [navigate]
  );
  const openStudioListen = useCallback(() => {
    emitStudioPane("listen");
    startTransition(() => navigate({ section: "studio" }));
  }, [navigate]);

  const openStudioMeta = useCallback(() => {
    emitStudioPane("meta");
    startTransition(() => navigate({ section: "studio" }));
  }, [navigate]);

  const onGoToAscolta = openStudioListen;

  const goAppSection = useCallback(
    (section: AppSection) => {
      if (section === "ascolta") {
        openStudioListen();
        return;
      }
      if (section === "gioco") {
        if (p.queue.length > 0) setRhythmOpen(true);
        startTransition(() => navigate({ section: "dashboard" }));
        return;
      }
      if (section === "libreria") {
        closeLibrarySearch();
        setLibraryHomeTick((n) => n + 1);
      }
      startTransition(() => {
        navigate({ section });
      });
    },
    [closeLibrarySearch, navigate, openStudioListen, p.queue.length, setRhythmOpen],
  );

  useEffect(() => {
    const raw = window.location.pathname.replace(/^\/+/, "").split("/")[0];
    if (raw !== "ascolta") return;
    openStudioListen();
  }, [openStudioListen]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const inField =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;

      if (event.ctrlKey && event.key.toLowerCase() === "k" && !event.altKey) {
        event.preventDefault();
        openLibrarySearch();
        return;
      }

      if (inField) return;

      if (event.key === "/" && !event.altKey) {
        event.preventDefault();
        openLibrarySearch();
        return;
      }

      if (event.code === "Space") {
        event.preventDefault();
        p.toggle();
      } else if (event.code === "KeyI") {
        event.preventDefault();
        openStudioListen();
      } else if (event.code === "KeyP") {
        event.preventDefault();
        if (p.queue.length > 0) setRhythmOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [navigate, openLibrarySearch, openStudioListen, p, setRhythmOpen]);

  const onLibraryHome = useCallback(() => {
    closeLibrarySearch();
    setLibraryHomeTick((n) => n + 1);
    navigate({ section: "libreria" });
  }, [navigate, closeLibrarySearch]);

  const currentView = (() => {
    if (route.section === "settings") {
      return (
        <Suspense fallback={<KordViewLoadingFallback />}>
          <LazySettingsView />
        </Suspense>
      );
    }
    if (bootstrapLoading) return <KordSplashLoader />;
    if (error && !index)
      return (
        <div className="panel-empty danger">{formatLoadError(error)}</div>
      );
    if (!index) return <div className="panel-empty">{t("empty.noData")}</div>;
    switch (route.section) {
      case "dashboard":
        return (
          <Suspense fallback={<KordViewLoadingFallback />}>
            <LazyDashboardView
              dashboard={dashboard}
              index={index}
              onOpenAlbum={navToLibraryAlbum}
              onOpenSection={navToSection}
            />
          </Suspense>
        );
      case "libreria":
        return (
          <Suspense fallback={<KordViewLoadingFallback />}>
            <LazyLibraryView
              index={index}
              route={route}
              query={deferredSearch}
              libraryHomeTick={libraryHomeTick}
              search={search}
              onSearchChange={setSearch}
              searchInputRef={searchInputRef}
              showSearchBar={librarySearchBarOpen}
              onSearchBarClose={closeLibrarySearch}
              onReconcileLibrary={reconcileLibrary}
              onLibraryDelta={(delta, reconcile) =>
                applyLibraryDelta(delta, reconcile ?? false)
              }
              onGoLibraryOverview={goLibraryOverview}
              onOpenArtist={navToLibraryArtist}
              onOpenAlbum={navToLibraryAlbum}
            />
          </Suspense>
        );
      case "studio":
        return (
          <div className="view-page view-page--studio">
            <Suspense fallback={<KordViewLoadingFallback />}>
              <LazyToolsView
                library={legacyLibrary}
                libraryIndex={index}
                onReconcileLibrary={reconcileLibrary}
                onLibraryDelta={applyLibraryDelta}
                onLibraryDeltas={applyLibraryDeltas}
                onOpenSection={navToSection}
              />
            </Suspense>
          </div>
        );
      case "discowall":
        return (
          <Suspense fallback={<KordViewLoadingFallback />}>
            <LazyDiscoWallView />
          </Suspense>
        );
      case "queue":
        return (
          <Suspense fallback={<KordViewLoadingFallback />}>
            <LazyQueueViewNew
              onOpenSavedPlaylist={navToPlaylist}
            />
          </Suspense>
        );
      case "playlists":
        return (
          <Suspense fallback={<KordViewLoadingFallback />}>
            <LazyPlaylistsViewNew
              route={route}
              index={index}
              onPickPlaylist={navToPlaylist}
            />
          </Suspense>
        );
      case "favorites":
        return (
          <Suspense fallback={<KordViewLoadingFallback />}>
            <LazyTrackCollectionView
              title={t("collection.favoritesTitle")}
              eyebrow={t("collection.favoritesEyebrow")}
              leadIcon={<UiFavorite className="section-head__ic" />}
              tracks={favoriteTracks}
              libraryTracks={index.tracks}
              collectionMode="shuffle"
            />
          </Suspense>
        );
      case "recent":
        return (
          <Suspense fallback={<KordViewLoadingFallback />}>
            <LazyTrackCollectionView
              title={t("collection.recentTitle")}
              eyebrow={t("collection.recentEyebrow")}
              leadIcon={<UiHistory className="section-head__ic" />}
              tracks={user.state.recent}
              libraryTracks={index.tracks}
              collectionMode="radio"
            />
          </Suspense>
        );
      case "statistics":
        return (
          <Suspense fallback={<KordViewLoadingFallback />}>
            <LazyStatisticsView
              index={index}
              onOpenArtist={navToLibraryArtist}
              onOpenAlbum={navToLibraryAlbum}
            />
          </Suspense>
        );
      case "achievements":
        return (
          <Suspense fallback={<KordViewLoadingFallback />}>
            <LazyAchievementsView
              index={index}
              onOpenSection={navToSection}
            />
          </Suspense>
        );
      default:
        return null;
    }
  })();

  const sideW = isMobileLayout ? "0px" : sidebarCollapsed ? "56px" : "220px";

  useLayoutEffect(() => {
    document.documentElement.style.setProperty("--side-w", sideW);
  }, [sideW]);

  return (
    <StudioNavigationProvider
      openStudioListen={openStudioListen}
      openStudioMeta={openStudioMeta}
    >
    <TrackMetaEditProvider
      genreOptions={libraryGenreOptions}
      onSaved={refreshAfterTrackMetaSaved}
    >
      <AlbumMetaEditProvider onSaved={refreshAfterAlbumMetaSaved}>
        <div
          className={styles.shell}
          style={{ "--side-w": sideW } as CSSProperties}
        >
          <div className={styles.body}>
            <div className="shell__workspace">
            {/* Desktop sidebar nav */}
            {!isMobileLayout ? (
              <SideBar
                activeSection={route.section}
                syncBusy={syncBusy}
                syncTapAnim={syncTapAnim}
                librarySearchBarOpen={librarySearchBarOpen}
                collapsed={sidebarCollapsed}
                onNavigate={navToSection}
                onSync={onSyncButtonClick}
                onLibraryHome={onLibraryHome}
                onToggleSearch={toggleLibrarySearchBar}
                onToggleCollapse={toggleSidebar}
              />
            ) : null}

            <div className={`${styles.main} shell__main`}>
              {/* Mobile topbar */}
              <TopBar
                activeSection={route.section}
                syncBusy={syncBusy}
                syncStatusTitle={syncStatusTitle}
                syncTapAnim={syncTapAnim}
                librarySearchBarOpen={librarySearchBarOpen}
                showInstallButton={showInstallAppButton}
                onSync={onSyncButtonClick}
                onToggleSearch={toggleLibrarySearchBar}
                onInstall={() => void installApp()}
                onOpenSettings={() => navigate({ section: "settings" })}
              />

              {error && index ? (
                <div className={styles.banner}>{formatLoadError(error)}</div>
              ) : null}
              {user.error ? (
                <div className={styles.banner}>
                  {user.error === "errors.backendUnreachable"
                    ? t("errors.backendUnreachable")
                    : `${t("persist.banner")} ${formatLoadError(user.error)}`}
                </div>
              ) : null}

              <main className={`content-shell ${styles.content}`}>
                <div className="content-shell__inner" key={route.section}>
                  {currentView}
                </div>
              </main>
            </div>
            </div>
          </div>

          <PlayerDock
            onGoToAscolta={onGoToAscolta}
            onOpenLibraryArtist={navToLibraryArtist}
            onOpenLibraryAlbum={navToLibraryAlbum}
            onLibraryDelta={applyLibraryDelta}
          />
          {isMobileLayout ? (
            <MobileBottomNav active={route.section} onSelect={goAppSection} />
          ) : null}
          {syncSnackbarOpen ? (
            <SyncStatusSnackbar
              message={syncStatusTitle}
              busy={syncBusy}
            />
          ) : null}
        </div>
      </AlbumMetaEditProvider>
    </TrackMetaEditProvider>
    </StudioNavigationProvider>
  );
}
