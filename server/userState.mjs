import fs from "fs/promises"
import { existsSync } from "fs"
import path from "path"
import { atomicWriteFileUtf8, kordAccountUserStatePath } from "./kordDataStore.mjs"
import { CONFIG_FILE } from "./musicRootConfig.mjs"

/** Serie di readUserState sulla stessa coppia (library, account): evita race sulla migrazione lazy. */
const readUserChains = new Map()
/** Serie di mutazioni read -> merge -> write sulla stessa coppia (library, account). */
const userStateMutationChains = new Map()

function readUserMutexKey(musicRoot, accountId) {
  try {
    return `${path.resolve(String(musicRoot))}\0${String(accountId ?? "")}`
  } catch {
    return `${String(musicRoot)}\0${String(accountId ?? "")}`
  }
}

async function withUserStateMutation(musicRoot, accountId, fn) {
  const key = readUserMutexKey(musicRoot, accountId)
  const prev = userStateMutationChains.get(key) ?? Promise.resolve()
  const next = prev
    .catch(() => {})
    .then(() => fn())
  userStateMutationChains.set(key, next)
  try {
    return await next
  } finally {
    if (userStateMutationChains.get(key) === next) {
      userStateMutationChains.delete(key)
    }
  }
}

function isObj(v) {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v)
}

function uniqStrings(arr) {
  return [...new Set((Array.isArray(arr) ? arr : []).filter((v) => typeof v === "string" && v.trim()))]
}

function sanitizeTrackMoodsMap(raw) {
  if (!isObj(raw)) return {}
  const out = {}
  for (const [k, v] of Object.entries(raw)) {
    if (typeof k !== "string" || !k.trim()) continue
    const arr = Array.isArray(v) ? v : typeof v === "string" ? [v] : []
    const moods = uniqStrings(arr)
    if (moods.length) out[k.trim()] = moods
  }
  return out
}

function sanitizePlectrBestEntry(raw) {
  if (!isObj(raw)) return null
  const score = Number(raw.score)
  if (!Number.isFinite(score)) return null
  const hits = Math.max(0, Math.round(Number(raw.hits) || 0))
  const rounded = Math.max(0, Math.round(score))
  if (rounded <= 0 && hits <= 0) return null
  return {
    score: rounded,
    grade: String(raw.grade ?? "").slice(0, 8),
    accuracy: Math.min(1, Math.max(0, Number(raw.accuracy) || 0)),
    maxCombo: Math.max(0, Math.round(Number(raw.maxCombo) || 0)),
    hits,
    misses: Math.max(0, Math.round(Number(raw.misses) || 0)),
    updatedAt:
      typeof raw.updatedAt === "string" && raw.updatedAt.trim()
        ? raw.updatedAt.trim()
        : new Date().toISOString(),
  }
}

function sanitizePlectrBestsMap(raw) {
  if (!isObj(raw)) return {}
  const out = {}
  for (const [k, v] of Object.entries(raw)) {
    if (typeof k !== "string" || !k.trim()) continue
    const best = sanitizePlectrBestEntry(v)
    if (best) out[k.trim()] = best
  }
  return out
}

function isBetterPlectrBest(next, current) {
  if (!current) return next.score > 0 || (next.hits ?? 0) > 0
  if (next.score !== current.score) return next.score > current.score
  const na = Number(next.accuracy) || 0
  const ca = Number(current.accuracy) || 0
  return na > ca
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
  "prism",
  "slate-light",
  "aubergine-light",
  "tangerine-light",
  "carmine-light",
  "custom",
])

const DEFAULT_CUSTOM_THEME = {
  bg: "#08111d",
  section: "#121f31",
  accent: "#ff8f5c",
  accent2: "#64d4ff",
}

