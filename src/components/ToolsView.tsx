import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { usePlayer } from "../context/PlayerContext"
import { useToolsActivity } from "../context/ToolsActivityContext"
import { useI18n } from "../i18n/useI18n"
import {
  applyArtwork,
  createMusicSubdir,
  fetchAccounts,
  fetchAlbumInfo,
  fetchLibraryIndexForAccount,
  fetchTrackInfo,
  fetchDownloadPreset,
  fetchYoutubeReleasesList,
  getSelectedAccountId,
  linkSharedFromAccount,
  listMusicDirs,
  runYtdlpDownload,
  sanitizeTrackTitles,
  searchArtwork,
} from "../lib/api"
import type { ArtworkHit, YoutubeReleasesList } from "../lib/api"
import { fmtDate } from "../lib/metaFormat"
import { albumFolderFromTrackRelPath } from "../lib/trackPaths"
import type { LinkSharedAlbumResult, LinkSharedResult } from "../lib/api"
import { ytdlpLogDetailForUser } from "../lib/ytdlpLogFilter"
import { classifyYoutubeUrl } from "../lib/youtubeUrl"
import { formatTrackGenresForDisplay } from "../lib/genres"
import type { LibArtist, LibTrack, LibraryIndex, LibraryResponse } from "../types"

type P = {
  library: LibraryResponse | null
  onRefreshLibrary: () => void
}

function sourceLabel(s: string | undefined): string {
  if (s === "itunes") return "iTunes"
  if (s === "deezer") return "Deezer"
  if (s === "musicbrainz") return "MusicBrainz"
  if (s === "theaudiodb") return "TheAudioDB"
  if (s === "coverart") return "CAA / MB"
  return s || "—"
}

function extLinkLabel(url: string, openWord: string): string {
  try {
    const h = new URL(url).hostname
    if (h.includes("apple.com")) return "iTunes / Apple"
    if (h.includes("deezer.com")) return "Deezer"
    if (h.includes("musicbrainz.org")) return "MusicBrainz"
    return h.replace("www.", "") || openWord
  } catch {
    return openWord
  }
}

function findLibTrack(library: LibraryResponse, relPath: string): LibTrack | null {
  for (const a of library.artists) {
    for (const al of a.albums) {
      for (const t of al.tracks) {
        if (t.relPath === relPath) return t
      }
    }
  }
  return null
}

const K_DL_OK = "kord-dl-committed"
const W_DL_OK = "wpp-dl-committed"
const K_DL_OUT = "kord-dl-out"
const W_DL_OUT = "wpp-dl-out"
const K_COVER_ALB = "kord-cover-album"
const W_COVER_ALB = "wpp-cover-album"

const SHARED_ALL_ALBUMS = "__kord_all_albums__"

function isAbortError(e: unknown): boolean {
  if (e instanceof Error && e.name === "AbortError") return true
  if (typeof DOMException !== "undefined" && e instanceof DOMException)
    return e.name === "AbortError"
  return false
}

function normalizeDlProgress(
  p: { current: number; total: number } | null,
): { cur: number; tot: number; pct: number } | null {
  if (!p) return null
  const tot = Math.max(1, Math.floor(Number(p.total) || 1))
  const cur = Math.min(tot, Math.max(0, Math.floor(Number(p.current) || 0)))
  return { cur, tot, pct: Math.max(3, Math.min(100, (cur / tot) * 100)) }
}

/** Brani nel singolo album (release batch); se total non noto ancora, pct leggera fissa. */
function normalizeTrackInAlbumProgress(
  p: { current: number; total: number } | null,
): { cur: number; tot: number; pct: number; hasTotal: boolean } | null {
  if (!p) return null
  const tot = Math.floor(Number(p.total) || 0)
  const cur = Math.max(0, Math.floor(Number(p.current) || 0))
  if (tot <= 0) {
    return { cur, tot: 0, pct: 10, hasTotal: false }
  }
  return {
    cur: Math.min(tot, cur),
    tot,
    hasTotal: true,
    pct: Math.max(3, Math.min(100, (cur / tot) * 100)),
  }
}

