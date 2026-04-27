import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePlayer } from "../context/PlayerContext";
import { useToolsActivity } from "../context/ToolsActivityContext";
import { useUserState } from "../context/UserStateContext";
import { useI18n } from "../i18n/useI18n";
import {
  applyArtwork,
  createMusicSubdir,
  deleteAudioRelPaths,
  fetchAccounts,
  fetchAlbumInfo,
  fetchLibraryIndex,
  fetchLibraryIndexForAccount,
  fetchTrackInfo,
  fetchDownloadPreset,
  streamYoutubeReleasesList,
  getSelectedAccountId,
  linkSharedFromAccount,
  listMusicDirs,
  fetchDownloadFlatCount,
  newStudioDownloadId,
  runYtdlpDownload,
  cancelStudioDownload,
  applyGenreAutoBatch,
  sanitizeTrackTitles,
  searchArtwork,
  pruneOrphanTrackMetaForAlbum,
} from "../lib/api";
import type {
  ArtworkHit,
  StudioDownloadKind,
  YoutubeReleasesList,
} from "../lib/api";
import { fmtDate } from "../lib/metaFormat";
import { albumFolderFromTrackRelPath } from "../lib/trackPaths";
import type { LinkSharedAlbumResult, LinkSharedResult } from "../lib/api";
import {
  buildFolderReplaceSnapshotForFolder,
  computePostDownloadRedundantRemovals,
  type FolderReplaceSnapshot,
} from "../lib/downloadFolderReplace";
import { ytdlpLogDetailForUser } from "../lib/ytdlpLogFilter";
import { formatTrackGenresForDisplay } from "../lib/genres";
import { computeGenreAutoAssignments } from "../lib/genreAutoAssign";
import type {
  LibArtist,
  LibTrack,
  LibraryIndex,
  LibraryResponse,
} from "../types";
import {
  urlMatchesStudioDlMode,
  type DlVideoMode,
  type DlYtSource,
} from "../lib/youtubeUrl";
import {
  UiChevronRight,
  UiDownload,
  UiGraphicEq,
  UiImage,
  UiLink,
  UiNote,
} from "./KordUiIcons";

