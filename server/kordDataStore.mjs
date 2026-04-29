import fs from "fs"
import fsp from "fs/promises"
import path from "path"

export const KORD_SCHEMA_VERSION = 2

export function safeKordAccountId(accountId) {
  const id = String(accountId || "").trim()
  if (!id) return null
  return id.replace(/[^a-zA-Z0-9._-]/g, "_")
}

export function kordBaseDir(libraryRoot) {
  return path.join(libraryRoot, ".kord")
}

export function kordGlobalInfoDir(libraryRoot) {
  return path.join(kordBaseDir(libraryRoot), "global_info")
}

export function kordGlobalAccountsPath(libraryRoot) {
  return path.join(kordGlobalInfoDir(libraryRoot), "accounts.json")
}

export function kordSchemaPath(libraryRoot) {
  return path.join(kordBaseDir(libraryRoot), "schema-version.json")
}

export function kordConfigPath(libraryRoot) {
  return path.join(kordGlobalInfoDir(libraryRoot), "config.json")
}

export function kordAccountDir(libraryRoot, accountId) {
  const id = safeKordAccountId(accountId)
  if (!id) return null
  return path.join(kordBaseDir(libraryRoot), `${id}_info`)
}

export function kordAccountProfilePath(libraryRoot, accountId) {
  const d = kordAccountDir(libraryRoot, accountId)
  return d ? path.join(d, "profile.json") : null
}

export function kordAccountUserStatePath(libraryRoot, accountId) {
  const d = kordAccountDir(libraryRoot, accountId)
  return d ? path.join(d, "user-state.json") : null
}

export function kordAccountLibrarySelectionPath(libraryRoot, accountId) {
  const d = kordAccountDir(libraryRoot, accountId)
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

/**
 * Scrittura atomica: file temp nella stessa directory poi rename.
 */
export async function atomicWriteFileUtf8(targetPath, contents) {
  const dir = path.dirname(targetPath)
  await fsp.mkdir(dir, { recursive: true })
  const base = path.basename(targetPath)
  const tmp = path.join(dir, `.${base}.${process.pid}.${Date.now()}.tmp`)
  await fsp.writeFile(tmp, contents, "utf8")
  await fsp.rename(tmp, targetPath)
}

export async function ensureKordSchemaFile(libraryRoot) {
  const p = kordSchemaPath(libraryRoot)
  if (fs.existsSync(p)) return
  await atomicWriteFileUtf8(
    p,
    JSON.stringify({ version: KORD_SCHEMA_VERSION, updatedAt: new Date().toISOString() }, null, 2),
  )
}

export async function writeKordConfigJson(libraryRoot, data) {
  const p = kordConfigPath(libraryRoot)
  await atomicWriteFileUtf8(p, JSON.stringify(data, null, 2))
}