export function ToolsView({ library, onRefreshLibrary }: P) {
  const p = usePlayer()
  const { t, sortLocale } = useI18n()
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
    stopMetaAll,
    stopTrackAll,
  } = useToolsActivity()
  const [preset, setPreset] = useState<string | null>(null)
  const [url, setUrl] = useState("")
  const [dlList, setDlList] = useState<
    | {
        path: string
        parent: string
        dirs: { name: string; relPath: string }[]
        musicRoot: string
      }
    | null
  >(null)
  const [dlPath, setDlPath] = useState(() => {
    try {
      if (
        sessionStorage.getItem(K_DL_OK) === "1" ||
        sessionStorage.getItem(W_DL_OK) === "1"
      ) {
        return sessionStorage.getItem(K_DL_OUT) ?? sessionStorage.getItem(W_DL_OUT) ?? ""
      }
    } catch {
      /* ignore */
    }
    return ""
  })
  const [dlDestPicked, setDlDestPicked] = useState(() => {
    try {
      return (
        sessionStorage.getItem(K_DL_OK) === "1" ||
        sessionStorage.getItem(W_DL_OK) === "1"
      )
    } catch {
      return false
    }
  })
  const [sharedAccounts, setSharedAccounts] = useState<
    { id: string; name: string; musicRoot: string }[]
  >([])
  const [sharedLockedByEnv, setSharedLockedByEnv] = useState(false)
  const [localSessionAccount, setLocalSessionAccount] = useState<string | null>(() =>
    getSelectedAccountId(),
  )
  const [sharedSourceId, setSharedSourceId] = useState("")
  const [sharedIndex, setSharedIndex] = useState<LibraryIndex | null>(null)
  const [sharedLoadBusy, setSharedLoadBusy] = useState(false)
  const [sharedLinkBusy, setSharedLinkBusy] = useState(false)
  const [sharedArtistId, setSharedArtistId] = useState("")
  const [sharedAlbumRel, setSharedAlbumRel] = useState("")
  const [sharedMsg, setSharedMsg] = useState<string | null>(null)
  const [sharedErr, setSharedErr] = useState<string | null>(null)
  const [artArt, setArtArt] = useState("")
  const [artAlb, setArtAlb] = useState("")
  const [artRes, setArtRes] = useState<ArtworkHit[]>([])
  const [newDirName, setNewDirName] = useState("")
  const [metaArtistName, setMetaArtistName] = useState("")
  const [metaAlbumPath, setMetaAlbumPath] = useState("")
  const [metaArt, setMetaArt] = useState("")
  const [metaAlb, setMetaAlb] = useState("")
  const [coverPickArtist, setCoverPickArtist] = useState("")
  const [relPayload, setRelPayload] = useState<YoutubeReleasesList | null>(null)
  const [relSel, setRelSel] = useState<Set<string>>(() => new Set())
  const [relLoadBusy, setRelLoadBusy] = useState(false)
  const [dlTrackProg, setDlTrackProg] = useState<{
    current: number
    total: number
  } | null>(null)
  const dlAbortRef = useRef<AbortController | null>(null)
  const [albumForCover, setAlbumForCover] = useState(() => {
    try {
      return (
        sessionStorage.getItem(K_COVER_ALB) ||
        sessionStorage.getItem(W_COVER_ALB) ||
        ""
      )
    } catch {
      return ""
    }
  })

  const loadPreset = useCallback(() => {
    fetchDownloadPreset()
      .then((d) => {
        setPreset(d.found && d.text ? d.text : null)
        if (d.exampleUrl) setUrl(d.exampleUrl)
      })
      .catch((e) => setLog((x) => x + t("tools.logCmdErr", { e })))
  }, [t])

  useEffect(() => {
    loadPreset()
  }, [loadPreset])

  const loadDlFs = useCallback((path: string) => {
    listMusicDirs(path)
      .then(setDlList)
      .catch((e) => setLog((x) => x + t("tools.logFolderErr", { e })))
  }, [t])

  useEffect(() => {
    if (!library || !metaAlbumPath) return
    for (const a of library.artists) {
      for (const al of a.albums) {
        const rp = al.relPath || `${a.name}/${al.name}`
        if (rp === metaAlbumPath) {
          setMetaArtistName(a.name)
          return
        }
      }
    }
  }, [library, metaAlbumPath])

  useEffect(() => {
    if (!library || !albumForCover) return
    for (const a of library.artists) {
      for (const al of a.albums) {
        const rp = al.relPath || `${a.name}/${al.name}`
        if (rp === albumForCover) {
          setCoverPickArtist(a.name)
          return
        }
      }
    }
  }, [library, albumForCover])

  useEffect(() => {
    if (classifyYoutubeUrl(url) === "releases") return
    setRelPayload(null)
    setRelSel(new Set())
  }, [url])

  useEffect(() => {
    loadDlFs("")
  }, [loadDlFs])

  const commitDlDest = (path: string) => {
    setDlPath(path)
    setDlDestPicked(true)
    try {
      sessionStorage.setItem(K_DL_OK, "1")
      sessionStorage.setItem(K_DL_OUT, path)
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    try {
      if (albumForCover) {
        sessionStorage.setItem(K_COVER_ALB, albumForCover)
      } else {
        sessionStorage.removeItem(K_COVER_ALB)
        sessionStorage.removeItem(W_COVER_ALB)
      }
    } catch {
      /* ignore */
    }
  }, [albumForCover])

  useEffect(() => {
    fetchAccounts()
      .then((a) => {
        setSharedAccounts(a.accounts)
        setSharedLockedByEnv(a.lockedByEnv)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    const h = () => setLocalSessionAccount(getSelectedAccountId())
    window.addEventListener("kord-account-session-changed", h)
    return () => window.removeEventListener("kord-account-session-changed", h)
  }, [])

  const libraryArtistsSorted = useMemo((): LibArtist[] => {
    if (!library) return []
    return [...library.artists].sort((a, b) =>
      a.name.localeCompare(b.name, sortLocale, { sensitivity: "base" }),
    )
  }, [library, sortLocale])

  const metaAlbumsForPick = useMemo(() => {
    if (!library || !metaArtistName) return [] as { relPath: string; name: string }[]
    const ar = library.artists.find((x) => x.name === metaArtistName)
    if (!ar) return []
    return ar.albums
      .filter((al) => al.id !== "__loose__")
      .map((al) => ({
        relPath: al.relPath || `${ar.name}/${al.name}`,
        name: al.name,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, sortLocale, { numeric: true }))
  }, [library, metaArtistName, sortLocale])

  const coverAlbumsForPick = useMemo(() => {
    if (!library || !coverPickArtist) return [] as { relPath: string; name: string }[]
    const ar = library.artists.find((x) => x.name === coverPickArtist)
    if (!ar) return []
    return ar.albums
      .filter((al) => al.id !== "__loose__")
      .map((al) => ({
        relPath: al.relPath || `${ar.name}/${al.name}`,
        name: al.name,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, sortLocale, { numeric: true }))
  }, [library, coverPickArtist, sortLocale])

  const dlKind = useMemo(() => classifyYoutubeUrl(url), [url])

  const otherSharedAccounts = useMemo(
    () => sharedAccounts.filter((a) => a.id !== (localSessionAccount || "")),
    [sharedAccounts, localSessionAccount],
  )

  const sharedAlbumsForArtist = useMemo(() => {
    if (!sharedIndex || !sharedArtistId) return []
    return sharedIndex.albums.filter((a) => a.artistId === sharedArtistId && !a.loose)
  }, [sharedIndex, sharedArtistId])

  const loadSharedCatalog = useCallback(() => {
    if (!sharedSourceId) return
    setSharedLoadBusy(true)
    setSharedErr(null)
    setSharedMsg(null)
    setSharedIndex(null)
    setSharedArtistId("")
    setSharedAlbumRel("")
    fetchLibraryIndexForAccount(sharedSourceId)
      .then((ix) => {
        setSharedIndex(ix)
      })
      .catch((e) => {
        setSharedErr(
          t("tools.sharedErr", { e: String((e as Error)?.message || e) }),
        )
        setSharedIndex(null)
      })
      .finally(() => setSharedLoadBusy(false))
  }, [sharedSourceId, t])

  const doLinkSharedAlbum = useCallback(() => {
    if (!sharedSourceId || !sharedArtistId || !sharedAlbumRel) return
    setSharedLinkBusy(true)
    setSharedErr(null)
    setSharedMsg(null)
    const scope = sharedAlbumRel === SHARED_ALL_ALBUMS ? "artist" : "album"
    const rel = scope === "artist" ? sharedArtistId : sharedAlbumRel
    linkSharedFromAccount(sharedSourceId, rel, scope)
      .then((r: LinkSharedResult) => {
        if ("scope" in r && r.scope === "artist") {
          const extra = r.errors?.length
            ? t("tools.sharedLinkArtistErrors", { n: r.errors.length })
            : ""
          setSharedMsg(
            t("tools.sharedLinkOkArtist", {
              albums: r.albums.length,
              files: r.totalLinked,
              skipped: r.totalSkipped,
              extra,
            }) +
              (r.errors?.length
                ? ` ${r.errors.map((e) => e.relPath).join(", ")}`
                : ""),
          )
        } else {
          const al = r as LinkSharedAlbumResult
          setSharedMsg(
            t("tools.sharedLinkOk", {
              linked: al.linked,
              skipped: al.skipped,
              path: al.destRelPath,
            }),
          )
        }
        onRefreshLibrary()
      })
      .catch((e) => {
        setSharedErr(
          t("tools.sharedErr", { e: String((e as Error)?.message || e) }),
        )
      })
      .finally(() => setSharedLinkBusy(false))
  }, [onRefreshLibrary, sharedAlbumRel, sharedArtistId, sharedSourceId, t])

  const useCurrentForArt = () => {
    if (p.current) {
      setArtArt(p.current.artist)
      setArtAlb(p.current.album)
      setCoverPickArtist(p.current.artist)
      const folder = albumFolderFromTrackRelPath(p.current.relPath)
      if (folder) {
        setAlbumForCover(folder)
      }
    }
  }

  const setCoverDestFromCurrentTrack = () => {
    if (!p.current?.relPath) {
      setLog((x) => x + t("tools.logNoTrackPath"))
      return
    }
    const folder = albumFolderFromTrackRelPath(p.current.relPath)
    if (!folder) {
      setLog((x) => x + t("tools.logNoAlbumFolder"))
      return
    }
    setCoverPickArtist(p.current.artist)
    setAlbumForCover(folder)
    setLog((x) => x + t("tools.logCoverDest", { path: folder }))
  }

  const doCreateFolder = () => {
    const n = newDirName.trim()
    if (n.length < 1 || !dlList) return
    setMkBusy(true)
    createMusicSubdir(dlList.path || "", n)
      .then(({ relPath }) => {
        setLog((x) => x + t("tools.logNewFolder", { path: relPath }))
        setNewDirName("")
        const parent = relPath.split("/").slice(0, -1).join("/")
        loadDlFs(parent)
      })
      .catch((e) => setLog((x) => x + t("tools.logFolderErr", { e })))
      .finally(() => setMkBusy(false))
  }

  const setMetaFromCurrent = () => {
    if (!p.current?.relPath) {
      setMetaLog(t("tools.metaNoTrack"))
      return
    }
    setMetaArt(p.current.artist)
    setMetaAlb(p.current.album)
    setMetaArtistName(p.current.artist)
    const folder = albumFolderFromTrackRelPath(p.current.relPath)
    if (folder) {
      setMetaAlbumPath(folder)
      setMetaLog(t("tools.metaFromTrackOk"))
    } else {
      setMetaLog(t("tools.metaNoFolder"))
    }
  }

  const fetchOneAlbumMeta = () => {
    if (!metaAlbumPath.trim()) {
      setMetaLog(t("tools.metaPickAlbum"))
      return
    }
    setMetaBusy(true)
    fetchAlbumInfo(metaAlbumPath.trim(), metaArt.trim(), metaAlb.trim())
      .then((r) => {
        const d = r.meta?.date
        setMetaLog((s) =>
          s + t("tools.metaOkLine", { path: r.albumPath, date: fmtDate(d) }),
        )
        onRefreshLibrary()
      })
      .catch((e) => setMetaLog((s) => s + t("tools.metaErr", { e })))
      .finally(() => setMetaBusy(false))
  }

  const runMetaScanAll = async () => {
    if (!library) return
    stopMetaAll.current = false
    setMetaAllBusy(true)
    setMetaScanProg(null)
    const list: { path: string; artist: string; album: string }[] = []
    for (const a of library.artists) {
      for (const al of a.albums) {
        if (al.id === "__loose__") continue
        list.push({ path: `${a.name}/${al.name}`, artist: a.name, album: al.name })
      }
    }
    const toFetch = list.filter((row) => {
      const ar = library.artists.find((x) => x.name === row.artist)
      const al = ar?.albums.find((x) => x.name === row.album)
      return !al?.hasAlbumMeta
    })
    const skipped = list.length - toFetch.length
    setMetaLog(
      (s) =>
        s +
        t("tools.metaScanStart", {
          fetch: toFetch.length,
          skip:
            skipped > 0 ? t("tools.metaScanSkip", { n: skipped }) : "",
        }),
    )
    if (toFetch.length === 0) {
      setMetaAllBusy(false)
      setMetaLog((s) => s + t("tools.metaNoAlbums"))
      return
    }
    for (let i = 0; i < toFetch.length; i += 1) {
      if (stopMetaAll.current) {
        setMetaLog((s) => s + t("tools.metaUserStop"))
        setMetaScanProg(null)
        setMetaAllBusy(false)
        onRefreshLibrary()
        return
      }
      const row = toFetch[i]!
      setMetaScanProg({ current: i + 1, total: toFetch.length })
      try {
        await fetchAlbumInfo(row.path, row.artist, row.album)
      } catch (e) {
        setMetaLog((s) =>
          s +
          t("tools.metaScanItemErr", {
            i: i + 1,
            total: toFetch.length,
            path: row.path,
            err: String((e as Error)?.message || e),
          }),
        )
      }
      if (i < toFetch.length - 1) {
        await new Promise((r) => setTimeout(r, 1100))
      }
    }
    setMetaScanProg(null)
    setMetaAllBusy(false)
    setMetaLog((s) => s + t("tools.metaScanDone"))
    onRefreshLibrary()
  }

  const fetchCurrentTrackMeta = () => {
    if (!p.current?.relPath) {
      setMetaLog((s) => s + t("tools.metaNoTrack"))
      return
    }
    setTrackMetaBusy(true)
    fetchTrackInfo(p.current.relPath)
      .then((r) => {
        setMetaLog(
          (s) =>
            s +
            t("tools.metaTrackOk", {
              title: p.current?.title ?? "",
              date: fmtDate(r.meta.releaseDate),
              genre: formatTrackGenresForDisplay(r.meta.genre) || t("common.emDash"),
            }),
        )
        onRefreshLibrary()
      })
      .catch((e) => setMetaLog((s) => s + t("tools.metaTrackErr", { e })))
      .finally(() => setTrackMetaBusy(false))
  }

  const runTrackScanAll = async () => {
    if (!library) return
    stopTrackAll.current = false
    setTrackAllBusy(true)
    setTrackScanProg(null)
    const rels: string[] = []
    for (const a of library.artists) {
      for (const al of a.albums) {
        for (const t of al.tracks) rels.push(t.relPath)
      }
    }
    const toFetch = rels.filter((rel) => {
      const tr = findLibTrack(library, rel)
      const m = tr?.meta
      if (!m) return true
      return !(formatTrackGenresForDisplay(m.genre) || m.releaseDate)
    })
    const skippedT = rels.length - toFetch.length
    setMetaLog(
      (s) =>
        s +
        t("tools.trackScanStart", {
          fetch: toFetch.length,
          skip:
            skippedT > 0 ? t("tools.trackScanSkip", { n: skippedT }) : "",
        }),
    )
    if (toFetch.length === 0) {
      setTrackAllBusy(false)
      setMetaLog((s) => s + t("tools.trackNoUpdate"))
      return
    }
    for (let i = 0; i < toFetch.length; i += 1) {
      if (stopTrackAll.current) {
        setMetaLog((s) => s + t("tools.trackScanStop"))
        setTrackScanProg(null)
        setTrackAllBusy(false)
        onRefreshLibrary()
        return
      }
      const rel = toFetch[i]!
      setTrackScanProg({ current: i + 1, total: toFetch.length })
      try {
        await fetchTrackInfo(rel)
      } catch (e) {
        setMetaLog((s) =>
          s +
          t("tools.trackScanItemErr", {
            i: i + 1,
            total: toFetch.length,
            path: rel,
            err: String((e as Error)?.message || e),
          }),
        )
      }
      if (i < toFetch.length - 1) {
        await new Promise((r) => setTimeout(r, 350))
      }
    }
    setTrackScanProg(null)
    setTrackAllBusy(false)
    setMetaLog((s) => s + t("tools.trackScanDone"))
    onRefreshLibrary()
  }

  const runSanitizeTitles = async (scope: "album" | "all", dryRun: boolean) => {
    if (scope === "album" && !metaAlbumPath.trim()) {
      setMetaLog(
        (s) => s + t("tools.sanitizePickAlbum"),
      )
      return
    }
    setTitleSanBusy(true)
    try {
      if (scope === "all") {
        const rAll = await sanitizeTrackTitles({ scope: "all", dryRun })
        setMetaLog((s) => {
          const head = dryRun
            ? t("tools.sanitizeHeadPreviewLib", {
                a: rAll.albumsScanned,
                c: rAll.changes.length,
              })
            : t("tools.sanitizeHeadApplyLib", {
                a: rAll.albumsScanned,
                c: rAll.changes.length,
              })
          if (rAll.changes.length === 0) {
            return s + head + t("tools.sanitizeNoFixLib")
          }
          const lines: string[] = [s + head]
          const show = rAll.changes.slice(0, 100)
          for (const c of show) {
            lines.push(
              `  ${c.albumRel} / ${c.fileName}: “${c.from}” → “${c.to}”`,
            )
          }
          if (rAll.changes.length > 100) {
            lines.push(
              "  " + t("tools.sanitizeMore", { n: rAll.changes.length - 100 }),
            )
          }
          lines.push("")
          return lines.join("\n")
        })
      } else {
        const r1 = await sanitizeTrackTitles({
          scope: "album",
          albumPath: metaAlbumPath.trim(),
          dryRun,
        })
        setMetaLog((s) => {
          const head = dryRun
            ? t("tools.sanitizeHeadPreviewAlb", { path: r1.albumPath })
            : t("tools.sanitizeHeadApplyAlb", { path: r1.albumPath })
          if (r1.changes.length === 0) {
            return s + head + t("tools.sanitizeNoFixAlb")
          }
          let acc = s + head
          for (const c of r1.changes) {
            acc += `  ${c.fileName}: “${c.from}” → “${c.to}”\n`
          }
          if (!dryRun) acc += t("tools.sanitizeRefreshHint")
          return acc
        })
      }
      if (!dryRun) onRefreshLibrary()
    } catch (e) {
      setMetaLog((s) => s + t("tools.sanitizeErr", { e: String(e) }))
    } finally {
      setTitleSanBusy(false)
    }
  }

  const runDl = () => {
    if (!url.trim()) return
    if (dlKind === "releases") {
      setLog((x) => x + t("tools.dlNeedLoadReleases"))
      return
    }
    if (!dlDestPicked) {
      setLog((x) => x + t("tools.dlPickFolder"))
      return
    }
    setDlTrackProg(null)
    const ac = new AbortController()
    dlAbortRef.current = ac
    setDlBusy(true)
    setDlProg(null)
    setLog((x) =>
      x +
      t("tools.dlStart", {
        path: dlPath || t("tools.dlRootLabel"),
      }),
    )
    runYtdlpDownload(
      url.trim(),
      dlPath,
      (p) => setDlProg({ current: p.current, total: p.total }),
      ac.signal,
    )
      .then((r) => {
        if (r.progress && r.progress.total > 0) {
          setDlProg({ current: r.progress.current, total: r.progress.total })
        }
        const detail = ytdlpLogDetailForUser(r)
        setLog(
          (x) =>
            x +
            (r.ok
              ? t("tools.dlResultOk")
              : t("tools.dlResultErr", { code: r.code }) +
                (detail ? t("tools.dlErrDetail", { detail }) : "")),
        )
        onRefreshLibrary()
      })
      .catch((e) => {
        if (isAbortError(e)) {
          setLog((x) => x + t("tools.dlCancelled"))
          onRefreshLibrary()
        } else {
          setLog((x) => x + t("tools.dlFail", { e: String((e as Error)?.message || e) }))
        }
      })
      .finally(() => {
        dlAbortRef.current = null
        setDlBusy(false)
      })
  }

  const cancelDownload = () => {
    dlAbortRef.current?.abort()
  }

  const loadReleasesCatalog = () => {
    if (!url.trim()) return
    if (!dlDestPicked) {
      setLog((x) => x + t("tools.dlPickFolder"))
      return
    }
    setRelLoadBusy(true)
    fetchYoutubeReleasesList(url.trim())
      .then((data) => {
        setRelPayload(data)
        setRelSel(new Set(data.entries.map((e) => e.id)))
        setLog(
          (x) =>
            x +
            t("tools.dlReleasesListTitle") +
            `: ${data.entries.length}` +
            (data.uploader
              ? ` — ${t("tools.dlReleasesUploader", { name: data.uploader })}`
              : "") +
            "\n",
        )
      })
      .catch((e) =>
        setLog(
          (x) =>
            x + t("tools.sharedErr", { e: String((e as Error)?.message || e) }),
        ),
      )
      .finally(() => setRelLoadBusy(false))
  }

  const runReleasesDl = () => {
    if (!relPayload || !dlDestPicked) {
      if (!dlDestPicked) setLog((x) => x + t("tools.dlPickFolder"))
      return
    }
    const list = relPayload.entries.filter((e) => relSel.has(e.id))
    if (list.length === 0) {
      setLog((x) => x + t("tools.dlNeedSelection"))
      return
    }
    const multiRelease = list.length > 1
    setDlBusy(true)
    setDlTrackProg(multiRelease ? { current: 0, total: 0 } : null)
    setDlProg({ current: 1, total: list.length })
    const rootLabel = dlPath || t("tools.dlRootLabel")
    setLog(
      (x) =>
        x +
        t("tools.dlStart", { path: rootLabel }) +
        ` — ${list.length} album(s)\n`,
    )
    void (async () => {
      let userAborted = false
      for (let i = 0; i < list.length; i += 1) {
        const item = list[i]!
        setDlProg({ current: i + 1, total: list.length })
        if (multiRelease) setDlTrackProg({ current: 0, total: 0 })
        setLog((x) => x + t("tools.dlBatchLine", { i: i + 1, n: list.length, title: item.title }))
        const ac = new AbortController()
        dlAbortRef.current = ac
        try {
          const r = await runYtdlpDownload(
            item.url,
            dlPath,
            multiRelease
              ? (p) => setDlTrackProg({ current: p.current, total: p.total })
              : undefined,
            ac.signal,
          )
          const detail = ytdlpLogDetailForUser(r)
          setLog(
            (x) =>
              x +
              (r.ok
                ? t("tools.dlResultOk")
                : t("tools.dlResultErr", { code: r.code }) +
                  (detail ? t("tools.dlErrDetail", { detail }) : "")),
          )
        } catch (e) {
          if (isAbortError(e)) {
            setLog((x) => x + t("tools.dlCancelled"))
            userAborted = true
            break
          }
          setLog((x) => x + t("tools.dlFail", { e: String((e as Error)?.message || e) }))
        } finally {
          dlAbortRef.current = null
        }
      }
      if (!userAborted) {
        setDlProg({ current: list.length, total: list.length })
      }
      if (multiRelease) setDlTrackProg(null)
      setDlBusy(false)
      onRefreshLibrary()
    })()
  }

  const toggleRelEntry = (id: string) => {
    setRelSel((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  const relTypeLabel = () => {
    if (dlKind === "single") return t("tools.dlTypeSingle")
    if (dlKind === "playlist") return t("tools.dlTypePlaylist")
    if (dlKind === "releases") return t("tools.dlTypeReleases")
    return t("tools.dlTypeOther")
  }

  const dlProgNorm = normalizeDlProgress(dlProg)
  const dlTrackNorm = normalizeTrackInAlbumProgress(dlTrackProg)
  const showReleaseMultiTrackBar =
    dlKind === "releases" &&
    dlProgNorm != null &&
    dlProgNorm.tot > 1 &&
    (dlBusy || dlTrackProg != null)

  const doArtSearch = () => {
    const a = artArt.trim()
    const b = artAlb.trim()
    if (a.length < 1 && b.length < 1) return
    setArtBusy(true)
    searchArtwork(a || b ? { artist: a, album: b } : { q: `${a} ${b}`.trim() })
      .then(setArtRes)
      .catch(() => setArtRes([]))
      .finally(() => setArtBusy(false))
  }

  const applyCover = (imageUrl: string) => {
    if (!albumForCover) {
      setLog((x) => x + t("tools.coverPickDest"))
      return
    }
    setArtBusy(true)
    applyArtwork(albumForCover, imageUrl)
      .then(() => {
        setLog((x) => x + t("tools.coverSaved", { path: albumForCover }))
        onRefreshLibrary()
      })
      .catch((e) => setLog((x) => x + t("tools.coverErr", { e })))
      .finally(() => setArtBusy(false))
  }

  return (
    <div className="tools tool-studio-layout">
      <section className="studio-hero surface-card" aria-labelledby="studio-hero-title">
        <p className="eyebrow">{t("tools.studioHeroEyebrow")}</p>
        <h2 id="studio-hero-title" className="studio-hero__title">
          {t("tools.studioHeroTitle")}
        </h2>
      </section>

      {sharedAccounts.length >= 2 ? (
        <section
          className="tool-block glass tools-shared-lib"
          aria-labelledby="tools-shared-title"
        >
          <header className="studio-head">
            <p className="eyebrow">{t("tools.sharedEyebrow")}</p>
            <h3 id="tools-shared-title">{t("tools.sharedTitle")}</h3>
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
                      setSharedSourceId(e.target.value)
                      setSharedIndex(null)
                      setSharedArtistId("")
                      setSharedAlbumRel("")
                      setSharedMsg(null)
                      setSharedErr(null)
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
                      <label className="subtle sm block-label" htmlFor="shared-artist-sel">
                        {t("tools.sharedPickArtist")}
                      </label>
                      <select
                        id="shared-artist-sel"
                        className="select"
                        value={sharedArtistId}
                        onChange={(e) => {
                          const v = e.target.value
                          setSharedArtistId(v)
                          setSharedAlbumRel(v ? SHARED_ALL_ALBUMS : "")
                        }}
                      >
                        <option value="">{t("tools.sharedPickPlaceholder")}</option>
                        {sharedIndex.artists.map((ar) => (
                          <option key={ar.id} value={ar.id}>
                            {ar.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="subtle sm block-label" htmlFor="shared-album-sel">
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
                          <option value="">{t("tools.sharedAlbumNeedArtist")}</option>
                        ) : (
                          <>
                            <option value={SHARED_ALL_ALBUMS}>{t("tools.sharedAllAlbums")}</option>
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
                      disabled={sharedLinkBusy || !sharedArtistId || !sharedAlbumRel}
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
            {sharedErr ? <p className="subtle sm warnline">{sharedErr}</p> : null}
          </div>
        </section>
      ) : null}

      <section className="tool-block glass tools-download">
        <header className="studio-head">
          <h3>{t("tools.downloadTitle")}</h3>
        </header>

        <details className="studio-details" open={false}>
          <summary>{t("tools.cmdUsed")}</summary>
          <pre className="codebox" tabIndex={0}>
            {preset || t("tools.cmdFallback")}
          </pre>
        </details>

        <div className="studio-panel tools-dl-dest">
          <h4 className="studio-panel-title">{t("tools.dlSaveFolder")}</h4>
          <div className="tools-dl-dest__layout">
            <div className="tools-dl-dest__nav">
              <p className="subtle sm tools-dl-dest__label">
                {t("tools.dlPathLabel")}
              </p>
              <div className="breadcrumbs tools-dl-dest__crumbs">
                <button type="button" className="crumb" onClick={() => loadDlFs("")}>
                  {dlList?.musicRoot?.split("/").pop() || t("tools.musicRoot")}
                </button>
                {(dlList?.path || "")
                  .split("/")
                  .filter(Boolean)
                  .map((seg, i, arr) => {
                    const pth = arr.slice(0, i + 1).join("/")
                    return (
                      <span key={pth}>
                        <span className="sep">/</span>
                        <button
                          type="button"
                          className="crumb"
                          onClick={() => loadDlFs(pth)}
                        >
                          {seg}
                        </button>
                      </span>
                    )
                  })}
              </div>
              {dlList?.path ? (
                <button
                  type="button"
                  className="btn secondary sm tools-dl-dest__up"
                  onClick={() => loadDlFs(dlList.parent || "")}
                >
                  {t("tools.up")}
                </button>
              ) : null}
              <p className="subtle sm tools-dl-dest__label tools-dl-dest__subsep">
                {t("tools.dlSubfolders")}
              </p>
              {dlList && dlList.dirs.length === 0 ? (
                <p className="subtle sm tools-dl-dest__empty">
                  {t("tools.dlEmptyFolders")}
                </p>
              ) : null}
              <ul className="dirlist tools-dl-dest__dirlist">
                {dlList?.dirs.map((d) => (
                  <li key={d.relPath}>
                    <button
                      type="button"
                      className="tools-dl-dest__dirbtn"
                      onClick={() => loadDlFs(d.relPath)}
                    >
                      {d.name}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            <div className="tools-dl-dest__create">
              <p className="subtle sm tools-dl-dest__label">{t("tools.dlNewSubLabel")}</p>
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
                      e.preventDefault()
                      doCreateFolder()
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
              <p className="subtle sm tools-dl-dest__label">
                {t("tools.dlPathActions")}
              </p>
              <div className="tools-dl-dest__commit">
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    if (dlList) commitDlDest(dlList.path || "")
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
          <p className="subtle sm tools-dl-detected">
            <span className="tools-dl-detected__label">{t("tools.dlTypeLabel")}:</span>{" "}
            <strong>{relTypeLabel()}</strong>
          </p>
          <input
            type="url"
            className="w-full"
            placeholder={t("tools.dlUrlPh")}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            autoComplete="off"
          />
          {dlKind === "releases" ? (
            <div className="tools-dl-releases">
              {relPayload ? (
                <div className="tools-dl-releases__picks tools-dl-releases__picks--full">
                  <p className="subtle sm">
                    {relPayload.listTitle
                      ? relPayload.listTitle
                      : relPayload.uploader
                        ? t("tools.dlReleasesUploader", { name: relPayload.uploader })
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
                  >
                    {relPayload.entries.map((e) => (
                      <li key={e.id} className="tools-dl-releases__row">
                        <label className="tools-dl-releases__check">
                          <input
                            type="checkbox"
                            checked={relSel.has(e.id)}
                            onChange={() => toggleRelEntry(e.id)}
                          />
                          <span className="tools-dl-releases__title" title={e.url}>
                            {e.title}
                          </span>
                          <span
                            className="tools-dl-releases__trackcount"
                            aria-label={
                              e.trackCount != null
                                ? t("tools.dlTrackCountAria", { n: e.trackCount })
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
                  </ul>
                </div>
              ) : null}
              <div className="studio-inline-actions studio-inline-actions--spaced">
                {!relPayload ? (
                  <button
                    type="button"
                    className="btn"
                    onClick={loadReleasesCatalog}
                    disabled={relLoadBusy || !url.trim() || !dlDestPicked}
                  >
                    {relLoadBusy
                      ? t("tools.dlReleasesLoading")
                      : t("tools.dlLoadReleases")}
                  </button>
                ) : dlBusy ? (
                  <button type="button" className="btn secondary" onClick={cancelDownload}>
                    {t("tools.dlCancelDownload")}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn"
                    onClick={runReleasesDl}
                    disabled={!dlDestPicked || relSel.size === 0}
                  >
                    {t("tools.dlDownloadSelected")}
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="studio-inline-actions studio-inline-actions--spaced">
              {dlBusy ? (
                <button type="button" className="btn secondary" onClick={cancelDownload}>
                  {t("tools.dlCancelDownload")}
                </button>
              ) : (
                <button
                  type="button"
                  className="btn"
                  onClick={runDl}
                  disabled={!url.trim() || !dlDestPicked}
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
                          width:
                            dlProgNorm
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
                        width:
                          dlProgNorm
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
        <header className="studio-head">
          <h3>{t("tools.metaTitle")}</h3>
        </header>

        <div className="studio-panel">
          <h4 className="studio-panel-title">{t("tools.metaAlbumPanel")}</h4>
          <div className="tools-shared-browse-picks tools-studio-pair-picks">
            <div>
              <label className="subtle sm block-label" htmlFor="meta-artist-sel">
                {t("tools.sharedPickArtist")}
              </label>
              <select
                id="meta-artist-sel"
                className="select"
                value={metaArtistName}
                onChange={(e) => {
                  const v = e.target.value
                  setMetaArtistName(v)
                  setMetaAlbumPath("")
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
                  const v = e.target.value
                  setMetaAlbumPath(v)
                  const o = metaAlbumsForPick.find((x) => x.relPath === v)
                  if (o) {
                    setMetaArt(metaArtistName)
                    setMetaAlb(o.name)
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
          <h4 className="studio-panel-title">{t("tools.actions")}</h4>
          <div className="studio-action-groups">
            <div className="studio-action-group">
              <span className="studio-action-group-label">{t("tools.selectedAlbum")}</span>
              <div className="studio-action-row">
                <button
                  type="button"
                  className="btn secondary sm"
                  onClick={setMetaFromCurrent}
                  disabled={!p.current}
                >
                  {t("tools.fromNowPlaying")}
                </button>
                <button
                  type="button"
                  className="btn secondary"
                  onClick={fetchOneAlbumMeta}
                  disabled={metaBusy || !metaAlbumPath}
                >
                  {metaBusy ? t("tools.fetchingMeta") : t("tools.updateAlbumMeta")}
                </button>
              </div>
            </div>
            <div>
              <span className="studio-action-group-label">{t("tools.allAlbums")}</span>
              <div className="studio-action-row">
                <button
                  type="button"
                  className="btn"
                  onClick={runMetaScanAll}
                  disabled={metaAllBusy || !library}
                  title={t("tools.scanAlbumsTitle")}
                >
                  {metaAllBusy ? t("tools.scanning") : t("tools.scanAlbumsAuto")}
                </button>
              </div>
            </div>
            <div className="studio-action-group">
              <span className="studio-action-group-label">{t("tools.tracks")}</span>
              <div className="studio-action-row">
                <button
                  type="button"
                  className="btn secondary sm"
                  onClick={fetchCurrentTrackMeta}
                  disabled={!p.current || trackMetaBusy}
                >
                  {trackMetaBusy ? "…" : t("tools.currentTrackMeta")}
                </button>
                <button
                  type="button"
                  className="btn sm"
                  onClick={runTrackScanAll}
                  disabled={!library || trackAllBusy}
                >
                  {trackAllBusy ? t("tools.scanning") : t("tools.scanAllTracks")}
                </button>
              </div>
            </div>
            <div className="studio-action-group">
              <span className="studio-action-group-label">{t("tools.displayedTitles")}</span>
              <p className="subtle sm studio-hint-line">
                {t("tools.titleHint")}
              </p>
              <div className="studio-action-row">
                <button
                  type="button"
                  className="btn secondary sm"
                  disabled={!metaAlbumPath || titleSanBusy}
                  onClick={() => runSanitizeTitles("album", true)}
                >
                  {titleSanBusy ? "…" : t("tools.previewAlbum")}
                </button>
                <button
                  type="button"
                  className="btn secondary sm"
                  disabled={!metaAlbumPath || titleSanBusy}
                  onClick={() => runSanitizeTitles("album", false)}
                >
                  {titleSanBusy ? "…" : t("tools.applyAlbum")}
                </button>
              </div>
              <div className="studio-action-row">
                <button
                  type="button"
                  className="btn secondary sm"
                  disabled={!library || titleSanBusy}
                  onClick={() => runSanitizeTitles("all", true)}
                >
                  {titleSanBusy ? "…" : t("tools.previewLibrary")}
                </button>
                <button
                  type="button"
                  className="btn sm"
                  disabled={!library || titleSanBusy}
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
                        (metaScanProg.current / metaScanProg.total) * 100,
                      ),
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
                        (trackScanProg.current / trackScanProg.total) * 100,
                      ),
                    )}%`,
                  }}
                />
              </div>
            </div>
          ) : null}
          {(metaAllBusy || trackAllBusy) && (
            <div className="studio-stop-row">
              {metaAllBusy ? (
                <button
                  type="button"
                  className="btn secondary sm"
                  onClick={() => {
                    stopMetaAll.current = true
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
                    stopTrackAll.current = true
                  }}
                >
                  {t("tools.stopTracks")}
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
          <button type="button" className="linkbtn" onClick={() => setMetaLog("")}>
            {t("tools.clear")}
          </button>
        </div>
      </section>

      <section className="tool-block glass tools-art">
        <header className="studio-head">
          <h3>{t("tools.coversTitle")}</h3>
        </header>

        <div className="studio-panel">
          <h4 className="studio-panel-title">{t("tools.coversSave")}</h4>
          <div className="tools-shared-browse-picks tools-studio-pair-picks">
            <div>
              <label className="subtle sm block-label" htmlFor="cover-artist-sel">
                {t("tools.sharedPickArtist")}
              </label>
              <select
                id="cover-artist-sel"
                className="select"
                value={coverPickArtist}
                onChange={(e) => {
                  setCoverPickArtist(e.target.value)
                  setAlbumForCover("")
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
              <label className="subtle sm block-label" htmlFor="cover-album-sel">
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
            <button type="button" className="btn secondary sm" onClick={useCurrentForArt}>
              {t("tools.fillFromPlayback")}
            </button>
            <button type="button" className="btn" onClick={doArtSearch} disabled={artBusy}>
              {artBusy ? t("tools.searching") : t("tools.searchCovers")}
            </button>
          </div>
        </div>

        <div className="artgrid2">
          {artRes.map((a, i) => (
            <div key={i + a.artwork} className="artcard2">
              <div className="artcard2-img">
                <img src={a.artwork} alt="" loading="lazy" />
                {a.source ? <span className="art-src">{sourceLabel(a.source)}</span> : null}
              </div>
              <div className="artcap2">
                <strong>{a.artist}</strong>
                <br />
                {a.name}
              </div>
              <div className="art-actions">
                <a className="extlink" href={a.url} target="_blank" rel="noreferrer">
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
        {artRes.length === 0 && !artBusy && (artArt.length > 0 || artAlb.length > 0) ? (
          <p className="subtle sm studio-panel-gap">{t("tools.noCoverResults")}</p>
        ) : null}
      </section>
    </div>
  )
}
