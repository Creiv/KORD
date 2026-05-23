import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { AppSection } from "../types";
import {
  K_STUDIO_PANE,
  STUDIO_PANE_EVENT,
  type StudioPaneId,
} from "../context/StudioNavigationContext";
import { usePlayer } from "../context/PlayerContext";
import { useToolsActivity } from "../context/ToolsActivityContext";
import { useAppConfirm } from "../context/AppConfirmContext";
import { useI18n } from "../i18n/useI18n";
import { useLibrarySyncActivity } from "../context/LibrarySyncActivityContext";
import {
  applyArtwork,
  createMusicSubdir,
  fetchConfig,
  fetchAlbumInfo,
  fetchLibraryCatalog,
  fetchMyLibrarySelection,
  patchMyLibrarySelection,
  fetchTrackInfo,
  fetchDownloadPreset,
  streamYoutubeReleasesList,
  getSelectedAccountId,
  listMusicDirs,
  fetchDownloadFlatCount,
  newStudioDownloadId,
  runYtdlpDownload,
  cancelStudioDownload,
  sanitizeTrackTitles,
  searchArtwork,
  searchMusicDirs,
  pruneOrphanTrackMetaForAlbum,
} from "../lib/api";
import type {
  ArtworkHit,
  FsDirSearchResult,
  StudioDownloadKind,
  YoutubeExploreResult,
  YoutubeReleasesList,
} from "../lib/api";
import { fmtDate } from "../lib/metaFormat";
import { albumFolderFromTrackRelPath } from "../lib/trackPaths";
import { partitionYoutubeReleaseEntries } from "../lib/youtubeReleases";
import type {
  CatalogArtistEntry,
  LibArtist,
  LibTrack,
  LibraryCatalogResponse,
  LibraryEntityDelta,
  LibraryIndex,
  LibraryResponse,
  LibrarySelectionV1,
} from "../types";
import {
  buildDownloadSummaryLine,
  buildReleaseBatchSummaryLine,
} from "../lib/downloadLogSummary";
import { ytdlpLogDetailForUser } from "../lib/ytdlpLogFilter";
import { formatTrackGenresForDisplay } from "../lib/genres";
import {
  buildStudioDownloadConfirm,
  isValidDownloadDestPath,
  joinMusicDestRelPath,
  normalizeDownloadDestPath,
  relPathLooksLikeAlbumFolderDest,
  resolveStudioDownloadOutputDir,
  studioDownloadKindForScope,
  type StudioDownloadScope,
} from "../lib/studioDownloadDest";
import {
  studioDownloadSourceForArtistUrl,
  urlMatchesStudioDlMode,
  type DlVideoMode,
} from "../lib/youtubeUrl";
import {
  UiChevronLeft,
  UiChevronRight,
  UiDownload,
  UiTrackChanges,
  UiImage,
  UiNavHeadphones,
  UiNote,
} from "./KordUiIcons";
import { CoverImg } from "./CoverImg";
import {
  StudioCatalogAlbumTile,
  StudioCatalogArtistTile,
} from "./library";
import { StudioDownloadExplore } from "./StudioDownloadExplore";
import { StudioDownloadDisclaimer } from "./StudioDownloadDisclaimer";
import { StudioCatalogWeb } from "./StudioCatalogWeb";
import type { LibraryReconcileOptions } from "../lib/libraryReconcile";

const LazyListenView = lazy(() => import("../views/ListenView/ListenView"));

type P = {
  library: LibraryResponse | null;
  libraryIndex: LibraryIndex | null;
  onReconcileLibrary: (opts?: LibraryReconcileOptions) => void | Promise<void>;
  onLibraryDelta?: (delta: LibraryEntityDelta, reconcile?: boolean) => void;
  /** Applica più delta in un solo aggiornamento indice (scan metadati). */
  onLibraryDeltas?: (deltas: LibraryEntityDelta[], reconcile?: boolean) => void;
  onOpenSection?: (section: AppSection) => void;
};

function sourceLabel(s: string | undefined): string {
  if (s === "itunes") return "iTunes";
  if (s === "deezer") return "Deezer";
  if (s === "musicbrainz") return "MusicBrainz";
  if (s === "theaudiodb") return "TheAudioDB";
  if (s === "coverart") return "CAA / MB";
  return s || "—";
}

function extLinkLabel(url: string, openWord: string): string {
  try {
    const h = new URL(url).hostname;
    if (h.includes("apple.com")) return "iTunes / Apple";
    if (h.includes("deezer.com")) return "Deezer";
    if (h.includes("musicbrainz.org")) return "MusicBrainz";
    return h.replace("www.", "") || openWord;
  } catch {
    return openWord;
  }
}

function findLibTrack(
  library: LibraryResponse,
  relPath: string
): LibTrack | null {
  for (const a of library.artists) {
    for (const al of a.albums) {
      for (const t of al.tracks) {
        if (t.relPath === relPath) return t;
      }
    }
  }
  return null;
}

const K_DL_OK = "kord-dl-committed";
const W_DL_OK = "wpp-dl-committed";
const K_DL_OUT = "kord-dl-out";
const W_DL_OUT = "wpp-dl-out";
const K_COVER_ALB = "kord-cover-album";
const W_COVER_ALB = "wpp-cover-album";
const K_DL_STUDIO_MODE = "kord-dl-studio-mode";
const K_CATALOG_STUDIO_MODE = "kord-catalog-studio-mode";

type StudioPane = StudioPaneId;
type DlStudioMode = "classic" | "explore";
type CatalogStudioMode = "local" | "web";

function readStoredDlStudioMode(): DlStudioMode {
  try {
    const v = localStorage.getItem(K_DL_STUDIO_MODE);
    if (v === "explore") return "explore";
  } catch {
    /* ignore */
  }
  return "classic";
}

function readStoredCatalogStudioMode(): CatalogStudioMode {
  try {
    const v = localStorage.getItem(K_CATALOG_STUDIO_MODE);
    if (v === "web") return "web";
  } catch {
    /* ignore */
  }
  return "local";
}

