import fs from "fs/promises"
import { existsSync } from "fs"
import path from "path"

const LIB_EXCLUDE = new Set([
  "kord",
  "node_modules",
  ".git",
  ".trash",
  ".wpp",
  ".kord",
])
const AUDIO_RE = /\.(mp3|flac|m4a|ogg|opus|wav|aac)$/i

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"

const ITUNES_HEADERS = {
  "User-Agent": UA,
  Accept: "application/json, text/javascript, */*;q=0.01",
  "Accept-Language": "en-US,en;q=0.9,it;q=0.85",
}

const MB_UA = "Kord/1.0 (https://github.com/local)"

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function itunesStorefronts() {
  const fromEnv = (process.env.ITUNES_STORE_COUNTRIES || "it,us,gb,de,fr")
    .split(/[,\s]+/)
    .map((c) => c.trim().toLowerCase())
    .filter((c) => /^[a-z]{2}$/.test(c))
  return fromEnv.length ? fromEnv : ["it", "us", "gb"]
}

/** Rimuove "Artista - " o "Artista: " se coincide con la cartella artista */
function stripRedundantArtistPrefix(artist, title) {
  const ar = String(artist || "")
    .trim()
    .replace(/\s*\/\s*/g, " / ")
  const t = String(title || "").trim()
  if (ar.length < 2) return t
  const re = new RegExp(
    `^\\s*${ar.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[-–—:|]\\s*`,
    "i",
  )
  return t.replace(re, "").trim()
}

/** Unicode / YouTube: rende i titoli più cercabili */
export function cleanTrackTitleForSearch(raw) {
  let s = String(raw || "")
  s = s
    .replace(/[？?…]/g, " ")
    .replace(/[⧸／﹨]/g, " ")
    .replace(/[＆&]/g, " ")
  s = s.split(/\s*[|｜]\s*/)[0] ?? s
  s = s.split(/\s*\/\/\s*/)[0] ?? s
  s = s.replace(/^\d{1,2}\s*[-–—.]\s*/i, "")
  s = s.replace(
    /\s*[\[【].*?[\]】]|\s*[\(（](?:official|clean|lyric|full\s+version|hd|4k|video|audio|live|anime|skit|hidden)[^)\]]*[\)）]/gi,
    " ",
  )
  s = s.replace(
    /\s*[\(（]?\s*(?:feat\.?|ft\.?|featuring|con)\s*[^)]+/gi,
    " ",
  )
  s = s.replace(
    /\s*-\s*(?:Official\s+)?(?:Music\s+Video|Video|Audio|Lyric\s+Video|Lyrics?|Remaster|Live)\b/gi,
    " ",
  )
  s = s.replace(
    /\s*[\(（]?(?:Long\s+Version|Clean\s+Version|Remaster(?:ed)?\s*\d*)\s*[\)）]?/gi,
    " ",
  )
  s = s.replace(
    /(?:Eminem|Caparezza|Salmo|Fabri Fibra|Linkin Park|TonyPitony)\s*-\s*/gi,
    " ",
  )
  s = s.replace(/\s+\[[a-z0-9\s]+\]\s*$/i, " ")
  s = s.replace(/\s+/g, " ").trim()
  if (s.length > 200) s = s.slice(0, 200)
  return s
}

export function prepareTrackTitleForMeta(artist, titleFromFile) {
  const base = String(titleFromFile || "").trim()
  const a = String(artist || "").trim()
  return cleanTrackTitleForSearch(stripRedundantArtistPrefix(a, base)) || base
}

