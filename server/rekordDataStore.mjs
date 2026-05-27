import fs from "fs"
import fsp from "fs/promises"
import path from "path"

export const REKORD_SCHEMA_VERSION = 2

/** Cartella dati in libreria (nome storico invariato). */
export const KORD_DATA_DIR = ".kord"

export function safeRekordAccountId(accountId) {
  const id = String(accountId || "").trim()
  if (!id) return null
  return id.replace(/[^a-zA-Z0-9._-]/g, "_")
}

export function rekordBaseDir(libraryRoot) {
  return path.join(libraryRoot, KORD_DATA_DIR)
}

/** Se una build precedente aveva creato `.rekord`, riporta i dati su `.kord`. */
export async function ensureKordDataDirOnDisk(libraryRoot) {
  const root = path.resolve(String(libraryRoot || ""))
  if (!root) return
  const kord = rekordBaseDir(root)
  const mistaken = path.join(root, ".rekord")
  if (fs.existsSync(kord) || !fs.existsSync(mistaken)) return
  try {
    await fsp.rename(mistaken, kord)
  } catch {
    /* ignore */
  }
}

export function rekordGlobalInfoDir(libraryRoot) {
  return path.join(rekordBaseDir(libraryRoot), "global_info")
}

export function rekordGlobalAccountsPath(libraryRoot) {
  return path.join(rekordGlobalInfoDir(libraryRoot), "accounts.json")
}

export function rekordSchemaPath(libraryRoot) {
  return path.join(rekordBaseDir(libraryRoot), "schema-version.json")
}

export function rekordConfigPath(libraryRoot) {
  return path.join(rekordGlobalInfoDir(libraryRoot), "config.json")
}

export function rekordAccountDir(libraryRoot, accountId) {
  const id = safeRekordAccountId(accountId)
  if (!id) return null
  return path.join(rekordBaseDir(libraryRoot), `${id}_info`)
}

export function rekordAccountProfilePath(libraryRoot, accountId) {
  const d = rekordAccountDir(libraryRoot, accountId)
  return d ? path.join(d, "profile.json") : null
}

export function rekordAccountUserStatePath(libraryRoot, accountId) {
  const d = rekordAccountDir(libraryRoot, accountId)
  return d ? path.join(d, "user-state.json") : null
}

export function rekordAccountLibrarySelectionPath(libraryRoot, accountId) {
  const d = rekordAccountDir(libraryRoot, accountId)
  return d ? path.join(d, "library-selection.json") : null
}

export async function readJsonFile(fp) {
  try {
    const raw = await fsp.readFile(fp, "utf8")
    const v = JSON.parse(raw)
    return v !== null && typeof v === "object" ? v : null
  } catch {
    return null
  }
}

const writeChains = new Map()

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isRetryableAtomicWriteError(error) {
  const code = String(error?.code || "")
  return code === "EPERM" || code === "EBUSY" || code === "ENOTEMPTY" || code === "EACCES"
}

async function cleanupTmpFile(tmp) {
  try {
    await fsp.unlink(tmp)
  } catch {
    /* ignore */
  }
}

/**
 * Scrittura atomica e serializzata per target: file temp nella stessa directory poi rename.
 */
export async function atomicWriteFileUtf8(targetPath, contents) {
  const key = path.resolve(targetPath)
  const prev = writeChains.get(key) ?? Promise.resolve()
  const next = prev
    .catch(() => {})
    .then(async () => {
      const dir = path.dirname(targetPath)
      await fsp.mkdir(dir, { recursive: true })
      const base = path.basename(targetPath)
      let lastError
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const tmp = path.join(
          dir,
          `.${base}.${process.pid}.${Date.now()}.${attempt}.tmp`,
        )
        try {
          await fsp.writeFile(tmp, contents, "utf8")
          await fsp.rename(tmp, targetPath)
          return
        } catch (error) {
          lastError = error
          await cleanupTmpFile(tmp)
          if (!isRetryableAtomicWriteError(error) || attempt === 7) break
          await sleep(35 + attempt * 55)
        }
      }
      const msg = lastError?.message || String(lastError || "unknown error")
      const err = new Error(`Failed to persist JSON file ${targetPath}: ${msg}`)
      err.code = lastError?.code
      err.cause = lastError
      throw err
    })
  writeChains.set(key, next)
  try {
    return await next
  } finally {
    if (writeChains.get(key) === next) writeChains.delete(key)
  }
}

export async function ensureRekordSchemaFile(libraryRoot) {
  await ensureKordDataDirOnDisk(libraryRoot)
  const p = rekordSchemaPath(libraryRoot)
  if (fs.existsSync(p)) return
  await atomicWriteFileUtf8(
    p,
    JSON.stringify({ version: REKORD_SCHEMA_VERSION, updatedAt: new Date().toISOString() }, null, 2),
  )
}

export async function writeRekordConfigJson(libraryRoot, data) {
  const p = rekordConfigPath(libraryRoot)
  await atomicWriteFileUtf8(p, JSON.stringify(data, null, 2))
}