function readStoredStudioPane(): StudioPane | null {
  try {
    const v = localStorage.getItem(K_STUDIO_PANE);
    if (v === "shared") return "catalog";
    if (
      v === "listen" ||
      v === "catalog" ||
      v === "download" ||
      v === "meta" ||
      v === "covers"
    ) {
      return v;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function isKordClientEmbed(): boolean {
  try {
    return sessionStorage.getItem("kord-embed") === "client";
  } catch {
    return false;
  }
}

function selectionHasArtist(sel: LibrarySelectionV1 | null, artistId: string) {
  if (!sel) return false;
  if (sel.includeAll) return true;
  return sel.artists.includes(artistId);
}

function selectionHasAlbum(
  sel: LibrarySelectionV1 | null,
  albumRel: string,
  artistId: string,
) {
  if (!sel) return false;
  if (sel.includeAll) return true;
  if (sel.artists.includes(artistId)) return true;
  return sel.albums.includes(albumRel);
}

function indexHasArtist(index: LibraryIndex | null, artistId: string) {
  if (!index?.artists?.length) return false;
  return index.artists.some((a) => a.id === artistId);
}

function indexHasAlbum(index: LibraryIndex | null, relPath: string) {
  if (!index?.albums?.length) return false;
  return index.albums.some((a) => a.relPath === relPath);
}

function catalogArtistCoverRel(ar: CatalogArtistEntry): string | null {
  if (ar.coverRelPath?.trim()) return ar.coverRelPath;
  const c = ar.relAlbums.find((x) => x.coverRelPath);
  if (c?.coverRelPath) return c.coverRelPath;
  return ar.relAlbums[0]?.relPath ?? null;
}

/** Artist not in account selection, or at least one catalog album folder missing from local index. */
function catalogArtistNeedsAttention(
  ar: CatalogArtistEntry,
  index: LibraryIndex | null,
  sel: LibrarySelectionV1 | null,
) {
  const notInSelection = !selectionHasArtist(sel, ar.id);
  const missingAlbum =
    ar.relAlbums.length > 0 &&
    ar.relAlbums.some((al) => !indexHasAlbum(index, al.relPath));
  return notInSelection || missingAlbum;
}

function exploreTypeLabel(
  type: YoutubeExploreResult["type"],
  t: (key: string, vars?: Record<string, string | number>) => string,
) {
  if (type === "album") return t("tools.exploreTypeAlbum");
  if (type === "artist") return t("tools.exploreTypeArtist");
  return t("tools.exploreTypeSong");
}

function exploreScopeForItem(item: YoutubeExploreResult): StudioDownloadScope {
  return item.type === "song" ? "single" : "playlist";
}

function exploreDownloadPreamble(
  item: YoutubeExploreResult,
  t: (key: string, vars?: Record<string, string | number>) => string,
): string {
  const typeLabel = exploreTypeLabel(item.type, t);
  let msg = t("tools.exploreConfirmLead", {
    type: typeLabel,
    title: item.title,
  });
  if (item.subtitle?.trim()) {
    msg +=
      "\n" +
      t("tools.exploreConfirmSubtitle", {
        subtitle: item.subtitle.trim(),
      });
  }
  if (item.url?.trim()) {
    msg += "\n" + t("tools.exploreConfirmUrl", { url: item.url.trim() });
  }
  return msg;
}

function buildReleasesArtistFolderConfirm(args: {
  dlPath: string;
  entries: { title: string }[];
  libraryIndex: LibraryIndex | null;
  t: (key: string, vars?: Record<string, string | number>) => string;
}): string {
  const norm = normalizeDownloadDestPath(args.dlPath);
  const rows: { path: string; exists: boolean }[] = [];
  const seen = new Set<string>();
  for (const e of args.entries) {
    const rel = joinMusicDestRelPath(norm, e.title);
    if (!rel || seen.has(rel)) continue;
    seen.add(rel);
    rows.push({
      path: rel,
      exists: indexHasAlbum(args.libraryIndex, rel),
    });
  }
  rows.sort((a, b) => a.path.localeCompare(b.path));
  const max = 45;
  const shown = rows.slice(0, max);
  const lines = shown.map((r) =>
    r.exists
      ? args.t("tools.dlReleasesRowUpdate", { path: r.path })
      : args.t("tools.dlReleasesRowNew", { path: r.path }),
  );
  let msg =
    args.t("tools.dlReleasesArtistConfirmLead", {
      count: rows.length,
      base: norm,
    }) +
    "\n\n" +
    lines.join("\n");
  if (rows.length > max) {
    msg += "\n" + args.t("tools.dlReleasesRowMore", { n: rows.length - max });
  }
  msg +=
    "\n\n" +
    args.t("tools.dlReleasesFolderNameHint") +
    "\n\n" +
    args.t("tools.dlReleasesProceedQ");
  return msg;
}

async function prepareStudioDownload(args: {
  hasValidDownloadDest: boolean;
  dlPath: string;
  scope: StudioDownloadScope;
  releaseTitle?: string;
  trackCount: number | null;
  preamble?: string;
  t: (key: string, vars?: Record<string, string | number>) => string;
  appConfirm: (opts: {
    variant?: "danger" | "warning";
    message: string;
  }) => Promise<boolean>;
  onLog: (updater: (prev: string) => string) => void;
}): Promise<boolean> {
  if (!args.hasValidDownloadDest) {
    args.onLog((x) => x + args.t("tools.dlPickFolder"));
    return false;
  }
  const confirmOpts = buildStudioDownloadConfirm({
    dlPath: args.dlPath,
    scope: args.scope,
    releaseTitle: args.releaseTitle,
    trackCount: args.trackCount,
    t: args.t,
    preamble: args.preamble,
  });
  if (!(await args.appConfirm(confirmOpts))) {
    return false;
  }
  if (args.scope === "playlist" && args.trackCount != null && args.trackCount > 35) {
    if (
      !(await args.appConfirm({
        message: args.t("tools.dlPlaylistManyConfirm", { n: args.trackCount }),
      }))
    ) {
      return false;
    }
  }
  return true;
}

function normalizeDlProgress(
  p: { current: number; total: number } | null
): { cur: number; tot: number; pct: number } | null {
  if (!p) return null;
  const tot = Math.max(1, Math.floor(Number(p.total) || 1));
  const cur = Math.min(tot, Math.max(0, Math.floor(Number(p.current) || 0)));
  return { cur, tot, pct: Math.max(3, Math.min(100, (cur / tot) * 100)) };
}

/** Brani nel singolo album (release batch); se total non noto ancora, pct leggera fissa. */
function normalizeTrackInAlbumProgress(
  p: { current: number; total: number } | null
): { cur: number; tot: number; pct: number; hasTotal: boolean } | null {
  if (!p) return null;
  const tot = Math.floor(Number(p.total) || 0);
  const cur = Math.max(0, Math.floor(Number(p.current) || 0));
  if (tot <= 0) {
    return { cur, tot: 0, pct: 10, hasTotal: false };
  }
  return {
    cur: Math.min(tot, cur),
    tot,
    hasTotal: true,
    pct: Math.max(3, Math.min(100, (cur / tot) * 100)),
  };
}

function DlDestFolderGlyph({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      aria-hidden
    >
      <path
        d="M4.25 5.5h5.1l1.1 1.1h8.3c.6 0 1.1.45 1.1 1v9.15c0 .6-.5 1.1-1.1 1.1H4.25c-.6 0-1.1-.5-1.1-1.1V6.6c0-.6.5-1.1 1.1-1.1Z"
        fill="currentColor"
        opacity="0.9"
      />
    </svg>
  );
}

function DlDestUpIcon() {
  return (
    <svg
      className="tools-dl-dest__up-ic"
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="currentColor"
      aria-hidden
    >
      <path d="M12 5.5L6.5 11H10v5.5h4V11h3.4L12 5.5z" />
    </svg>
  );
}

export function ToolsView({
  library,
  libraryIndex,
  onReconcileLibrary,
  onLibraryDelta,
  onLibraryDeltas,
  onOpenSection,
}: P) {
  const p = usePlayer();
  const { t, sortLocale } = useI18n();
  const downloadSummaryLine = useCallback(
    (r: Parameters<typeof buildDownloadSummaryLine>[0]) =>
      buildDownloadSummaryLine(r, t),
    [t],
  );
  const { confirm: appConfirm } = useAppConfirm();
  const {
    log,
    setLog,
    metaLog,
    setMetaLog,
    dlBusy,
    setDlBusy,
    dlProg,
    setDlProg,
    dlTrackProg,
    setDlTrackProg,
    mkBusy,
    setMkBusy,
    artBusy,
    setArtBusy,
    metaBusy,
    setMetaBusy,
    metaAllBusy,
    setMetaAllBusy,
    metaScanProg,
    setMetaScanProg,
    trackMetaBusy,
    setTrackMetaBusy,
    trackAllBusy,
    setTrackAllBusy,
    trackScanProg,
    setTrackScanProg,
    titleSanBusy,
    setTitleSanBusy,
    trackPruneBusy,
    setTrackPruneBusy,
    trackPruneProg,
    setTrackPruneProg,
    stopMetaAll,
    stopTrackAll,
    stopTrackPrune,
  } = useToolsActivity();
  const librarySync = useLibrarySyncActivity();

  useEffect(() => {
    if (!dlBusy) return;
    return librarySync.beginActivity("sync.activity.downloading");
  }, [dlBusy, librarySync]);

  useEffect(() => {
    if (!metaBusy) return;
    return librarySync.beginActivity("sync.activity.fetchAlbumMeta");
  }, [metaBusy, librarySync]);

  useEffect(() => {
    if (!metaAllBusy) return;
    return librarySync.beginActivity("sync.activity.scanAlbumMeta");
  }, [metaAllBusy, librarySync]);

  useEffect(() => {
    if (!trackMetaBusy) return;
    return librarySync.beginActivity("sync.activity.fetchTrackMeta");
  }, [trackMetaBusy, librarySync]);

  useEffect(() => {
    if (!trackAllBusy) return;
    return librarySync.beginActivity("sync.activity.scanTrackMeta");
  }, [trackAllBusy, librarySync]);

  useEffect(() => {
    if (!artBusy) return;
    return librarySync.beginActivity("sync.activity.applyingCover");
  }, [artBusy, librarySync]);

  useEffect(() => {
    if (!titleSanBusy) return;
    return librarySync.beginActivity("sync.activity.sanitizingTitles");
  }, [titleSanBusy, librarySync]);

  useEffect(() => {
    if (!trackPruneBusy) return;
    return librarySync.beginActivity("sync.activity.pruningTrackMeta");
  }, [trackPruneBusy, librarySync]);

  const [url, setUrl] = useState("");
  const [dlStudioMode, setDlStudioMode] = useState<DlStudioMode>(
    readStoredDlStudioMode,
  );
  const [catalogStudioMode, setCatalogStudioMode] =
    useState<CatalogStudioMode>(readStoredCatalogStudioMode);
  const [dlUrlMode, setDlUrlMode] = useState<DlVideoMode>("single");
  const [dlList, setDlList] = useState<{
    path: string;
    parent: string;
    dirs: { name: string; relPath: string }[];
    musicRoot: string;
  } | null>(null);
  const [dlDirQuery, setDlDirQuery] = useState("");
  const [dlDirResults, setDlDirResults] = useState<FsDirSearchResult[]>([]);
  const [dlDirSearchBusy, setDlDirSearchBusy] = useState(false);
  const [dlPath, setDlPath] = useState(() => {
    try {
      if (
        sessionStorage.getItem(K_DL_OK) === "1" ||
        sessionStorage.getItem(W_DL_OK) === "1"
      ) {
        const saved = normalizeDownloadDestPath(
          sessionStorage.getItem(K_DL_OUT) ??
          sessionStorage.getItem(W_DL_OUT) ??
          ""
        );
        if (saved) return saved;
      }
    } catch {
      /* ignore */
    }
    return "";
  });
  const [dlDestPicked, setDlDestPicked] = useState(() => {
    try {
      const saved = normalizeDownloadDestPath(
        sessionStorage.getItem(K_DL_OUT) ??
          sessionStorage.getItem(W_DL_OUT) ??
          ""
      );
      return Boolean(saved) && (
        sessionStorage.getItem(K_DL_OK) === "1" ||
        sessionStorage.getItem(W_DL_OK) === "1"
      );
    } catch {
      return false;
    }
  });
  const [catalogLockedByEnv, setCatalogLockedByEnv] = useState(false);
  const [serverLocalAccess, setServerLocalAccess] = useState(false);
  const [localSessionAccount, setLocalSessionAccount] = useState<string | null>(
    () => getSelectedAccountId()
  );
  const [catalogData, setCatalogData] = useState<LibraryCatalogResponse | null>(
    null,
  );
  const [mySelection, setMySelection] = useState<LibrarySelectionV1 | null>(
    null,
  );
  const [catalogBusy, setCatalogBusy] = useState(false);
  const [catalogErr, setCatalogErr] = useState<string | null>(null);
  const [catalogMsg, setCatalogMsg] = useState<string | null>(null);
  const [catalogArtistDetail, setCatalogArtistDetail] =
    useState<CatalogArtistEntry | null>(null);
  const [catalogArtistQuery, setCatalogArtistQuery] = useState("");
  const [catalogArtistOnlyAttention, setCatalogArtistOnlyAttention] =
    useState(true);
  const [artQuery, setArtQuery] = useState("");
  const [artRes, setArtRes] = useState<ArtworkHit[]>([]);
  const [newDirName, setNewDirName] = useState("");
  const [metaArtistName, setMetaArtistName] = useState("");
  const [metaAlbumPath, setMetaAlbumPath] = useState("");
  const [metaArt, setMetaArt] = useState("");
  const [metaAlb, setMetaAlb] = useState("");
  const [coverPickArtist, setCoverPickArtist] = useState("");
  const [relPayload, setRelPayload] = useState<YoutubeReleasesList | null>(
    null
  );
  const [relStreamComplete, setRelStreamComplete] = useState(false);
  const [relEnrichBusy, setRelEnrichBusy] = useState(false);
  const [relSel, setRelSel] = useState<Set<string>>(() => new Set());
  const [relQuery, setRelQuery] = useState("");
  const [relLoadBusy, setRelLoadBusy] = useState(false);
  const relAborter = useRef<AbortController | null>(null);
  const relLogTotalRef = useRef(0);
  const relEntryBatchRef = useRef<
    NonNullable<typeof relPayload>["entries"][number][]
  >([]);
  const relEntryFlushRafRef = useRef<number | null>(null);
  const relLogUploaderRef = useRef("");
  const catalogLoadedAccountRef = useRef<string | null>(null);
  const dlActiveDownloadIdRef = useRef<string | null>(null);
  const dlBatchStopRef = useRef(false);
  const studioDlRunLatchRef = useRef(false);
  const [albumForCover, setAlbumForCover] = useState(() => {
    try {
      return (
        sessionStorage.getItem(K_COVER_ALB) ||
        sessionStorage.getItem(W_COVER_ALB) ||
        ""
      );
    } catch {
      return "";
    }
  });
  const [metaScanChoiceOpen, setMetaScanChoiceOpen] = useState<
    null | "album" | "track"
  >(null);
  const [metaOptionalOpen, setMetaOptionalOpen] = useState(false);
  const [studioPane, setStudioPane] = useState<StudioPane>(() => {
    return readStoredStudioPane() ?? "listen";
  });

  useEffect(() => {
    try {
      localStorage.setItem(K_STUDIO_PANE, studioPane);
    } catch {
      /* ignore */
    }
  }, [studioPane]);

  useEffect(() => {
    const onPane = (event: Event) => {
      const pane = (event as CustomEvent<StudioPaneId>).detail;
      if (pane) setStudioPane(pane);
    };
    window.addEventListener(STUDIO_PANE_EVENT, onPane);
    return () => window.removeEventListener(STUDIO_PANE_EVENT, onPane);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(K_DL_STUDIO_MODE, dlStudioMode);
    } catch {
      /* ignore */
    }
  }, [dlStudioMode]);

  useEffect(() => {
    try {
      localStorage.setItem(K_CATALOG_STUDIO_MODE, catalogStudioMode);
    } catch {
      /* ignore */
    }
  }, [catalogStudioMode]);

  useEffect(() => {
    if (!metaScanChoiceOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMetaScanChoiceOpen(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [metaScanChoiceOpen]);

  const loadPreset = useCallback(() => {
    fetchDownloadPreset()
      .then((d) => {
        if (d.exampleUrl) setUrl(d.exampleUrl);
      })
      .catch((e) => setLog((x) => x + t("tools.logCmdErr", { e })));
  }, [t]);

  useEffect(() => {
    loadPreset();
  }, [loadPreset]);

  const commitDlDest = useCallback((path: string) => {
    const normalized = normalizeDownloadDestPath(path);
    setDlPath(normalized);
    setDlDestPicked(Boolean(normalized));
    try {
      if (normalized) {
        sessionStorage.setItem(K_DL_OK, "1");
        sessionStorage.setItem(K_DL_OUT, normalized);
      } else {
        sessionStorage.removeItem(K_DL_OK);
        sessionStorage.removeItem(K_DL_OUT);
        sessionStorage.removeItem(W_DL_OK);
        sessionStorage.removeItem(W_DL_OUT);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const clearDownloadDestination = useCallback(() => {
    setDlPath("");
    setDlDestPicked(false);
    try {
      sessionStorage.removeItem(K_DL_OK);
      sessionStorage.removeItem(K_DL_OUT);
      sessionStorage.removeItem(W_DL_OK);
      sessionStorage.removeItem(W_DL_OUT);
    } catch {
      /* ignore */
    }
  }, []);

  const pickCatalogWebForDownload = useCallback(
    (pickUrl: string, kind: "album" | "song") => {
      const trimmed = pickUrl.trim();
      if (!trimmed) return;
      clearDownloadDestination();
      setDlStudioMode("classic");
      setDlUrlMode(kind === "song" ? "single" : "playlist");
      setUrl(trimmed);
      setStudioPane("download");
    },
    [clearDownloadDestination],
  );

  const loadDlFs = useCallback(
    (path: string) => {
      listMusicDirs(path)
        .then((data) => {
          setDlList(data);
          const browsed = data.path ?? "";
          if (isValidDownloadDestPath(browsed)) {
            commitDlDest(browsed);
          }
        })
        .catch((e) => setLog((x) => x + t("tools.logFolderErr", { e })));
    },
    [t, commitDlDest],
  );

  useEffect(() => {
    if (!library || !metaAlbumPath) return;
    for (const a of library.artists) {
      for (const al of a.albums) {
        const rp = al.relPath || `${a.name}/${al.name}`;
        if (rp === metaAlbumPath) {
          setMetaArtistName(a.name);
          return;
        }
      }
    }
  }, [library, metaAlbumPath]);

  useEffect(() => {
    if (!library || !albumForCover) return;
    for (const a of library.artists) {
      for (const al of a.albums) {
        const rp = al.relPath || `${a.name}/${al.name}`;
        if (rp === albumForCover) {
          setCoverPickArtist(a.name);
          return;
        }
      }
    }
  }, [library, albumForCover]);

  useEffect(() => {
    setRelPayload(null);
    setRelStreamComplete(false);
    setRelSel(new Set());
    setRelQuery("");
  }, [url, dlUrlMode]);

  useEffect(() => {
    loadDlFs("");
  }, [loadDlFs]);

  useEffect(() => {
    const q = dlDirQuery.trim();
    if (!q) {
      setDlDirResults([]);
      setDlDirSearchBusy(false);
      return;
    }
    let cancelled = false;
    setDlDirSearchBusy(true);
    const timer = window.setTimeout(() => {
      searchMusicDirs(q)
        .then((results) => {
          if (!cancelled) setDlDirResults(results);
        })
        .catch((e) => {
          if (!cancelled) {
            setDlDirResults([]);
            setLog((x) => x + t("tools.logFolderErr", { e }));
          }
        })
        .finally(() => {
          if (!cancelled) setDlDirSearchBusy(false);
        });
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [dlDirQuery, setLog, t]);

  useEffect(
    () => () => {
      relAborter.current?.abort();
    },
    [],
  );

  useEffect(() => {
    try {
      if (albumForCover) {
        sessionStorage.setItem(K_COVER_ALB, albumForCover);
      } else {
        sessionStorage.removeItem(K_COVER_ALB);
        sessionStorage.removeItem(W_COVER_ALB);
      }
    } catch {
      /* ignore */
    }
  }, [albumForCover]);

  useEffect(() => {
    fetchConfig()
      .then((c) => {
        setCatalogLockedByEnv(c.lockedByEnv);
        setServerLocalAccess(Boolean(c.localAccess) && !isKordClientEmbed());
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const h = () => setLocalSessionAccount(getSelectedAccountId());
    window.addEventListener("kord-account-session-changed", h);
    return () => window.removeEventListener("kord-account-session-changed", h);
  }, []);

  const libraryArtistsSorted = useMemo((): LibArtist[] => {
    if (!library) return [];
    return [...library.artists].sort((a, b) =>
      a.name.localeCompare(b.name, sortLocale, { sensitivity: "base" })
    );
  }, [library, sortLocale]);

  const studioMetaBusy = useMemo(
    () =>
      metaBusy ||
      metaAllBusy ||
      trackMetaBusy ||
      trackAllBusy ||
      trackPruneBusy ||
      titleSanBusy,
    [
      metaBusy,
      metaAllBusy,
      trackMetaBusy,
      trackAllBusy,
      trackPruneBusy,
      titleSanBusy,
    ]
  );

  const metaAlbumsForPick = useMemo(() => {
    if (!library || !metaArtistName)
      return [] as { relPath: string; name: string }[];
    const ar = library.artists.find((x) => x.name === metaArtistName);
    if (!ar) return [];
    return ar.albums
      .filter((al) => al.id !== "__loose__")
      .map((al) => ({
        relPath: al.relPath || `${ar.name}/${al.name}`,
        name: al.name,
      }))
      .sort((a, b) =>
        a.name.localeCompare(b.name, sortLocale, { numeric: true })
      );
  }, [library, metaArtistName, sortLocale]);

  const coverAlbumsForPick = useMemo(() => {
    if (!library || !coverPickArtist)
      return [] as { relPath: string; name: string }[];
    const ar = library.artists.find((x) => x.name === coverPickArtist);
    if (!ar) return [];
    return ar.albums
      .filter((al) => al.id !== "__loose__")
      .map((al) => ({
        relPath: al.relPath || `${ar.name}/${al.name}`,
        name: al.name,
      }))
      .sort((a, b) =>
        a.name.localeCompare(b.name, sortLocale, { numeric: true })
      );
  }, [library, coverPickArtist, sortLocale]);

  const dlUrlPlaceholder = useMemo(() => {
    if (dlUrlMode === "single") return t("tools.dlUrlPhSingle");
    if (dlUrlMode === "playlist") return t("tools.dlUrlPhPlaylist");
    return t("tools.dlUrlPhReleases");
  }, [dlUrlMode, t]);

  const showMultiAlbumPicker = dlUrlMode === "releases";

  const filteredRelEntries = useMemo(() => {
    const entries = relPayload?.entries ?? [];
    const q = relQuery.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(
      (entry) =>
        entry.title.toLowerCase().includes(q) ||
        entry.url.toLowerCase().includes(q)
    );
  }, [relPayload?.entries, relQuery]);

  const { albums: filteredRelAlbums, songs: filteredRelSongs } = useMemo(
    () => partitionYoutubeReleaseEntries(filteredRelEntries),
    [filteredRelEntries],
  );

  const dlUrlValid = useMemo(
    () => urlMatchesStudioDlMode(url, "video", dlUrlMode),
    [url, dlUrlMode]
  );

  const catalogDataRef = useRef(catalogData);
  const mySelectionRef = useRef(mySelection);
  catalogDataRef.current = catalogData;
  mySelectionRef.current = mySelection;

  const loadCatalogPane = useCallback((force = false) => {
    const accountKey = localSessionAccount || "__default__";
    if (
      !force &&
      catalogLoadedAccountRef.current === accountKey &&
      catalogDataRef.current &&
      mySelectionRef.current
    ) {
      return;
    }
    setCatalogBusy(true);
    setCatalogErr(null);
    setCatalogArtistDetail(null);
    Promise.all([fetchLibraryCatalog({ summary: true }), fetchMyLibrarySelection()])
      .then(([cat, sel]) => {
        setCatalogData(cat);
        setMySelection(sel);
        catalogLoadedAccountRef.current = accountKey;
      })
      .catch((e) => {
        setCatalogErr(
          t("tools.catalogErr", { e: String((e as Error)?.message || e) }),
        );
        setCatalogData(null);
        setMySelection(null);
      })
      .finally(() => setCatalogBusy(false));
  }, [localSessionAccount, t]);

  const openCatalogArtist = useCallback(
    (artistId: string) => {
      setCatalogBusy(true);
      setCatalogErr(null);
      fetchLibraryCatalog({ artistId })
        .then((cat) => {
          const detail =
            cat.artists.find((artist) => artist.id === artistId) ??
            catalogData?.artists.find((artist) => artist.id === artistId) ??
            cat.artists[0] ??
            null;
          setCatalogArtistDetail(detail);
        })
        .catch((e) => {
          setCatalogErr(
            t("tools.catalogErr", { e: String((e as Error)?.message || e) }),
          );
        })
        .finally(() => setCatalogBusy(false));
    },
    [catalogData?.artists, t],
  );

  useEffect(() => {
    if (studioPane !== "catalog") return;
    if (catalogStudioMode !== "local") return;
    loadCatalogPane();
  }, [studioPane, catalogStudioMode, loadCatalogPane, localSessionAccount]);

  const afterCatalogPatch = useCallback(() => {
    setCatalogMsg(t("tools.catalogUpdated"));
    if (catalogArtistDetail) {
      void fetchLibraryCatalog({ artistId: catalogArtistDetail.id })
        .then((cat) => setCatalogArtistDetail(cat.artists[0] ?? null))
        .catch(() => {});
      void fetchMyLibrarySelection().then(setMySelection).catch(() => {});
    } else {
      loadCatalogPane(true);
    }
    void onReconcileLibrary({ mode: "debounced" });
  }, [catalogArtistDetail, loadCatalogPane, onReconcileLibrary, t]);

  const addArtistCatalog = useCallback(
    (artistId: string) => {
      setCatalogBusy(true);
      setCatalogErr(null);
      patchMyLibrarySelection({ addArtists: [artistId] })
        .then((s) => {
          setMySelection(s);
          afterCatalogPatch();
        })
        .catch((e) => {
          setCatalogErr(
            t("tools.catalogErr", { e: String((e as Error)?.message || e) }),
          );
        })
        .finally(() => setCatalogBusy(false));
    },
    [afterCatalogPatch, t],
  );

  const removeArtistCatalog = useCallback(
    (artistId: string) => {
      setCatalogBusy(true);
      setCatalogErr(null);
      patchMyLibrarySelection({
        includeAll: false,
        removeArtists: [artistId],
      })
        .then((s) => {
          setMySelection(s);
          afterCatalogPatch();
        })
        .catch((e) => {
          setCatalogErr(
            t("tools.catalogErr", { e: String((e as Error)?.message || e) }),
          );
        })
        .finally(() => setCatalogBusy(false));
    },
    [afterCatalogPatch, t],
  );

  const addAlbumCatalog = useCallback(
    (relPath: string) => {
      setCatalogBusy(true);
      setCatalogErr(null);
      patchMyLibrarySelection({ addAlbums: [relPath] })
        .then((s) => {
          setMySelection(s);
          afterCatalogPatch();
        })
        .catch((e) => {
          setCatalogErr(
            t("tools.catalogErr", { e: String((e as Error)?.message || e) }),
          );
        })
        .finally(() => setCatalogBusy(false));
    },
    [afterCatalogPatch, t],
  );

  const removeAlbumCatalog = useCallback(
    (relPath: string) => {
      setCatalogBusy(true);
      setCatalogErr(null);
      patchMyLibrarySelection({ removeAlbums: [relPath] })
        .then((s) => {
          setMySelection(s);
          afterCatalogPatch();
        })
        .catch((e) => {
          setCatalogErr(
            t("tools.catalogErr", { e: String((e as Error)?.message || e) }),
          );
        })
        .finally(() => setCatalogBusy(false));
    },
    [afterCatalogPatch, t],
  );

  const useCurrentForArt = () => {
    if (p.current) {
      setArtQuery([p.current.artist, p.current.album].filter(Boolean).join(" "));
      setCoverPickArtist(p.current.artist);
      const folder = albumFolderFromTrackRelPath(p.current.relPath);
      if (folder) {
        setAlbumForCover(folder);
      }
    }
  };

  const doCreateFolder = () => {
    const n = newDirName.trim();
    if (n.length < 1 || !dlList) return;
    if (relPathLooksLikeAlbumFolderDest(dlList.path || "")) {
      setLog((x) => x + t("tools.dlMkdirBlockedInAlbum") + "\n");
      return;
    }
    setMkBusy(true);
    createMusicSubdir(dlList.path || "", n)
      .then(({ relPath }) => {
        setLog((x) => x + t("tools.logNewFolder", { path: relPath }));
        setNewDirName("");
        loadDlFs(relPath);
      })
      .catch((e) => setLog((x) => x + t("tools.logFolderErr", { e })))
      .finally(() => setMkBusy(false));
  };

  const setMetaFromCurrent = () => {
    if (!p.current?.relPath) {
      setMetaLog(t("tools.metaNoTrack"));
      return;
    }
    setMetaArt(p.current.artist);
    setMetaAlb(p.current.album);
    setMetaArtistName(p.current.artist);
    const folder = albumFolderFromTrackRelPath(p.current.relPath);
    if (folder) {
      setMetaAlbumPath(folder);
      setMetaLog(t("tools.metaFromTrackOk"));
    } else {
      setMetaLog(t("tools.metaNoFolder"));
    }
  };

  const fetchOneAlbumMeta = () => {
    if (!metaAlbumPath.trim()) {
      setMetaLog(t("tools.metaPickAlbum"));
      return;
    }
    setMetaBusy(true);
    fetchAlbumInfo(metaAlbumPath.trim(), metaArt.trim(), metaAlb.trim())
      .then((r) => {
        const d = r.meta?.date;
        setMetaLog(
          (s) =>
            s + t("tools.metaOkLine", { path: r.albumPath, date: fmtDate(d) })
        );
        if (r.album && onLibraryDelta) {
          onLibraryDelta({ album: r.album }, false);
        } else {
          void onReconcileLibrary({ mode: "debounced" });
        }
      })
      .catch((e) => setMetaLog((s) => s + t("tools.metaErr", { e })))
      .finally(() => setMetaBusy(false));
  };

  const runMetaScanAll = async (rescanAll: boolean) => {
    if (!library) return;
    stopMetaAll.current = false;
    setMetaAllBusy(true);
    setMetaScanProg(null);
    const list: { path: string; artist: string; album: string }[] = [];
    for (const a of library.artists) {
      for (const al of a.albums) {
        if (al.id === "__loose__") continue;
        list.push({
          path: `${a.name}/${al.name}`,
          artist: a.name,
          album: al.name,
        });
      }
    }
    const toFetch = rescanAll
      ? list
      : list.filter((row) => {
          const ar = library.artists.find((x) => x.name === row.artist);
          const al = ar?.albums.find((x) => x.name === row.album);
          return !al?.hasAlbumMeta;
        });
    const skipped = list.length - toFetch.length;
    setMetaLog(
      (s) =>
        s +
        (rescanAll ? t("tools.metaScanRescanAllBanner") : "") +
        t("tools.metaScanStart", {
          fetch: toFetch.length,
          skip: skipped > 0 ? t("tools.metaScanSkip", { n: skipped }) : "",
        })
    );
    if (toFetch.length === 0) {
      setMetaAllBusy(false);
      setMetaLog((s) => s + t("tools.metaNoAlbums"));
      return;
    }
    const scanDeltas: LibraryEntityDelta[] = [];
    const flushScanDeltas = () => {
      if (!scanDeltas.length) return;
      if (onLibraryDeltas) {
        onLibraryDeltas(scanDeltas, false);
      } else {
        for (const delta of scanDeltas) {
          onLibraryDelta?.(delta, false);
        }
      }
      scanDeltas.length = 0;
    };
    for (let i = 0; i < toFetch.length; i += 1) {
      if (stopMetaAll.current) {
        setMetaLog((s) => s + t("tools.metaUserStop"));
        setMetaScanProg(null);
        setMetaAllBusy(false);
        flushScanDeltas();
        void onReconcileLibrary({ mode: "now" });
        return;
      }
      const row = toFetch[i]!;
      setMetaScanProg({ current: i + 1, total: toFetch.length });
      try {
        const r = await fetchAlbumInfo(row.path, row.artist, row.album);
        if (r.album) {
          scanDeltas.push({ album: r.album });
        }
      } catch (e) {
        setMetaLog(
          (s) =>
            s +
            t("tools.metaScanItemErr", {
              i: i + 1,
              total: toFetch.length,
              path: row.path,
              err: String((e as Error)?.message || e),
            })
        );
      }
    }
    setMetaScanProg(null);
    setMetaAllBusy(false);
    flushScanDeltas();
    setMetaLog((s) => s + t("tools.metaScanDone"));
    void onReconcileLibrary({ mode: "now" });
  };

  const fetchCurrentTrackMeta = () => {
    if (!p.current?.relPath) {
      setMetaLog((s) => s + t("tools.metaNoTrack"));
      return;
    }
    setTrackMetaBusy(true);
    fetchTrackInfo(p.current.relPath)
      .then((r) => {
        setMetaLog(
          (s) =>
            s +
            t("tools.metaTrackOk", {
              title: p.current?.title ?? "",
              date: fmtDate(r.meta.releaseDate),
              genre:
                formatTrackGenresForDisplay(r.meta.genre) || t("common.emDash"),
            })
        );
        if (r.track && onLibraryDelta) {
          onLibraryDelta({ track: r.track }, false);
        } else {
          void onReconcileLibrary({ mode: "debounced" });
        }
      })
      .catch((e) => setMetaLog((s) => s + t("tools.metaTrackErr", { e })))
      .finally(() => setTrackMetaBusy(false));
  };

  const runTrackScanAll = async (rescanAll: boolean) => {
    if (!library) return;
    stopTrackAll.current = false;
    setTrackAllBusy(true);
    setTrackScanProg(null);
    const rels: string[] = [];
    for (const a of library.artists) {
      for (const al of a.albums) {
        for (const t of al.tracks) rels.push(t.relPath);
      }
    }
    const toFetch = rescanAll
      ? rels
      : rels.filter((rel) => {
          const tr = findLibTrack(library, rel);
          const m = tr?.meta;
          if (!m) return true;
          return !(formatTrackGenresForDisplay(m.genre) || m.releaseDate);
        });
    const skippedT = rels.length - toFetch.length;
    setMetaLog(
      (s) =>
        s +
        (rescanAll ? t("tools.trackScanRescanAllBanner") : "") +
        t("tools.trackScanStart", {
          fetch: toFetch.length,
          skip: skippedT > 0 ? t("tools.trackScanSkip", { n: skippedT }) : "",
        })
    );
    if (toFetch.length === 0) {
      setTrackAllBusy(false);
      setMetaLog((s) => s + t("tools.trackNoUpdate"));
      return;
    }
    for (let i = 0; i < toFetch.length; i += 1) {
      if (stopTrackAll.current) {
        setMetaLog((s) => s + t("tools.trackScanStop"));
        setTrackScanProg(null);
        setTrackAllBusy(false);
        void onReconcileLibrary({ mode: "now" });
        return;
      }
      const rel = toFetch[i]!;
      setTrackScanProg({ current: i + 1, total: toFetch.length });
      try {
        const r = await fetchTrackInfo(rel);
        if (r.track && onLibraryDelta) {
          onLibraryDelta({ track: r.track }, false);
        }
      } catch (e) {
        setMetaLog(
          (s) =>
            s +
            t("tools.trackScanItemErr", {
              i: i + 1,
              total: toFetch.length,
              path: rel,
              err: String((e as Error)?.message || e),
            })
        );
      }
      if (i < toFetch.length - 1) {
        await new Promise((r) => setTimeout(r, 350));
      }
    }
    setTrackScanProg(null);
    setTrackAllBusy(false);
    setMetaLog((s) => s + t("tools.trackScanDone"));
    void onReconcileLibrary({ mode: "now" });
  };

  const runPruneOrphanTrackMeta = async () => {
    if (!library) return;
    if (
      !(await appConfirm({
        message: t("tools.trackMetaPruneConfirm"),
        variant: "danger",
      }))
    ) {
      return;
    }
    stopTrackPrune.current = false;
    setTrackPruneBusy(true);
    setTrackPruneProg(null);
    const list: string[] = [];
    for (const a of library.artists) {
      for (const al of a.albums) {
        const folder = al.relPath?.trim() || `${a.name}/${al.name}`;
        if (folder) list.push(folder);
      }
    }
    setMetaLog((s) => s + t("tools.trackMetaPruneStart", { n: list.length }));
    let albumsTouched = 0;
    let keysRemoved = 0;
    for (let i = 0; i < list.length; i += 1) {
      if (stopTrackPrune.current) {
        setMetaLog((s) => s + t("tools.trackMetaPruneStop"));
        setTrackPruneProg(null);
        setTrackPruneBusy(false);
        void onReconcileLibrary({ mode: "now" });
        return;
      }
      const albumPath = list[i]!;
      setTrackPruneProg({ current: i + 1, total: list.length });
      try {
        const r = await pruneOrphanTrackMetaForAlbum(albumPath);
        if (r.removed.length) {
          albumsTouched += 1;
          keysRemoved += r.removed.length;
          const files =
            r.removed.length > 6
              ? `${r.removed.slice(0, 6).join(", ")}…`
              : r.removed.join(", ");
          setMetaLog(
            (s) =>
              s + t("tools.trackMetaPruneAlbum", { path: albumPath, files })
          );
        }
      } catch (e) {
        setMetaLog(
          (s) =>
            s +
            t("tools.trackMetaPruneItemErr", {
              i: i + 1,
              total: list.length,
              path: albumPath,
              err: String((e as Error)?.message || e),
            })
        );
      }
    }
    setTrackPruneProg(null);
    setTrackPruneBusy(false);
    setMetaLog(
      (s) =>
        s + t("tools.trackMetaPruneDone", { a: albumsTouched, k: keysRemoved })
    );
    void onReconcileLibrary({ mode: "now" });
  };

  const runSanitizeTitles = async (scope: "album" | "all", dryRun: boolean) => {
    if (scope === "album" && !metaAlbumPath.trim()) {
      setMetaLog((s) => s + t("tools.sanitizePickAlbum"));
      return;
    }
    setTitleSanBusy(true);
    try {
      if (scope === "all") {
        const rAll = await sanitizeTrackTitles({ scope: "all", dryRun });
        setMetaLog((s) => {
          const head = dryRun
            ? t("tools.sanitizeHeadPreviewLib", {
                a: rAll.albumsScanned,
                c: rAll.changes.length,
              })
            : t("tools.sanitizeHeadApplyLib", {
                a: rAll.albumsScanned,
                c: rAll.changes.length,
              });
          if (rAll.changes.length === 0) {
            return s + head + t("tools.sanitizeNoFixLib");
          }
          const lines: string[] = [s + head];
          const show = rAll.changes.slice(0, 100);
          for (const c of show) {
            lines.push(
              `  ${c.albumRel} / ${c.fileName}: “${c.from}” → “${c.to}”`
            );
          }
          if (rAll.changes.length > 100) {
            lines.push(
              "  " + t("tools.sanitizeMore", { n: rAll.changes.length - 100 })
            );
          }
          lines.push("");
          return lines.join("\n");
        });
      } else {
        const r1 = await sanitizeTrackTitles({
          scope: "album",
          albumPath: metaAlbumPath.trim(),
          dryRun,
        });
        setMetaLog((s) => {
          const head = dryRun
            ? t("tools.sanitizeHeadPreviewAlb", { path: r1.albumPath })
            : t("tools.sanitizeHeadApplyAlb", { path: r1.albumPath });
          if (r1.changes.length === 0) {
            return s + head + t("tools.sanitizeNoFixAlb");
          }
          let acc = s + head;
          for (const c of r1.changes) {
            acc += `  ${c.fileName}: “${c.from}” → “${c.to}”\n`;
          }
          if (!dryRun) acc += t("tools.sanitizeRefreshHint");
          return acc;
        });
      }
      if (!dryRun) void onReconcileLibrary({ mode: "now" });
    } catch (e) {
      setMetaLog((s) => s + t("tools.sanitizeErr", { e: String(e) }));
    } finally {
      setTitleSanBusy(false);
    }
  };

  const stopStudioDownload = () => {
    dlBatchStopRef.current = true;
    const id = dlActiveDownloadIdRef.current;
    if (id) void cancelStudioDownload(id);
  };

  const hasValidDownloadDest =
    dlDestPicked && isValidDownloadDestPath(dlPath);

  const releasesDlBlockedAlbumFolder =
    showMultiAlbumPicker &&
    hasValidDownloadDest &&
    relPathLooksLikeAlbumFolderDest(dlPath);

  const exploreSingleBlockedArtistFolder =
    hasValidDownloadDest && !relPathLooksLikeAlbumFolderDest(dlPath);

  const prepareExploreDownload = useCallback(
    async (item: YoutubeExploreResult) => {
      const scope = exploreScopeForItem(item);
      if (scope === "single" && exploreSingleBlockedArtistFolder) {
        return false;
      }
      let trackCount: number | null = null;
      if (scope === "playlist") {
        try {
          trackCount = await fetchDownloadFlatCount(item.url);
        } catch (e) {
          setLog(
            (x) =>
              x +
              t("tools.dlPlaylistCountErr", {
                e: String((e as Error)?.message || e),
              }),
          );
          return false;
        }
      }
      return prepareStudioDownload({
        hasValidDownloadDest,
        dlPath,
        scope,
        releaseTitle: scope === "playlist" ? item.title : undefined,
        trackCount,
        preamble: exploreDownloadPreamble(item, t),
        t,
        appConfirm,
        onLog: setLog,
      });
    },
    [hasValidDownloadDest, dlPath, exploreSingleBlockedArtistFolder, appConfirm, t],
  );

  const runDl = () => {
    if (!url.trim()) return;
    if (!urlMatchesStudioDlMode(url, "video", dlUrlMode)) {
      setLog((x) => x + t("tools.dlUrlMismatch"));
      return;
    }
    if (showMultiAlbumPicker) {
      setLog((x) => x + t("tools.dlNeedLoadReleases"));
      return;
    }
    if (!hasValidDownloadDest) {
      setLog((x) => x + t("tools.dlPickFolder"));
      return;
    }
    if (studioDlRunLatchRef.current || dlBusy) return;
    studioDlRunLatchRef.current = true;
    void (async () => {
      try {
        const scope: StudioDownloadScope =
          dlUrlMode === "playlist" ? "playlist" : "single";
        let trackCount: number | null = null;
        if (scope === "playlist") {
          try {
            trackCount = await fetchDownloadFlatCount(url.trim());
          } catch (e) {
            setLog(
              (x) =>
                x +
                t("tools.dlPlaylistCountErr", {
                  e: String((e as Error)?.message || e),
                })
            );
            return;
          }
        }
        if (
          !(await prepareStudioDownload({
            hasValidDownloadDest,
            dlPath,
            scope,
            trackCount,
            t,
            appConfirm,
            onLog: setLog,
          }))
        ) {
          return;
        }
        const outputDir = resolveStudioDownloadOutputDir(dlPath, scope);
        const studioDlKind = studioDownloadKindForScope(scope);
        setDlBusy(true);
        setDlProg(null);
        setDlTrackProg(null);
        dlBatchStopRef.current = false;
        try {
          const dlId = newStudioDownloadId();
          dlActiveDownloadIdRef.current = dlId;
          setLog(
            (x) =>
              x +
              t("tools.dlStart", {
                path: dlPath,
              })
          );
          const r = await runYtdlpDownload(
            url.trim(),
            outputDir,
            (p) => setDlProg({ current: p.current, total: p.total }),
            { downloadId: dlId, downloadKind: studioDlKind }
          );
          if (r.progress && r.progress.total > 0) {
            setDlProg({ current: r.progress.current, total: r.progress.total });
          }
          if (r.cancelled) setDlProg(null);
          const detail = ytdlpLogDetailForUser(r);
          setLog((x) => {
            if (r.cancelled) return x + t("tools.dlStoppedByUser") + "\n";
            return (
              x +
              (r.ok
                ? t("tools.dlResultOk")
                : t("tools.dlResultErr", { code: r.code }) +
                  (detail ? t("tools.dlErrDetail", { detail }) : "")) +
              downloadSummaryLine(r)
            );
          });
          await onReconcileLibrary({ mode: "now" });
        } catch (e) {
          setLog(
            (x) =>
              x + t("tools.dlFail", { e: String((e as Error)?.message || e) })
          );
        } finally {
          dlActiveDownloadIdRef.current = null;
        }
      } finally {
        setDlBusy(false);
        studioDlRunLatchRef.current = false;
      }
    })();
  };

  const loadReleasesCatalog = () => {
    if (!url.trim()) return;
    if (!urlMatchesStudioDlMode(url, "video", dlUrlMode)) {
      setLog((x) => x + t("tools.dlUrlMismatch"));
      return;
    }
    if (!hasValidDownloadDest) {
      setLog((x) => x + t("tools.dlPickFolder"));
      return;
    }
    relAborter.current?.abort();
    relAborter.current = new AbortController();
    const signal = relAborter.current.signal;
    relEntryBatchRef.current = [];
    if (relEntryFlushRafRef.current != null) {
      window.cancelAnimationFrame(relEntryFlushRafRef.current);
      relEntryFlushRafRef.current = null;
    }
    setRelLoadBusy(true);
    setRelStreamComplete(false);
    setRelEnrichBusy(false);
    setRelPayload(null);
    setRelSel(new Set());
    void streamYoutubeReleasesList(
      url.trim(),
      {
        onMeta: (m) => {
          relLogTotalRef.current = m.total;
          relLogUploaderRef.current = m.uploader;
          setRelPayload({
            listTitle: m.listTitle,
            uploader: m.uploader,
            channelUrl: m.channelUrl,
            entries: [],
          });
        },
        onEntry: (e) => {
          relEntryBatchRef.current.push(e);
          if (relEntryFlushRafRef.current != null) return;
          relEntryFlushRafRef.current = window.requestAnimationFrame(() => {
            relEntryFlushRafRef.current = null;
            const batch = relEntryBatchRef.current;
            relEntryBatchRef.current = [];
            if (!batch.length) return;
            setRelPayload((p) =>
              p ? { ...p, entries: [...p.entries, ...batch] } : null
            );
          });
        },
        onListReady: () => {
          if (relEntryFlushRafRef.current != null) {
            window.cancelAnimationFrame(relEntryFlushRafRef.current);
            relEntryFlushRafRef.current = null;
          }
          const batch = relEntryBatchRef.current;
          relEntryBatchRef.current = [];
          if (batch.length) {
            setRelPayload((p) =>
              p ? { ...p, entries: [...p.entries, ...batch] } : null,
            );
          }
          setRelStreamComplete(true);
          setRelLoadBusy(false);
          setRelEnrichBusy(true);
          const n = relLogTotalRef.current;
          const u = relLogUploaderRef.current;
          setLog(
            (x) =>
              x +
              t("tools.dlReleasesListTitle") +
              `: ${n}` +
              (u ? ` — ${t("tools.dlReleasesUploader", { name: u })}` : "") +
              "\n"
          );
        },
        onEntryPatch: (e) => {
          setRelPayload((p) => {
            if (!p) return p;
            return {
              ...p,
              entries: p.entries.map((row) =>
                row.id === e.id
                  ? { ...row, trackCount: e.trackCount ?? row.trackCount }
                  : row,
              ),
            };
          });
        },
        onDone: () => {
          setRelLoadBusy(false);
          setRelEnrichBusy(false);
        },
      },
      { enrichCounts: true, signal },
    ).catch((e) => {
      if (String((e as Error)?.name) === "AbortError") {
        setRelLoadBusy(false);
        return;
      }
      setLog(
        (x) =>
          x + t("tools.sharedErr", { e: String((e as Error)?.message || e) })
      );
      setRelLoadBusy(false);
      setRelPayload(null);
      setRelStreamComplete(false);
      setRelEnrichBusy(false);
    });
  };

  const runReleasesDl = () => {
    if (!urlMatchesStudioDlMode(url, "video", dlUrlMode)) {
      setLog((x) => x + t("tools.dlUrlMismatch"));
      return;
    }
    if (!relPayload || !hasValidDownloadDest) {
      if (!hasValidDownloadDest) setLog((x) => x + t("tools.dlPickFolder"));
      return;
    }
    if (!relStreamComplete) {
      setLog((x) => x + t("tools.dlReleasesWaitEnrich") + "\n");
      return;
    }
    const list = relPayload.entries.filter((e) => relSel.has(e.id));
    if (list.length === 0) {
      setLog((x) => x + t("tools.dlNeedSelection"));
      return;
    }
    if (studioDlRunLatchRef.current || dlBusy) return;
    studioDlRunLatchRef.current = true;
    void (async () => {
      try {
        const studioDlKind: StudioDownloadKind =
          studioDownloadSourceForArtistUrl(url) === "music"
            ? "download_ytmusic"
            : "download_releases";
        if (releasesDlBlockedAlbumFolder) {
          setLog((x) => x + t("tools.dlReleasesBlockedAlbumFolderLog") + "\n");
          return;
        }
        if (
          !(await appConfirm({
            variant: "warning",
            message: buildReleasesArtistFolderConfirm({
              dlPath,
              entries: list,
              libraryIndex,
              t,
            }),
          }))
        ) {
          return;
        }
        setDlBusy(true);
        dlBatchStopRef.current = false;
        setDlTrackProg({ current: 0, total: 0 });
        setDlProg({ current: 1, total: list.length });
        setLog(
          (x) =>
            x +
            t("tools.dlStart", { path: dlPath }) +
            ` — ${list.length} album(s)\n`
        );
        try {
          const batchResults: {
            status: "ok" | "partial" | "failed";
            title: string;
          }[] = [];
          for (let i = 0; i < list.length; i += 1) {
            if (dlBatchStopRef.current) {
              setLog((x) => x + t("tools.dlBatchStoppedHint") + "\n");
              break;
            }
            const item = list[i]!;
            setDlProg({ current: i + 1, total: list.length });
            setDlTrackProg({ current: 0, total: 0 });
            setLog(
              (x) =>
                x +
                t("tools.dlBatchLine", {
                  i: i + 1,
                  n: list.length,
                  title: item.title,
                })
            );
            const dlId = newStudioDownloadId();
            dlActiveDownloadIdRef.current = dlId;
            try {
              const r = await runYtdlpDownload(
                item.url,
                dlPath,
                (p) => setDlTrackProg({ current: p.current, total: p.total }),
                { downloadId: dlId, downloadKind: studioDlKind }
              );
              const detail = ytdlpLogDetailForUser(r);
              if (r.cancelled) {
                setLog((x) => x + t("tools.dlStoppedByUser") + "\n");
                break;
              }
              batchResults.push({
                status: !r.ok
                  ? "failed"
                  : (r.failedItems?.length ?? 0) > 0
                    ? "partial"
                    : "ok",
                title: item.title,
              });
              setLog(
                (x) =>
                  x +
                  (r.ok
                    ? t("tools.dlResultOk")
                    : t("tools.dlResultErr", { code: r.code }) +
                      (detail ? t("tools.dlErrDetail", { detail }) : "")) +
                  downloadSummaryLine(r)
              );
            } catch (e) {
              batchResults.push({ status: "failed", title: item.title });
              setLog(
                (x) =>
                  x +
                  t("tools.dlFail", { e: String((e as Error)?.message || e) })
              );
            } finally {
              dlActiveDownloadIdRef.current = null;
            }
          }
          if (!dlBatchStopRef.current) {
            setDlProg({ current: list.length, total: list.length });
            setDlTrackProg(null);
          } else {
            setDlProg(null);
            setDlTrackProg(null);
          }
          setLog((x) => x + buildReleaseBatchSummaryLine(batchResults, t));
          await onReconcileLibrary({ mode: "now" });
        } finally {
          dlActiveDownloadIdRef.current = null;
        }
      } finally {
        setDlBusy(false);
        studioDlRunLatchRef.current = false;
      }
    })();
  };

  const toggleRelEntry = (id: string) => {
    setRelSel((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const dlMkdirBlockedInAlbum = Boolean(
    dlList && relPathLooksLikeAlbumFolderDest(dlList.path || ""),
  );

  const dlProgNorm = normalizeDlProgress(dlProg);
  const dlTrackNorm = normalizeTrackInAlbumProgress(dlTrackProg);
  /** Barra album + brani: stato download, non la modalità URL (si resetta al remount). */
  const showDualDlProgressBar =
    dlProgNorm != null &&
    dlProgNorm.tot >= 1 &&
    dlTrackProg != null;
  const singleDlBarNorm = showDualDlProgressBar
    ? null
    : dlProgNorm
      ? { ...dlProgNorm, hasTotal: true as const }
      : dlTrackNorm;
  const showDlProgressWrap = dlBusy || dlProg != null || dlTrackProg != null;

  const doArtSearch = () => {
    const q = artQuery.trim();
    if (q.length < 1) return;
    setArtBusy(true);
    searchArtwork({ q })
      .then(setArtRes)
      .catch(() => setArtRes([]))
      .finally(() => setArtBusy(false));
  };

  const applyCover = (imageUrl: string) => {
    if (!albumForCover) {
      setLog((x) => x + t("tools.coverPickDest"));
      return;
    }
    setArtBusy(true);
    applyArtwork(albumForCover, imageUrl)
      .then((delta) => {
        setLog((x) => x + t("tools.coverSaved", { path: albumForCover }));
        if (onLibraryDelta) onLibraryDelta(delta, false);
        else void onReconcileLibrary({ mode: "debounced" });
      })
      .catch((e) => setLog((x) => x + t("tools.coverErr", { e })))
      .finally(() => setArtBusy(false));
  };

  const filteredCatalogArtists = useMemo(() => {
    if (!catalogData?.artists.length) return [];
    const q = catalogArtistQuery.trim().toLowerCase();
    return catalogData.artists.filter((ar) => {
      if (q && !ar.name.toLowerCase().includes(q)) return false;
      if (
        catalogArtistOnlyAttention &&
        !catalogArtistNeedsAttention(ar, libraryIndex, mySelection)
      ) {
        return false;
      }
      return true;
    });
  }, [
    catalogData,
    catalogArtistQuery,
    catalogArtistOnlyAttention,
    libraryIndex,
    mySelection,
  ]);

  const studioOverviewIcon = useMemo(() => {
    switch (studioPane) {
      case "listen":
        return <UiNavHeadphones className="section-head__ic" />;
      case "catalog":
        return <UiTrackChanges className="section-head__ic" />;
      case "download":
        return <UiDownload className="section-head__ic" />;
      case "meta":
        return <UiNote className="section-head__ic" />;
      case "covers":
        return <UiImage className="section-head__ic" />;
      default:
        return <UiTrackChanges className="section-head__ic" />;
    }
  }, [studioPane]);

  return (
    <>
      <section className="surface-card surface-card--toolbar-only">
        <div className="section-head section-head--page-toolbar">
          <div className="section-head__lead">
            <span className="section-head__icon-wrap" aria-hidden>
              {studioOverviewIcon}
            </span>
            <div className="section-head__text">
              <p className="eyebrow">{t("tools.studioOverviewEyebrow")}</p>
              <div
                className="section-nav-tabs"
                role="group"
                aria-label={t("tools.studioPaneAria")}
              >
                <button
                  type="button"
                  className={`section-nav-tab${
                    studioPane === "listen" ? " is-on" : ""
                  }`}
                  onClick={() => setStudioPane("listen")}
                >
                  {t("tools.studioTabListen")}
                </button>
                <button
                  type="button"
                  className={`section-nav-tab${
                    studioPane === "catalog" ? " is-on" : ""
                  }`}
                  onClick={() => setStudioPane("catalog")}
                >
                  {t("tools.studioTabCatalog")}
                </button>
                <button
                  type="button"
                  className={`section-nav-tab${
                    studioPane === "download" ? " is-on" : ""
                  }`}
                  onClick={() => setStudioPane("download")}
                >
                  {t("tools.studioTabDownload")}
                </button>
                <button
                  type="button"
                  className={`section-nav-tab${
                    studioPane === "meta" ? " is-on" : ""
                  }`}
                  onClick={() => setStudioPane("meta")}
                >
                  {t("tools.studioTabMeta")}
                </button>
                <button
                  type="button"
                  className={`section-nav-tab${
                    studioPane === "covers" ? " is-on" : ""
                  }`}
                  onClick={() => setStudioPane("covers")}
                >
                  {t("tools.studioTabCovers")}
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="surface-card studio-page-card">
        <div className="tools tool-studio-layout">
          {studioPane === "listen" && libraryIndex ? (
            <div
              className="studio-pane studio-pane--listen"
              role="region"
              aria-label={t("tools.studioTabListen")}
            >
              <Suspense fallback={<p className="subtle sm">…</p>}>
                <LazyListenView
                  index={libraryIndex}
                  onOpenSection={onOpenSection ?? (() => {})}
                />
              </Suspense>
            </div>
          ) : null}
          {studioPane === "catalog" ? (
            <div
              className="studio-pane tools-shared-lib"
              role="region"
              aria-label={t("tools.catalogTitle")}
            >
              <div className="studio-catalog-browse tools-shared-browse">
                <div className="studio-catalog-head">
                  <p className="subtle sm tools-shared-browse-lead">
                    {catalogStudioMode === "web"
                      ? t("tools.catalogWebDesc")
                      : t("tools.catalogDesc")}
                  </p>
                  <div
                    className="tools-dl-studio-switch studio-catalog-head__mode-switch"
                    role="group"
                    aria-label={t("tools.catalogUiModeAria")}
                  >
                    <span
                      className={`tools-dl-studio-switch__label${
                        catalogStudioMode === "local" ? " is-active" : ""
                      }`}
                    >
                      {t("tools.catalogUiLocal")}
                    </span>
                    <button
                      type="button"
                      role="switch"
                      className="tools-dl-studio-switch__track"
                      aria-checked={catalogStudioMode === "web"}
                      aria-label={t("tools.catalogUiModeAria")}
                      onClick={() =>
                        setCatalogStudioMode((m) => {
                          const next = m === "local" ? "web" : "local";
                          if (next === "web") setCatalogArtistDetail(null);
                          return next;
                        })
                      }
                    >
                      <span
                        className="tools-dl-studio-switch__thumb"
                        aria-hidden
                      />
                    </button>
                    <span
                      className={`tools-dl-studio-switch__label${
                        catalogStudioMode === "web" ? " is-active" : ""
                      }`}
                    >
                      {t("tools.catalogUiWeb")}
                    </span>
                  </div>
                </div>
                {catalogStudioMode === "web" ? (
                  <StudioCatalogWeb
                    t={t}
                    active={studioPane === "catalog"}
                    onPickForDownload={pickCatalogWebForDownload}
                  />
                ) : (
                  <>
                {catalogLockedByEnv ? (
                  <p className="subtle sm warnline">
                    {t("tools.sharedEnvLock")}
                  </p>
                ) : null}
                {!catalogLockedByEnv ? (
                  <div className="studio-catalog-toolbar">
                    <div className="studio-catalog-toolbar__row">
                      <button
                        type="button"
                        className="primary-btn primary-btn--sm"
                        onClick={() => loadCatalogPane(true)}
                        disabled={catalogBusy}
                      >
                        {catalogBusy
                          ? t("tools.catalogLoading")
                          : t("tools.catalogReload")}
                      </button>
                      {catalogData && !catalogArtistDetail ? (
                        <input
                          type="search"
                          className="ghost-input ghost-input--search studio-catalog-toolbar__search"
                          value={catalogArtistQuery}
                          onChange={(e) => setCatalogArtistQuery(e.target.value)}
                          placeholder={t("tools.catalogSearchPlaceholder")}
                          aria-label={t("tools.catalogSearchAria")}
                        />
                      ) : null}
                    </div>
                    {catalogData && !catalogArtistDetail ? (
                      <label className="studio-catalog-toolbar__check">
                        <input
                          type="checkbox"
                          checked={catalogArtistOnlyAttention}
                          onChange={(e) =>
                            setCatalogArtistOnlyAttention(e.target.checked)
                          }
                        />
                        <span>{t("tools.catalogFilterNeedsAttention")}</span>
                      </label>
                    ) : null}
                  </div>
                ) : null}
                {mySelection?.includeAll ? (
                  <p className="subtle sm">{t("tools.catalogIncludeAll")}</p>
                ) : null}
                {catalogData ? (
                  <>
                    {catalogArtistDetail ? (
                      <>
                        <div className="section-head section-head--page-toolbar">
                          <div className="page-toolbar__lead page-toolbar__lead--backrow">
                            <button
                              type="button"
                              className="page-toolbar-back-ic"
                              onClick={() => setCatalogArtistDetail(null)}
                              aria-label={t("tools.catalogBackArtists")}
                            >
                              <UiChevronLeft
                                aria-hidden
                                className="page-toolbar-back-ic__ic"
                              />
                            </button>
                            <div className="page-toolbar__textcol">
                              <p className="eyebrow">{t("tools.catalogTabAlbums")}</p>
                              <h2>{catalogArtistDetail.name}</h2>
                            </div>
                          </div>
                        </div>
                        <div className="library-overview-cols">
                          {catalogArtistDetail.relAlbums.map((al) => {
                            const inIndex = indexHasAlbum(
                              libraryIndex,
                              al.relPath,
                            );
                            const sel = selectionHasAlbum(
                              mySelection,
                              al.relPath,
                              catalogArtistDetail.id,
                            );
                            return (
                              <StudioCatalogAlbumTile
                                key={al.relPath}
                                album={al}
                                artistName={catalogArtistDetail.name}
                                inLibraryIndex={inIndex}
                                inSelection={sel}
                                catalogBusy={catalogBusy}
                                selectionIncludeAll={
                                  Boolean(mySelection?.includeAll)
                                }
                                onAddToLibrary={() => addAlbumCatalog(al.relPath)}
                                onRemoveFromLibrary={() =>
                                  removeAlbumCatalog(al.relPath)
                                }
                                addLabel={t("tools.catalogAddLibrary")}
                                removeLabel={t("tools.catalogRemoveLibrary")}
                              />
                            );
                          })}
                        </div>
                      </>
                    ) : (
                      <>
                        {filteredCatalogArtists.length === 0 &&
                        catalogData.artists.length > 0 ? (
                          <p className="subtle sm studio-catalog-filter-empty">
                            {t("tools.catalogFilterEmpty")}
                          </p>
                        ) : (
                          <div className="library-overview-cols">
                            {filteredCatalogArtists.map((ar) => {
                              const coverRel = catalogArtistCoverRel(ar);
                              const inIndex = indexHasArtist(
                                libraryIndex,
                                ar.id,
                              );
                              const sel = selectionHasArtist(
                                mySelection,
                                ar.id,
                              );
                              return (
                                <StudioCatalogArtistTile
                                  key={ar.id}
                                  artist={ar}
                                  coverRelPath={coverRel}
                                  inLibraryIndex={inIndex}
                                  inSelection={sel}
                                  catalogBusy={catalogBusy}
                                  selectionIncludeAll={Boolean(
                                    mySelection?.includeAll,
                                  )}
                                  onOpen={() => openCatalogArtist(ar.id)}
                                  onAddToLibrary={() => addArtistCatalog(ar.id)}
                                  onRemoveFromLibrary={() =>
                                    removeArtistCatalog(ar.id)
                                  }
                                  addLabel={t("tools.catalogAddLibrary")}
                                  removeLabel={t("tools.catalogRemoveLibrary")}
                                />
                              );
                            })}
                          </div>
                        )}
                      </>
                    )}
                  </>
                ) : null}
                {catalogMsg ? <p className="subtle sm">{catalogMsg}</p> : null}
                {catalogErr ? (
                  <p className="subtle sm warnline">{catalogErr}</p>
                ) : null}
                  </>
                )}
              </div>
            </div>
          ) : null}

          {studioPane === "download" ? (
            <div
              className="studio-pane tools-download"
              role="region"
              aria-label={t("tools.downloadTitle")}
            >
              <div className="studio-panel tools-dl-dest">
                <div className="tools-dl-dest__head">
                  <div className="tools-dl-dest__head-text">
                    <h4 className="studio-panel-title">
                      {t("tools.dlSaveFolder")}
                    </h4>
                    <p className="subtle sm tools-dl-dest__lead">
                      {t("tools.dlDestLead")}
                    </p>
                  </div>
                  <div
                    className="tools-dl-studio-switch tools-dl-dest__mode-switch"
                    role="group"
                    aria-label={t("tools.dlUiModeAria")}
                  >
                    <span
                      className={`tools-dl-studio-switch__label${
                        dlStudioMode === "classic" ? " is-active" : ""
                      }`}
                    >
                      {t("tools.dlUiClassic")}
                    </span>
                    <button
                      type="button"
                      role="switch"
                      className="tools-dl-studio-switch__track"
                      aria-checked={dlStudioMode === "explore"}
                      aria-label={t("tools.dlUiModeAria")}
                      onClick={() =>
                        setDlStudioMode((m) =>
                          m === "classic" ? "explore" : "classic",
                        )
                      }
                    >
                      <span
                        className="tools-dl-studio-switch__thumb"
                        aria-hidden
                      />
                    </button>
                    <span
                      className={`tools-dl-studio-switch__label${
                        dlStudioMode === "explore" ? " is-active" : ""
                      }`}
                    >
                      {t("tools.dlUiExplore")}
                    </span>
                  </div>
                </div>
                <div className="tools-dl-dest__shell">
                  <div className="tools-dl-dest__pathheader">
                    <p
                      className="tools-dl-dest__label"
                      id="tools-dl-dest-where"
                    >
                      {t("tools.dlPathLabel")}
                    </p>
                    <div className="tools-dl-dest__pathbar">
                      <button
                        type="button"
                        className="tools-dl-dest__up-icon"
                        onClick={() => {
                          if (dlList) loadDlFs(dlList.parent || "");
                        }}
                        disabled={!dlList?.path}
                        title={t("tools.up")}
                        aria-label={t("tools.upFolderAria")}
                      >
                        <DlDestUpIcon />
                      </button>
                      <nav
                        className="breadcrumbs tools-dl-dest__crumbs"
                        aria-labelledby="tools-dl-dest-where"
                      >
                        <button
                          type="button"
                          className="crumb"
                          onClick={() => loadDlFs("")}
                        >
                          {dlList?.musicRoot?.split("/").pop() ||
                            t("tools.musicRoot")}
                        </button>
                        {(dlList?.path || "")
                          .split("/")
                          .filter(Boolean)
                          .map((seg, i, arr) => {
                            const pth = arr.slice(0, i + 1).join("/");
                            return (
                              <span className="tools-dl-dest__bc" key={pth}>
                                <span
                                  className="tools-dl-dest__bc-sep"
                                  aria-hidden
                                >
                                  <UiChevronRight className="tools-dl-dest__bc-ic" />
                                </span>
                                <button
                                  type="button"
                                  className="crumb"
                                  onClick={() => loadDlFs(pth)}
                                >
                                  {seg}
                                </button>
                              </span>
                            );
                          })}
                      </nav>
                    </div>
                  </div>

                  <div className="tools-dl-dest__search">
                    <input
                      type="search"
                      className="w-full"
                      value={dlDirQuery}
                      onChange={(e) => setDlDirQuery(e.target.value)}
                      placeholder={t("tools.dlFolderSearchPh")}
                      aria-label={t("tools.dlFolderSearchAria")}
                    />
                    {dlDirQuery.trim() ? (
                      <div className="tools-dl-dest__search-results">
                        {dlDirSearchBusy ? (
                          <p className="subtle sm">{t("tools.searching")}</p>
                        ) : dlDirResults.length ? (
                          <ul className="tools-dl-dest__dirlist">
                            {dlDirResults.map((d) => (
                              <li key={d.relPath}>
                                <button
                                  type="button"
                                  className="tools-dl-dest__dirbtn"
                                  onClick={() => {
                                    loadDlFs(d.relPath);
                                    setDlDirQuery("");
                                  }}
                                >
                                  <DlDestFolderGlyph className="tools-dl-dest__dir-ic" />
                                  <span className="tools-dl-dest__dir-name">
                                    {d.relPath}
                                  </span>
                                </button>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="subtle sm">{t("tools.dlFolderSearchEmpty")}</p>
                        )}
                      </div>
                    ) : null}
                  </div>

                  <div
                    className="tools-dl-dest__browser"
                    role="group"
                    aria-label={t("tools.dlSubfolders")}
                  >
                    {dlList && dlList.dirs.length === 0 ? (
                      <p className="subtle sm tools-dl-dest__empty">
                        {t("tools.dlEmptyFolders")}
                      </p>
                    ) : null}
                    <ul className="tools-dl-dest__dirlist">
                      {dlList?.dirs.map((d) => (
                        <li key={d.relPath}>
                          <button
                            type="button"
                            className="tools-dl-dest__dirbtn"
                            onClick={() => loadDlFs(d.relPath)}
                          >
                            <DlDestFolderGlyph className="tools-dl-dest__dir-ic" />
                            <span className="tools-dl-dest__dir-name">
                              {d.name}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div
                    className="tools-dl-dest__create"
                    aria-label={
                      dlMkdirBlockedInAlbum
                        ? t("tools.dlMkdirBlockedInAlbum")
                        : t("tools.dlNewSubLabel")
                    }
                  >
                    {dlMkdirBlockedInAlbum ? (
                      <p className="subtle sm tools-dl-dest__mkdir-blocked">
                        {t("tools.dlMkdirBlockedInAlbum")}
                      </p>
                    ) : (
                      <>
                        <p className="tools-dl-dest__label tools-dl-dest__label--inline">
                          {t("tools.dlNewSubLabel")}
                        </p>
                        <div className="tools-dl-dest__newrow">
                          <input
                            type="text"
                            className="tools-dl-dest__newinput"
                            minLength={1}
                            maxLength={200}
                            placeholder={t("tools.newFolderPh")}
                            value={newDirName}
                            onChange={(e) => setNewDirName(e.target.value)}
                            onKeyDown={(e) => {
                              if (
                                e.key === "Enter" &&
                                newDirName.trim() &&
                                dlList
                              ) {
                                e.preventDefault();
                                doCreateFolder();
                              }
                            }}
                            aria-label={t("tools.newFolderAria")}
                          />
                          <button
                            type="button"
                            className="ghost-btn"
                            disabled={
                              mkBusy || !newDirName.trim() || !dlList
                            }
                            onClick={doCreateFolder}
                          >
                            {mkBusy ? t("tools.creating") : t("tools.createHere")}
                          </button>
                        </div>
                      </>
                    )}
                  </div>

                  {hasValidDownloadDest ? (
                    <div className="tools-dl-dest__picked" role="status">
                      {t("tools.destLine", {
                        path: dlPath,
                      })}
                    </div>
                  ) : (
                    <p className="subtle sm warnline tools-dl-dest__warn">
                      {t("tools.confirmFolderWarn")}
                    </p>
                  )}
                </div>
              </div>

              <div className="studio-panel">
                {dlStudioMode === "explore" ? (
                  <StudioDownloadExplore
                    t={t}
                    dlPath={dlPath}
                    singleBlockedArtistFolder={exploreSingleBlockedArtistFolder}
                    resolveOutputDir={(path, item) =>
                      resolveStudioDownloadOutputDir(
                        path,
                        exploreScopeForItem(item),
                        exploreScopeForItem(item) === "playlist"
                          ? item.title
                          : undefined,
                      )
                    }
                    downloadKindForItem={(item) =>
                      studioDownloadKindForScope(exploreScopeForItem(item))
                    }
                    hasValidDownloadDest={hasValidDownloadDest}
                    dlBusy={dlBusy}
                    onBusyChange={setDlBusy}
                    onProgress={setDlProg}
                    onTrackProgress={setDlTrackProg}
                    onLog={setLog}
                    onReconcileLibrary={onReconcileLibrary}
                    onPrepareDownload={prepareExploreDownload}
                    downloadSummaryLine={downloadSummaryLine}
                    onDownloadIdChange={(id) => {
                      dlActiveDownloadIdRef.current = id;
                    }}
                  />
                ) : (
                  <>
                <h4 className="studio-panel-title">
                  {t("tools.dlLinkSection")}
                </h4>
                <div className="tools-dl-modes">
                  <div className="tools-dl-mode">
                    <div
                      className="tools-dl-mode__seg"
                      role="group"
                      aria-label={t("tools.dlModeHelpAria")}
                    >
                      <button
                        type="button"
                        className={`tools-dl-mode__btn${
                          dlUrlMode === "single" ? " is-on" : ""
                        }`}
                        aria-pressed={dlUrlMode === "single"}
                        onClick={() => setDlUrlMode("single")}
                      >
                        {t("tools.dlTypeSingle")}
                      </button>
                      <button
                        type="button"
                        className={`tools-dl-mode__btn${
                          dlUrlMode === "playlist" ? " is-on" : ""
                        }`}
                        aria-pressed={dlUrlMode === "playlist"}
                        onClick={() => setDlUrlMode("playlist")}
                      >
                        {t("tools.dlTypePlaylist")}
                      </button>
                      <button
                        type="button"
                        className={`tools-dl-mode__btn${
                          dlUrlMode === "releases" ? " is-on" : ""
                        }`}
                        aria-pressed={dlUrlMode === "releases"}
                        onClick={() => setDlUrlMode("releases")}
                      >
                        {t("tools.dlTypeReleases")}
                      </button>
                    </div>
                    <span className="tools-dl-mode__help-wrap">
                      <button
                        type="button"
                        className="tools-dl-mode__help"
                        aria-label={t("tools.dlModeHelpAria")}
                      >
                        ?
                      </button>
                      <span className="tools-dl-mode__tip" role="tooltip">
                        {t("tools.dlModeGuide")}
                      </span>
                    </span>
                  </div>
                </div>
                <input
                  type="url"
                  className="w-full"
                  placeholder={dlUrlPlaceholder}
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  autoComplete="off"
                  aria-invalid={url.trim() !== "" && !dlUrlValid}
                />
                {showMultiAlbumPicker ? (
                  <div className="tools-dl-releases">
                    {relPayload ? (
                      <div className="tools-dl-releases__picks tools-dl-releases__picks--full">
                        <p className="subtle sm">
                          {relPayload.listTitle
                            ? relPayload.listTitle
                            : relPayload.uploader
                            ? t("tools.dlReleasesUploader", {
                                name: relPayload.uploader,
                              })
                            : null}
                        </p>
                        <div className="tools-dl-releases__toolbar">
                          {relPayload.entries.length > 1 ? (
                            <input
                              type="search"
                              className="w-full"
                              value={relQuery}
                              onChange={(e) => setRelQuery(e.target.value)}
                              placeholder={t("tools.dlReleaseSearchPh")}
                              aria-label={t("tools.dlReleaseSearchAria")}
                            />
                          ) : null}
                          <button
                            type="button"
                            className="ghost-btn ghost-btn--sm"
                            onClick={() =>
                              setRelSel(
                                new Set(filteredRelEntries.map((e) => e.id))
                              )
                            }
                          >
                            {t("tools.dlSelectAll")}
                          </button>
                          <button
                            type="button"
                            className="ghost-btn ghost-btn--sm"
                            onClick={() => setRelSel(new Set())}
                          >
                            {t("tools.dlSelectNone")}
                          </button>
                        </div>
                        <div
                          className="tools-dl-releases__sections"
                          aria-busy={!relStreamComplete}
                        >
                          {filteredRelAlbums.length > 0 ? (
                            <section
                              className="tools-dl-releases__section"
                              aria-label={t("tools.catalogWebAlbumsSection")}
                            >
                              <h4 className="tools-dl-releases__section-title">
                                {t("tools.catalogWebAlbumsSection")}
                                <span className="tools-dl-releases__section-count">
                                  {filteredRelAlbums.length}
                                </span>
                              </h4>
                              <ul className="tools-dl-releases__list tools-dl-releases__list--grid">
                                {filteredRelAlbums.map((e) => (
                                  <li
                                    key={e.id}
                                    className="tools-dl-releases__row"
                                  >
                                    <label className="tools-dl-releases__check">
                                      <input
                                        type="checkbox"
                                        checked={relSel.has(e.id)}
                                        onChange={() => toggleRelEntry(e.id)}
                                      />
                                      <span
                                        className="tools-dl-releases__title"
                                        title={e.url}
                                      >
                                        {e.title}
                                      </span>
                                      <span
                                        className={`tools-dl-releases__trackcount${
                                          relEnrichBusy && e.trackCount == null
                                            ? " tools-dl-releases__trackcount--pending"
                                            : ""
                                        }`}
                                        aria-label={
                                          e.trackCount != null
                                            ? t("tools.dlTrackCountAria", {
                                                n: e.trackCount,
                                              })
                                            : relEnrichBusy
                                              ? t(
                                                  "tools.dlTrackCountPendingAria",
                                                )
                                              : undefined
                                        }
                                      >
                                        {e.trackCount != null
                                          ? t("tools.dlTrackCount", {
                                              n: e.trackCount,
                                            })
                                          : relEnrichBusy
                                            ? t("tools.dlTrackCountPending")
                                            : t("tools.dlTrackCountUnknown")}
                                      </span>
                                    </label>
                                  </li>
                                ))}
                              </ul>
                            </section>
                          ) : null}
                          {filteredRelSongs.length > 0 ? (
                            <section
                              className="tools-dl-releases__section"
                              aria-label={t("tools.catalogWebSongsSection")}
                            >
                              <h4 className="tools-dl-releases__section-title">
                                {t("tools.catalogWebSongsSection")}
                                <span className="tools-dl-releases__section-count">
                                  {filteredRelSongs.length}
                                </span>
                              </h4>
                              <ul className="tools-dl-releases__list tools-dl-releases__list--grid">
                                {filteredRelSongs.map((e) => (
                                  <li
                                    key={e.id}
                                    className="tools-dl-releases__row"
                                  >
                                    <label className="tools-dl-releases__check">
                                      <input
                                        type="checkbox"
                                        checked={relSel.has(e.id)}
                                        onChange={() => toggleRelEntry(e.id)}
                                      />
                                      <span
                                        className="tools-dl-releases__title"
                                        title={e.url}
                                      >
                                        {e.title}
                                      </span>
                                      <span
                                        className={`tools-dl-releases__trackcount${
                                          relEnrichBusy && e.trackCount == null
                                            ? " tools-dl-releases__trackcount--pending"
                                            : ""
                                        }`}
                                        aria-label={
                                          e.trackCount != null
                                            ? t("tools.dlTrackCountAria", {
                                                n: e.trackCount,
                                              })
                                            : relEnrichBusy
                                              ? t(
                                                  "tools.dlTrackCountPendingAria",
                                                )
                                              : undefined
                                        }
                                      >
                                        {e.trackCount != null
                                          ? t("tools.dlTrackCount", {
                                              n: e.trackCount,
                                            })
                                          : relEnrichBusy
                                            ? t("tools.dlTrackCountPending")
                                            : t("tools.dlTrackCountUnknown")}
                                      </span>
                                    </label>
                                  </li>
                                ))}
                              </ul>
                            </section>
                          ) : null}
                        </div>
                        {relEnrichBusy ? (
                          <p
                            className="subtle sm tools-dl-releases__enrich"
                            role="status"
                          >
                            {t("tools.dlReleasesEnriching")}
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                    <div className="studio-inline-actions studio-inline-actions--spaced tools-dl-actions-row">
                      {!relPayload ? (
                        <button
                          type="button"
                          className="primary-btn"
                          onClick={loadReleasesCatalog}
                          disabled={
                            relLoadBusy ||
                            !url.trim() ||
                            !hasValidDownloadDest ||
                            !dlUrlValid
                          }
                        >
                          {relLoadBusy
                            ? t("tools.dlReleasesLoading")
                            : t("tools.dlLoadReleases")}
                        </button>
                      ) : dlBusy ? (
                        <span className="subtle sm" role="status">
                          {t("tools.inProgress")}
                        </span>
                      ) : (
                        <>
                          <StudioDownloadDisclaimer t={t} />
                          <div className="tools-dl-actions-row__cta">
                            <button
                              type="button"
                              className="primary-btn"
                              onClick={runReleasesDl}
                              disabled={
                                dlBusy ||
                                relLoadBusy ||
                                !hasValidDownloadDest ||
                                relSel.size === 0 ||
                                !relStreamComplete ||
                                !dlUrlValid ||
                                releasesDlBlockedAlbumFolder
                              }
                            >
                              {t("tools.dlDownloadSelected")}
                            </button>
                            {releasesDlBlockedAlbumFolder ? (
                              <p className="subtle sm tools-dl-releases__blocked-hint">
                                {t("tools.dlReleasesBlockedAlbumFolderHint")}
                              </p>
                            ) : null}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="studio-inline-actions studio-inline-actions--spaced tools-dl-actions-row">
                    {dlBusy ? (
                      <span className="subtle sm" role="status">
                        {t("tools.inProgress")}
                      </span>
                    ) : (
                      <>
                        <StudioDownloadDisclaimer t={t} />
                        <button
                          type="button"
                          className="primary-btn tools-dl-actions-row__cta"
                          onClick={runDl}
                          disabled={
                            dlBusy ||
                            !url.trim() ||
                            !hasValidDownloadDest ||
                            !dlUrlValid
                          }
                        >
                          {t("tools.downloadRun")}
                        </button>
                      </>
                    )}
                  </div>
                )}
                  </>
                )}
                {showDlProgressWrap && (
                  <div
                    className={[
                      "dl-progress-wrap",
                      showDualDlProgressBar ? "dl-progress-wrap--dual" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    aria-live="polite"
                  >
                    {dlBusy ? (
                      <div className="dl-progress-stop-row">
                        <button
                          type="button"
                          className="ghost-btn danger ghost-btn--sm"
                          onClick={stopStudioDownload}
                        >
                          {t("tools.dlStop")}
                        </button>
                      </div>
                    ) : null}
                    {showDualDlProgressBar ? (
                      <>
                        <div className="dl-progress-block">
                          <div className="dl-progress-top">
                            <strong>{t("tools.dlProgressAlbumsLabel")}</strong>
                            <span>
                              {dlBusy
                                ? dlProgNorm
                                  ? t("tools.dlProgressCount", {
                                      cur: dlProgNorm.cur,
                                      tot: dlProgNorm.tot,
                                    })
                                  : t("tools.inProgress")
                                : dlProgNorm
                                ? t("tools.dlProgressCount", {
                                    cur: dlProgNorm.cur,
                                    tot: dlProgNorm.tot,
                                  })
                                : t("common.emDash")}
                            </span>
                          </div>
                          <div className="dl-progress-rail">
                            <div
                              className="dl-progress-fill"
                              style={{
                                width: dlProgNorm
                                  ? `${dlProgNorm.pct}%`
                                  : dlBusy
                                  ? "18%"
                                  : "0%",
                              }}
                            />
                          </div>
                        </div>
                        {dlTrackNorm ? (
                          <div className="dl-progress-block">
                            <div className="dl-progress-top">
                              <strong>
                                {t("tools.dlProgressTracksInAlbum")}
                              </strong>
                              <span>
                                {dlTrackNorm.hasTotal
                                  ? t("tools.dlProgressCount", {
                                      cur: dlTrackNorm.cur,
                                      tot: dlTrackNorm.tot,
                                    })
                                  : t("tools.dlProgressTrackWait")}
                              </span>
                            </div>
                            <div className="dl-progress-rail">
                              <div
                                className="dl-progress-fill"
                                style={{ width: `${dlTrackNorm.pct}%` }}
                              />
                            </div>
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <>
                        <div className="dl-progress-top">
                          <strong>{t("tools.progress")}</strong>
                          <span>
                            {dlBusy
                              ? singleDlBarNorm
                                ? singleDlBarNorm.hasTotal
                                  ? t("tools.dlProgressCount", {
                                      cur: singleDlBarNorm.cur,
                                      tot: singleDlBarNorm.tot,
                                    })
                                  : t("tools.dlProgressTrackWait")
                                : t("tools.inProgress")
                              : singleDlBarNorm
                              ? singleDlBarNorm.hasTotal
                                ? t("tools.dlProgressCount", {
                                    cur: singleDlBarNorm.cur,
                                    tot: singleDlBarNorm.tot,
                                  })
                                : t("tools.dlProgressTrackWait")
                              : t("common.emDash")}
                          </span>
                        </div>
                        <div className="dl-progress-rail">
                          <div
                            className="dl-progress-fill"
                            style={{
                              width: singleDlBarNorm
                                ? `${singleDlBarNorm.pct}%`
                                : dlBusy
                                ? "18%"
                                : "0%",
                            }}
                          />
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>

              <div className="studio-log">
                <label className="subtle sm">{t("tools.logLabel")}</label>
                <textarea
                  className="log"
                  value={log}
                  onChange={(e) => setLog(e.target.value)}
                  rows={4}
                />
                <button
                  type="button"
                  className="linkbtn"
                  onClick={() => setLog("")}
                >
                  {t("tools.clear")}
                </button>
              </div>
            </div>
          ) : null}

          {studioPane === "meta" ? (
            <div
              className="studio-pane tools-meta"
              role="region"
              aria-label={t("tools.metaTitle")}
            >
              <div className="studio-meta-split">
                <div className="studio-meta-split__primary">
                  <div className="studio-panel studio-meta-picks">
                    <div className="tools-shared-browse-picks tools-studio-pair-picks">
                      <div>
                        <label
                          className="subtle sm block-label"
                          htmlFor="meta-artist-sel"
                        >
                          {t("tools.sharedPickArtist")}
                        </label>
                        <select
                          id="meta-artist-sel"
                          className="select"
                          value={metaArtistName}
                          onChange={(e) => {
                            const v = e.target.value;
                            setMetaArtistName(v);
                            setMetaAlbumPath("");
                          }}
                          aria-label={t("tools.sharedPickArtist")}
                        >
                          <option value="">
                            {t("tools.sharedPickPlaceholder")}
                          </option>
                          {libraryArtistsSorted.map((a) => (
                            <option key={a.name} value={a.name}>
                              {a.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label
                          className="subtle sm block-label"
                          htmlFor="meta-album-sel"
                        >
                          {t("tools.sharedPickAlbum")}
                        </label>
                        <select
                          id="meta-album-sel"
                          className="select"
                          value={metaAlbumPath}
                          onChange={(e) => {
                            const v = e.target.value;
                            setMetaAlbumPath(v);
                            const o = metaAlbumsForPick.find(
                              (x) => x.relPath === v
                            );
                            if (o) {
                              setMetaArt(metaArtistName);
                              setMetaAlb(o.name);
                            }
                          }}
                          disabled={!metaArtistName}
                          aria-label={t("tools.metaAlbumAria")}
                        >
                          {!metaArtistName ? (
                            <option value="">
                              {t("tools.sharedAlbumNeedArtist")}
                            </option>
                          ) : (
                            <>
                              <option value="">{t("tools.pickAlbum")}</option>
                              {metaAlbumsForPick.map((o) => (
                                <option key={o.relPath} value={o.relPath}>
                                  {o.name}
                                </option>
                              ))}
                            </>
                          )}
                        </select>
                      </div>
                    </div>
                    {metaAlbumPath ? (
                      <p className="art-target sm">
                        {t("tools.folderLine", { path: metaAlbumPath })}
                      </p>
                    ) : null}
                    <div className="studio-action-row studio-meta-fill-row">
                      <button
                        type="button"
                        className="ghost-btn ghost-btn--sm"
                        onClick={setMetaFromCurrent}
                        disabled={!p.current || studioMetaBusy}
                      >
                        {t("tools.metaFillFromPlayback")}
                      </button>
                    </div>
                  </div>

                  <div className="studio-panel studio-meta-essentials">
                    <h4 className="studio-panel-title">
                      {t("tools.metaEssentials")}
                    </h4>
                    <div className="studio-action-groups">
                      <div className="studio-action-group">
                        <span className="studio-action-group-label">
                          {t("tools.metaAlbumSectionLabel")}
                        </span>
                        <p className="subtle sm studio-meta-essentials-hint">
                          {t("tools.metaEssentialsAlbumSub")}
                        </p>
                        <div className="studio-action-row studio-meta-equal-btns">
                          <button
                            type="button"
                            className="ghost-btn"
                            onClick={fetchOneAlbumMeta}
                            disabled={!metaAlbumPath?.trim() || studioMetaBusy}
                          >
                            {metaBusy
                              ? t("tools.fetchingMeta")
                              : t("tools.metaBtnSelectedAlbum")}
                          </button>
                          <button
                            type="button"
                            className="primary-btn"
                            onClick={() => setMetaScanChoiceOpen("album")}
                            disabled={!library || studioMetaBusy}
                            title={t("tools.scanAlbumsTitle")}
                          >
                            {metaAllBusy
                              ? t("tools.scanning")
                              : t("tools.metaBtnScanAuto")}
                          </button>
                        </div>
                      </div>
                      <div className="studio-action-group">
                        <span className="studio-action-group-label">
                          {t("tools.tracks")}
                        </span>
                        <p className="subtle sm studio-meta-essentials-hint">
                          {t("tools.metaEssentialsTracksSub")}
                        </p>
                        <div className="studio-action-row studio-meta-equal-btns">
                          <button
                            type="button"
                            className="ghost-btn"
                            onClick={fetchCurrentTrackMeta}
                            disabled={!p.current || studioMetaBusy}
                          >
                            {trackMetaBusy ? "…" : t("tools.currentTrackMeta")}
                          </button>
                          <button
                            type="button"
                            className="primary-btn"
                            onClick={() => setMetaScanChoiceOpen("track")}
                            disabled={!library || studioMetaBusy}
                          >
                            {trackAllBusy
                              ? t("tools.scanning")
                              : t("tools.scanAllTracks")}
                          </button>
                        </div>
                      </div>
                    </div>
                    {metaAllBusy && metaScanProg && metaScanProg.total > 0 ? (
                      <div className="dl-progress-wrap">
                        <div className="dl-progress-top">
                          <span>{t("tools.progressAlbumMeta")}</span>
                          <span>
                            {metaScanProg.current}/{metaScanProg.total}
                          </span>
                        </div>
                        <div className="dl-progress-rail">
                          <div
                            className="dl-progress-fill"
                            style={{
                              width: `${Math.max(
                                2,
                                Math.min(
                                  100,
                                  (metaScanProg.current / metaScanProg.total) *
                                    100
                                )
                              )}%`,
                            }}
                          />
                        </div>
                      </div>
                    ) : null}
                    {trackAllBusy &&
                    trackScanProg &&
                    trackScanProg.total > 0 ? (
                      <div className="dl-progress-wrap">
                        <div className="dl-progress-top">
                          <span>{t("tools.progressTrackMeta")}</span>
                          <span>
                            {trackScanProg.current}/{trackScanProg.total}
                          </span>
                        </div>
                        <div className="dl-progress-rail">
                          <div
                            className="dl-progress-fill"
                            style={{
                              width: `${Math.max(
                                2,
                                Math.min(
                                  100,
                                  (trackScanProg.current /
                                    trackScanProg.total) *
                                    100
                                )
                              )}%`,
                            }}
                          />
                        </div>
                      </div>
                    ) : null}
                    {trackPruneBusy &&
                    trackPruneProg &&
                    trackPruneProg.total > 0 ? (
                      <div className="dl-progress-wrap">
                        <div className="dl-progress-top">
                          <span>{t("tools.progressTrackMetaPrune")}</span>
                          <span>
                            {trackPruneProg.current}/{trackPruneProg.total}
                          </span>
                        </div>
                        <div className="dl-progress-rail">
                          <div
                            className="dl-progress-fill"
                            style={{
                              width: `${Math.max(
                                2,
                                Math.min(
                                  100,
                                  (trackPruneProg.current /
                                    trackPruneProg.total) *
                                    100
                                )
                              )}%`,
                            }}
                          />
                        </div>
                      </div>
                    ) : null}
                    {(metaAllBusy || trackAllBusy || trackPruneBusy) && (
                      <div className="studio-stop-row">
                        {metaAllBusy ? (
                          <button
                            type="button"
                            className="ghost-btn ghost-btn--sm"
                            onClick={() => {
                              stopMetaAll.current = true;
                            }}
                          >
                            {t("tools.stopAlbums")}
                          </button>
                        ) : null}
                        {trackAllBusy ? (
                          <button
                            type="button"
                            className="ghost-btn ghost-btn--sm"
                            onClick={() => {
                              stopTrackAll.current = true;
                            }}
                          >
                            {t("tools.stopTracks")}
                          </button>
                        ) : null}
                        {trackPruneBusy ? (
                          <button
                            type="button"
                            className="ghost-btn ghost-btn--sm"
                            onClick={() => {
                              stopTrackPrune.current = true;
                            }}
                          >
                            {t("tools.stopTrackPrune")}
                          </button>
                        ) : null}
                      </div>
                    )}
                    <div className="studio-meta-if-needed">
                      <button
                        type="button"
                        className="ghost-btn ghost-btn--sm"
                        onClick={() => {
                          void runPruneOrphanTrackMeta();
                        }}
                        disabled={!library || studioMetaBusy}
                        title={t("tools.trackMetaPruneTitle")}
                      >
                        {trackPruneBusy
                          ? "…"
                          : t("tools.trackMetaPruneOrphans")}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="studio-meta-split__secondary">
                  <div className="studio-meta-optional">
                    <button
                      type="button"
                      className="studio-meta-optional__toggle"
                      onClick={() => setMetaOptionalOpen((v) => !v)}
                      aria-expanded={metaOptionalOpen}
                    >
                      <span>{t("tools.metaOptional")}</span>
                      <UiChevronRight
                        className={
                          metaOptionalOpen
                            ? "studio-meta-optional__chev is-open"
                            : "studio-meta-optional__chev"
                        }
                        aria-hidden
                      />
                    </button>
                    {metaOptionalOpen ? (
                      <div className="studio-meta-optional__body studio-action-groups">
                        <div className="studio-action-group">
                          <span className="studio-action-group-label">
                            {t("tools.metaOptionalTitles")}
                          </span>
                          <p className="subtle sm studio-hint-line">
                            {t("tools.titleHint")}
                          </p>
                          <div className="studio-action-row studio-meta-equal-btns">
                            <button
                              type="button"
                              className="ghost-btn"
                              disabled={!metaAlbumPath || studioMetaBusy}
                              onClick={() => runSanitizeTitles("album", true)}
                            >
                              {titleSanBusy ? "…" : t("tools.previewAlbum")}
                            </button>
                            <button
                              type="button"
                              className="primary-btn"
                              disabled={!metaAlbumPath || studioMetaBusy}
                              onClick={() => runSanitizeTitles("album", false)}
                            >
                              {titleSanBusy ? "…" : t("tools.applyAlbum")}
                            </button>
                          </div>
                          {serverLocalAccess ? (
                            <div className="studio-action-row studio-meta-equal-btns">
                              <button
                                type="button"
                                className="ghost-btn"
                                disabled={!library || studioMetaBusy}
                                onClick={() => runSanitizeTitles("all", true)}
                              >
                                {titleSanBusy ? "…" : t("tools.previewLibrary")}
                              </button>
                              <button
                                type="button"
                                className="primary-btn"
                                disabled={!library || studioMetaBusy}
                                onClick={() => runSanitizeTitles("all", false)}
                              >
                                {titleSanBusy ? "…" : t("tools.applyLibrary")}
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <div className="studio-log">
                    <label className="subtle sm">{t("tools.logLabel")}</label>
                    <textarea
                      className="log"
                      value={metaLog}
                      onChange={(e) => setMetaLog(e.target.value)}
                      rows={3}
                    />
                    <button
                      type="button"
                      className="linkbtn"
                      onClick={() => setMetaLog("")}
                    >
                      {t("tools.clear")}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {studioPane === "covers" ? (
            <div
              className="studio-pane tools-art"
              role="region"
              aria-label={t("tools.coversTitle")}
            >
              <div className="studio-covers-split">
                <div className="studio-panel">
                  <h4 className="studio-panel-title">
                    {t("tools.coversSave")}
                  </h4>
                  <div className="tools-shared-browse-picks tools-studio-pair-picks tools-cover-save-picks">
                    <div>
                      <label
                        className="subtle sm block-label"
                        htmlFor="cover-artist-sel"
                      >
                        {t("tools.sharedPickArtist")}
                      </label>
                      <select
                        id="cover-artist-sel"
                        className="select"
                        value={coverPickArtist}
                        onChange={(e) => {
                          setCoverPickArtist(e.target.value);
                          setAlbumForCover("");
                        }}
                        aria-label={t("tools.sharedPickArtist")}
                      >
                        <option value="">
                          {t("tools.sharedPickPlaceholder")}
                        </option>
                        {libraryArtistsSorted.map((a) => (
                          <option key={a.name} value={a.name}>
                            {a.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label
                        className="subtle sm block-label"
                        htmlFor="cover-album-sel"
                      >
                        {t("tools.sharedPickAlbum")}
                      </label>
                      <select
                        id="cover-album-sel"
                        className="select"
                        value={albumForCover}
                        onChange={(e) => setAlbumForCover(e.target.value)}
                        disabled={!coverPickArtist}
                        aria-label={t("tools.coversPickAria")}
                      >
                        {!coverPickArtist ? (
                          <option value="">
                            {t("tools.sharedAlbumNeedArtist")}
                          </option>
                        ) : (
                          <>
                            <option value="">{t("tools.pickAlbum")}</option>
                            {coverAlbumsForPick.map((o) => (
                              <option key={o.relPath} value={o.relPath}>
                                {o.name}
                              </option>
                            ))}
                          </>
                        )}
                      </select>
                    </div>
                  </div>
                  {albumForCover ? (
                    <p className="art-target sm">
                      <code>{albumForCover}</code>
                    </p>
                  ) : null}
                </div>

                <div className="studio-panel">
                  <h4 className="studio-panel-title">
                    {t("tools.coversSearch")}
                  </h4>
                  <div className="art-fields">
                    <label className="art-field art-field--full">
                      <span className="subtle sm block-label">
                        {t("tools.coverSearchLabel")}
                      </span>
                      <input
                        type="text"
                        className="flex1"
                        value={artQuery}
                        onChange={(e) => setArtQuery(e.target.value)}
                        placeholder={t("tools.coverSearchPh")}
                      />
                    </label>
                  </div>
                  <div className="studio-inline-actions studio-inline-actions--spaced">
                    <button
                      type="button"
                      className="ghost-btn ghost-btn--sm"
                      onClick={useCurrentForArt}
                    >
                      {t("tools.fillFromPlayback")}
                    </button>
                    <button
                      type="button"
                      className="primary-btn"
                      onClick={doArtSearch}
                      disabled={artBusy}
                    >
                      {artBusy ? t("tools.searching") : t("tools.searchCovers")}
                    </button>
                  </div>
                </div>
              </div>

              <div className="artgrid2">
                {artRes.map((a, i) => (
                  <div key={i + a.artwork} className="artcard2">
                    <div className="artcard2-img">
                      <CoverImg src={a.artwork} alt="" decoding="async" />
                      {a.source ? (
                        <span className="art-src">{sourceLabel(a.source)}</span>
                      ) : null}
                    </div>
                    <div className="artcap2">
                      <strong>{a.artist}</strong>
                      <br />
                      {a.name}
                    </div>
                    <div className="art-actions">
                      <a
                        className="extlink"
                        href={a.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {extLinkLabel(a.url, t("common.open"))}
                      </a>
                      <button
                        type="button"
                        className="primary-btn primary-btn--sm"
                        disabled={artBusy || !albumForCover}
                        onClick={() => applyCover(a.artwork)}
                      >
                        {t("tools.saveCover")}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              {artRes.length === 0 &&
              !artBusy &&
              artQuery.length > 0 ? (
                <p className="subtle sm studio-panel-gap">
                  {t("tools.noCoverResults")}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>
      {metaScanChoiceOpen ? (
        <div
          className="meta-edit-backdrop"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setMetaScanChoiceOpen(null);
          }}
        >
          <div
            className="meta-edit-dialog surface-card studio-scan-choice"
            role="dialog"
            aria-modal="true"
            aria-labelledby="scan-choice-title"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h4 className="studio-scan-choice__title" id="scan-choice-title">
              {metaScanChoiceOpen === "album"
                ? t("tools.scanChoiceAlbumTitle")
                : t("tools.scanChoiceTrackTitle")}
            </h4>
            <p className="subtle sm studio-scan-choice__hint">
              {metaScanChoiceOpen === "album"
                ? t("tools.scanChoiceAlbumHint")
                : t("tools.scanChoiceTrackHint")}
            </p>
            <div className="studio-scan-choice__actions">
              <button
                type="button"
                className="ghost-btn"
                onClick={() => {
                  const k = metaScanChoiceOpen;
                  setMetaScanChoiceOpen(null);
                  if (k === "album") void runMetaScanAll(true);
                  else void runTrackScanAll(true);
                }}
              >
                {t("tools.scanChoiceRescanAll")}
              </button>
              <button
                type="button"
                className="primary-btn"
                onClick={() => {
                  const k = metaScanChoiceOpen;
                  setMetaScanChoiceOpen(null);
                  if (k === "album") void runMetaScanAll(false);
                  else void runTrackScanAll(false);
                }}
              >
                {t("tools.scanChoiceMissingOnly")}
              </button>
              <button
                type="button"
                className="ghost-btn"
                onClick={() => setMetaScanChoiceOpen(null)}
              >
                {t("tools.scanChoiceCancel")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