function cleanAlbumNameForSearch(raw) {
  return String(raw || "")
    .replace(/[？?…]/g, " ")
    .replace(/[⧸／]/g, "/")
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * @param {string} albumDir percorso assoluto
 */
const FILE_ALBUM = "kord-albuminfo.json"
const FILE_ALBUM_WPP = "wpp-albuminfo.json"
const FILE_TRACK = "kord-trackinfo.json"
const FILE_TRACK_WPP = "wpp-trackinfo.json"

function pickAlbumMetaPath(albumDir) {
  const k = path.join(albumDir, FILE_ALBUM)
  const w = path.join(albumDir, FILE_ALBUM_WPP)
  if (existsSync(k)) return k
  if (existsSync(w)) return w
  return k
}

function pickTrackMetaPath(albumDir) {
  const k = path.join(albumDir, FILE_TRACK)
  const w = path.join(albumDir, FILE_TRACK_WPP)
  if (existsSync(k)) return k
  if (existsSync(w)) return w
  return k
}

export async function loadAlbumJsonMetaFromDir(albumDir) {
  const p = pickAlbumMetaPath(albumDir)
  if (!existsSync(p)) return null
  try {
    const raw = await fs.readFile(p, "utf8")
    const j = JSON.parse(raw)
    if (!j || typeof j !== "object") return null
    return {
      releaseDate: j.date || j.releaseDate || null,
      label: j.label || null,
      country: j.country || null,
      musicbrainzReleaseId: j.musicbrainzReleaseId || null,
    }
  } catch {
    return null
  }
}

/**
 * @param {string} albumDir percorso assoluto
 */
export async function loadTrackJsonMetaMapFromDir(albumDir) {
  const p = pickTrackMetaPath(albumDir)
  if (!existsSync(p)) return {}
  try {
    const raw = await fs.readFile(p, "utf8")
    const j = JSON.parse(raw)
    if (!j || typeof j !== "object") return {}
    const out = {}
    for (const [k, v] of Object.entries(j)) {
      if (!k || !v || typeof v !== "object") continue
      const t = v.title != null && String(v.title).trim() ? String(v.title).trim() : null
      out[k] = {
        title: t,
        releaseDate: v.releaseDate || v.date || null,
        genre: v.genre || null,
        durationMs: Number.isFinite(v.durationMs) ? v.durationMs : null,
        trackNumber: Number.isFinite(v.trackNumber) ? v.trackNumber : null,
        discNumber: Number.isFinite(v.discNumber) ? v.discNumber : null,
        source: v.source || null,
        url: v.url || null,
      }
    }
    return out
  } catch {
    return {}
  }
}

/**
 * Rimuove segmenti [testo], prefisso "numero + trattino" o "numero + punto" dal nome file (senza estensione).
 */
export function sanitizeLocalTrackTitleDisplay(raw) {
  let s = String(raw || "")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  s = s.replace(/^\d+\s*[-–—]\s*/i, "").trim()
  s = s.replace(/^\d+\s*\.\s+/, "").trim()
  s = s.replace(/\s+/g, " ").trim()
  if (s.length > 200) s = s.slice(0, 200)
  return s
}

/**
 * Scrive in kord-trackinfo.json (o legacy wpp-*) il campo `title` quando il nome file contiene numeri+trattino o […] da normalizzare.
 * @param {string} albumDir percorso assoluto album
 * @param {boolean} dryRun
 */
export async function sanitizeTrackTitlesInAlbumDir(albumDir, dryRun) {
  const changes = []
  const entries = await fs.readdir(albumDir, { withFileTypes: true })
  const readPath = pickTrackMetaPath(albumDir)
  const writePath = path.join(albumDir, FILE_TRACK)
  let mut = {}
  if (existsSync(readPath)) {
    try {
      const raw = await fs.readFile(readPath, "utf8")
      const j = JSON.parse(raw)
      if (j && typeof j === "object") mut = { ...j }
    } catch {
      mut = {}
    }
  }
  for (const e of entries) {
    if (!e.isFile() || !AUDIO_RE.test(e.name)) continue
    const base = e.name.replace(AUDIO_RE, "").trim() || e.name
    const to = sanitizeLocalTrackTitleDisplay(base)
    if (to === base) continue
    const existing =
      mut[e.name] && typeof mut[e.name] === "object" ? { ...mut[e.name] } : {}
    changes.push({ fileName: e.name, from: base, to })
    if (!dryRun) {
      mut[e.name] = { ...existing, title: to }
    }
  }
  let written = false
  if (!dryRun && changes.length) {
    await fs.writeFile(writePath, JSON.stringify(mut, null, 2), "utf8")
    written = true
  }
  return { changes, written }
}

/**
 * @param {string} musicRoot
 */
export async function listAlbumRelPathsUnderRoot(musicRoot) {
  const out = []
  const top = await fs.readdir(musicRoot, { withFileTypes: true })
  for (const t of top) {
    if (!t.isDirectory() || t.name.startsWith(".") || LIB_EXCLUDE.has(t.name)) {
      continue
    }
    const ap = path.join(musicRoot, t.name)
    const subs = await fs.readdir(ap, { withFileTypes: true })
    for (const s of subs) {
      if (!s.isDirectory() || s.name.startsWith(".")) continue
      out.push(`${t.name}/${s.name}`)
    }
  }
  return out
}

/**
 * @param {string} musicRoot
 * @param {boolean} dryRun
 */
export async function sanitizeTrackTitlesFullLibrary(musicRoot, dryRun) {
  const rels = await listAlbumRelPathsUnderRoot(musicRoot)
  const changes = []
  for (const rel of rels) {
    const full = path.join(musicRoot, rel.replaceAll("/", path.sep))
    if (!existsSync(full)) continue
    const r = await sanitizeTrackTitlesInAlbumDir(full, dryRun)
    for (const c of r.changes) {
      changes.push({ albumRel: rel, fileName: c.fileName, from: c.from, to: c.to })
    }
  }
  return { changes, albumsScanned: rels.length, dryRun }
}

export async function fetchReleaseMetadataMusicBrainz(artist, album) {
  const a = String(artist || "").trim()
  const b = String(album || "").trim()
  if (a.length < 1 && b.length < 1) return { error: "Artista o album mancante" }
  const q =
    a && b
      ? `release:"${b}" AND artist:"${a}"`
      : b
        ? `release:"${b}"`
        : `release:"${a}"`
  const searchUrl = `https://musicbrainz.org/ws/2/release/?query=${encodeURIComponent(
    q,
  )}&fmt=json&limit=5`
  let r0 = await fetch(searchUrl, { headers: { "User-Agent": MB_UA } })
  for (let t = 0; t < 2 && (r0.status === 503 || r0.status === 429); t += 1) {
    await sleep(2200)
    r0 = await fetch(searchUrl, { headers: { "User-Agent": MB_UA } })
  }
  if (!r0.ok) {
    return { error: `MusicBrainz search ${r0.status}` }
  }
  const j0 = await r0.json()
  const rel = (j0.releases || [])[0]
  if (!rel || !rel.id) {
    return { error: "Nessun release trovato" }
  }
  await sleep(1000)
  const infoUrl = `https://musicbrainz.org/ws/2/release/${rel.id}?inc=labels&fmt=json`
  let r1 = await fetch(infoUrl, { headers: { "User-Agent": MB_UA } })
  for (let t = 0; t < 2 && (r1.status === 503 || r1.status === 429); t += 1) {
    await sleep(2200)
    r1 = await fetch(infoUrl, { headers: { "User-Agent": MB_UA } })
  }
  if (!r1.ok) {
    return {
      ok: true,
      source: "musicbrainz",
      musicbrainzReleaseId: rel.id,
      title: rel.title,
      date: rel.date || null,
      country: rel.country || null,
      label: null,
    }
  }
  const info = await r1.json()
  const labelInfo = info["label-info"]?.[0]
  const labelName =
    (labelInfo && labelInfo.label && labelInfo.label.name) || null
  return {
    ok: true,
    source: "musicbrainz",
    musicbrainzReleaseId: rel.id,
    title: info.title || rel.title,
    date: info.date || rel.date || null,
    country: info.country || rel.country || null,
    label: labelName,
  }
}

const THEAUDIODB_KEY = () => process.env.THEAUDIODB_API_KEY || "2"

function theAudioDbAlbumToPayload(pick, al) {
  const y = pick.intYearReleased
  let date = null
  if (y != null && String(y).length >= 4) {
    const ys = String(y).slice(0, 4)
    if (/^\d{4}$/.test(ys)) date = `${ys}-01-01`
  }
  return {
    ok: true,
    source: "theaudiodb",
    musicbrainzReleaseId: null,
    theAudioDbAlbumId: pick.idAlbum != null ? String(pick.idAlbum) : null,
    title: pick.strAlbum || al,
    date,
    country: pick.strCountry || null,
    label: pick.strLabel || null,
  }
}

export async function fetchReleaseMetadataTheAudioDB(artist, album) {
  const ar = String(artist || "").trim()
  const al = String(album || "").trim()
  if (al.length < 1) return { error: "Album mancante" }
  const key = THEAUDIODB_KEY()
  const tryUrl = async (url) => {
    let r = await fetch(url, { headers: { "User-Agent": UA } })
    for (let t = 0; t < 2 && (r.status === 503 || r.status === 429); t += 1) {
      await sleep(1200)
      r = await fetch(url, { headers: { "User-Agent": UA } })
    }
    if (!r.ok) return { error: `TheAudioDB ${r.status}` }
    return r.json()
  }
  const u1 = `https://www.theaudiodb.com/api/v1/json/${key}/searchalbum.php?s=${encodeURIComponent(
    ar,
  )}&a=${encodeURIComponent(al)}`
  const j1 = await tryUrl(u1)
  if (j1.error) return j1
  let raw = j1.album
  let rows = raw == null ? [] : Array.isArray(raw) ? raw : [raw]
  if (rows.length < 1 && ar.length > 0) {
    const u2 = `https://www.theaudiodb.com/api/v1/json/${key}/searchalbum.php?s=${encodeURIComponent(
      ar,
    )}`
    const j2 = await tryUrl(u2)
    if (j2.error) return j2
    raw = j2.album
    rows = raw == null ? [] : Array.isArray(raw) ? raw : [raw]
    if (rows.length < 1) return { error: "Nessun risultato" }
    const nAl = al.toLowerCase()
    const scored = rows
      .map((x) => {
        const s = String(x.strAlbum || "").toLowerCase()
        let sc = 0
        if (s === nAl) sc = 100
        else if (s.includes(nAl) || nAl.includes(s)) sc = 50
        return { x, sc }
      })
      .sort((a, b) => b.sc - a.sc)
    const best = scored[0]
    if (!best || best.sc < 1) return { error: "Nessun risultato" }
    return theAudioDbAlbumToPayload(best.x, al)
  }
  if (rows.length < 1) return { error: "Nessun risultato" }
  return theAudioDbAlbumToPayload(rows[0], al)
}

export async function fetchReleaseMetadataItunesAlbum(artist, album) {
  const ar = String(artist || "").trim()
  const al = cleanAlbumNameForSearch(String(album || ""))
  if (al.length < 1) return { error: "Album mancante" }
  const terms = [al, ar].filter(Boolean).join(" ")
  let lastErr = "Nessun risultato"
  for (const country of itunesStorefronts()) {
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(
      terms,
    )}&entity=album&limit=15&country=${country}`
    let r = await fetch(url, { headers: ITUNES_HEADERS })
    for (let t = 0; t < 2 && (r.status === 503 || r.status === 429); t += 1) {
      await sleep(1200)
      r = await fetch(url, { headers: ITUNES_HEADERS })
    }
    if (r.status === 403) {
      lastErr = `iTunes 403 (${country})`
      continue
    }
    if (!r.ok) {
      lastErr = `iTunes ${r.status} (${country})`
      continue
    }
    const j = await r.json()
    const rows = Array.isArray(j.results) ? j.results : []
    if (rows.length < 1) {
      lastErr = `Nessun risultato (${country})`
      continue
    }
    const nAl = al.toLowerCase()
    const nAr = ar.toLowerCase()
    let pick = rows[0]
    for (const x of rows) {
      const cx = String(x.collectionName || "").toLowerCase()
      const ax = String(x.artistName || "").toLowerCase()
      const albumOk = !nAl || cx.includes(nAl) || nAl.includes(cx)
      const artistOk = !nAr || ax.includes(nAr) || nAr.includes(ax)
      if (albumOk && artistOk) {
        pick = x
        break
      }
    }
    const rd = pick.releaseDate
    const date =
      typeof rd === "string" && rd.length >= 10 ? rd.slice(0, 10) : null
    return {
      ok: true,
      source: "itunes",
      musicbrainzReleaseId: null,
      title: pick.collectionName || al,
      date,
      country: null,
      label: null,
    }
  }
  return { error: lastErr }
}

/**
 * MusicBrainz, poi TheAudioDB, poi iTunes.
 */
export async function fetchReleaseMetadata(artist, album) {
  const mb = await fetchReleaseMetadataMusicBrainz(artist, album)
  if (mb.ok) return mb
  await sleep(400)
  const adb = await fetchReleaseMetadataTheAudioDB(artist, album)
  if (adb.ok) return adb
  await sleep(300)
  const it = await fetchReleaseMetadataItunesAlbum(artist, album)
  if (it.ok) return it
  const err = [mb.error, adb.error, it.error].filter(Boolean).join(" · ")
  return { error: err || "Nessun metadato album trovato" }
}

export async function fetchTrackMetadataItunes(artist, title, album) {
  const ar = String(artist || "").trim()
  const tt0 = String(title || "").trim()
  const clean = cleanTrackTitleForSearch(tt0) || tt0
  const al = cleanAlbumNameForSearch(String(album || ""))
  if (clean.length < 1) return { error: "Titolo mancante" }
  const baseTerms = [
    [clean, ar, al].filter(Boolean).join(" "),
    [clean, ar].filter(Boolean).join(" "),
  ].filter((s) => s.length >= 2)
  const nTitle = clean.toLowerCase()
  const nArtist = ar.toLowerCase()
  const nAlbum = al.toLowerCase()
  let lastErr = "Nessun risultato"
  storefront: for (const country of itunesStorefronts()) {
    for (const terms of baseTerms) {
      const url = `https://itunes.apple.com/search?term=${encodeURIComponent(
        terms,
      )}&entity=song&limit=12&country=${country}`
      let r = await fetch(url, { headers: ITUNES_HEADERS })
      for (let t = 0; t < 2 && (r.status === 503 || r.status === 429); t += 1) {
        await sleep(1200)
        r = await fetch(url, { headers: ITUNES_HEADERS })
      }
      if (r.status === 403) {
        lastErr = `iTunes 403 (${country})`
        continue storefront
      }
      if (!r.ok) {
        lastErr = `iTunes ${r.status} (${country})`
        continue
      }
      const j = await r.json()
      const rows = Array.isArray(j.results) ? j.results : []
      if (rows.length < 1) {
        lastErr = `Nessun risultato (${country})`
        continue
      }
      let pick = rows[0]
      for (const x of rows) {
        const tx = String(x.trackName || "").toLowerCase()
        const ax = String(x.artistName || "").toLowerCase()
        const bx = String(x.collectionName || "").toLowerCase()
        const titleOk = nTitle && (tx.includes(nTitle) || nTitle.includes(tx))
        const artistOk = !nArtist || ax.includes(nArtist) || nArtist.includes(ax)
        const albumOk = !nAlbum || bx.includes(nAlbum) || nAlbum.includes(bx)
        if (titleOk && artistOk && albumOk) {
          pick = x
          break
        }
      }
      return {
        ok: true,
        source: "itunes",
        title: pick.trackName || clean,
        releaseDate: pick.releaseDate || null,
        genre: pick.primaryGenreName || null,
        durationMs: Number.isFinite(pick.trackTimeMillis) ? pick.trackTimeMillis : null,
        trackNumber: Number.isFinite(pick.trackNumber) ? pick.trackNumber : null,
        discNumber: Number.isFinite(pick.discNumber) ? pick.discNumber : null,
        url: pick.trackViewUrl || pick.collectionViewUrl || null,
      }
    }
  }
  return { error: lastErr }
}

function pickBestDeezerRow(rows, ar, al, clean) {
  if (!rows.length) return null
  const nTitle = String(clean || "").toLowerCase()
  const nArtist = String(ar || "").toLowerCase()
  const nAlbum = String(al || "").toLowerCase()
  for (const x of rows) {
    const tx = String(x.title || "").toLowerCase()
    const ax = String(x.artist?.name || "").toLowerCase()
    const bx = String(x.album?.title || "").toLowerCase()
    const titleOk = !nTitle || tx.includes(nTitle) || nTitle.includes(tx)
    const artistOk = !nArtist || ax.includes(nArtist) || nArtist.includes(ax)
    const albumOk = !nAlbum || bx.includes(nAlbum) || nAlbum.includes(bx)
    if (titleOk && artistOk && (!nAlbum || albumOk)) return x
  }
  for (const x of rows) {
    const ax = String(x.artist?.name || "").toLowerCase()
    if (!nArtist || ax.includes(nArtist) || nArtist.includes(ax)) return x
  }
  return rows[0]
}

export async function fetchTrackMetadataDeezer(artist, title, album, titleFromFile) {
  const ar = String(artist || "").trim()
  const tMain = String(title || "").trim()
  const tFile = String(titleFromFile != null ? titleFromFile : tMain).trim()
  const clean = cleanTrackTitleForSearch(tMain) || tMain
  const fromFile = cleanTrackTitleForSearch(tFile) || tFile
  const al = cleanAlbumNameForSearch(String(album || ""))
  if (clean.length < 1) return { error: "Titolo mancante" }
  const qSet = new Set()
  if (ar && clean) {
    qSet.add(`artist:"${ar}" track:"${clean}"`)
  }
  if (ar && fromFile && fromFile !== clean) {
    qSet.add(`artist:"${ar}" track:"${fromFile}"`)
  }
  if (al && ar && clean) {
    qSet.add(`artist:"${ar}" track:"${clean}" album:"${al}"`)
  }
  if (ar && clean) {
    qSet.add(`${ar} ${clean}`)
  }
  if (ar && al && clean) {
    qSet.add(`${ar} ${al} ${clean}`)
  }
  if (fromFile.length > 1) {
    qSet.add(fromFile)
  }
  for (const q of qSet) {
    if (q.length < 2) continue
    const url = `https://api.deezer.com/search/track?q=${encodeURIComponent(q)}&limit=25`
    let r = await fetch(url, { headers: { "User-Agent": UA } })
    for (let t = 0; t < 2 && (r.status === 503 || r.status === 429); t += 1) {
      await sleep(1000)
      r = await fetch(url, { headers: { "User-Agent": UA } })
    }
    if (!r.ok) continue
    const j = await r.json()
    const rows = Array.isArray(j.data) ? j.data : []
    if (rows.length < 1) continue
    const pick = pickBestDeezerRow(rows, ar, al, clean)
    if (pick == null) continue
    let full = pick
    if (pick.id != null) {
      const detailUrl = `https://api.deezer.com/track/${pick.id}`
      const rd = await fetch(detailUrl, { headers: { "User-Agent": UA } })
      if (rd.ok) {
        try {
          const dj = await rd.json()
          if (dj && dj.id) full = dj
        } catch {
          /* ignore */
        }
      }
    }
    const relD =
      full.release_date || (full.album && full.album.release_date) || null
    return {
      ok: true,
      source: "deezer",
      title: full.title || clean,
      releaseDate: relD,
      genre: null,
      durationMs: Number.isFinite(full.duration) ? full.duration * 1000 : null,
      trackNumber: Number.isFinite(full.track_position)
        ? full.track_position
        : null,
      discNumber: Number.isFinite(full.disk_number) ? full.disk_number : null,
      url: full.link || null,
    }
  }
  return { error: "Nessun risultato" }
}

