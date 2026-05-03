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
])

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
    vizMode: (() => {
      let m = src.vizMode === "soft" ? "signals" : src.vizMode
      if (m === "horizon") m = "embers"
      if (m === "prism") m = "bars"
      return m === "mirror" ||
        m === "osc" ||
        m === "oscSoft" ||
        m === "bars" ||
        m === "signals" ||
        m === "embers" ||
        m === "kord"
        ? m
        : "bars"
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
    migratedLegacy: src.migratedLegacy === true,
    trackMoodsMigrated: src.trackMoodsMigrated === true,
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
