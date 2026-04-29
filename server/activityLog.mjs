import fs from "fs/promises"
import { existsSync } from "fs"
import path from "path"
import { getMusicRoot, isLibraryRootConfigured } from "./musicRootConfig.mjs"
import { kordGlobalInfoDir } from "./kordDataStore.mjs"

const LOG_BASENAME = "kord-activity.log.jsonl"

export function getActivityLogFilePath() {
  if (!isLibraryRootConfigured()) return null
  const root = getMusicRoot()
  if (!root) return null
  return path.join(kordGlobalInfoDir(root), LOG_BASENAME)
}

/** Coda in-process: righe JSONL non si intercalano. */
let activityLogChain = Promise.resolve()

/**
 * @param {Record<string, unknown>} entry accountId, kind, action, folder?, musicRoot?, detail?
 */
export async function appendActivityLog(entry) {
  const p = getActivityLogFilePath()
  if (!p) return
  const line =
    JSON.stringify({
      ts: new Date().toISOString(),
      ...entry,
    }) + "\n"
  const job = activityLogChain.catch(() => {}).then(async () => {
    await fs.mkdir(path.dirname(p), { recursive: true })
    await fs.appendFile(p, line, "utf8")
  })
  activityLogChain = job.catch((e) => console.error("[kord] activity log:", e?.message ?? e))
  await job
}

/** Differenze su playlist e impostazioni (esclude coda, preferiti, esclusioni shuffle, conteggi, …). */
export function diffUserStatePlaylistsAndSettings(prev, next) {
  const out = []
  const pPl = Array.isArray(prev?.playlists) ? prev.playlists : []
  const nPl = Array.isArray(next?.playlists) ? next.playlists : []
  const pById = new Map(pPl.map((p) => [p.id, p]))
  const nById = new Map(nPl.map((p) => [p.id, p]))
  for (const pl of nPl) {
    if (!pById.has(pl.id)) {
      out.push({
        kind: "playlist",
        action: "create",
        folder: null,
        detail: pl.name,
      })
    }
  }
  for (const pl of pPl) {
    if (!nById.has(pl.id)) {
      out.push({
        kind: "playlist",
        action: "delete",
        folder: null,
        detail: pl.name,
      })
    }
  }
  for (const pl of nPl) {
    const o = pById.get(pl.id)
    if (!o) continue
    if (o.name !== pl.name) {
      out.push({
        kind: "playlist",
        action: "rename",
        folder: null,
        detail: `${o.name} → ${pl.name}`,
      })
    }
    if (o.tracks.length !== pl.tracks.length) {
      out.push({
        kind: "playlist",
        action: "tracks",
        folder: null,
        detail: `${pl.name} (${o.tracks.length}→${pl.tracks.length} ${pl.tracks.length === 1 ? "track" : "tracks"})`,
      })
    }
  }
  const pS = prev?.settings && typeof prev.settings === "object" ? prev.settings : {}
  const nS = next?.settings && typeof next.settings === "object" ? next.settings : {}
  const keys = new Set([...Object.keys(pS), ...Object.keys(nS)])
  for (const k of keys) {
    if (JSON.stringify(pS[k]) !== JSON.stringify(nS[k])) {
      out.push({
        kind: "settings",
        action: "update",
        folder: null,
        detail: String(k),
      })
    }
  }
  return out
}

/**
 * @param {number} limit
 */
export async function readActivityLogs(limit = 500) {
  const p = getActivityLogFilePath()
  if (!p || !existsSync(p)) return []
  const raw = await fs.readFile(p, "utf8")
  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
  const take = lines.slice(-Math.min(limit, 5000))
  const out = []
  for (const line of take) {
    try {
      out.push(JSON.parse(line))
    } catch {
      /* skip */
    }
  }
  return out.reverse()
}