function mbCreditNamesLower(rec) {
  const ac = rec["artist-credit"]
  if (!Array.isArray(ac)) return ""
  return ac
    .map((c) => (c && (c.name || c.artist?.name)) || "")
    .join(" ")
    .toLowerCase()
}

export async function fetchTrackMetadataMusicBrainz(artist, title) {
  const ar = String(artist || "").trim()
  const tt0 = String(title || "").trim()
  if (tt0.length < 1) return { error: "Titolo mancante" }
  if (ar.length < 1) return { error: "Artista mancante" }
  const tt = tt0
    .replace(/"/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120)
  const ars = ar
    .replace(/"/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100)
  const want = ar.toLowerCase()
  const parts = want.split(/\s*\/\s*|\s*&\s*|\s+feat\.?\s+/i)
  const queries = [
    `recording:"${tt}" AND artist:"${ars}"`,
    `recording:"${tt}"`,
  ]
  for (const q of queries) {
    const url = `https://musicbrainz.org/ws/2/recording?query=${encodeURIComponent(
      q,
    )}&fmt=json&limit=10`
    let r = await fetch(url, { headers: { "User-Agent": MB_UA } })
    for (let t = 0; t < 2 && (r.status === 503 || r.status === 429); t += 1) {
      await sleep(2200)
      r = await fetch(url, { headers: { "User-Agent": MB_UA } })
    }
    if (!r.ok) {
      await sleep(1000)
      continue
    }
    const j = await r.json()
    const recs = j.recordings || []
    if (recs.length < 1) {
      await sleep(1000)
      continue
    }
    const matchOne = (rec) => {
      const n = mbCreditNamesLower(rec)
      if (n.includes(want)) return true
      return parts.some(
        (p) => p.length > 1 && n.includes(String(p).trim().toLowerCase()),
      )
    }
    const rec =
      q === queries[0] ? (recs.find(matchOne) || recs[0]) : recs.find(matchOne)
    if (!rec || !rec.id) continue
    const frd = rec["first-release-date"] || null
    const len = rec.length
    return {
      ok: true,
      source: "musicbrainz",
      title: rec.title || tt0,
      releaseDate: frd,
      genre: null,
      durationMs: Number.isFinite(len) ? len : null,
      trackNumber: null,
      discNumber: null,
      url: `https://musicbrainz.org/recording/${rec.id}`,
    }
  }
  return { error: "Nessun risultato" }
}

export async function fetchTrackMetadataTheAudioDB(artist, title, album, titleFromFile) {
  const ar = String(artist || "").trim()
  const t0 = String(title || "").trim()
  const tFile = String(titleFromFile != null ? titleFromFile : t0).trim()
  const candidates = new Set(
    [
      cleanTrackTitleForSearch(t0) || t0,
      cleanTrackTitleForSearch(tFile) || tFile,
      t0.split(/\s+/).slice(0, 8).join(" "),
    ].filter((s) => s.length > 0),
  )
  const al = cleanAlbumNameForSearch(String(album || ""))
  if (ar.length < 1) return { error: "Artista mancante" }
  const key = THEAUDIODB_KEY()
  const nAl = al.toLowerCase()
  for (const clean of candidates) {
    if (clean.length < 1) continue
    const url = `https://www.theaudiodb.com/api/v1/json/${key}/searchtrack.php?s=${encodeURIComponent(
      ar,
    )}&t=${encodeURIComponent(clean)}`
    let r = await fetch(url, { headers: { "User-Agent": UA } })
    for (let t = 0; t < 2 && (r.status === 503 || r.status === 429); t += 1) {
      await sleep(1000)
      r = await fetch(url, { headers: { "User-Agent": UA } })
    }
    if (!r.ok) continue
    const j = await r.json()
    const raw = j.track
    const rows = raw == null ? [] : Array.isArray(raw) ? raw : [raw]
    if (rows.length < 1) continue
    let pick = rows[0]
    if (nAl) {
      const hit = rows.find((x) => {
        const bx = String(x.strAlbum || "").toLowerCase()
        return bx.includes(nAl) || nAl.includes(bx)
      })
      if (hit) pick = hit
    }
    const dMs = pick.intDuration != null ? Number(pick.intDuration) : null
    const tn = pick.intTrackNumber != null ? Number(pick.intTrackNumber) : null
    const disc = pick.intCD != null ? Number(pick.intCD) : null
    return {
      ok: true,
      source: "theaudiodb",
      title: pick.strTrack || clean,
      releaseDate: null,
      genre: pick.strGenre || pick.strStyle || null,
      durationMs: Number.isFinite(dMs) && dMs > 0 ? dMs : null,
      trackNumber: Number.isFinite(tn) ? tn : null,
      discNumber: Number.isFinite(disc) ? disc : null,
      url: null,
    }
  }
  return { error: "Nessun risultato" }
}

/**
 * Ordine: Deezer (niente 403) → TheAudioDB → MusicBrainz (date/durata) → iTunes (genere se disponibile).
 */
export async function fetchTrackMetadata(artist, title, album, titleFromFile) {
  const t = String(title || "").trim()
  const tFile =
    titleFromFile != null && String(titleFromFile).trim().length > 0
      ? String(titleFromFile).trim()
      : t

  const dz = await fetchTrackMetadataDeezer(artist, t, album, tFile)
  if (dz.ok) return dz
  await sleep(200)
  const adb = await fetchTrackMetadataTheAudioDB(artist, t, album, tFile)
  if (adb.ok) return adb
  await sleep(1000)
  const mb = await fetchTrackMetadataMusicBrainz(artist, t)
  if (mb.ok) return mb
  await sleep(200)
  const it = await fetchTrackMetadataItunes(artist, t, album)
  if (it.ok) return it
  if (it.error === "Titolo mancante") return it
  const parts = [dz.error, adb.error, mb.error, it.error].filter(Boolean)
  return {
    error: parts.length
      ? [...new Set(parts)].join(" · ")
      : "Nessun risultato",
  }
}
