import fs from "fs/promises"
import { existsSync } from "fs"
import path from "path"
import { normalizeStoredGenreString } from "./genres.mjs"

const LIB_EXCLUDE = new Set([
  "kord",
  "node_modules",
  ".git",
  ".trash",
  ".wpp",
  ".kord",
])
const AUDIO_RE = /\.(mp3|flac|m4a|ogg|opus|wav|aac|webm)$/i

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

/** Strips "Artist - " or "Artist: " prefix when it matches the artist folder name */
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

/**
 * Unicode / YouTube: rende i titoli più cercabili.
 * @param {string} [artist] se indicato, rimuove il prefisso "Artista -" ridondante (stesso criterio di stripRedundantArtistPrefix).
 */
export function cleanTrackTitleForSearch(raw, artist) {
  let s = String(raw || "")
  const ar = String(artist || "").trim()
  if (ar.length >= 2) s = stripRedundantArtistPrefix(ar, s)
  s = s
    .replace(/[？?…]/g, " ")
    .replace(/[⧸／﹨]/g, " ")
    .replace(/[＆&]/g, " ")
  s = s.split(/\s*[|｜]\s*/)[0] ?? s
  s = s.split(/\s*\/\/\s*/)[0] ?? s
  s = s.replace(/^\d{1,2}\s*[-–—.]\s*/i, "")
  s = s.replace(/\s*[\[【]([\s\S]*?)[\]】]/gi, (match, inner) => {
    if (/^skit$/i.test(String(inner || "").trim())) return match
    return " "
  })
  s = s.replace(
    /\s*[\(（](?:official|lyric|hd|4k|video|audio|anime|hidden|original|re-?master|remaster|music\s*video|lyric(?:s)?\s*video|audio\s*only|visuali[sz]er|amazon(?:\s*music)?|apple(?:\s*music)?|youtub(?:e|e\s*music|e\s*topic)?|spotify|deezer|tidal|vevo|soundcloud|pandora|iheartradio|shazam|napster|full\s*album)[^)\]]*[\)）]/gi,
    " ",
  )
  s = s.replace(
    /\s*-\s*(?:Official\s+)?(?:Music\s+Video|Video|Audio|Lyric\s+Video|Lyrics?|Remaster)\b/gi,
    " ",
  )
  s = s.replace(/\s+\[[a-z0-9\s]+\]\s*$/i, (m) => {
    const inner = m.replace(/^\s*\[|\]\s*$/g, "").trim()
    if (/^skit$/i.test(inner)) return m
    return " "
  })
  s = s.replace(/\s+/g, " ").trim()
  if (s.length > 200) s = s.slice(0, 200)
  return s
}

