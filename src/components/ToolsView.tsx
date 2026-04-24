import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { usePlayer } from "../context/PlayerContext"
import {
  applyArtwork,
  createMusicSubdir,
  fetchAlbumInfo,
  fetchTrackInfo,
  fetchDownloadPreset,
  listMusicDirs,
  runYtdlpDownload,
  sanitizeTrackTitles,
  searchArtwork,
} from "../lib/api"
import type { ArtworkHit } from "../lib/api"
import { fmtDate } from "../lib/metaFormat"
import { albumFolderFromTrackRelPath } from "../lib/trackPaths"
import type { LibTrack, LibraryResponse } from "../types"

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

function extLinkLabel(url: string): string {
  try {
    const h = new URL(url).hostname
    if (h.includes("apple.com")) return "iTunes / Apple"
    if (h.includes("deezer.com")) return "Deezer"
    if (h.includes("musicbrainz.org")) return "MusicBrainz"
    return h.replace("www.", "") || "Apri"
  } catch {
    return "Apri"
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

export function ToolsView({ library, onRefreshLibrary }: P) {
  const p = usePlayer()
  const [preset, setPreset] = useState<string | null>(null)
  const [url, setUrl] = useState("")
  const [log, setLog] = useState("")
  const [dlBusy, setDlBusy] = useState(false)
  const [dlProg, setDlProg] = useState<{ current: number; total: number } | null>(null)
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
  const [artArt, setArtArt] = useState("")
  const [artAlb, setArtAlb] = useState("")
  const [artRes, setArtRes] = useState<ArtworkHit[]>([])
  const [newDirName, setNewDirName] = useState("")
  const [mkBusy, setMkBusy] = useState(false)
  const [artBusy, setArtBusy] = useState(false)
  const [metaAlbumPath, setMetaAlbumPath] = useState("")
  const [metaArt, setMetaArt] = useState("")
  const [metaAlb, setMetaAlb] = useState("")
  const [metaBusy, setMetaBusy] = useState(false)
  const [metaLog, setMetaLog] = useState("")
  const [metaAllBusy, setMetaAllBusy] = useState(false)
  const stopMetaAll = useRef(false)
  const [metaScanProg, setMetaScanProg] = useState<{
    current: number
    total: number
  } | null>(null)
  const [trackMetaBusy, setTrackMetaBusy] = useState(false)
  const [trackAllBusy, setTrackAllBusy] = useState(false)
  const stopTrackAll = useRef(false)
  const [trackScanProg, setTrackScanProg] = useState<{
    current: number
    total: number
  } | null>(null)
  const [titleSanBusy, setTitleSanBusy] = useState(false)
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
      .catch((e) => setLog((x) => x + `Comando: ${e}\n`))
  }, [])

  useEffect(() => {
    loadPreset()
  }, [loadPreset])

  const loadDlFs = useCallback((path: string) => {
    listMusicDirs(path)
      .then(setDlList)
      .catch((e) => setLog((x) => x + `Cartelle: ${e}\n`))
  }, [])

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

  const albumOpts = useMemo(() => {
    if (!library) return [] as { label: string; value: string; releaseDate: string }[]
    const o: { label: string; value: string; releaseDate: string }[] = []
    for (const a of library.artists) {
      for (const al of a.albums) {
        if (al.id === "__loose__") continue
        o.push({
          label: `${a.name} — ${al.name}`,
          value: `${a.name}/${al.name}`,
          releaseDate: al.meta?.releaseDate || "",
        })
      }
    }
    o.sort((x, y) => {
      const dx = x.releaseDate
      const dy = y.releaseDate
      if (dx && dy && dx !== dy) return dx.localeCompare(dy, undefined, { numeric: true })
      if (dx && !dy) return -1
      if (!dx && dy) return 1
      return x.label.localeCompare(y.label, "it", { numeric: true })
    })
    return o
  }, [library])

  const metaOpts = useMemo(() => {
    if (!library) {
      return [] as {
        value: string
        label: string
        artist: string
        album: string
        releaseDate: string
      }[]
    }
    const o: {
      value: string
      label: string
      artist: string
      album: string
      releaseDate: string
    }[] = []
    for (const a of library.artists) {
      for (const al of a.albums) {
        if (al.id === "__loose__") continue
        o.push({
          value: `${a.name}/${al.name}`,
          label: `${a.name} — ${al.name}`,
          artist: a.name,
          album: al.name,
          releaseDate: al.meta?.releaseDate || "",
        })
      }
    }
    o.sort((x, y) => {
      const dx = x.releaseDate
      const dy = y.releaseDate
      if (dx && dy && dx !== dy) return dx.localeCompare(dy, undefined, { numeric: true })
      if (dx && !dy) return -1
      if (!dx && dy) return 1
      return x.label.localeCompare(y.label, "it", { numeric: true })
    })
    return o
  }, [library])

  const useCurrentForArt = () => {
    if (p.current) {
      setArtArt(p.current.artist)
      setArtAlb(p.current.album)
      const folder = albumFolderFromTrackRelPath(p.current.relPath)
      if (folder) {
        setAlbumForCover(folder)
      }
    }
  }

  const setCoverDestFromCurrentTrack = () => {
    if (!p.current?.relPath) {
      setLog((x) => x + "Nessun brano o percorso file.\n")
      return
    }
    const folder = albumFolderFromTrackRelPath(p.current.relPath)
    if (!folder) {
      setLog((x) => x + "Impossibile dedurre la cartella album da questo file.\n")
      return
    }
    setAlbumForCover(folder)
    setLog((x) => x + `Destinazione copertina: ${folder}\n`)
  }

  const doCreateFolder = () => {
    const n = newDirName.trim()
    if (n.length < 1 || !dlList) return
    setMkBusy(true)
    createMusicSubdir(dlList.path || "", n)
      .then(({ relPath }) => {
        setLog((x) => x + `Nuova cartella: ${relPath}\n`)
        setNewDirName("")
        const parent = relPath.split("/").slice(0, -1).join("/")
        loadDlFs(parent)
      })
      .catch((e) => setLog((x) => x + `Cartella: ${e}\n`))
      .finally(() => setMkBusy(false))
  }

  const setMetaFromCurrent = () => {
    if (!p.current?.relPath) {
      setMetaLog("Nessun brano in riproduzione.\n")
      return
    }
    setMetaArt(p.current.artist)
    setMetaAlb(p.current.album)
    const folder = albumFolderFromTrackRelPath(p.current.relPath)
    if (folder) {
      setMetaAlbumPath(folder)
      setMetaLog("Campi e cartella impostati dal brano in corso.\n")
    } else {
      setMetaLog("Cartella album non deducibile.\n")
    }
  }

  const fetchOneAlbumMeta = () => {
    if (!metaAlbumPath.trim()) {
      setMetaLog("Scegli un album (percorso cartella sotto Musica).\n")
      return
    }
    setMetaBusy(true)
    fetchAlbumInfo(metaAlbumPath.trim(), metaArt.trim(), metaAlb.trim())
      .then((r) => {
        const d = r.meta?.date
        setMetaLog((s) => s + `OK ${r.albumPath}: data ${fmtDate(d)}\n`)
        onRefreshLibrary()
      })
      .catch((e) => setMetaLog((s) => s + `Errore: ${e}\n`))
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
        `Scansione album: ${toFetch.length} da scaricare${
          skipped > 0 ? `, ${skipped} saltati (metadati già in cartella)` : ""
        }.\n`,
    )
    if (toFetch.length === 0) {
      setMetaAllBusy(false)
      setMetaLog((s) => s + "Nessun album da aggiornare.\n")
      return
    }
    for (let i = 0; i < toFetch.length; i += 1) {
      if (stopMetaAll.current) {
        setMetaLog((s) => s + "Interrotto dall’utente.\n")
        setMetaScanProg(null)
        setMetaAllBusy(false)
        onRefreshLibrary()
        return
      }
      const row = toFetch[i]!
      setMetaScanProg({ current: i + 1, total: toFetch.length })
      setMetaLog((s) => s + `[${i + 1}/${toFetch.length}] ${row.path}…\n`)
      try {
        await fetchAlbumInfo(row.path, row.artist, row.album)
        setMetaLog((s) => s + "  → ok\n")
      } catch (e) {
        setMetaLog((s) => s + `  → ${e}\n`)
      }
      if (i < toFetch.length - 1) {
        await new Promise((r) => setTimeout(r, 1100))
      }
    }
    setMetaScanProg(null)
    setMetaAllBusy(false)
    setMetaLog((s) => s + "Fine scansione.\n")
    onRefreshLibrary()
  }

  const fetchCurrentTrackMeta = () => {
    if (!p.current?.relPath) {
      setMetaLog((s) => s + "Nessun brano in riproduzione.\n")
      return
    }
    setTrackMetaBusy(true)
    fetchTrackInfo(p.current.relPath)
      .then((r) => {
        setMetaLog(
          (s) =>
            s +
            `Brano OK: ${p.current?.title} · ${fmtDate(r.meta.releaseDate)} · ${r.meta.genre || "—"}\n`,
        )
        onRefreshLibrary()
      })
      .catch((e) => setMetaLog((s) => s + `Brano: ${e}\n`))
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
      return !(m.genre || m.releaseDate)
    })
    const skippedT = rels.length - toFetch.length
    setMetaLog(
      (s) =>
        s +
        `Scansione brani: ${toFetch.length} da scaricare${
          skippedT > 0
            ? `, ${skippedT} saltati (genere o data già presenti)`
            : ""
        }.\n`,
    )
    if (toFetch.length === 0) {
      setTrackAllBusy(false)
      setMetaLog((s) => s + "Nessun brano da aggiornare.\n")
      return
    }
    for (let i = 0; i < toFetch.length; i += 1) {
      if (stopTrackAll.current) {
        setMetaLog((s) => s + "Scansione brani interrotta.\n")
        setTrackScanProg(null)
        setTrackAllBusy(false)
        onRefreshLibrary()
        return
      }
      const rel = toFetch[i]!
      setTrackScanProg({ current: i + 1, total: toFetch.length })
      setMetaLog((s) => s + `[brano ${i + 1}/${toFetch.length}] ${rel}\n`)
      try {
        await fetchTrackInfo(rel)
      } catch (e) {
        setMetaLog((s) => s + `  → ${e}\n`)
      }
      if (i < toFetch.length - 1) {
        await new Promise((r) => setTimeout(r, 350))
      }
    }
    setTrackScanProg(null)
    setTrackAllBusy(false)
    setMetaLog((s) => s + "Fine scansione metadati brani.\n")
    onRefreshLibrary()
  }

  const runSanitizeTitles = async (scope: "album" | "all", dryRun: boolean) => {
    if (scope === "album" && !metaAlbumPath.trim()) {
      setMetaLog(
        (s) =>
          s + "Scegli un album (menu «Album e campi di ricerca») per l’anteprima o l’applicazione sull’album.\n",
      )
      return
    }
    setTitleSanBusy(true)
    try {
      if (scope === "all") {
        const rAll = await sanitizeTrackTitles({ scope: "all", dryRun })
        setMetaLog((s) => {
          const head =
            (dryRun ? "Anteprima" : "Applicazione") +
            " titoli visibili — tutta la libreria\n" +
            `Album scansionati: ${rAll.albumsScanned} · file da aggiustare: ${rAll.changes.length}\n`
          if (rAll.changes.length === 0) {
            return s + head + "Nessun nome file con prefisso numerico o con […] da correggere.\n"
          }
          const lines: string[] = [s + head]
          const show = rAll.changes.slice(0, 100)
          for (const c of show) {
            lines.push(
              `  ${c.albumRel} / ${c.fileName}: “${c.from}” → “${c.to}”`,
            )
          }
          if (rAll.changes.length > 100) {
            lines.push(`  … e altre ${rAll.changes.length - 100} voci.`)
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
          const head =
            (dryRun ? "Anteprima" : "Scrittura kord-trackinfo") +
            ` — ${r1.albumPath}\n`
          if (r1.changes.length === 0) {
            return (
              s +
              head +
              "Nessun file da aggiustare in questo album.\n"
            )
          }
          let t = s + head
          for (const c of r1.changes) {
            t += `  ${c.fileName}: “${c.from}” → “${c.to}”\n`
          }
          if (!dryRun) t += "OK, aggiorna la libreria se non si aggiorna da sola.\n"
          return t
        })
      }
      if (!dryRun) onRefreshLibrary()
    } catch (e) {
      setMetaLog((s) => s + `Titoli: ${e}\n`)
    } finally {
      setTitleSanBusy(false)
    }
  }

  const runDl = () => {
    if (!url.trim()) return
    if (!dlDestPicked) {
      setLog(
        (x) =>
          x +
          "Scegli la cartella: «Usa questa cartella» o «Usa root Musica» (sopra).\n",
      )
      return
    }
    setDlBusy(true)
    setDlProg(null)
    setLog(
      (x) => x + `→ Avvio in «${dlPath || "(root Musica)"}»…\n`,
    )
    runYtdlpDownload(url.trim(), dlPath)
      .then((r) => {
        if (r.progress && r.progress.total > 0) {
          setDlProg({ current: r.progress.current, total: r.progress.total })
        }
        const errText = [r.error, r.stderr]
          .filter(Boolean)
          .join("\n")
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(
            (l) =>
              l.length > 0 &&
              (/\berror\b/i.test(l) ||
                /\bwarning\b/i.test(l) ||
                /\bfailed\b/i.test(l) ||
                /\b403\b|\b404\b/.test(l)),
          )
          .join("\n")
        setLog(
          (x) =>
            x +
            `${r.ok ? "OK" : "Errore"} (code ${r.code})\n` +
            (r.progress?.total
              ? `Progresso: ${r.progress.current}/${r.progress.total}\n`
              : "") +
            (errText ? `Dettagli errore:\n${errText}\n` : ""),
        )
        onRefreshLibrary()
      })
      .catch((e) => setLog((x) => x + `Errore: ${e}\n`))
      .finally(() => setDlBusy(false))
  }

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
      setLog((x) => x + "Scegli un album di destinazione o «da brano in corso».\n")
      return
    }
    setArtBusy(true)
    applyArtwork(albumForCover, imageUrl)
      .then(() => {
        setLog((x) => x + `Copertina salvata in ${albumForCover}\n`)
        onRefreshLibrary()
      })
      .catch((e) => setLog((x) => x + `Copertina: ${e}\n`))
      .finally(() => setArtBusy(false))
  }

  return (
    <div className="tools tool-studio-layout">
      <section className="tool-block glass tools-download">
        <header className="studio-head">
          <h3>Download</h3>
        </header>

        <details className="studio-details" open={false}>
          <summary>Comando usato</summary>
          <pre className="codebox" tabIndex={0}>
            {preset || "yt-dlp -x --audio-format flac --embed-thumbnail --add-metadata -o \"…\" + URL"}
          </pre>
        </details>

        <div className="studio-panel">
          <h4 className="studio-panel-title">Destinazione</h4>
          <div className="breadcrumbs">
            <button type="button" className="crumb" onClick={() => loadDlFs("")}>
              {dlList?.musicRoot?.split("/").pop() || "Musica"}
            </button>
            {(dlList?.path || "")
              .split("/")
              .filter(Boolean)
              .map((seg, i, arr) => {
                const pth = arr.slice(0, i + 1).join("/")
                return (
                  <span key={pth}>
                    <span className="sep">/</span>
                    <button type="button" className="crumb" onClick={() => loadDlFs(pth)}>
                      {seg}
                    </button>
                  </span>
                )
              })}
          </div>
          {dlList?.path ? (
            <button
              type="button"
              className="btn secondary sm"
              onClick={() => loadDlFs(dlList.parent || "")}
            >
              ← Su
            </button>
          ) : null}
          <ul className="dirlist">
            {dlList?.dirs.map((d) => (
              <li key={d.relPath}>
                <button type="button" onClick={() => loadDlFs(d.relPath)}>
                  {d.name}
                </button>
              </li>
            ))}
          </ul>
          <div className="row gap flex-wrap align-end">
            <input
              type="text"
              className="flex1"
              minLength={1}
              maxLength={200}
              placeholder="Nuova sottocartella"
              value={newDirName}
              onChange={(e) => setNewDirName(e.target.value)}
              aria-label="Nome nuova cartella"
            />
            <button
              type="button"
              className="btn secondary sm"
              disabled={mkBusy || !newDirName.trim() || !dlList}
              onClick={doCreateFolder}
            >
              {mkBusy ? "Creo…" : "Crea qui"}
            </button>
          </div>
          <div className="studio-inline-actions studio-inline-actions--spaced">
            <button
              type="button"
              className="btn"
              onClick={() => {
                if (dlList) commitDlDest(dlList.path || "")
              }}
              disabled={!dlList}
              title="Percorso relativo a Musica"
            >
              Usa questa cartella
            </button>
            <button
              type="button"
              className="btn secondary"
              onClick={() => commitDlDest("")}
              title="File direttamente sotto Musica"
            >
              Root Musica
            </button>
          </div>
          {dlDestPicked ? (
            <p className="art-target sm">
              Destinazione: <code>{dlPath || "— (root) —"}</code>
            </p>
          ) : (
            <p className="subtle sm warnline">Conferma una cartella prima del download.</p>
          )}
        </div>

        <div className="studio-panel">
          <h4 className="studio-panel-title">URL</h4>
          <input
            type="url"
            className="w-full"
            placeholder="URL playlist o video"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <div className="studio-inline-actions studio-inline-actions--spaced">
            <button
              type="button"
              className="btn"
              onClick={runDl}
              disabled={dlBusy || !url.trim() || !dlDestPicked}
            >
              {dlBusy ? "Esecuzione…" : "Scarica e importa"}
            </button>
            <button type="button" className="btn secondary sm" onClick={loadPreset}>
              Ricarica testo comando
            </button>
          </div>
          {(dlBusy || dlProg) && (
            <div className="dl-progress-wrap" aria-live="polite">
              <div className="dl-progress-top">
                <strong>Avanzamento</strong>
                <span>
                  {dlBusy
                    ? dlProg
                      ? `${dlProg.current}/${dlProg.total}`
                      : "in corso…"
                    : dlProg
                      ? `${dlProg.current}/${dlProg.total}`
                      : "—"}
                </span>
              </div>
              <div className="dl-progress-rail">
                <div
                  className="dl-progress-fill"
                  style={{
                    width:
                      dlProg && dlProg.total > 0
                        ? `${Math.max(3, Math.min(100, (dlProg.current / dlProg.total) * 100))}%`
                        : dlBusy
                          ? "18%"
                          : "0%",
                  }}
                />
              </div>
            </div>
          )}
        </div>

        <div className="studio-log">
          <label className="subtle sm">Log</label>
          <textarea
            className="log"
            value={log}
            onChange={(e) => setLog(e.target.value)}
            rows={4}
          />
          <button type="button" className="linkbtn" onClick={() => setLog("")}>
            Pulisci
          </button>
        </div>
      </section>

      <section className="tool-block glass tools-meta">
        <header className="studio-head">
          <h3>Metadati</h3>
        </header>

        <div className="studio-panel">
          <h4 className="studio-panel-title">Album e campi di ricerca</h4>
          <select
            className="select"
            value={metaAlbumPath}
            onChange={(e) => {
              const v = e.target.value
              setMetaAlbumPath(v)
              const o = metaOpts.find((x) => x.value === v)
              if (o) {
                setMetaArt(o.artist)
                setMetaAlb(o.album)
              }
            }}
            aria-label="Album per metadati"
          >
            <option value="">Scegli album…</option>
            {metaOpts.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {metaAlbumPath ? (
            <p className="art-target sm">
              Cartella: <code>{metaAlbumPath}</code>
            </p>
          ) : null}
          <div className="art-fields">
            <input
              type="text"
              className="flex1"
              value={metaArt}
              onChange={(e) => setMetaArt(e.target.value)}
              placeholder="Artista"
            />
            <input
              type="text"
              className="flex1"
              value={metaAlb}
              onChange={(e) => setMetaAlb(e.target.value)}
              placeholder="Album"
            />
          </div>
        </div>

        <div className="studio-panel">
          <h4 className="studio-panel-title">Azioni</h4>
          <div className="studio-action-groups">
            <div className="studio-action-group">
              <span className="studio-action-group-label">Album selezionato</span>
              <div className="studio-action-row">
                <button
                  type="button"
                  className="btn secondary sm"
                  onClick={setMetaFromCurrent}
                  disabled={!p.current}
                >
                  Da brano in riproduzione
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={fetchOneAlbumMeta}
                  disabled={metaBusy || !metaAlbumPath}
                >
                  {metaBusy ? "Scarico…" : "Aggiorna metadati album"}
                </button>
              </div>
            </div>
            <div>
              <span className="studio-action-group-label">Tutti gli album</span>
              <div className="studio-action-row">
                <button
                  type="button"
                  className="btn secondary"
                  onClick={runMetaScanAll}
                  disabled={metaAllBusy || !library}
                  title="Salta album con kord-albuminfo.json; ritardo tra le richieste (rate limit MusicBrainz)"
                >
                  {metaAllBusy ? "Scansione…" : "Scansione automatica album"}
                </button>
              </div>
            </div>
            <div className="studio-action-group">
              <span className="studio-action-group-label">Brani</span>
              <div className="studio-action-row">
                <button
                  type="button"
                  className="btn secondary sm"
                  onClick={fetchCurrentTrackMeta}
                  disabled={!p.current || trackMetaBusy}
                >
                  {trackMetaBusy ? "…" : "Metadati brano attuale"}
                </button>
                <button
                  type="button"
                  className="btn secondary sm"
                  onClick={runTrackScanAll}
                  disabled={!library || trackAllBusy}
                >
                  {trackAllBusy ? "Scansione…" : "Scansione tutti i brani"}
                </button>
              </div>
            </div>
            <div className="studio-action-group">
              <span className="studio-action-group-label">Titoli mostrati (da nome file)</span>
              <p className="subtle sm studio-hint-line">
                Senza rinominare i file: salva in{" "}
                <code>kord-trackinfo.json</code> un titolo senza prefisso tipo{" "}
                <code>01 -</code>/<code>12 —</code> e senza segmenti tra parentesi quadre{" "}
                <code>[…]</code>, calcolato dal nome file.
              </p>
              <div className="studio-action-row">
                <button
                  type="button"
                  className="btn secondary sm"
                  disabled={!metaAlbumPath || titleSanBusy}
                  onClick={() => runSanitizeTitles("album", true)}
                >
                  {titleSanBusy ? "…" : "Anteprima album"}
                </button>
                <button
                  type="button"
                  className="btn secondary sm"
                  disabled={!metaAlbumPath || titleSanBusy}
                  onClick={() => runSanitizeTitles("album", false)}
                >
                  {titleSanBusy ? "…" : "Applica su album"}
                </button>
              </div>
              <div className="studio-action-row">
                <button
                  type="button"
                  className="btn sm"
                  disabled={!library || titleSanBusy}
                  onClick={() => runSanitizeTitles("all", true)}
                >
                  {titleSanBusy ? "…" : "Anteprima tutta la libreria"}
                </button>
                <button
                  type="button"
                  className="btn sm"
                  disabled={!library || titleSanBusy}
                  onClick={() => runSanitizeTitles("all", false)}
                >
                  {titleSanBusy ? "…" : "Applica a tutta la libreria"}
                </button>
              </div>
            </div>
          </div>
          {metaAllBusy && metaScanProg && metaScanProg.total > 0 ? (
            <div className="dl-progress-wrap">
              <div className="dl-progress-top">
                <span>Metadati album (MB / TheAudioDB / iTunes)</span>
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
                <span>Metadati brani</span>
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
                  Interrompi album
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
                  Interrompi brani
                </button>
              ) : null}
            </div>
          )}
        </div>

        <div className="studio-log">
          <label className="subtle sm">Log</label>
          <textarea
            className="log"
            value={metaLog}
            onChange={(e) => setMetaLog(e.target.value)}
            rows={3}
          />
          <button type="button" className="linkbtn" onClick={() => setMetaLog("")}>
            Pulisci
          </button>
        </div>
      </section>

      <section className="tool-block glass tools-art">
        <header className="studio-head">
          <h3>Copertine</h3>
        </header>

        <div className="studio-panel">
          <h4 className="studio-panel-title">Salvataggio</h4>
          <select
            className="select"
            value={albumForCover}
            onChange={(e) => setAlbumForCover(e.target.value)}
            aria-label="Album in cui salvare la copertina"
          >
            <option value="">Scegli album…</option>
            {albumOpts.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
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
            Usa album del brano in riproduzione
          </button>
        </div>

        <div className="studio-panel">
          <h4 className="studio-panel-title">Ricerca</h4>
          <div className="art-fields">
            <input
              type="text"
              className="flex1"
              value={artArt}
              onChange={(e) => setArtArt(e.target.value)}
              placeholder="Artista"
            />
            <input
              type="text"
              className="flex1"
              value={artAlb}
              onChange={(e) => setArtAlb(e.target.value)}
              placeholder="Album"
            />
          </div>
          <div className="studio-inline-actions studio-inline-actions--spaced">
            <button type="button" className="btn secondary sm" onClick={useCurrentForArt}>
              Compila da riproduzione
            </button>
            <button type="button" className="btn" onClick={doArtSearch} disabled={artBusy}>
              {artBusy ? "Ricerca…" : "Cerca copertine"}
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
                  {extLinkLabel(a.url)}
                </a>
                <button
                  type="button"
                  className="btn sm"
                  disabled={artBusy || !albumForCover}
                  onClick={() => applyCover(a.artwork)}
                >
                  Salva
                </button>
              </div>
            </div>
          ))}
        </div>
        {artRes.length === 0 && !artBusy && (artArt.length > 0 || artAlb.length > 0) ? (
          <p className="subtle sm studio-panel-gap">Nessun risultato. Prova altre parole.</p>
        ) : null}
      </section>
    </div>
  )
}
