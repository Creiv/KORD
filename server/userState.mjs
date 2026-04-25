import fs from "fs/promises"
import { existsSync } from "fs"
import path from "path"
import { CONFIG_FILE } from "./musicRootConfig.mjs"

function isObj(v) {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v)
}

function uniqStrings(arr) {
  return [...new Set((Array.isArray(arr) ? arr : []).filter((v) => typeof v === "string" && v.trim()))]
}

function sanitizeTrack(track) {
  if (!isObj(track)) return null
  const relPath = typeof track.relPath === "string" ? track.relPath.trim() : ""
  const title = typeof track.title === "string" ? track.title.trim() : ""
  if (!relPath || !title) return null
  return {
    id: typeof track.id === "string" && track.id.trim() ? track.id : relPath,
    relPath,
    title,
    artist: typeof track.artist === "string" && track.artist.trim() ? track.artist : "—",
    album: typeof track.album === "string" && track.album.trim() ? track.album : "—",
    ...(isObj(track.meta) ? { meta: track.meta } : {}),
    ...(isObj(track.albumMeta) ? { albumMeta: track.albumMeta } : {}),
  }
}

function sanitizeTrackPlayCounts(raw) {
  if (!isObj(raw)) return {}
  const out = {}
  for (const [relPath, count] of Object.entries(raw)) {
    if (typeof relPath !== "string" || !relPath.trim()) continue
    const n = Number(count)
    if (!Number.isFinite(n) || n <= 0) continue
    out[relPath] = Math.min(Math.floor(n), 1_000_000_000)
  }
  return out
}

function sanitizePlaylist(item) {
  if (!isObj(item)) return null
  const id = typeof item.id === "string" && item.id.trim() ? item.id : crypto.randomUUID()
  const name = typeof item.name === "string" && item.name.trim() ? item.name.trim() : "New playlist"
  const tracks = Array.isArray(item.tracks)
    ? item.tracks
        .map((track) => sanitizeTrack(track))
        .filter(Boolean)
        .map((track) => ({
          relPath: track.relPath,
          title: track.title,
          artist: track.artist,
          album: track.album,
        }))
    : []
  return { id, name, tracks }
}

const THEME_MODES = new Set([
  "midnight",
  "sunset",
  "aurora",
  "ember",
  "forest",
  "neon",
  "ocean",
  "rose",
  "slate",
  "aubergine",
  "tangerine",
  "carmine",
])

function sanitizeSettings(settings) {
  const src = isObj(settings) ? settings : {}
  const loc = src.locale === "it" ? "it" : "en"
  const libBrowse = src.libBrowse === "genres" ? "genres" : "artists"
  const libOverviewSort = src.libOverviewSort === "plays" ? "plays" : "name"
  const sas = src.artistAlbumSort
  const artistAlbumSort =
    sas === "name" || sas === "plays" || sas === "date" ? sas : "date"
  return {
    theme: THEME_MODES.has(src.theme) ? src.theme : "midnight",
    vizMode: (() => {
      let m = src.vizMode === "soft" ? "signals" : src.vizMode;
      if (m === "horizon") m = "embers";
      return m === "mirror" ||
        m === "osc" ||
        m === "bars" ||
        m === "signals" ||
        m === "embers" ||
        m === "kord"
        ? m
        : "bars";
    })(),
    restoreSession: src.restoreSession !== false,
    defaultTab:
      typeof src.defaultTab === "string" && src.defaultTab.trim() ? src.defaultTab : "dashboard",
    locale: loc,
    libBrowse,
    libOverviewSort,
    artistAlbumSort,
  }
}

export function defaultUserState() {
  return {
    version: 1,
    favorites: [],
    recent: [],
    trackPlayCounts: {},
    playlists: [],
    queue: {
      tracks: [],
      currentIndex: 0,
    },
    settings: sanitizeSettings({}),
  }
}

export function sanitizeUserState(input) {
  const base = defaultUserState()
  const src = isObj(input) ? input : {}
  const queueTracks = Array.isArray(src.queue?.tracks)
    ? src.queue.tracks.map((track) => sanitizeTrack(track)).filter(Boolean)
    : []
  return {
    ...base,
    version: 1,
    favorites: uniqStrings(src.favorites),
    recent: Array.isArray(src.recent)
      ? src.recent.map((track) => sanitizeTrack(track)).filter(Boolean).slice(0, 30)
      : [],
    trackPlayCounts: sanitizeTrackPlayCounts(src.trackPlayCounts),
    playlists: Array.isArray(src.playlists)
      ? src.playlists.map((item) => sanitizePlaylist(item)).filter(Boolean)
      : [],
    queue: {
      tracks: queueTracks,
      currentIndex: Math.min(
        Math.max(Number(src.queue?.currentIndex) || 0, 0),
        Math.max(queueTracks.length - 1, 0),
      ),
    },
    settings: sanitizeSettings(src.settings),
    migratedLegacy: src.migratedLegacy === true,
  }
}

function safeAccountId(accountId) {
  const id = String(accountId || "").trim()
  if (!id) return null
  return id.replace(/[^a-zA-Z0-9._-]/g, "_")
}

function filePathAccount(accountId) {
  const id = safeAccountId(accountId)
  if (!id) return null
  return path.join(path.dirname(CONFIG_FILE), "accounts", id, "user-state.v1.json")
}

function filePathKord(musicRoot) {
  return path.join(musicRoot, ".kord", "user-state.v1.json")
}
function filePathWpp(musicRoot) {
  return path.join(musicRoot, ".wpp", "user-state.v1.json")
}

async function readStateFile(fp) {
  const raw = await fs.readFile(fp, "utf8")
  return sanitizeUserState(JSON.parse(raw))
}

export async function readUserState(musicRoot, accountId = null) {
  const accountPath = filePathAccount(accountId)
  if (accountPath && existsSync(accountPath)) {
    try {
      return await readStateFile(accountPath)
    } catch {
      return defaultUserState()
    }
  }
  const p = filePathKord(musicRoot)
  const legacy = filePathWpp(musicRoot)
  const use = existsSync(p) ? p : existsSync(legacy) ? legacy : null
  if (!use) {
    const state = defaultUserState()
    if (accountId && safeAccountId(accountId) !== "default") {
      state.migratedLegacy = true
    }
    return state
  }
  try {
    const state = await readStateFile(use)
    if (accountId && safeAccountId(accountId) !== "default") {
      state.migratedLegacy = true
    }
    if (accountPath) {
      await fs.mkdir(path.dirname(accountPath), { recursive: true })
      await fs.writeFile(accountPath, JSON.stringify(state, null, 2), "utf8")
    }
    return state
  } catch {
    return defaultUserState()
  }
}

export async function writeUserState(musicRoot, input, accountId = null) {
  const fp = filePathAccount(accountId) || filePathKord(musicRoot)
  await fs.mkdir(path.dirname(fp), { recursive: true })
  const state = sanitizeUserState(input)
  await fs.writeFile(fp, JSON.stringify(state, null, 2), "utf8")
  return state
}
