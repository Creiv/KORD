import { existsSync } from "fs"
import fs from "fs/promises"
import path from "path"
import archiver from "archiver"
import unzipper from "unzipper"
import {
  CONFIG_FILE,
  findAccountById,
  getAccountsSnapshot,
  getMusicRootForAccountStrict,
  isMusicRootFromEnv,
  reloadConfigFromDisk,
} from "./musicRootConfig.mjs"
import { getActivityLogFilePath } from "./activityLog.mjs"
import { getUserStateFilePathInConfigDir } from "./userState.mjs"

const METADATA_BASENAMES = new Set([
  "kord-albuminfo.json",
  "wpp-albuminfo.json",
  "kord-trackinfo.json",
  "wpp-trackinfo.json",
  "linked-source.json",
])

export async function collectLibraryMetadataForBackup(musicRoot, accountId) {
  const root = path.resolve(musicRoot)
  try {
    const st = await fs.stat(root)
    if (!st.isDirectory()) return []
  } catch {
    return []
  }
  const out = []
  async function go(dir) {
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === ".git") continue
        await go(full)
        continue
      }
      if (!e.isFile()) continue
      if (METADATA_BASENAMES.has(e.name)) {
        const rel = path.relative(root, full)
        const relPosix = rel.split(path.sep).join("/")
        out.push({
          abs: full,
          zipName: `libraries/${accountId}/${relPosix}`,
        })
      }
    }
  }
  await go(root)
  return out
}

/**
 * @param {() => { accounts: { id: string; name: string; musicRoot: string }[]; lockedByEnv: boolean; defaultAccountId: string }} getAccountsSnapshot
 */
export async function buildKordBackupPlan(getAccountsSnapshot) {
  const snap = getAccountsSnapshot()
  const entries = []
  if (existsSync(CONFIG_FILE)) {
    entries.push({ abs: CONFIG_FILE, zipName: "config/music-root.config.json" })
  }
  const actPath = getActivityLogFilePath()
  if (existsSync(actPath)) {
    entries.push({ abs: actPath, zipName: "config/kord-activity.log.jsonl" })
  }
  const accounts = Array.isArray(snap.accounts) ? snap.accounts : []
  const manifest = {
    kordBackup: 1,
    createdAt: new Date().toISOString(),
    accounts: accounts.map((a) => ({ id: a.id, name: a.name, musicRoot: a.musicRoot })),
    lockedByEnv: Boolean(snap.lockedByEnv),
  }
  entries.push({
    _body: JSON.stringify(manifest, null, 2),
    zipName: "config/manifest.json",
  })
  for (const acc of accounts) {
    const p = getUserStateFilePathInConfigDir(acc.id)
    if (p && existsSync(p)) {
      entries.push({ abs: p, zipName: `user-state/accounts/${acc.id}/user-state.v1.json` })
    }
    const kordLegacy = path.join(acc.musicRoot, ".kord", "user-state.v1.json")
    const wppLegacy = path.join(acc.musicRoot, ".wpp", "user-state.v1.json")
    if (existsSync(kordLegacy)) {
      entries.push({
        abs: kordLegacy,
        zipName: `user-state/legacy-in-library/${acc.id}/.kord-user-state.v1.json`,
      })
    }
    if (existsSync(wppLegacy)) {
      entries.push({
        abs: wppLegacy,
        zipName: `user-state/legacy-in-library/${acc.id}/.wpp-user-state.v1.json`,
      })
    }
    const lib = await collectLibraryMetadataForBackup(acc.musicRoot, acc.id)
    for (const e of lib) entries.push(e)
  }
  return entries
}

/**
 * @param {import("express").Response} res
 * @param {() => { accounts: { id: string; name: string; musicRoot: string }[]; lockedByEnv: boolean; defaultAccountId: string }} getAccountsSnapshot
 */
export async function streamKordBackupZip(res, getAccountsSnapshot) {
  const plan = await buildKordBackupPlan(getAccountsSnapshot)
  const archive = archiver("zip", { zlib: { level: 6 } })
  await new Promise((resolve, reject) => {
    archive.on("error", reject)
    archive.on("warning", (err) => {
      if (err.code === "ENOENT") return
    })
    archive.pipe(res)
    void (async () => {
      try {
        for (const e of plan) {
          if (e._body != null) {
            archive.append(e._body, { name: e.zipName })
          } else {
            archive.file(e.abs, { name: e.zipName })
          }
        }
        await archive.finalize()
        resolve()
      } catch (err) {
        reject(err)
      }
    })()
  })
}

