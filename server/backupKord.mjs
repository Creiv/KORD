import { existsSync } from "fs"
import { createWriteStream } from "fs"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { randomUUID } from "crypto"
import { pipeline } from "stream/promises"
import archiver from "archiver"
import unzipper from "unzipper"
import {
  CONFIG_FILE,
  findAccountById,
  getAccountsSnapshot,
  getMusicRoot,
  getMusicRootForAccountStrict,
  isMusicRootFromEnv,
  reloadConfigFromDisk,
} from "./musicRootConfig.mjs"
import { getActivityLogFilePath } from "./activityLog.mjs"
import { getUserStateFilePathForAccount, getUserStateFilePathInConfigDir } from "./userState.mjs"

const METADATA_BASENAMES = new Set([
  "kord-albuminfo.json",
  "wpp-albuminfo.json",
  "kord-trackinfo.json",
  "wpp-trackinfo.json",
  "linked-source.json",
])

export async function collectLibraryMetadataForBackup(musicRoot, zipFolderTag) {
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
        if (e.name === "node_modules" || e.name === ".git" || e.name === ".kord") continue
        await go(full)
        continue
      }
      if (!e.isFile()) continue
      if (METADATA_BASENAMES.has(e.name)) {
        const rel = path.relative(root, full)
        const relPosix = rel.split(path.sep).join("/")
        out.push({
          abs: full,
          zipName: `libraries/${zipFolderTag}/${relPosix}`,
        })
      }
    }
  }
  await go(root)
  return out
}

async function collectKordDbJsonBackup(libraryRoot) {
  const root = path.join(path.resolve(libraryRoot), ".kord")
  if (!existsSync(root)) return []
  const out = []
  async function walk(dir) {
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        await walk(full)
        continue
      }
      if (!e.isFile() || !e.name.endsWith(".json")) continue
      const rel = path.relative(root, full)
      const relPosix = rel.split(path.sep).join("/")
      out.push({
        abs: full,
        zipName: `kord-db/${relPosix}`,
      })
    }
  }
  await walk(root)
  return out
}

/**
 * @param {() => { accounts: { id: string; name: string }[]; lockedByEnv: boolean; defaultAccountId: string }} getAccountsSnapshot
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
  const libRoot = getMusicRoot()
  const manifest = {
    kordBackup: 2,
    createdAt: new Date().toISOString(),
    accounts: accounts.map((a) => ({ id: a.id, name: a.name })),
    lockedByEnv: Boolean(snap.lockedByEnv),
    libraryRoot: libRoot,
  }
  entries.push({
    _body: JSON.stringify(manifest, null, 2),
    zipName: "config/manifest.json",
  })
  const dbFiles = await collectKordDbJsonBackup(libRoot)
  for (const e of dbFiles) entries.push(e)
  for (const acc of accounts) {
    const leg = getUserStateFilePathInConfigDir(acc.id)
    if (leg && existsSync(leg)) {
      entries.push({ abs: leg, zipName: `user-state/legacy-config/${acc.id}/user-state.v1.json` })
    }
    const kordLegacy = path.join(libRoot, ".kord", "user-state.v1.json")
    const wppLegacy = path.join(libRoot, ".wpp", "user-state.v1.json")
    if (existsSync(kordLegacy)) {
      entries.push({
        abs: kordLegacy,
        zipName: `user-state/legacy-in-library/.kord-user-state.v1.json`,
      })
    }
    if (existsSync(wppLegacy)) {
      entries.push({
        abs: wppLegacy,
        zipName: `user-state/legacy-in-library/.wpp-user-state.v1.json`,
      })
    }
  }
  const lib = await collectLibraryMetadataForBackup(libRoot, "shared")
  for (const e of lib) entries.push(e)
  return entries
}

/**
 * @param {import("express").Response} res
 * @param {() => { accounts: { id: string; name: string }[]; lockedByEnv: boolean; defaultAccountId: string }} getAccountsSnapshot
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

/** @param {string} stagingRoot resolved abs */
/** @returns {boolean} */
function safeZipEntryPath(stagingRoot, rawPathName) {
  const rel = String(rawPathName || "").replace(/\\/g, "/").replace(/^\/+/, "")
  if (!rel || rel.startsWith("../") || rel.includes("/../")) return false
  for (const seg of rel.split("/")) {
    if (seg === "..") return false
  }
  const target = path.resolve(path.join(stagingRoot, ...rel.split("/")))
  const base = path.resolve(stagingRoot) + path.sep
  return target === path.resolve(stagingRoot) || target.startsWith(base)
}