type P = {
  library: LibraryResponse | null;
  libraryIndex: LibraryIndex | null;
  onRefreshLibrary: () => void;
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

const SHARED_ALL_ALBUMS = "__kord_all_albums__";

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

export function ToolsView({ library, libraryIndex, onRefreshLibrary }: P) {
  const p = usePlayer();
  const { t, sortLocale } = useI18n();
  const {
    state: userState,
    stripUserStateForRelPaths,
    remapUserStateAfterDownloadReplace,
  } = useUserState();
  const {
    log,
    setLog,
    metaLog,
    setMetaLog,
    dlBusy,
    setDlBusy,
    dlProg,
    setDlProg,
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
    genreAutoBusy,
    setGenreAutoBusy,
    trackPruneBusy,
    setTrackPruneBusy,
    trackPruneProg,
    setTrackPruneProg,
    stopMetaAll,
    stopTrackAll,
    stopTrackPrune,
  } = useToolsActivity();
  const [genreAutoProg, setGenreAutoProg] = useState<{
    current: number;
    total: number;
  } | null>(null);
  const [preset, setPreset] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [dlYtSource, setDlYtSource] = useState<DlYtSource>("video");
  const [dlUrlMode, setDlUrlMode] = useState<DlVideoMode>("single");
  const [dlList, setDlList] = useState<{
    path: string;
    parent: string;
    dirs: { name: string; relPath: string }[];
    musicRoot: string;
  } | null>(null);
  const [dlPath, setDlPath] = useState(() => {
    try {
      if (
        sessionStorage.getItem(K_DL_OK) === "1" ||
        sessionStorage.getItem(W_DL_OK) === "1"
      ) {
        return (
          sessionStorage.getItem(K_DL_OUT) ??
          sessionStorage.getItem(W_DL_OUT) ??
          ""
        );
      }
    } catch {
      /* ignore */
    }
    return "";
  });
  const [dlDestPicked, setDlDestPicked] = useState(() => {
    try {
      return (
        sessionStorage.getItem(K_DL_OK) === "1" ||
        sessionStorage.getItem(W_DL_OK) === "1"
      );
    } catch {
      return false;
    }
  });
  const [sharedAccounts, setSharedAccounts] = useState<
    { id: string; name: string; musicRoot: string }[]
  >([]);
  const [sharedLockedByEnv, setSharedLockedByEnv] = useState(false);
  const [localSessionAccount, setLocalSessionAccount] = useState<string | null>(
    () => getSelectedAccountId()
  );
  const [sharedSourceId, setSharedSourceId] = useState("");
  const [sharedIndex, setSharedIndex] = useState<LibraryIndex | null>(null);
  const [sharedLoadBusy, setSharedLoadBusy] = useState(false);
  const [sharedLinkBusy, setSharedLinkBusy] = useState(false);
  const [sharedArtistId, setSharedArtistId] = useState("");
  const [sharedAlbumRel, setSharedAlbumRel] = useState("");
  const [sharedMsg, setSharedMsg] = useState<string | null>(null);
  const [sharedErr, setSharedErr] = useState<string | null>(null);
  const [artArt, setArtArt] = useState("");
  const [artAlb, setArtAlb] = useState("");
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
  const [relStreamTotal, setRelStreamTotal] = useState<number | null>(null);
  const [relStreamComplete, setRelStreamComplete] = useState(false);
  const [relSel, setRelSel] = useState<Set<string>>(() => new Set());
  const [relLoadBusy, setRelLoadBusy] = useState(false);
  const relAborter = useRef<AbortController | null>(null);
  const relLogTotalRef = useRef(0);
  const relLogUploaderRef = useRef("");
  const dlActiveDownloadIdRef = useRef<string | null>(null);
  const dlBatchStopRef = useRef(false);
  const [dlReplaceMode, setDlReplaceMode] = useState(false);
  const [dlTrackProg, setDlTrackProg] = useState<{
    current: number;
    total: number;
  } | null>(null);
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

  const loadPreset = useCallback(() => {
    fetchDownloadPreset()
      .then((d) => {
        setPreset(d.found && d.text ? d.text : null);
        if (d.exampleUrl) setUrl(d.exampleUrl);
      })
      .catch((e) => setLog((x) => x + t("tools.logCmdErr", { e })));
  }, [t]);

  useEffect(() => {
    loadPreset();
  }, [loadPreset]);

  const loadDlFs = useCallback(
    (path: string) => {
      listMusicDirs(path)
        .then(setDlList)
        .catch((e) => setLog((x) => x + t("tools.logFolderErr", { e })));
    },
    [t]
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
    setRelStreamTotal(null);
    setRelStreamComplete(false);
    setRelSel(new Set());
  }, [url, dlUrlMode, dlYtSource]);

  useEffect(() => {
    loadDlFs("");
  }, [loadDlFs]);

  useEffect(
    () => () => {
      relAborter.current?.abort();
    },
    []
  );

  const commitDlDest = (path: string) => {
    setDlPath(path);
    setDlDestPicked(true);
    try {
      sessionStorage.setItem(K_DL_OK, "1");
      sessionStorage.setItem(K_DL_OUT, path);
    } catch {
      /* ignore */
    }
  };

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
    fetchAccounts()
      .then((a) => {
        setSharedAccounts(a.accounts);
        setSharedLockedByEnv(a.lockedByEnv);
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
      genreAutoBusy ||
      trackPruneBusy ||
      titleSanBusy,
    [
      metaBusy,
      metaAllBusy,
      trackMetaBusy,
      trackAllBusy,
      genreAutoBusy,
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
    if (dlYtSource === "music") return t("tools.dlUrlPhYtMusic");
    if (dlUrlMode === "single") return t("tools.dlUrlPhSingle");
    if (dlUrlMode === "playlist") return t("tools.dlUrlPhPlaylist");
    return t("tools.dlUrlPhReleases");
  }, [dlYtSource, dlUrlMode, t]);

  const showMultiAlbumPicker =
    dlYtSource === "music" ||
    (dlYtSource === "video" && dlUrlMode === "releases");

  const dlUrlValid = useMemo(
    () => urlMatchesStudioDlMode(url, dlYtSource, dlUrlMode),
    [url, dlYtSource, dlUrlMode]
  );

  const otherSharedAccounts = useMemo(
    () => sharedAccounts.filter((a) => a.id !== (localSessionAccount || "")),
    [sharedAccounts, localSessionAccount]
  );

  const sharedAlbumsForArtist = useMemo(() => {
    if (!sharedIndex || !sharedArtistId) return [];
    return sharedIndex.albums.filter(
      (a) => a.artistId === sharedArtistId && !a.loose
    );
  }, [sharedIndex, sharedArtistId]);

  const loadSharedCatalog = useCallback(() => {
    if (!sharedSourceId) return;
    setSharedLoadBusy(true);
    setSharedErr(null);
    setSharedMsg(null);
    setSharedIndex(null);
    setSharedArtistId("");
    setSharedAlbumRel("");
    fetchLibraryIndexForAccount(sharedSourceId)
      .then((ix) => {
        setSharedIndex(ix);
      })
      .catch((e) => {
        setSharedErr(
          t("tools.sharedErr", { e: String((e as Error)?.message || e) })
        );
        setSharedIndex(null);
      })
      .finally(() => setSharedLoadBusy(false));
  }, [sharedSourceId, t]);

  const doLinkSharedAlbum = useCallback(() => {
    if (!sharedSourceId || !sharedArtistId || !sharedAlbumRel) return;
    setSharedLinkBusy(true);
    setSharedErr(null);
    setSharedMsg(null);
    const scope = sharedAlbumRel === SHARED_ALL_ALBUMS ? "artist" : "album";
    const rel = scope === "artist" ? sharedArtistId : sharedAlbumRel;
    linkSharedFromAccount(sharedSourceId, rel, scope)
      .then((r: LinkSharedResult) => {
        if ("scope" in r && r.scope === "artist") {
          const extra = r.errors?.length
            ? t("tools.sharedLinkArtistErrors", { n: r.errors.length })
            : "";
          setSharedMsg(
            t("tools.sharedLinkOkArtist", {
              albums: r.albums.length,
              files: r.totalLinked,
              skipped: r.totalSkipped,
              extra,
            }) +
              (r.errors?.length
                ? ` ${r.errors.map((e) => e.relPath).join(", ")}`
                : "")
          );
        } else {
          const al = r as LinkSharedAlbumResult;
          setSharedMsg(
            t("tools.sharedLinkOk", {
              linked: al.linked,
              skipped: al.skipped,
              path: al.destRelPath,
            })
          );
        }
        onRefreshLibrary();
      })
      .catch((e) => {
        setSharedErr(
          t("tools.sharedErr", { e: String((e as Error)?.message || e) })
        );
      })
      .finally(() => setSharedLinkBusy(false));
  }, [onRefreshLibrary, sharedAlbumRel, sharedArtistId, sharedSourceId, t]);

  const useCurrentForArt = () => {
    if (p.current) {
      setArtArt(p.current.artist);
      setArtAlb(p.current.album);
      setCoverPickArtist(p.current.artist);
      const folder = albumFolderFromTrackRelPath(p.current.relPath);
      if (folder) {
        setAlbumForCover(folder);
      }
    }
  };

  const setCoverDestFromCurrentTrack = () => {
    if (!p.current?.relPath) {
      setLog((x) => x + t("tools.logNoTrackPath"));
      return;
    }
    const folder = albumFolderFromTrackRelPath(p.current.relPath);
    if (!folder) {
      setLog((x) => x + t("tools.logNoAlbumFolder"));
      return;
    }
    setCoverPickArtist(p.current.artist);
    setAlbumForCover(folder);
    setLog((x) => x + t("tools.logCoverDest", { path: folder }));
  };

  const doCreateFolder = () => {
    const n = newDirName.trim();
    if (n.length < 1 || !dlList) return;
    setMkBusy(true);
    createMusicSubdir(dlList.path || "", n)
      .then(({ relPath }) => {
        setLog((x) => x + t("tools.logNewFolder", { path: relPath }));
        setNewDirName("");
        const parent = relPath.split("/").slice(0, -1).join("/");
        loadDlFs(parent);
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
        onRefreshLibrary();
      })
      .catch((e) => setMetaLog((s) => s + t("tools.metaErr", { e })))
      .finally(() => setMetaBusy(false));
  };

  const runMetaScanAll = async () => {
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
    const toFetch = list.filter((row) => {
      const ar = library.artists.find((x) => x.name === row.artist);
      const al = ar?.albums.find((x) => x.name === row.album);
      return !al?.hasAlbumMeta;
    });
    const skipped = list.length - toFetch.length;
    setMetaLog(
      (s) =>
        s +
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
    for (let i = 0; i < toFetch.length; i += 1) {
      if (stopMetaAll.current) {
        setMetaLog((s) => s + t("tools.metaUserStop"));
        setMetaScanProg(null);
        setMetaAllBusy(false);
        onRefreshLibrary();
        return;
      }
      const row = toFetch[i]!;
      setMetaScanProg({ current: i + 1, total: toFetch.length });
      try {
        await fetchAlbumInfo(row.path, row.artist, row.album);
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
      if (i < toFetch.length - 1) {
        await new Promise((r) => setTimeout(r, 1100));
      }
    }
    setMetaScanProg(null);
    setMetaAllBusy(false);
    setMetaLog((s) => s + t("tools.metaScanDone"));
    onRefreshLibrary();
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
        onRefreshLibrary();
      })
      .catch((e) => setMetaLog((s) => s + t("tools.metaTrackErr", { e })))
      .finally(() => setTrackMetaBusy(false));
  };

  const runTrackScanAll = async () => {
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
    const toFetch = rels.filter((rel) => {
      const tr = findLibTrack(library, rel);
      const m = tr?.meta;
      if (!m) return true;
      return !(formatTrackGenresForDisplay(m.genre) || m.releaseDate);
    });
    const skippedT = rels.length - toFetch.length;
    setMetaLog(
      (s) =>
        s +
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
        onRefreshLibrary();
        return;
      }
      const rel = toFetch[i]!;
      setTrackScanProg({ current: i + 1, total: toFetch.length });
      try {
        await fetchTrackInfo(rel);
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
    onRefreshLibrary();
  };

  const runPruneOrphanTrackMeta = async () => {
    if (!library) return;
    if (!window.confirm(t("tools.trackMetaPruneConfirm"))) return;
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
        onRefreshLibrary();
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
            (s) => s + t("tools.trackMetaPruneAlbum", { path: albumPath, files })
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
        s +
        t("tools.trackMetaPruneDone", { a: albumsTouched, k: keysRemoved })
    );
    onRefreshLibrary();
  };

  const runGenreAutoPreview = useCallback(() => {
    if (!libraryIndex) {
      setMetaLog((s) => s + t("tools.genreAutoNoIndex"));
      return;
    }
    const list = computeGenreAutoAssignments(libraryIndex);
    if (list.length === 0) {
      setMetaLog((s) => s + t("tools.genreAutoPreviewEmpty"));
      return;
    }
    const maxLines = 150;
    const lines = list.slice(0, maxLines).map((row) =>
      t("tools.genreAutoLine", {
        path: row.relPath,
        genre: row.genreSerialized,
        source:
          row.source === "album"
            ? t("tools.genreAutoSourceAlbum")
            : t("tools.genreAutoSourceArtist"),
      })
    );
    let tail = "";
    if (list.length > maxLines) {
      tail = t("tools.genreAutoMore", { n: list.length - maxLines });
    }
    setMetaLog(
      (s) =>
        s +
        t("tools.genreAutoPreviewHead", { n: list.length }) +
        lines.join("") +
        tail
    );
  }, [libraryIndex, setMetaLog, t]);

  const runGenreAutoApply = useCallback(async () => {
    if (!libraryIndex) {
      setMetaLog((s) => s + t("tools.genreAutoNoIndex"));
      return;
    }
    const list = computeGenreAutoAssignments(libraryIndex);
    if (list.length === 0) {
      setMetaLog((s) => s + t("tools.genreAutoPreviewEmpty"));
      return;
    }
    if (!window.confirm(t("tools.genreAutoApplyConfirm", { n: list.length })))
      return;
    setGenreAutoBusy(true);
    setGenreAutoProg(null);
    try {
      const data = await applyGenreAutoBatch(
        list.map((row) => ({
          relPath: row.relPath,
          genre: row.genreSerialized,
        })),
      );
      setMetaLog((s) => s + t("tools.genreAutoApplyDone", { n: data.ok }));
      for (const e of data.errors) {
        setMetaLog(
          (s) =>
            s +
            t("tools.genreAutoApplyErr", {
              path: e.relPath,
              err: e.err,
            }),
        );
      }
      onRefreshLibrary();
    } catch (e) {
      setMetaLog(
        (s) =>
          s + t("tools.sharedErr", { e: String((e as Error)?.message || e) }),
      );
    } finally {
      setGenreAutoProg(null);
      setGenreAutoBusy(false);
    }
  }, [libraryIndex, onRefreshLibrary, setMetaLog, t]);

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
      if (!dryRun) onRefreshLibrary();
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

  const runDl = () => {
    if (!url.trim()) return;
    if (!urlMatchesStudioDlMode(url, dlYtSource, dlUrlMode)) {
      setLog((x) => x + t("tools.dlUrlMismatch"));
      return;
    }
    if (showMultiAlbumPicker) {
      setLog((x) => x + t("tools.dlNeedLoadReleases"));
      return;
    }
    if (!dlDestPicked) {
      setLog((x) => x + t("tools.dlPickFolder"));
      return;
    }
    void (async () => {
      let indexBefore: LibraryIndex | null = null;
      let replaceSnap: FolderReplaceSnapshot | null = null;
      if (dlReplaceMode && dlPath.trim()) {
        if (!window.confirm(t("tools.dlReplaceConfirm", { path: dlPath }))) {
          return;
        }
        indexBefore = await fetchLibraryIndex();
        replaceSnap = buildFolderReplaceSnapshotForFolder(
          userState,
          indexBefore,
          dlPath
        );
      }
      if (dlUrlMode === "playlist") {
        try {
          const cnt = await fetchDownloadFlatCount(url.trim());
          if (cnt > 35) {
            if (!window.confirm(t("tools.dlPlaylistManyConfirm", { n: cnt }))) {
              return;
            }
          }
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
      setDlTrackProg(null);
      dlBatchStopRef.current = false;
      setDlBusy(true);
      setDlProg(null);
      try {
        const dlId = newStudioDownloadId();
        dlActiveDownloadIdRef.current = dlId;
        const studioDlKind: StudioDownloadKind =
          dlUrlMode === "playlist" ? "download_playlist" : "download_single";
        setLog(
          (x) =>
            x +
            t("tools.dlStart", {
              path: dlPath || t("tools.dlRootLabel"),
            })
        );
        const r = await runYtdlpDownload(
          url.trim(),
          dlPath,
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
                (detail ? t("tools.dlErrDetail", { detail }) : ""))
          );
        });
        await onRefreshLibrary();
        if (replaceSnap && indexBefore) {
          await runReplaceAfterDownload(indexBefore, replaceSnap);
        }
      } catch (e) {
        setLog(
          (x) =>
            x + t("tools.dlFail", { e: String((e as Error)?.message || e) })
        );
      } finally {
        dlActiveDownloadIdRef.current = null;
        setDlBusy(false);
      }
    })();
  };

  const runReplaceAfterDownload = useCallback(
    async (indexBefore: LibraryIndex, replaceSnap: FolderReplaceSnapshot) => {
      let toDelete: string[] = [];
      try {
        const indexAfter = await fetchLibraryIndex();
        toDelete = computePostDownloadRedundantRemovals(
          indexBefore,
          indexAfter,
          dlPath
        ).toDelete;
        if (toDelete.length > 0) {
          await deleteAudioRelPaths(toDelete);
          setLog(
            (x) =>
              x +
              t("tools.dlReplaceRemovedDupes", { n: toDelete.length }) +
              "\n"
          );
          await onRefreshLibrary();
        }
        const indexFinal = await fetchLibraryIndex();
        stripUserStateForRelPaths(toDelete);
        remapUserStateAfterDownloadReplace(replaceSnap, indexFinal, dlPath);
      } catch (e) {
        setLog(
          (x) =>
            x + t("tools.sharedErr", { e: String((e as Error)?.message || e) })
        );
      }
    },
    [
      dlPath,
      onRefreshLibrary,
      setLog,
      stripUserStateForRelPaths,
      remapUserStateAfterDownloadReplace,
      t,
    ]
  );

  const loadReleasesCatalog = () => {
    if (!url.trim()) return;
    if (!urlMatchesStudioDlMode(url, dlYtSource, dlUrlMode)) {
      setLog((x) => x + t("tools.dlUrlMismatch"));
      return;
    }
    if (!dlDestPicked) {
      setLog((x) => x + t("tools.dlPickFolder"));
      return;
    }
    relAborter.current?.abort();
    relAborter.current = new AbortController();
    const signal = relAborter.current.signal;
    setRelLoadBusy(true);
    setRelStreamComplete(false);
    setRelStreamTotal(null);
    setRelPayload(null);
    setRelSel(new Set());
    void streamYoutubeReleasesList(
      url.trim(),
      {
        onMeta: (m) => {
          relLogTotalRef.current = m.total;
          relLogUploaderRef.current = m.uploader;
          setRelStreamTotal(m.total);
          setRelPayload({
            listTitle: m.listTitle,
            uploader: m.uploader,
            channelUrl: m.channelUrl,
            entries: [],
          });
        },
        onEntry: (e) => {
          setRelPayload((p) =>
            p ? { ...p, entries: [...p.entries, e] } : null
          );
          setRelSel((prev) => new Set([...prev, e.id]));
        },
        onDone: () => {
          setRelStreamComplete(true);
          setRelLoadBusy(false);
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
      },
      signal
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
      setRelStreamTotal(null);
      setRelStreamComplete(false);
    });
  };

  const runReleasesDl = () => {
    if (!urlMatchesStudioDlMode(url, dlYtSource, dlUrlMode)) {
      setLog((x) => x + t("tools.dlUrlMismatch"));
      return;
    }
    if (!relPayload || !dlDestPicked) {
      if (!dlDestPicked) setLog((x) => x + t("tools.dlPickFolder"));
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
    const multiRelease = list.length > 1;
    void (async () => {
      let indexBefore: LibraryIndex | null = null;
      let replaceSnap: FolderReplaceSnapshot | null = null;
      if (dlReplaceMode && dlPath.trim()) {
        if (!window.confirm(t("tools.dlReplaceConfirm", { path: dlPath }))) {
          return;
        }
        indexBefore = await fetchLibraryIndex();
        replaceSnap = buildFolderReplaceSnapshotForFolder(
          userState,
          indexBefore,
          dlPath
        );
      }
      setDlBusy(true);
      dlBatchStopRef.current = false;
      setDlTrackProg(multiRelease ? { current: 0, total: 0 } : null);
      setDlProg({ current: 1, total: list.length });
      const rootLabel = dlPath || t("tools.dlRootLabel");
      setLog(
        (x) =>
          x +
          t("tools.dlStart", { path: rootLabel }) +
          ` — ${list.length} album(s)\n`
      );
      const studioDlKind: StudioDownloadKind =
        dlYtSource === "music" ? "download_ytmusic" : "download_releases";
      try {
        for (let i = 0; i < list.length; i += 1) {
          if (dlBatchStopRef.current) {
            setLog((x) => x + t("tools.dlBatchStoppedHint") + "\n");
            break;
          }
          const item = list[i]!;
          setDlProg({ current: i + 1, total: list.length });
          if (multiRelease) setDlTrackProg({ current: 0, total: 0 });
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
              multiRelease
                ? (p) => setDlTrackProg({ current: p.current, total: p.total })
                : undefined,
              { downloadId: dlId, downloadKind: studioDlKind }
            );
            const detail = ytdlpLogDetailForUser(r);
            if (r.cancelled) {
              setLog((x) => x + t("tools.dlStoppedByUser") + "\n");
              break;
            }
            setLog(
              (x) =>
                x +
                (r.ok
                  ? t("tools.dlResultOk")
                  : t("tools.dlResultErr", { code: r.code }) +
                    (detail ? t("tools.dlErrDetail", { detail }) : ""))
            );
          } catch (e) {
            setLog(
              (x) =>
                x + t("tools.dlFail", { e: String((e as Error)?.message || e) })
            );
          } finally {
            dlActiveDownloadIdRef.current = null;
          }
        }
        if (!dlBatchStopRef.current) {
          setDlProg({ current: list.length, total: list.length });
        } else {
          setDlProg(null);
          setDlTrackProg(null);
        }
        if (multiRelease && !dlBatchStopRef.current) setDlTrackProg(null);
        await onRefreshLibrary();
        if (replaceSnap && indexBefore) {
          await runReplaceAfterDownload(indexBefore, replaceSnap);
        }
      } finally {
        dlActiveDownloadIdRef.current = null;
        setDlBusy(false);
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

  const dlProgNorm = normalizeDlProgress(dlProg);
  const dlTrackNorm = normalizeTrackInAlbumProgress(dlTrackProg);
  const showReleaseMultiTrackBar =
    showMultiAlbumPicker &&
    dlProgNorm != null &&
    dlProgNorm.tot > 1 &&
    (dlBusy || dlTrackProg != null);

  const doArtSearch = () => {
    const a = artArt.trim();
    const b = artAlb.trim();
    if (a.length < 1 && b.length < 1) return;
    setArtBusy(true);
    searchArtwork(a || b ? { artist: a, album: b } : { q: `${a} ${b}`.trim() })
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
      .then(() => {
        setLog((x) => x + t("tools.coverSaved", { path: albumForCover }));
        onRefreshLibrary();
      })
      .catch((e) => setLog((x) => x + t("tools.coverErr", { e })))
      .finally(() => setArtBusy(false));
  };

  return (
    <div className="tools tool-studio-layout">
      <section
        className="studio-hero surface-card"
        aria-labelledby="studio-hero-title"
      >
        <div className="studio-hero__lead">
          <span className="section-head__icon-wrap" aria-hidden>
            <UiGraphicEq className="section-head__ic" />
          </span>
          <div className="studio-hero__text">
            <p className="eyebrow">{t("tools.studioHeroEyebrow")}</p>
            <h2 id="studio-hero-title" className="studio-hero__title">
              {t("tools.studioHeroTitle")}
            </h2>
          </div>
        </div>
      </section>

      {sharedAccounts.length >= 2 ? (
        <section
          className="tool-block glass tools-shared-lib"
          aria-labelledby="tools-shared-title"
        >
          <header className="studio-head studio-head--with-ic">
            <span className="section-head__icon-wrap studio-head__ic-slot" aria-hidden>
              <UiLink className="section-head__ic" />
            </span>
            <div className="studio-head__text">
              <p className="eyebrow">{t("tools.sharedEyebrow")}</p>
              <h3 id="tools-shared-title">{t("tools.sharedTitle")}</h3>
            </div>
          </header>

          <div className="studio-panel tools-shared-browse">
            <p className="subtle sm tools-shared-browse-lead">
              {t("tools.sharedBrowseDesc")}
            </p>
            {sharedLockedByEnv ? (
              <p className="subtle sm warnline">{t("tools.sharedEnvLock")}</p>
            ) : null}
            {otherSharedAccounts.length === 0 ? (
              <p className="subtle sm">{t("tools.sharedNoOtherAccount")}</p>
            ) : (
              <>
                <div className="tools-shared-browse-row">
                  <select
                    className="select"
                    value={sharedSourceId}
                    onChange={(e) => {
                      setSharedSourceId(e.target.value);
                      setSharedIndex(null);
                      setSharedArtistId("");
                      setSharedAlbumRel("");
                      setSharedMsg(null);
                      setSharedErr(null);
                    }}
                    aria-label={t("tools.sharedPickSource")}
                  >
                    <option value="">{t("tools.sharedPickPlaceholder")}</option>
                    {otherSharedAccounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn sm"
                    onClick={loadSharedCatalog}
                    disabled={!sharedSourceId || sharedLoadBusy}
                  >
                    {sharedLoadBusy
                      ? t("tools.sharedLoadingCatalog")
                      : t("tools.sharedLoadCatalog")}
                  </button>
                </div>
                {sharedIndex ? (
                  <div className="tools-shared-browse-picks">
                    <div>
                      <label
                        className="subtle sm block-label"
                        htmlFor="shared-artist-sel"
                      >
                        {t("tools.sharedPickArtist")}
                      </label>
                      <select
                        id="shared-artist-sel"
                        className="select"
                        value={sharedArtistId}
                        onChange={(e) => {
                          const v = e.target.value;
                          setSharedArtistId(v);
                          setSharedAlbumRel(v ? SHARED_ALL_ALBUMS : "");
                        }}
                      >
                        <option value="">
                          {t("tools.sharedPickPlaceholder")}
                        </option>
                        {sharedIndex.artists.map((ar) => (
                          <option key={ar.id} value={ar.id}>
                            {ar.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label
                        className="subtle sm block-label"
                        htmlFor="shared-album-sel"
                      >
                        {t("tools.sharedPickAlbum")}
                      </label>
                      <select
                        id="shared-album-sel"
                        className="select"
                        value={sharedArtistId ? sharedAlbumRel : ""}
                        onChange={(e) => setSharedAlbumRel(e.target.value)}
                        disabled={!sharedArtistId}
                      >
                        {!sharedArtistId ? (
                          <option value="">
                            {t("tools.sharedAlbumNeedArtist")}
                          </option>
                        ) : (
                          <>
                            <option value={SHARED_ALL_ALBUMS}>
                              {t("tools.sharedAllAlbums")}
                            </option>
                            {sharedAlbumsForArtist.map((al) => (
                              <option key={al.relPath} value={al.relPath}>
                                {al.name} · {al.trackCount}
                              </option>
                            ))}
                          </>
                        )}
                      </select>
                    </div>
                    <button
                      type="button"
                      className="btn"
                      onClick={doLinkSharedAlbum}
                      disabled={
                        sharedLinkBusy || !sharedArtistId || !sharedAlbumRel
                      }
                    >
                      {sharedLinkBusy
                        ? t("tools.sharedLinking")
                        : t("tools.sharedAddToMine")}
                    </button>
                  </div>
                ) : null}
              </>
            )}
            {sharedMsg ? <p className="subtle sm">{sharedMsg}</p> : null}
            {sharedErr ? (
              <p className="subtle sm warnline">{sharedErr}</p>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="tool-block glass tools-download">
        <header className="studio-head studio-head--with-ic">
          <span className="section-head__icon-wrap studio-head__ic-slot" aria-hidden>
            <UiDownload className="section-head__ic" />
          </span>
          <h3 className="studio-head__h3-solo">{t("tools.downloadTitle")}</h3>
        </header>

        <details className="studio-details" open={false}>
          <summary>{t("tools.cmdUsed")}</summary>
          <pre className="codebox" tabIndex={0}>
            {preset || t("tools.cmdFallback")}
          </pre>
        </details>

        <div className="studio-panel tools-dl-dest">
          <h4 className="studio-panel-title">{t("tools.dlSaveFolder")}</h4>
          <p className="subtle sm tools-dl-dest__lead">
            {t("tools.dlDestLead")}
          </p>
          <div className="tools-dl-dest__shell">
            <div className="tools-dl-dest__pathheader">
              <p className="tools-dl-dest__label" id="tools-dl-dest-where">
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
                          <span className="tools-dl-dest__bc-sep" aria-hidden>
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
                      <span className="tools-dl-dest__dir-name">{d.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            <div
              className="tools-dl-dest__create"
              aria-label={t("tools.dlNewSubLabel")}
            >
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
                    if (e.key === "Enter" && newDirName.trim() && dlList) {
                      e.preventDefault();
                      doCreateFolder();
                    }
                  }}
                  aria-label={t("tools.newFolderAria")}
                />
                <button
                  type="button"
                  className="btn secondary"
                  disabled={mkBusy || !newDirName.trim() || !dlList}
                  onClick={doCreateFolder}
                >
                  {mkBusy ? t("tools.creating") : t("tools.createHere")}
                </button>
              </div>
            </div>

            <div className="tools-dl-dest__actions">
              <p className="tools-dl-dest__label" id="tools-dl-dest-confirm">
                {t("tools.dlPathActions")}
              </p>
              <div className="tools-dl-dest__actions-row">
                <div
                  className="tools-dl-dest__commit"
                  aria-labelledby="tools-dl-dest-confirm"
                >
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      if (dlList) commitDlDest(dlList.path || "");
                    }}
                    disabled={!dlList}
                    title={t("tools.useThisFolderTitle")}
                  >
                    {t("tools.useThisFolder")}
                  </button>
                  <button
                    type="button"
                    className="btn secondary"
                    onClick={() => commitDlDest("")}
                    title={t("tools.musicRootTitle")}
                  >
                    {t("tools.musicRootBtn")}
                  </button>
                </div>
                <label
                  className={`tools-dl-dest__replace${
                    !dlPath.trim() ? " tools-dl-dest__replace--off" : ""
                  }`}
                  title={
                    !dlPath.trim()
                      ? t("tools.dlReplaceRootTitle")
                      : t("tools.dlReplaceHint")
                  }
                >
                  <input
                    type="checkbox"
                    checked={dlReplaceMode}
                    disabled={!dlDestPicked || !dlPath.trim()}
                    onChange={(e) => {
                      setDlReplaceMode(e.target.checked);
                    }}
                  />
                  <span>{t("tools.dlReplaceFolder")}</span>
                </label>
              </div>
            </div>
            {dlDestPicked ? (
              <div className="tools-dl-dest__picked" role="status">
                {t("tools.destLine", { path: dlPath || t("tools.destRoot") })}
              </div>
            ) : (
              <p className="subtle sm warnline tools-dl-dest__warn">
                {t("tools.confirmFolderWarn")}
              </p>
            )}
          </div>
        </div>

        <div className="studio-panel">
          <h4 className="studio-panel-title">{t("tools.dlLinkSection")}</h4>
          <div className="tools-dl-modes">
            <div className="tools-dl-mode">
              <span className="tools-dl-mode__label subtle sm">
                {t("tools.dlYtVideoLabel")}
              </span>
              <div
                className="tools-dl-mode__seg"
                role="group"
                aria-label={t("tools.dlYtVideoLabel")}
              >
                <button
                  type="button"
                  className={`tools-dl-mode__btn${dlYtSource === "video" && dlUrlMode === "single" ? " is-on" : ""}`}
                  aria-pressed={
                    dlYtSource === "video" && dlUrlMode === "single"
                  }
                  onClick={() => {
                    setDlYtSource("video");
                    setDlUrlMode("single");
                  }}
                >
                  {t("tools.dlTypeSingle")}
                </button>
                <button
                  type="button"
                  className={`tools-dl-mode__btn${dlYtSource === "video" && dlUrlMode === "playlist" ? " is-on" : ""}`}
                  aria-pressed={
                    dlYtSource === "video" && dlUrlMode === "playlist"
                  }
                  onClick={() => {
                    setDlYtSource("video");
                    setDlUrlMode("playlist");
                  }}
                >
                  {t("tools.dlTypePlaylist")}
                </button>
                <button
                  type="button"
                  className={`tools-dl-mode__btn${dlYtSource === "video" && dlUrlMode === "releases" ? " is-on" : ""}`}
                  aria-pressed={
                    dlYtSource === "video" && dlUrlMode === "releases"
                  }
                  onClick={() => {
                    setDlYtSource("video");
                    setDlUrlMode("releases");
                  }}
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
            <div className="tools-dl-mode">
              <span className="tools-dl-mode__label subtle sm">
                {t("tools.dlYtMusicLabel")}
              </span>
              <div
                className="tools-dl-mode__seg tools-dl-mode__seg--one"
                role="group"
                aria-label={t("tools.dlYtMusicLabel")}
              >
                <button
                  type="button"
                  className={`tools-dl-mode__btn${dlYtSource === "music" ? " is-on" : ""}`}
                  aria-pressed={dlYtSource === "music"}
                  onClick={() => setDlYtSource("music")}
                >
                  {t("tools.dlYtMusicMode")}
                </button>
              </div>
              <span className="tools-dl-mode__help-wrap">
                <button
                  type="button"
                  className="tools-dl-mode__help"
                  aria-label={t("tools.dlYtMusicHelpAria")}
                >
                  ?
                </button>
                <span className="tools-dl-mode__tip" role="tooltip">
                  {t("tools.dlYtMusicGuide")}
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
                    <button
                      type="button"
                      className="btn secondary sm"
                      onClick={() =>
                        setRelSel(new Set(relPayload.entries.map((e) => e.id)))
                      }
                    >
                      {t("tools.dlSelectAll")}
                    </button>
                    <button
                      type="button"
                      className="btn secondary sm"
                      onClick={() => setRelSel(new Set())}
                    >
                      {t("tools.dlSelectNone")}
                    </button>
                  </div>
                  <ul
                    className="tools-dl-releases__list tools-dl-releases__list--grid"
                    aria-label={t("tools.dlReleasesListTitle")}
                    aria-busy={!relStreamComplete}
                  >
                    {relPayload.entries.map((e) => (
                      <li key={e.id} className="tools-dl-releases__row">
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
                            className="tools-dl-releases__trackcount"
                            aria-label={
                              e.trackCount != null
                                ? t("tools.dlTrackCountAria", {
                                    n: e.trackCount,
                                  })
                                : undefined
                            }
                          >
                            {e.trackCount != null
                              ? t("tools.dlTrackCount", { n: e.trackCount })
                              : t("tools.dlTrackCountUnknown")}
                          </span>
                        </label>
                      </li>
                    ))}
                    {relStreamTotal != null && !relStreamComplete
                      ? Array.from(
                          {
                            length: Math.max(
                              0,
                              relStreamTotal - relPayload.entries.length
                            ),
                          },
                          (_, sk) => (
                            <li
                              key={`rel-sk-${sk}`}
                              className="tools-dl-releases__row tools-dl-releases__row--skeleton"
                              aria-hidden
                            >
                              <div className="tools-dl-releases__check tools-dl-releases__check--skeleton">
                                <span className="tools-dl-releases__sk-pad" />
                                <div className="tools-dl-releases__sk-text">
                                  <div className="tools-dl-releases__skeleton-bar" />
                                  <div className="tools-dl-releases__skeleton-bar tools-dl-releases__skeleton-bar--sub" />
                                </div>
                                <div className="tools-dl-releases__skeleton-bar tools-dl-releases__skeleton-bcount" />
                              </div>
                            </li>
                          )
                        )
                      : null}
                  </ul>
                  {relPayload && !relStreamComplete ? (
                    <p
                      className="subtle sm tools-dl-releases__enrich"
                      role="status"
                    >
                      {t("tools.dlReleasesEnriching")}
                    </p>
                  ) : null}
                </div>
              ) : null}
              <div className="studio-inline-actions studio-inline-actions--spaced">
                {!relPayload ? (
                  <button
                    type="button"
                    className="btn"
                    onClick={loadReleasesCatalog}
                    disabled={
                      relLoadBusy ||
                      !url.trim() ||
                      !dlDestPicked ||
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
                  <button
                    type="button"
                    className="btn"
                    onClick={runReleasesDl}
                    disabled={
                      !dlDestPicked ||
                      relSel.size === 0 ||
                      !relStreamComplete ||
                      !dlUrlValid
                    }
                  >
                    {t("tools.dlDownloadSelected")}
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="studio-inline-actions studio-inline-actions--spaced">
              {dlBusy ? (
                <span className="subtle sm" role="status">
                  {t("tools.inProgress")}
                </span>
              ) : (
                <button
                  type="button"
                  className="btn"
                  onClick={runDl}
                  disabled={!url.trim() || !dlDestPicked || !dlUrlValid}
                >
                  {t("tools.downloadRun")}
                </button>
              )}
            </div>
          )}
          {(dlBusy || dlProg) && (
            <div
              className={[
                "dl-progress-wrap",
                showReleaseMultiTrackBar ? "dl-progress-wrap--dual" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              aria-live="polite"
            >
              {dlBusy ? (
                <div className="dl-progress-stop-row">
                  <button
                    type="button"
                    className="btn danger sm"
                    onClick={stopStudioDownload}
                  >
                    {t("tools.dlStop")}
                  </button>
                </div>
              ) : null}
              {showReleaseMultiTrackBar ? (
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
                        <strong>{t("tools.dlProgressTracksInAlbum")}</strong>
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
          <button type="button" className="linkbtn" onClick={() => setLog("")}>
            {t("tools.clear")}
          </button>
        </div>
      </section>

      <section className="tool-block glass tools-meta">
        <header className="studio-head studio-head--with-ic">
          <span className="section-head__icon-wrap studio-head__ic-slot" aria-hidden>
            <UiNote className="section-head__ic" />
          </span>
          <h3 className="studio-head__h3-solo">{t("tools.metaTitle")}</h3>
        </header>

        <div className="studio-panel">
          <h4 className="studio-panel-title">{t("tools.metaAlbumPanel")}</h4>
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
                <option value="">{t("tools.sharedPickPlaceholder")}</option>
                {libraryArtistsSorted.map((a) => (
                  <option key={a.name} value={a.name}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="subtle sm block-label" htmlFor="meta-album-sel">
                {t("tools.sharedPickAlbum")}
              </label>
              <select
                id="meta-album-sel"
                className="select"
                value={metaAlbumPath}
                onChange={(e) => {
                  const v = e.target.value;
                  setMetaAlbumPath(v);
                  const o = metaAlbumsForPick.find((x) => x.relPath === v);
                  if (o) {
                    setMetaArt(metaArtistName);
                    setMetaAlb(o.name);
                  }
                }}
                disabled={!metaArtistName}
                aria-label={t("tools.metaAlbumAria")}
              >
                {!metaArtistName ? (
                  <option value="">{t("tools.sharedAlbumNeedArtist")}</option>
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
          <div className="art-fields">
            <input
              type="text"
              className="flex1"
              value={metaArt}
              onChange={(e) => setMetaArt(e.target.value)}
              placeholder={t("tools.artistPh")}
            />
            <input
              type="text"
              className="flex1"
              value={metaAlb}
              onChange={(e) => setMetaAlb(e.target.value)}
              placeholder={t("tools.albumPh")}
            />
          </div>
        </div>

        <div className="studio-panel">
          <div className="studio-panel-title-row">
            <h4 className="studio-panel-title">{t("tools.actions")}</h4>
            <button
              type="button"
              className="btn secondary sm"
              onClick={() => {
                void runPruneOrphanTrackMeta();
              }}
              disabled={!library || studioMetaBusy}
              title={t("tools.trackMetaPruneTitle")}
            >
              {trackPruneBusy ? "…" : t("tools.trackMetaPruneOrphans")}
            </button>
          </div>
          <div className="studio-action-groups">
            <div className="studio-action-group">
              <span className="studio-action-group-label">
                {t("tools.selectedAlbum")}
              </span>
              <div className="studio-action-row">
                <button
                  type="button"
                  className="btn secondary sm"
                  onClick={setMetaFromCurrent}
                  disabled={!p.current || studioMetaBusy}
                >
                  {t("tools.fromNowPlaying")}
                </button>
                <button
                  type="button"
                  className="btn secondary"
                  onClick={fetchOneAlbumMeta}
                  disabled={!metaAlbumPath || studioMetaBusy}
                >
                  {metaBusy
                    ? t("tools.fetchingMeta")
                    : t("tools.updateAlbumMeta")}
                </button>
              </div>
            </div>
            <div>
              <span className="studio-action-group-label">
                {t("tools.allAlbums")}
              </span>
              <div className="studio-action-row">
                <button
                  type="button"
                  className="btn"
                  onClick={runMetaScanAll}
                  disabled={!library || studioMetaBusy}
                  title={t("tools.scanAlbumsTitle")}
                >
                  {metaAllBusy
                    ? t("tools.scanning")
                    : t("tools.scanAlbumsAuto")}
                </button>
              </div>
            </div>
            <div className="studio-action-group">
              <span className="studio-action-group-label">
                {t("tools.tracks")}
              </span>
              <div className="studio-action-row">
                <button
                  type="button"
                  className="btn secondary sm"
                  onClick={fetchCurrentTrackMeta}
                  disabled={!p.current || studioMetaBusy}
                >
                  {trackMetaBusy ? "…" : t("tools.currentTrackMeta")}
                </button>
                <button
                  type="button"
                  className="btn sm"
                  onClick={runTrackScanAll}
                  disabled={!library || studioMetaBusy}
                >
                  {trackAllBusy
                    ? t("tools.scanning")
                    : t("tools.scanAllTracks")}
                </button>
              </div>
            </div>
            <div className="studio-action-group">
              <span className="studio-action-group-label">
                {t("tools.genreAutoGroup")}
              </span>
              <p className="subtle sm studio-hint-line">
                {t("tools.genreAutoHint")}
              </p>
              <div className="studio-action-row">
                <button
                  type="button"
                  className="btn secondary sm"
                  disabled={!libraryIndex || studioMetaBusy}
                  onClick={runGenreAutoPreview}
                >
                  {genreAutoBusy ? "…" : t("tools.genreAutoPreview")}
                </button>
                <button
                  type="button"
                  className="btn sm"
                  disabled={!libraryIndex || studioMetaBusy}
                  onClick={() => {
                    void runGenreAutoApply();
                  }}
                >
                  {genreAutoBusy
                    ? t("tools.scanning")
                    : t("tools.genreAutoApply")}
                </button>
              </div>
            </div>
            <div className="studio-action-group">
              <span className="studio-action-group-label">
                {t("tools.displayedTitles")}
              </span>
              <p className="subtle sm studio-hint-line">
                {t("tools.titleHint")}
              </p>
              <div className="studio-action-row">
                <button
                  type="button"
                  className="btn secondary sm"
                  disabled={!metaAlbumPath || studioMetaBusy}
                  onClick={() => runSanitizeTitles("album", true)}
                >
                  {titleSanBusy ? "…" : t("tools.previewAlbum")}
                </button>
                <button
                  type="button"
                  className="btn secondary sm"
                  disabled={!metaAlbumPath || studioMetaBusy}
                  onClick={() => runSanitizeTitles("album", false)}
                >
                  {titleSanBusy ? "…" : t("tools.applyAlbum")}
                </button>
              </div>
              <div className="studio-action-row">
                <button
                  type="button"
                  className="btn secondary sm"
                  disabled={!library || studioMetaBusy}
                  onClick={() => runSanitizeTitles("all", true)}
                >
                  {titleSanBusy ? "…" : t("tools.previewLibrary")}
                </button>
                <button
                  type="button"
                  className="btn sm"
                  disabled={!library || studioMetaBusy}
                  onClick={() => runSanitizeTitles("all", false)}
                >
                  {titleSanBusy ? "…" : t("tools.applyLibrary")}
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
                        (metaScanProg.current / metaScanProg.total) * 100
                      )
                    )}%`,
                  }}
                />
              </div>
            </div>
          ) : null}
          {trackAllBusy && trackScanProg && trackScanProg.total > 0 ? (
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
                        (trackScanProg.current / trackScanProg.total) * 100
                      )
                    )}%`,
                  }}
                />
              </div>
            </div>
          ) : null}
          {genreAutoBusy && genreAutoProg && genreAutoProg.total > 0 ? (
            <div className="dl-progress-wrap">
              <div className="dl-progress-top">
                <span>{t("tools.genreAutoProgress")}</span>
                <span>
                  {genreAutoProg.current}/{genreAutoProg.total}
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
                        (genreAutoProg.current / genreAutoProg.total) * 100
                      )
                    )}%`,
                  }}
                />
              </div>
            </div>
          ) : null}
          {trackPruneBusy && trackPruneProg && trackPruneProg.total > 0 ? (
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
                        (trackPruneProg.current / trackPruneProg.total) * 100
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
                  className="btn secondary sm"
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
                  className="btn secondary sm"
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
                  className="btn secondary sm"
                  onClick={() => {
                    stopTrackPrune.current = true;
                  }}
                >
                  {t("tools.stopTrackPrune")}
                </button>
              ) : null}
            </div>
          )}
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
      </section>

      <section className="tool-block glass tools-art">
        <header className="studio-head studio-head--with-ic">
          <span className="section-head__icon-wrap studio-head__ic-slot" aria-hidden>
            <UiImage className="section-head__ic" />
          </span>
          <h3 className="studio-head__h3-solo">{t("tools.coversTitle")}</h3>
        </header>

        <div className="studio-panel">
          <h4 className="studio-panel-title">{t("tools.coversSave")}</h4>
          <div className="tools-shared-browse-picks tools-studio-pair-picks">
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
                <option value="">{t("tools.sharedPickPlaceholder")}</option>
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
                  <option value="">{t("tools.sharedAlbumNeedArtist")}</option>
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
          <button
            type="button"
            className="btn secondary sm"
            onClick={setCoverDestFromCurrentTrack}
            disabled={!p.current}
          >
            {t("tools.useAlbumFromTrack")}
          </button>
        </div>

        <div className="studio-panel">
          <h4 className="studio-panel-title">{t("tools.coversSearch")}</h4>
          <div className="art-fields">
            <input
              type="text"
              className="flex1"
              value={artArt}
              onChange={(e) => setArtArt(e.target.value)}
              placeholder={t("tools.artistPh")}
            />
            <input
              type="text"
              className="flex1"
              value={artAlb}
              onChange={(e) => setArtAlb(e.target.value)}
              placeholder={t("tools.albumPh")}
            />
          </div>
          <div className="studio-inline-actions studio-inline-actions--spaced">
            <button
              type="button"
              className="btn secondary sm"
              onClick={useCurrentForArt}
            >
              {t("tools.fillFromPlayback")}
            </button>
            <button
              type="button"
              className="btn"
              onClick={doArtSearch}
              disabled={artBusy}
            >
              {artBusy ? t("tools.searching") : t("tools.searchCovers")}
            </button>
          </div>
        </div>

        <div className="artgrid2">
          {artRes.map((a, i) => (
            <div key={i + a.artwork} className="artcard2">
              <div className="artcard2-img">
                <img src={a.artwork} alt="" loading="lazy" />
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
                  className="btn sm"
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
        (artArt.length > 0 || artAlb.length > 0) ? (
          <p className="subtle sm studio-panel-gap">
            {t("tools.noCoverResults")}
          </p>
        ) : null}
      </section>
    </div>
  );
}