function underMusicRoot(full, musicRoot) {
  const root = path.resolve(musicRoot)
  const resolved = path.resolve(full)
  return resolved === root || resolved.startsWith(root + path.sep)
}

/**
 * Ripristina da buffer ZIP prodotto da `streamKordBackupZip`. Richiede `config/manifest.json`.
 * @param {Buffer} buffer
 */
export async function restoreKordFromZipBuffer(buffer) {
  if (isMusicRootFromEnv()) {
    const e = new Error(
      "Restore is not available when MUSIC_ROOT is set in the environment",
    )
    e.code = "ENV_LOCKED"
    throw e
  }
  const directory = await unzipper.Open.buffer(buffer)
  const files = await directory.files
  const entries = new Map()
  for (const f of files) {
    if (f.type === "Directory") continue
    const name = f.path.replace(/\\/g, "/")
    const buf = await f.buffer()
    entries.set(name, buf)
  }
  const manBuf = entries.get("config/manifest.json")
  if (!manBuf) {
    const e = new Error("Invalid archive: config/manifest.json is missing")
    e.code = "BAD_BACKUP"
    throw e
  }
  let manifest
  try {
    manifest = JSON.parse(manBuf.toString("utf8"))
  } catch {
    const e = new Error("Invalid manifest JSON")
    e.code = "BAD_BACKUP"
    throw e
  }
  if (manifest.kordBackup !== 1) {
    const e = new Error("Not a Kord backup archive")
    e.code = "BAD_BACKUP"
    throw e
  }
  const cfgBuf = entries.get("config/music-root.config.json")
  if (!cfgBuf) {
    const e = new Error("Missing config/music-root.config.json in archive")
    e.code = "BAD_BACKUP"
    throw e
  }
  await fs.mkdir(path.dirname(CONFIG_FILE), { recursive: true })
  await fs.writeFile(CONFIG_FILE, cfgBuf, "utf8")
  reloadConfigFromDisk()
  const actBuf = entries.get("config/kord-activity.log.jsonl")
  if (actBuf) {
    const p = getActivityLogFilePath()
    await fs.mkdir(path.dirname(p), { recursive: true })
    await fs.writeFile(p, actBuf, "utf8")
  }
  const snap = getAccountsSnapshot()
  for (const acc of snap.accounts) {
    const us = entries.get(`user-state/accounts/${acc.id}/user-state.v1.json`)
    if (us) {
      const dest = getUserStateFilePathInConfigDir(acc.id)
      if (dest) {
        await fs.mkdir(path.dirname(dest), { recursive: true })
        await fs.writeFile(dest, us, "utf8")
      }
    }
    const mr = getMusicRootForAccountStrict(acc.id)
    const kordL = entries.get(`user-state/legacy-in-library/${acc.id}/.kord-user-state.v1.json`)
    const wppL = entries.get(`user-state/legacy-in-library/${acc.id}/.wpp-user-state.v1.json`)
    if (kordL) {
      const dest = path.join(mr, ".kord", "user-state.v1.json")
      await fs.mkdir(path.dirname(dest), { recursive: true })
      await fs.writeFile(dest, kordL, "utf8")
    }
    if (wppL) {
      const dest = path.join(mr, ".wpp", "user-state.v1.json")
      await fs.mkdir(path.dirname(dest), { recursive: true })
      await fs.writeFile(dest, wppL, "utf8")
    }
  }
  for (const [name, buf] of entries) {
    if (!name.startsWith("libraries/")) continue
    const rest = name.slice("libraries/".length)
    const slash = rest.indexOf("/")
    if (slash < 0) continue
    const accountId = rest.slice(0, slash)
    const rel = rest.slice(slash + 1)
    if (!findAccountById(accountId)) continue
    const base = path.basename(rel)
    if (!METADATA_BASENAMES.has(base)) continue
    const musicRoot = getMusicRootForAccountStrict(accountId)
    const full = path.join(musicRoot, rel.split("/").join(path.sep))
    if (!underMusicRoot(full, musicRoot)) continue
    await fs.mkdir(path.dirname(full), { recursive: true })
    await fs.writeFile(full, buf, "utf8")
  }
  return { restored: true, accountCount: snap.accounts.length }
}