async function unzipFileToStaging(zipPath, stagingRoot) {
  const directory = await unzipper.Open.file(zipPath)
  const files = directory.files || []
  for (const f of files) {
    if (f.type === "Directory") continue
    const zipName = f.path.replace(/\\/g, "/").replace(/^\/+/, "")
    if (!safeZipEntryPath(stagingRoot, zipName)) continue
    const dest = path.resolve(path.join(stagingRoot, ...zipName.split("/")))
    await fs.mkdir(path.dirname(dest), { recursive: true })
    if (typeof f.stream === "function") {
      try {
        await pipeline(f.stream(), createWriteStream(dest))
      } catch {
        const buf = await f.buffer()
        await fs.writeFile(dest, buf)
      }
    } else {
      const buf = await f.buffer()
      await fs.writeFile(dest, buf)
    }
  }
}

async function readStagedMaybe(stagingRoot, relPosix) {
  const rel = String(relPosix || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
  if (!rel || rel.split("/").includes("..")) return null
  const full = path.join(stagingRoot, ...rel.split("/"))
  const base = path.resolve(stagingRoot) + path.sep
  const rf = path.resolve(full)
  if (rf !== path.resolve(stagingRoot) && !rf.startsWith(base)) return null
  try {
    return await fs.readFile(rf)
  } catch {
    return null
  }
}

/**
 * Ripristina da file ZIP sul disco (`unzipper.Open.file` senza caricare tutto il buffer centrale nell’implementazione unzip).
 * Usa una directory staging in temp prima di applicare modifiche alla config.
 *
 * `restoreKordFromZipBuffer` scrive prima su file temporaneo e delega qui.
 */
export async function restoreKordFromZipPath(zipPath) {
  if (isMusicRootFromEnv()) {
    const e = new Error(
      "Restore is not available when MUSIC_ROOT is set in the environment",
    )
    e.code = "ENV_LOCKED"
    throw e
  }

  let stagingRoot = ""
  try {
    stagingRoot = await fs.mkdtemp(path.join(os.tmpdir(), "kord-restore-stage-"))
    await unzipFileToStaging(zipPath, stagingRoot)

    const manBuf = await readStagedMaybe(stagingRoot, "config/manifest.json")
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
    const backupVer = manifest.kordBackup
    if (backupVer !== 1 && backupVer !== 2) {
      const e = new Error("Not a Kord backup archive")
      e.code = "BAD_BACKUP"
      throw e
    }

    const cfgBuf = await readStagedMaybe(stagingRoot, "config/music-root.config.json")
    if (!cfgBuf) {
      const e = new Error("Missing config/music-root.config.json in archive")
      e.code = "BAD_BACKUP"
      throw e
    }

    await fs.mkdir(path.dirname(CONFIG_FILE), { recursive: true })
    try {
      if (existsSync(CONFIG_FILE)) {
        const bakTarget = `${CONFIG_FILE}.pre-restore.${Date.now()}.bak`
        await fs.copyFile(CONFIG_FILE, bakTarget)
      }
      await fs.writeFile(CONFIG_FILE, cfgBuf)
    } catch (err) {
      console.error("[kord-backup-restore]", err)
      throw err
    }
    reloadConfigFromDisk()

    const actBuf = await readStagedMaybe(stagingRoot, "config/kord-activity.log.jsonl")
    if (actBuf) {
      const p = getActivityLogFilePath()
      await fs.mkdir(path.dirname(p), { recursive: true })
      await fs.writeFile(p, actBuf, "utf8")
    }
    const snap = getAccountsSnapshot()
    const lr = getMusicRoot()

    async function stagedEntriesKv() {
      const out = []
      async function walk(relUnix, abs) {
        const list = await fs.readdir(abs, { withFileTypes: true }).catch(() => [])
        for (const ent of list) {
          const name = ent.name
          const rp = relUnix ? `${relUnix}/${name}` : name
          const ap = path.join(abs, name)
          if (ent.isDirectory()) {
            await walk(rp, ap)
          } else {
            out.push([rp.replace(/\\/g, "/"), ap])
          }
        }
      }
      await walk("", stagingRoot)
      return out
    }

    if (backupVer === 2) {
      const all = await stagedEntriesKv()
      for (const [relUnix] of all) {
        if (!relUnix.startsWith("kord-db/")) continue
        const restPath = relUnix.slice("kord-db/".length)
        const buf = await readStagedMaybe(stagingRoot, relUnix)
        if (!buf) continue
        const dest = path.join(lr, ".kord", restPath.split("/").join(path.sep))
        const kordRoot = path.join(lr, ".kord")
        if (!underMusicRoot(dest, kordRoot)) continue
        await fs.mkdir(path.dirname(dest), { recursive: true })
        await fs.writeFile(dest, buf, "utf8")
      }
    }

    for (const acc of snap.accounts) {
      const usPrimary = await readStagedMaybe(stagingRoot, `user-state/accounts/${acc.id}/user-state.v1.json`)
      const buf = usPrimary || (await readStagedMaybe(stagingRoot, `user-state/legacy-config/${acc.id}/user-state.v1.json`))
      if (buf?.length) {
        const dest = getUserStateFilePathForAccount(lr, acc.id)
        if (dest) {
          await fs.mkdir(path.dirname(dest), { recursive: true })
          await fs.writeFile(dest, buf, "utf8")
        }
        const leg = getUserStateFilePathInConfigDir(acc.id)
        if (leg) {
          await fs.mkdir(path.dirname(leg), { recursive: true })
          await fs.writeFile(leg, buf, "utf8")
        }
      }
      const mr = getMusicRootForAccountStrict(acc.id)
      const kordL =
        (await readStagedMaybe(stagingRoot, `user-state/legacy-in-library/${acc.id}/.kord-user-state.v1.json`)) ||
        (await readStagedMaybe(stagingRoot, "user-state/legacy-in-library/.kord-user-state.v1.json"))
      const wppL =
        (await readStagedMaybe(stagingRoot, `user-state/legacy-in-library/${acc.id}/.wpp-user-state.v1.json`)) ||
        (await readStagedMaybe(stagingRoot, "user-state/legacy-in-library/.wpp-user-state.v1.json"))
      if (kordL?.length) {
        const dest = path.join(mr, ".kord", "user-state.v1.json")
        await fs.mkdir(path.dirname(dest), { recursive: true })
        await fs.writeFile(dest, kordL, "utf8")
      }
      if (wppL?.length) {
        const dest = path.join(mr, ".wpp", "user-state.v1.json")
        await fs.mkdir(path.dirname(dest), { recursive: true })
        await fs.writeFile(dest, wppL, "utf8")
      }
    }

    async function stagedLibraryMetadata() {
      const all = await stagedEntriesKv()
      for (const [relUnix] of all) {
        if (!relUnix.startsWith("libraries/")) continue
        const rest = relUnix.slice("libraries/".length)
        const slash = rest.indexOf("/")
        if (slash < 0) continue
        const accountId = rest.slice(0, slash)
        const rel = rest.slice(slash + 1)
        if (backupVer === 1 && !findAccountById(accountId)) continue
        const base = path.basename(rel)
        if (!METADATA_BASENAMES.has(base)) continue
        const musicRoot = backupVer === 2 ? lr : getMusicRootForAccountStrict(accountId)
        const full = path.join(musicRoot, rel.split("/").join(path.sep))
        if (!underMusicRoot(full, musicRoot)) continue
        const buf = await readStagedMaybe(stagingRoot, relUnix)
        if (!buf) continue
        await fs.mkdir(path.dirname(full), { recursive: true })
        await fs.writeFile(full, buf, "utf8")
      }
    }
    await stagedLibraryMetadata()

    return { restored: true, accountCount: snap.accounts.length }
  } finally {
    if (stagingRoot) {
      await fs.rm(stagingRoot, { recursive: true, force: true }).catch(() => {})
    }
  }
}

/**
 * @param {Buffer} buffer upload completo in RAM (limit multer nel server).
 */
export async function restoreKordFromZipBuffer(buffer) {
  if (isMusicRootFromEnv()) {
    const e = new Error(
      "Restore is not available when MUSIC_ROOT is set in the environment",
    )
    e.code = "ENV_LOCKED"
    throw e
  }
  const tmpZip = path.join(os.tmpdir(), `kord-restore-upload-${randomUUID()}.zip`)
  await fs.writeFile(tmpZip, buffer)
  try {
    return await restoreKordFromZipPath(tmpZip)
  } finally {
    await fs.unlink(tmpZip).catch(() => {})
  }
}