function sanitizeHexColor(raw, fallback) {
  if (typeof raw !== "string") return fallback
  const s = raw.trim()
  if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase()
  if (/^#[0-9a-f]{3}$/i.test(s)) {
    return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`.toLowerCase()
  }
  return fallback
}

function sanitizeCustomTheme(raw) {
  const src = isObj(raw) ? raw : {}
  return {
    bg: sanitizeHexColor(src.bg, DEFAULT_CUSTOM_THEME.bg),
    section: sanitizeHexColor(src.section, DEFAULT_CUSTOM_THEME.section),
    accent: sanitizeHexColor(src.accent, DEFAULT_CUSTOM_THEME.accent),
    accent2: sanitizeHexColor(src.accent2, DEFAULT_CUSTOM_THEME.accent2),
  }
}

function normalizeAudioCrossfadeSec(src) {
  const n = Number(src.audioCrossfadeSec)
  if (n === 0 || n === 3 || n === 5) return n
  return src.trackChangeTransitions === false ? 0 : 3
}

function sanitizeSettings(settings) {
  const src = isObj(settings) ? settings : {}
  const loc = src.locale === "it" ? "it" : "en"
  const libBrowse =
    src.libBrowse === "genres"
      ? "genres"
      : src.libBrowse === "moods"
        ? "moods"
        : "artists"
  const libOverviewSort = src.libOverviewSort === "plays" ? "plays" : "name"
  const sas = src.artistAlbumSort
  const artistAlbumSort =
    sas === "name" || sas === "plays" || sas === "date" ? sas : "date"
  return {
    theme: THEME_MODES.has(src.theme) ? src.theme : "midnight",
    customTheme: sanitizeCustomTheme(src.customTheme),
    vizMode: (() => {
      let m = src.vizMode === "soft" ? "signals" : src.vizMode
      if (m === "horizon") m = "embers"
      if (m === "prism") m = "bars"
      return m === "mirror" ||
        m === "osc" ||
        m === "oscSoft" ||
        m === "hmb" ||
        m === "bars" ||
        m === "signals" ||
        m === "embers" ||
        m === "karaoke"
        ? m
        : "hmb"
    })(),
    restoreSession: src.restoreSession !== false,
    defaultTab:
      typeof src.defaultTab === "string" && src.defaultTab.trim() ? src.defaultTab : "dashboard",
    locale: loc,
    libBrowse,
    libOverviewSort,
    artistAlbumSort,
    audioCrossfadeSec: normalizeAudioCrossfadeSec(src),
  }
}

function sanitizeShuffleIdList(raw) {
  if (!Array.isArray(raw)) return []
  return uniqStrings(raw).slice(0, 100_000)
}

export function defaultUserState() {
  return {
    version: 1,
    revision: 1,
    favorites: [],
    recent: [],
    trackPlayCounts: {},
    playlists: [],
    queue: {
      tracks: [],
      currentIndex: 0,
    },
    settings: sanitizeSettings({}),
    shuffleExcludedAlbumIds: [],
    shuffleExcludedTrackRelPaths: [],
    trackMoods: {},
    plectrBests: {},
    playlistsMigrated: false,
  }
}

function sanitizeStoredRevision(raw) {
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 1) return 1
  return Math.min(Math.floor(n), Number.MAX_SAFE_INTEGER)
}

/** Revisione ottimistic locking sullo stato utente (≥ 1). */
export function currentRevision(prev) {
  return sanitizeStoredRevision(prev?.revision)
}

export function stripRevisionFromPatch(patch) {
  if (!isObj(patch) || Array.isArray(patch)) return patch
  const { revision: _r, ...rest } = patch
  void _r
  return rest
}

/** Rimuove `settings` dal payload PUT: le impostazioni si aggiornano solo via PATCH dedicata. */
export function stripSettingsFromUserStatePatch(patch) {
  if (!isObj(patch) || Array.isArray(patch)) return patch
  const { settings: _s, ...rest } = patch
  void _s
  return rest
}

export function stripClientControlledKeysFromPutPatch(patch) {
  return stripRevisionFromPatch(stripSettingsFromUserStatePatch(patch))
}

export async function mergeAndWriteUserStateWithRevision(musicRoot, accountId, expectedRevision, buildMergedFromPrevFresh) {
  return withUserStateMutation(musicRoot, accountId, async () => {
    const prevFresh = await readUserStateImpl(musicRoot, accountId)
    const cur = currentRevision(prevFresh)
    const exp = Number(expectedRevision)
    if (!Number.isFinite(exp) || exp !== cur) {
      const err = new Error("USER_STATE_REVISION_CONFLICT")
      err.code = "USER_STATE_REVISION_CONFLICT"
      err.currentState = prevFresh
      throw err
    }
    const merged = buildMergedFromPrevFresh(prevFresh)
    const sanitized = sanitizeUserState({
      ...merged,
      revision: cur + 1,
    })
    return writeUserStatePersist(musicRoot, sanitized, accountId)
  })
}

export async function mergeAndWriteUserStatePatch(musicRoot, accountId, patch) {
  return withUserStateMutation(musicRoot, accountId, async () => {
    const prevFresh = await readUserStateImpl(musicRoot, accountId)
    const merged = mergeUserStateForPut(
      prevFresh,
      stripRevisionFromPatch(isObj(patch) && !Array.isArray(patch) ? patch : {}),
    )
    const sanitized = sanitizeUserState({
      ...merged,
      revision: currentRevision(prevFresh) + 1,
    })
    return writeUserStatePersist(musicRoot, sanitized, accountId)
  })
}

export function mergeUserStateForPut(prev, patch) {
  if (!isObj(patch) || Array.isArray(patch)) return prev
  if (Object.keys(patch).length === 0) return prev
  const out = { ...prev }
  for (const k of Object.keys(patch)) {
    if (patch[k] === undefined) continue
    if (k === "settings") {
      if (isObj(patch.settings)) {
        out.settings = { ...prev.settings, ...patch.settings }
      }
      continue
    }
    if (k === "queue" && isObj(patch.queue)) {
      out.queue = patch.queue
      continue
    }
    if (k === "trackMoods" && isObj(patch.trackMoods)) {
      out.trackMoods = { ...(prev.trackMoods || {}), ...sanitizeTrackMoodsMap(patch.trackMoods) }
      continue
    }
    if (k === "plectrBests" && isObj(patch.plectrBests)) {
      out.plectrBests = {
        ...(prev.plectrBests || {}),
        ...sanitizePlectrBestsMap(patch.plectrBests),
      }
      continue
    }
    out[k] = patch[k]
  }
  return out
}

export function sanitizeUserState(input) {
  const base = defaultUserState()
  const src = isObj(input) ? input : {}
  const queueTracks = Array.isArray(src.queue?.tracks)
    ? src.queue.tracks.map((track) => sanitizeTrack(track)).filter(Boolean)
    : []
  const revSrc = Object.prototype.hasOwnProperty.call(src, "revision") ? src.revision : base.revision
  return {
    ...base,
    version: 1,
    revision: sanitizeStoredRevision(revSrc),
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
    shuffleExcludedAlbumIds: sanitizeShuffleIdList(src.shuffleExcludedAlbumIds),
    shuffleExcludedTrackRelPaths: sanitizeShuffleIdList(src.shuffleExcludedTrackRelPaths),
    trackMoods: sanitizeTrackMoodsMap(src.trackMoods),
    plectrBests: sanitizePlectrBestsMap(src.plectrBests),
    migratedLegacy: src.migratedLegacy === true,
    trackMoodsMigrated: src.trackMoodsMigrated === true,
    playlistsMigrated: src.playlistsMigrated === true,
  }
}

function safeAccountId(accountId) {
  const id = String(accountId || "").trim()
  if (!id) return null
  return id.replace(/[^a-zA-Z0-9._-]/g, "_")
}

function filePathAccountLegacy(accountId) {
  const id = safeAccountId(accountId)
  if (!id) return null
  return path.join(path.dirname(CONFIG_FILE), "accounts", id, "user-state.v1.json")
}

export function getUserStateFilePathInConfigDir(accountId) {
  return filePathAccountLegacy(accountId)
}

export function getUserStateFilePathForAccount(libraryRoot, accountId) {
  return kordAccountUserStatePath(libraryRoot, accountId)
}

function filePathKord(musicRoot) {
  return path.join(musicRoot, ".kord", "user-state.v1.json")
}
function filePathWpp(musicRoot) {
  return path.join(musicRoot, ".wpp", "user-state.v1.json")
}

async function readJsonUserStateFile(fp, maxAttempts = 5) {
  let lastErr
  for (let i = 0; i < maxAttempts; i += 1) {
    try {
      const raw = await fs.readFile(fp, "utf8")
      if (!raw || !String(raw).trim()) throw new Error("empty user-state file")
      return sanitizeUserState(JSON.parse(raw))
    } catch (e) {
      lastErr = e
      if (i < maxAttempts - 1) {
        await new Promise((r) => setTimeout(r, 20 + i * 35))
      }
    }
  }
  if (lastErr && process.env.KORD_VERBOSE) {
    console.warn("[kord] user-state read failed:", fp, lastErr?.message ?? lastErr)
  }
  return null
}

async function readUserStateImpl(musicRoot, accountId = null) {
  if (!musicRoot) return defaultUserState()
  const kordAcc = kordAccountUserStatePath(musicRoot, accountId)
  const accountPath = filePathAccountLegacy(accountId)
  const legacyKord = filePathKord(musicRoot)
  const legacyWpp = filePathWpp(musicRoot)

  let state =
    kordAcc && existsSync(kordAcc) ? await readJsonUserStateFile(kordAcc) : null
  if (!state && accountPath && existsSync(accountPath)) {
    state = await readJsonUserStateFile(accountPath)
  }
  const legacyFp = existsSync(legacyKord)
    ? legacyKord
    : existsSync(legacyWpp)
      ? legacyWpp
      : null
  if (!state && legacyFp) {
    state = await readJsonUserStateFile(legacyFp)
    if (state && accountId && safeAccountId(accountId) !== "default") {
      state.migratedLegacy = true
    }
    if (state && kordAcc) {
      await atomicWriteFileUtf8(kordAcc, JSON.stringify(state, null, 2))
    } else if (state && accountPath) {
      await atomicWriteFileUtf8(accountPath, JSON.stringify(state, null, 2))
    }
    return state
  }
  if (state) return state

  const empty = defaultUserState()
  if (accountId && safeAccountId(accountId) !== "default") {
    empty.migratedLegacy = true
  }
  return empty
}

export async function readUserState(musicRoot, accountId = null) {
  const key = readUserMutexKey(musicRoot, accountId)
  const prev = readUserChains.get(key) ?? Promise.resolve()
  const next = prev
    .catch(() => {})
    .then(() => readUserStateImpl(musicRoot, accountId))
  readUserChains.set(key, next)
  return await next
}

async function writeUserStatePersist(musicRoot, sanitizedState, accountId = null) {
  if (!musicRoot) {
    const e = new Error("Library not configured")
    e.code = "LIBRARY_NOT_CONFIGURED"
    throw e
  }
  const kordAcc = kordAccountUserStatePath(musicRoot, accountId)
  const fp = kordAcc || filePathAccountLegacy(accountId) || filePathKord(musicRoot)
  await atomicWriteFileUtf8(fp, JSON.stringify(sanitizedState, null, 2))
  return sanitizedState
}

/** Scrittura server-side monotona (test, merge mood retry). Bump revision da disco. */
export async function writeUserState(musicRoot, input, accountId = null) {
  return withUserStateMutation(musicRoot, accountId, async () => {
    const prev = await readUserStateImpl(musicRoot, accountId)
    const sanitized = sanitizeUserState(input)
    sanitized.revision = currentRevision(prev) + 1
    return writeUserStatePersist(musicRoot, sanitized, accountId)
  })
}

export async function writeUserPlectrBestWithCAS(
  musicRoot,
  accountId,
  relPath,
  result,
  maxRetries = 8,
) {
  const pathKey = String(relPath || "").trim()
  if (!pathKey) {
    const err = new Error("relPath is required")
    err.code = "INVALID_REL_PATH"
    throw err
  }
  const next = sanitizePlectrBestEntry(result)
  if (!next) {
    const err = new Error("Invalid Plectr score")
    err.code = "INVALID_PLECTR_SCORE"
    throw err
  }

  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    try {
      const prev = await readUserState(musicRoot, accountId)
      const exp = currentRevision(prev)
      const current = prev.plectrBests?.[pathKey] ?? null
      if (current && !isBetterPlectrBest(next, current)) {
        return { state: prev, saved: false, best: current }
      }
      const merged = await mergeAndWriteUserStateWithRevision(
        musicRoot,
        accountId,
        exp,
        (fresh) => {
          const tm = { ...(fresh.plectrBests || {}) }
          tm[pathKey] = next
          return {
            ...fresh,
            plectrBests: sanitizePlectrBestsMap(tm),
          }
        },
      )
      return { state: merged, saved: true, best: merged.plectrBests?.[pathKey] ?? next }
    } catch (e) {
      if (e?.code !== "USER_STATE_REVISION_CONFLICT") throw e
      if (attempt === maxRetries - 1) throw e
      await new Promise((r) => setTimeout(r, 20 + attempt * 30))
    }
  }
  throw new Error("writeUserPlectrBestWithCAS exhausted retries")
}

export async function writeUserTrackMoodsWithCAS(musicRoot, accountId, relPath, moodsList, maxRetries = 8) {
  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    try {
      const prev = await readUserState(musicRoot, accountId)
      const exp = currentRevision(prev)
      const list = moodsList ?? []
      return await mergeAndWriteUserStateWithRevision(musicRoot, accountId, exp, (fresh) => {
        const tm = { ...(fresh.trackMoods || {}) }
        if (!list.length) delete tm[relPath]
        else tm[relPath] = list.map(String).filter(Boolean)
        return {
          ...fresh,
          trackMoods: sanitizeTrackMoodsMap(tm),
        }
      })
    } catch (e) {
      if (e?.code !== "USER_STATE_REVISION_CONFLICT") throw e
      if (attempt === maxRetries - 1) throw e
      await new Promise((r) => setTimeout(r, 20 + attempt * 30))
    }
  }
}