export function prepareTrackTitleForMeta(artist, titleFromFile) {
  const base = String(titleFromFile || "").trim()
  const a = String(artist || "").trim()
  return cleanTrackTitleForSearch(base, a) || base
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
    let expectedTracks = null
    let expectedTrackCount = null
    if (Array.isArray(j.expectedTracks)) {
      expectedTracks = j.expectedTracks
        .map((row) => {
          const title =
            row && row.title != null ? String(row.title).trim() : ""
          if (!title) return null
          return {
            disc: Number.isFinite(Number(row.disc)) ? Number(row.disc) : 1,
            position: Number.isFinite(Number(row.position))
              ? Number(row.position)
              : null,
            title,
          }
        })
        .filter(Boolean)
      expectedTrackCount =
        typeof j.expectedTrackCount === "number" && j.expectedTrackCount > 0
          ? j.expectedTrackCount
          : expectedTracks.length > 0
            ? expectedTracks.length
            : null
    } else if (
      typeof j.expectedTrackCount === "number" &&
      j.expectedTrackCount > 0
    ) {
      expectedTrackCount = j.expectedTrackCount
    }
    return {
      title: j.title || j.name || null,
      releaseDate: j.date || j.releaseDate || null,
      label: j.label || null,
      country: j.country || null,
      musicbrainzReleaseId: j.musicbrainzReleaseId || null,
      expectedTrackCount,
      expectedTracks,
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

export async function saveAlbumManualMeta(albumDir, patch) {
  const readPath = pickAlbumMetaPath(albumDir)
  const writePath = path.join(albumDir, FILE_ALBUM)
  let json = {}
  if (existsSync(readPath)) {
    try {
      const raw = await fs.readFile(readPath, "utf8")
      const j = JSON.parse(raw)
      if (j && typeof j === "object") json = j
    } catch {
      json = {}
    }
  }
  const next = { ...json }
  const str = (v, max) => {
    if (v == null) return null
    const s = String(v).trim()
    return s ? s.slice(0, max) : null
  }
  if (Object.prototype.hasOwnProperty.call(patch, "title")) {
    next.title = str(patch.title, 500)
  }
  if (Object.prototype.hasOwnProperty.call(patch, "releaseDate")) {
    next.releaseDate = str(patch.releaseDate, 64)
    next.date = next.releaseDate
  }
  if (Object.prototype.hasOwnProperty.call(patch, "label")) {
    next.label = str(patch.label, 300)
  }
  if (Object.prototype.hasOwnProperty.call(patch, "country")) {
    next.country = str(patch.country, 64)
  }
  if (Object.prototype.hasOwnProperty.call(patch, "musicbrainzReleaseId")) {
    next.musicbrainzReleaseId = str(patch.musicbrainzReleaseId, 200)
  }
  next.editedAt = new Date().toISOString()
  await fs.writeFile(writePath, JSON.stringify(next, null, 2), "utf8")
  return next
}

/**
 * Merge manuale in kord-trackinfo.json per un file audio (legge da kord o legacy wpp, scrive sempre kord).
 * @param {string} albumDir assoluto
 * @param {string} fileName es. "01 - Song.flac"
 * @param {Record<string, unknown>} patch solo chiavi ammesse
 */
export async function saveTrackManualMeta(albumDir, fileName, patch) {
  const readPath = pickTrackMetaPath(albumDir)
  const writePath = path.join(albumDir, FILE_TRACK)
  let json = {}
  if (existsSync(readPath)) {
    try {
      const raw = await fs.readFile(readPath, "utf8")
      const j = JSON.parse(raw)
      if (j && typeof j === "object") json = j
    } catch {
      json = {}
    }
  }
  const prev =
    json[fileName] && typeof json[fileName] === "object"
      ? { ...json[fileName] }
      : {}
  const next = { ...prev }
  const str = (v, max) => {
    if (v == null) return null
    const s = String(v).trim()
    return s ? s.slice(0, max) : null
  }
  if (Object.prototype.hasOwnProperty.call(patch, "title")) {
    next.title = str(patch.title, 500)
  }
  if (Object.prototype.hasOwnProperty.call(patch, "releaseDate")) {
    next.releaseDate = str(patch.releaseDate, 64)
  }
  if (Object.prototype.hasOwnProperty.call(patch, "genre")) {
    const g = patch.genre
    if (g === "" || g == null) {
      next.genre = null
    } else {
      const norm = normalizeStoredGenreString(String(g))
      next.genre = norm ? str(norm, 800) : null
    }
  }
  if (Object.prototype.hasOwnProperty.call(patch, "source")) {
    next.source = str(patch.source, 200)
  }
  if (Object.prototype.hasOwnProperty.call(patch, "url")) {
    next.url = str(patch.url, 2000)
  }
  for (const f of ["durationMs", "trackNumber", "discNumber"]) {
    if (Object.prototype.hasOwnProperty.call(patch, f)) {
      const v = patch[f]
      if (v === "" || v == null) next[f] = null
      else {
        const n = Number(v)
        next[f] = Number.isFinite(n) ? n : null
      }
    }
  }
  next.editedAt = new Date().toISOString()
  json[fileName] = next
  await fs.writeFile(writePath, JSON.stringify(json, null, 2), "utf8")
  return next
}

function reEscape(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function isCollabParensContent(inner) {
  const t = String(inner).trim()
  if (t.length < 1) return false
  if (/^feat\.?|^ft[.\s]|^with\s+|\bfeatur(?:ing|e)\b|^\s*con\s+\w/i.test(t)) return true
  if (/\b(?:feat|ft)\.?\s+[A-Za-zÀ-ÿ"'']/i.test(t)) return true
  if (/[,&]\s*[\w"'' -]+\s+(?:&|feat|and)\b/i.test(t)) return true
  return false
}

const JUNK_PAREN_PATTERNS = [
  /\bofficial(\s*audio|\s*video|\s*music)?\b/i,
  /\boriginal(\s*mix)?\b/i,
  /\boriginal\s*version\b/i,
  /\borig\.?\b/i,
  /\bremaster(ed|ing)?\b/i,
  /\bre-?master/i,
  /\bradio\s*edit/i,
  /\bextended(\s*mix|\s*version)?\b/i,
  /\b(?:club|dub|extended|radio)\s*mix\b/i,
  /\bvisuali[sz]er\b/i,
  /\b(?:lyric|lyrics?)\s*video/i,
  /^\s*lyrics?\s*$/i,
  /^\s*music\s*video\s*$/i,
  /\b(?:4k|uhd|h\.?265|h\.?264|2160p|1080p|720p)\b/i,
  /(?:^|[^\d])\bhd\b|^\s*hd\s*$/i,
  /\bmusic\s*video\b/i,
  /\b(?:video|audio|clip)\b(?!\s*feat)/i,
  /\baudio\s*only/i,
  /\bfrom\s+the\b/i,
  /\bsoundtrack|^\s*ost\s*$/i,
  /\btrailer|teaser|preview\b/i,
  /\b(?:deluxe|explicit)\b/i,
  /\b(?:amazon|apple\s*music|youtub(?:e|e\s*music|e\s*topic)?|spotify|deezer|tidal|vevo|soundcloud|pandora|iheartradio|shazam|napster|bandcamp)(?:\s*music)?\b/i,
  /^\s*mv\s*$/i,
  /\bclip\b|^\s*clip\s*$/i,
  /\bbts\b|behind\s+the\s+scenes/i,
  /\blive(\s*at|\s*acoustic|\s*in\b)/i,
  /^\s*live\s*$/i,
  /studio\s*session|piano|orchestra|unplugged|acoustic(?!a)/i,
  /instrumental(?!e)|karaoke|mono|stereo|lossless|high[-\s]*quality|^\s*hq\s*$/i,
  /^\s*edit\s*$/i,
  /\bremix\b/,
  /^\s*mix\s*$/i,
  /\bwork\s*print|rough\s*mix|outtake|acapella|a[\s*]cappella/i,
  /^\s*version\s*$/i,
  /\b\d{4}\s*remaster/i,
  /cover(?:\s*ver|version)?/i,
  /re-?(?:issue|press|press(?:ing|ed)|cut)/i,
  /demo|sketch|bootleg(?!a)/i,
  /m\/v\b/i,
]

function isJunkParensContent(inner) {
  if (isCollabParensContent(inner)) return false
  if (String(inner).trim().length < 1) return false
  return JUNK_PAREN_PATTERNS.some((re) => re.test(inner))
}

function stripJunkRoundParens(s) {
  const re = /\s*([\(（])([^)）]+)([\)）])/g
  let t = String(s)
  for (let pass = 0; pass < 15; pass++) {
    const before = t
    t = t.replace(re, (full, _o, inner, _c) => {
      if (isJunkParensContent(inner)) return " "
      return full
    })
    t = t.replace(/\s+/g, " ").trim()
    if (t === before) break
  }
  return t
}

function stripTailYouTubeCruft(s) {
  let t = String(s || "").replace(/\s+/g, " ").trim()
  t = stripJunkRoundParens(t)
  for (let i = 0; i < 4; i++) {
    const before = t
    t = t.replace(/\s*-\s*topic\s*$/i, "").trim()
    t = t.replace(/\s*\|\s*[^|]+\s*-\s*Topic\s*$/i, "").trim()
    t = t.replace(/\s+/g, " ").trim()
    if (t === before) break
  }
  return t
}

function artistFolderNameVariants(artistFolder) {
  const a = String(artistFolder || "").trim()
  if (a.length < 2) return []
  const out = [a]
  if (/^The\s+/i.test(a)) out.push(a.replace(/^The\s+/i, "").trim())
  else out.push(`The ${a}`)
  return out.filter((x) => x.length >= 2)
}

function stripIfArtistLeadsName(s, artistFolder) {
  for (const v of artistFolderNameVariants(artistFolder)) {
    const re = new RegExp(`^\\s*${reEscape(v)}\\s*[-–—|]\\s*`, "i")
    if (re.test(s)) return s.replace(re, "").trim()
  }
  return s
}

function stripIfArtistTrailsWithDash(s, artistFolder) {
  for (const v of artistFolderNameVariants(artistFolder)) {
    const re = new RegExp(
      `^(.*)\\s*[-–—|]\\s*${reEscape(v)}(?:\\s+(\\([^)]+\\)))?\\s*$`,
      "i",
    )
    const m = s.match(re)
    if (m) {
      const left = m[1].trim()
      if (left.length < 1) return s
      if (m[2]) {
        return `${left} ${m[2].trim()}`.replace(/\s+/g, " ").trim()
      }
      return left
    }
  }
  return s
}

/**
 * Rimuove […], numerazione, parentesi “junk” (no versioni long/clean, no feat), poi - Topic.
 * Prefisso “Artista - ”: usa `trackArtist` da kord-trackinfo se presente, altrimenti `artistFolder`.
 * @param {string} raw
 * @param {{ artistFolder?: string; trackArtist?: string } | undefined} [opts]
 */
export function sanitizeLocalTrackTitleDisplay(raw, opts) {
  let s = String(raw || "")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  s = s.replace(/^\d+\s*[-–—]\s*/i, "").trim()
  s = s.replace(/^\d+\s*\.\s+/, "").trim()
  s = s.replace(/\s+/g, " ").trim()
  s = stripTailYouTubeCruft(s)
  const arForRedundant =
    String(opts?.trackArtist || "").trim() || (opts?.artistFolder || "")
  s = stripIfArtistLeadsName(s, arForRedundant)
  s = stripIfArtistTrailsWithDash(s, arForRedundant)
  s = s.replace(/\s+/g, " ").trim()
  if (s.length > 200) s = s.slice(0, 200)
  return s
}

/**
 * Scrive in kord-trackinfo.json (o legacy wpp-*) il campo `title` quando `sanitizeLocalTrackTitleDisplay` produce un testo diverso dal nome file (senza estensione).
 * @param {string} albumDir percorso assoluto album
 * @param {boolean} dryRun
 */
/**
 * Rimuove da kord-trackinfo (o legacy) le chiavi che non corrispondono a file audio presenti in cartella.
 * @param {string} albumDir percorso assoluto album
 * @returns {Promise<{ removed: string[]; written: boolean }>}
 */
export async function pruneOrphanTrackMetaInAlbumDir(albumDir) {
  const readPath = pickTrackMetaPath(albumDir)
  if (!existsSync(readPath)) return { removed: [], written: false }
  let json = {}
  try {
    const raw = await fs.readFile(readPath, "utf8")
    const j = JSON.parse(raw)
    if (j && typeof j === "object" && !Array.isArray(j)) json = { ...j }
  } catch {
    return { removed: [], written: false }
  }
  const entries = await fs.readdir(albumDir, { withFileTypes: true })
  const audioNames = new Set()
  for (const e of entries) {
    if (e.isFile() && AUDIO_RE.test(e.name)) audioNames.add(e.name)
  }
  const removed = []
  const next = { ...json }
  for (const k of Object.keys(next)) {
    if (!audioNames.has(k)) {
      removed.push(k)
      delete next[k]
    }
  }
  if (removed.length === 0) return { removed: [], written: false }
  const writePath = path.join(albumDir, FILE_TRACK)
  await fs.writeFile(writePath, JSON.stringify(next, null, 2), "utf8")
  return { removed, written: true }
}

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
  const segs = path.normalize(albumDir).split(path.sep).filter(Boolean)
  const artistFolder = segs.length >= 2 ? segs[segs.length - 2] : ""
  for (const e of entries) {
    if (!e.isFile() || !AUDIO_RE.test(e.name)) continue
    const base = e.name.replace(AUDIO_RE, "").trim() || e.name
    const existing =
      mut[e.name] && typeof mut[e.name] === "object" ? { ...mut[e.name] } : {}
    const trackArtist = String(existing.artist || "").trim()
    const to = sanitizeLocalTrackTitleDisplay(base, {
      artistFolder,
      ...(trackArtist ? { trackArtist } : {}),
    })
    if (to === base) continue
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

function extractMusicBrainzReleaseTracks(info) {
  const list = []
  const media = Array.isArray(info?.media) ? info.media : []
  for (const medium of media) {
    const disc = Number.isFinite(Number(medium.position)) ? Number(medium.position) : 1
    const tracks = Array.isArray(medium.tracks) ? medium.tracks : []
    for (const tr of tracks) {
      const raw =
        tr.title ||
        (tr.recording && typeof tr.recording === "object" ? tr.recording.title : null)
      const title = raw != null ? String(raw).trim() : ""
      if (!title) continue
      const pos = Number.isFinite(Number(tr.position)) ? Number(tr.position) : list.length + 1
      list.push({ disc, position: pos, title })
    }
  }
  return list
}

function musicBrainzMediaTrackTotal(info) {
  const media = Array.isArray(info?.media) ? info.media : []
  let n = 0
  for (const m of media) {
    const c = m["track-count"]
    if (Number.isFinite(Number(c))) n += Number(c)
  }
  return n > 0 ? n : null
}

async function fetchMusicBrainzReleaseJson(relId) {
  const infoUrl = `https://musicbrainz.org/ws/2/release/${relId}?inc=labels+artist-credits+recordings&fmt=json`
  let r1 = await fetch(infoUrl, { headers: { "User-Agent": MB_UA } })
  for (let t = 0; t < 2 && (r1.status === 503 || r1.status === 429); t += 1) {
    await sleep(2200)
    r1 = await fetch(infoUrl, { headers: { "User-Agent": MB_UA } })
  }
  if (!r1.ok) return null
  return r1.json()
}

function mbReleaseHasTracklist(info) {
  const tr = extractMusicBrainzReleaseTracks(info)
  if (tr.length > 0) return true
  const mc = musicBrainzMediaTrackTotal(info)
  return mc != null && mc > 0
}

export async function fetchReleaseMetadataMusicBrainz(artist, album) {
  const a = String(artist || "").trim()
  const b = String(album || "").trim()
  if (a.length < 1 && b.length < 1) return { error: "Artist or album missing" }
  const q =
    a && b
      ? `release:"${b}" AND artist:"${a}"`
      : b
        ? `release:"${b}"`
        : `release:"${a}"`
  const searchUrl = `https://musicbrainz.org/ws/2/release/?query=${encodeURIComponent(
    q,
  )}&fmt=json&limit=10`
  let r0 = await fetch(searchUrl, { headers: { "User-Agent": MB_UA } })
  for (let t = 0; t < 2 && (r0.status === 503 || r0.status === 429); t += 1) {
    await sleep(2200)
    r0 = await fetch(searchUrl, { headers: { "User-Agent": MB_UA } })
  }
  if (!r0.ok) {
    return { error: `MusicBrainz search ${r0.status}` }
  }
  const j0 = await r0.json()
  const candidates = (j0.releases || []).filter((x) => x && x.id)
  const rel0 = candidates[0]
  if (!rel0) {
    return { error: "No release found" }
  }

  await sleep(1000)
  let chosenRel = rel0
  let metaFallback = null
  let metaFallbackRel = rel0
  let info = null
  for (let i = 0; i < candidates.length && i < 8; i += 1) {
    const rel = candidates[i]
    if (i > 0) await sleep(1100)
    const parsed = await fetchMusicBrainzReleaseJson(rel.id)
    if (!parsed) continue
    if (!metaFallback) {
      metaFallback = parsed
      metaFallbackRel = rel
    }
    if (mbReleaseHasTracklist(parsed)) {
      chosenRel = rel
      info = parsed
      break
    }
  }

  info = info || metaFallback
  chosenRel = info === metaFallback ? metaFallbackRel : chosenRel

  if (!info) {
    return {
      ok: true,
      source: "musicbrainz",
      musicbrainzReleaseId: chosenRel.id,
      title: chosenRel.title,
      date: chosenRel.date || null,
      country: chosenRel.country || null,
      label: null,
    }
  }

  const labelInfo = info["label-info"]?.[0]
  const labelName =
    (labelInfo && labelInfo.label && labelInfo.label.name) || null
  const expectedTracks = extractMusicBrainzReleaseTracks(info)
  const fromMediaCount = musicBrainzMediaTrackTotal(info)
  const expectedTrackCount =
    expectedTracks.length > 0 ? expectedTracks.length : fromMediaCount
  return {
    ok: true,
    source: "musicbrainz",
    musicbrainzReleaseId: chosenRel.id,
    title: info.title || chosenRel.title,
    date: info.date || chosenRel.date || null,
    country: info.country || chosenRel.country || null,
    label: labelName,
    ...(expectedTracks.length > 0 ? { expectedTracks } : {}),
    ...(expectedTrackCount != null ? { expectedTrackCount } : {}),
  }
}

const THEAUDIODB_KEY = () => process.env.THEAUDIODB_API_KEY || "2"

async function attachExpectedTracksTheAudioDb(payload, pick, tryUrl, key) {
  const idAlbum = pick?.idAlbum
  if (idAlbum == null) return
  const uTr = `https://www.theaudiodb.com/api/v1/json/${key}/track.php?m=${encodeURIComponent(
    String(idAlbum),
  )}`
  const jTr = await tryUrl(uTr)
  if (jTr.error || jTr.track == null) return
  const rawT = Array.isArray(jTr.track) ? jTr.track : [jTr.track]
  const sorted = [...rawT].sort(
    (a, b) =>
      Number(a.intTrackNumber || 0) - Number(b.intTrackNumber || 0),
  )
  const expectedTracks = sorted
    .map((t, idx) => {
      const title = String(t.strTrack || "").trim()
      if (!title) return null
      return {
        disc: Number.isFinite(Number(t.intCD)) ? Number(t.intCD) : 1,
        position: Number.isFinite(Number(t.intTrackNumber))
          ? Number(t.intTrackNumber)
          : idx + 1,
        title,
      }
    })
    .filter(Boolean)
  if (expectedTracks.length < 1) return
  payload.expectedTracks = expectedTracks
  payload.expectedTrackCount = expectedTracks.length
}

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
  if (al.length < 1) return { error: "Album missing" }
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
    if (rows.length < 1) return { error: "No results" }
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
    if (!best || best.sc < 1) return { error: "No results" }
    const payload = theAudioDbAlbumToPayload(best.x, al)
    await attachExpectedTracksTheAudioDb(payload, best.x, tryUrl, key)
    return payload
  }
  if (rows.length < 1) return { error: "No results" }
  const payload = theAudioDbAlbumToPayload(rows[0], al)
  await attachExpectedTracksTheAudioDb(payload, rows[0], tryUrl, key)
  return payload
}

async function attachExpectedTracksItunes(payload, pick, country) {
  const cid = pick.collectionId
  if (!Number.isFinite(Number(cid))) return
  const lookupUrl = `https://itunes.apple.com/lookup?id=${cid}&entity=song&limit=500&country=${country}`
  let lr = await fetch(lookupUrl, { headers: ITUNES_HEADERS })
  for (let t = 0; t < 2 && (lr.status === 503 || lr.status === 429); t += 1) {
    await sleep(1200)
    lr = await fetch(lookupUrl, { headers: ITUNES_HEADERS })
  }
  if (!lr.ok) return
  const lj = await lr.json()
  const results = Array.isArray(lj.results) ? lj.results : []
  const songs = results.filter(
    (x) =>
      x &&
      (x.wrapperType === "track" || x.kind === "song") &&
      x.trackName,
  )
  const expectedTracks = songs
    .map((x, idx) => ({
      disc: Number.isFinite(Number(x.discNumber)) ? Number(x.discNumber) : 1,
      position: Number.isFinite(Number(x.trackNumber))
        ? Number(x.trackNumber)
        : idx + 1,
      title: String(x.trackName || "").trim(),
    }))
    .filter((x) => x.title)
  if (expectedTracks.length < 1) return
  payload.expectedTracks = expectedTracks
  payload.expectedTrackCount = expectedTracks.length
}

export async function fetchReleaseMetadataItunesAlbum(artist, album) {
  const ar = String(artist || "").trim()
  const al = cleanAlbumNameForSearch(String(album || ""))
  if (al.length < 1) return { error: "Album missing" }
  const terms = [al, ar].filter(Boolean).join(" ")
  let lastErr = "No results"
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
      lastErr = `No results (${country})`
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
    const payload = {
      ok: true,
      source: "itunes",
      musicbrainzReleaseId: null,
      title: pick.collectionName || al,
      date,
      country: null,
      label: null,
    }
    await attachExpectedTracksItunes(payload, pick, country)
    return payload
  }
  return { error: lastErr }
}

async function enrichMbPayloadWithFallbackTracklists(mb, artist, album) {
  const hasTitles =
    Array.isArray(mb.expectedTracks) && mb.expectedTracks.length > 0
  if (hasTitles) return mb

  await sleep(350)
  const adb = await fetchReleaseMetadataTheAudioDB(artist, album)
  let tracks =
    adb.ok &&
    Array.isArray(adb.expectedTracks) &&
    adb.expectedTracks.length > 0
      ? adb.expectedTracks
      : null

  if (!tracks) {
    await sleep(250)
    const it = await fetchReleaseMetadataItunesAlbum(artist, album)
    if (
      it.ok &&
      Array.isArray(it.expectedTracks) &&
      it.expectedTracks.length > 0
    )
      tracks = it.expectedTracks
  }

  if (!tracks?.length) return mb

  const prevCount =
    typeof mb.expectedTrackCount === "number" && mb.expectedTrackCount > 0
      ? mb.expectedTrackCount
      : null
  return {
    ...mb,
    expectedTracks: tracks,
    expectedTrackCount: prevCount ?? tracks.length,
  }
}

/**
 * MusicBrainz, poi TheAudioDB, poi iTunes.
 */
export async function fetchReleaseMetadata(artist, album) {
  const mb = await fetchReleaseMetadataMusicBrainz(artist, album)
  if (mb.ok) return enrichMbPayloadWithFallbackTracklists(mb, artist, album)
  await sleep(400)
  const adb = await fetchReleaseMetadataTheAudioDB(artist, album)
  if (adb.ok) return adb
  await sleep(300)
  const it = await fetchReleaseMetadataItunesAlbum(artist, album)
  if (it.ok) return it
  const err = [mb.error, adb.error, it.error].filter(Boolean).join(" · ")
  return { error: err || "No album metadata found" }
}

export async function fetchTrackMetadataItunes(artist, title, album) {
  const ar = String(artist || "").trim()
  const tt0 = String(title || "").trim()
  const clean = cleanTrackTitleForSearch(tt0, ar) || tt0
  const al = cleanAlbumNameForSearch(String(album || ""))
  if (clean.length < 1) return { error: "Title missing" }
  const baseTerms = [
    [clean, ar, al].filter(Boolean).join(" "),
    [clean, ar].filter(Boolean).join(" "),
  ].filter((s) => s.length >= 2)
  const nTitle = clean.toLowerCase()
  const nArtist = ar.toLowerCase()
  const nAlbum = al.toLowerCase()
  let lastErr = "No results"
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
        lastErr = `No results (${country})`
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
  const clean = cleanTrackTitleForSearch(tMain, ar) || tMain
  const fromFile = cleanTrackTitleForSearch(tFile, ar) || tFile
  const al = cleanAlbumNameForSearch(String(album || ""))
  if (clean.length < 1) return { error: "Title missing" }
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
  return { error: "No results" }
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
  if (tt0.length < 1) return { error: "Title missing" }
  if (ar.length < 1) return { error: "Artist missing" }
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
  return { error: "No results" }
}

export async function fetchTrackMetadataTheAudioDB(artist, title, album, titleFromFile) {
  const ar = String(artist || "").trim()
  const t0 = String(title || "").trim()
  const tFile = String(titleFromFile != null ? titleFromFile : t0).trim()
  const candidates = new Set(
    [
      cleanTrackTitleForSearch(t0, ar) || t0,
      cleanTrackTitleForSearch(tFile, ar) || tFile,
      t0.split(/\s+/).slice(0, 8).join(" "),
    ].filter((s) => s.length > 0),
  )
  const al = cleanAlbumNameForSearch(String(album || ""))
  if (ar.length < 1) return { error: "Artist missing" }
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
  return { error: "No results" }
}

function withNormalizedTrackGenre(m) {
  if (!m || m.error || !m.ok) return m
  if (m.genre == null) return m
  return { ...m, genre: normalizeStoredGenreString(m.genre) }
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
  if (dz.ok) return withNormalizedTrackGenre(dz)
  await sleep(200)
  const adb = await fetchTrackMetadataTheAudioDB(artist, t, album, tFile)
  if (adb.ok) return withNormalizedTrackGenre(adb)
  await sleep(1000)
  const mb = await fetchTrackMetadataMusicBrainz(artist, t)
  if (mb.ok) return withNormalizedTrackGenre(mb)
  await sleep(200)
  const it = await fetchTrackMetadataItunes(artist, t, album)
  if (it.ok) return withNormalizedTrackGenre(it)
  if (it.error === "Title missing") return it
  const parts = [dz.error, adb.error, mb.error, it.error].filter(Boolean)
  return {
    error: parts.length
      ? [...new Set(parts)].join(" · ")
      : "No results",
  }
}
