import fs from "fs"
import fsp from "fs/promises"
import path from "path"
import {
  atomicWriteFileUtf8,
  ensureKordSchemaFile,
  kordAccountDir,
  kordAccountLibrarySelectionPath,
  kordAccountUserStatePath,
  kordBaseDir,
  kordConfigPath,
  kordGlobalInfoDir,
  readJsonFile,
} from "./kordDataStore.mjs"

const ACTIVITY_LOG_BASENAME = "kord-activity.log.jsonl"

function sameResolved(a, b) {
  try {
    return path.resolve(a) === path.resolve(b)
  } catch {
    return false
  }
}

export async function migrateMoodsFromTrackInfoToUserState(libraryRoot, userStateJsonPath) {
  if (!userStateJsonPath || !fs.existsSync(userStateJsonPath)) return
  const state = await readJsonFile(userStateJsonPath)
  if (!state || typeof state !== "object") return
  if (state.trackMoodsMigrated === true) return

  const trackMoods = state.trackMoods && typeof state.trackMoods === "object" ? { ...state.trackMoods } : {}
  const root = path.resolve(libraryRoot)

  async function scanAlbumDir(albumDir, artistName, albumFolder) {
    const trackFile = path.join(albumDir, "kord-trackinfo.json")
    const wppFile = path.join(albumDir, "wpp-trackinfo.json")
    const tp = fs.existsSync(trackFile) ? trackFile : fs.existsSync(wppFile) ? wppFile : null
    if (!tp) return
    let j = {}
    try {
      j = JSON.parse(await fsp.readFile(tp, "utf8")) || {}
    } catch {
      return
    }
    for (const [fileName, v] of Object.entries(j)) {
      if (!v || typeof v !== "object") continue
      const moods = v.moods || (v.mood ? [v.mood] : [])
      const list = Array.isArray(moods) ? moods.filter((m) => typeof m === "string" && m.trim()) : []
      if (!list.length) continue
      const rel = [artistName, albumFolder, fileName].join("/")
      if (!trackMoods[rel]) trackMoods[rel] = [...new Set(list)]
    }
  }

  try {
    const top = await fsp.readdir(root, { withFileTypes: true })
    for (const e of top) {
      if (!e.isDirectory() || e.name.startsWith(".")) continue
      if (e.name === "node_modules" || e.name === ".kord") continue
      const artistDir = path.join(root, e.name)
      const subs = await fsp.readdir(artistDir, { withFileTypes: true })
      for (const s of subs) {
        if (!s.isDirectory() || s.name.startsWith(".")) continue
        await scanAlbumDir(path.join(artistDir, s.name), e.name, s.name)
      }
    }
  } catch {
    /* ignore */
  }

  if (Object.keys(trackMoods).length) {
    state.trackMoods = trackMoods
  }
  state.trackMoodsMigrated = true
  await atomicWriteFileUtf8(userStateJsonPath, JSON.stringify(state, null, 2))
}

/**
 * Migrazione idempotente verso libraryRoot/.kord/
 * @param {object} opts
 * @param {string} opts.libraryRoot
 * @param {{ id: string; name: string }[]} opts.accounts
 * @param {Record<string, string>} opts.legacyAccountMusicRoots — id → vecchia musicRoot
 * @param {string} opts.configDir — dirname(CONFIG_FILE)
 */
export async function runKordLayoutMigration({
  libraryRoot,
  accounts,
  legacyAccountMusicRoots = {},
  configDir,
}) {
  const root = path.resolve(libraryRoot)
  if (!root) return

  try {
    await fsp.mkdir(root, { recursive: true })
  } catch {
    return
  }

  await ensureKordSchemaFile(root)
  const base = kordBaseDir(root)
  const gInfo = kordGlobalInfoDir(root)
  await fsp.mkdir(gInfo, { recursive: true })

  const legacyAccountsTree = path.join(base, "accounts")
  if (fs.existsSync(legacyAccountsTree)) {
    let subs
    try {
      subs = await fsp.readdir(legacyAccountsTree, { withFileTypes: true })
    } catch {
      subs = []
    }
    for (const s of subs) {
      if (!s.isDirectory()) continue
      const from = path.join(legacyAccountsTree, s.name)
      const dest = kordAccountDir(root, s.name)
      if (!dest) continue
      if (!fs.existsSync(dest)) {
        try {
          await fsp.rename(from, dest)
        } catch {
          /* ignore */
        }
      }
    }
    try {
      await fsp.rm(legacyAccountsTree, { recursive: true })
    } catch {
      /* ignore */
    }
  }

  const oldKordConfig = path.join(base, "config.json")
  const newKordConfig = kordConfigPath(root)
  if (fs.existsSync(oldKordConfig) && !fs.existsSync(newKordConfig)) {
    try {
      await fsp.rename(oldKordConfig, newKordConfig)
    } catch {
      /* ignore */
    }
  }

  const oldActivity = path.join(String(configDir || ""), ACTIVITY_LOG_BASENAME)
  const newActivity = path.join(gInfo, ACTIVITY_LOG_BASENAME)
  if (configDir && fs.existsSync(oldActivity) && !fs.existsSync(newActivity)) {
    try {
      await fsp.copyFile(oldActivity, newActivity)
    } catch {
      /* ignore */
    }
  }

  const roots = new Set(
    Object.values(legacyAccountMusicRoots)
      .filter(Boolean)
      .map((p) => path.resolve(String(p))),
  )
  const singleUniformRoot = roots.size <= 1
  const onlyRoot = roots.size === 1 ? [...roots][0] : null
  const legacyAlignedToLibrary =
    roots.size === 0 || (singleUniformRoot && sameResolved(onlyRoot, root))

  for (const acc of accounts) {
    const id = String(acc?.id || "").trim()
    if (!id) continue
    const accDir = kordAccountDir(root, id)
    if (!accDir) continue
    await fsp.mkdir(accDir, { recursive: true })

    const destState = kordAccountUserStatePath(root, id)
    const oldPerAccount = path.join(configDir, "accounts", id.replace(/[^a-zA-Z0-9._-]/g, "_"), "user-state.v1.json")
    if (destState && !fs.existsSync(destState) && fs.existsSync(oldPerAccount)) {
      try {
        const raw = await fsp.readFile(oldPerAccount, "utf8")
        await atomicWriteFileUtf8(destState, raw)
      } catch {
        /* ignore */
      }
    }

    if (destState && !fs.existsSync(destState)) {
      const legKord = path.join(root, ".kord", "user-state.v1.json")
      const legWpp = path.join(root, ".wpp", "user-state.v1.json")
      const pick = fs.existsSync(legKord) ? legKord : fs.existsSync(legWpp) ? legWpp : null
      if (pick && id === "default") {
        try {
          const raw = await fsp.readFile(pick, "utf8")
          await atomicWriteFileUtf8(destState, raw)
        } catch {
          /* ignore */
        }
      }
    }

    const selPath = kordAccountLibrarySelectionPath(root, id)
    if (!selPath || fs.existsSync(selPath)) continue

    const accLegacyRoot = legacyAccountMusicRoots[id]
    const DEFAULT_ACCOUNT_ID = "default"
    let includeAll = false
    if (id === DEFAULT_ACCOUNT_ID) {
      if (accLegacyRoot == null) includeAll = true
      else includeAll = legacyAlignedToLibrary && sameResolved(path.resolve(String(accLegacyRoot)), root)
    } else {
      includeAll = Boolean(
        accLegacyRoot && legacyAlignedToLibrary && sameResolved(path.resolve(String(accLegacyRoot)), root),
      )
    }

    await atomicWriteFileUtf8(
      selPath,
      JSON.stringify(
        {
          version: 1,
          includeAll,
          artists: [],
          albums: [],
          tracks: [],
        },
        null,
        2,
      ),
    )
  }

  if (!fs.existsSync(newKordConfig)) {
    await atomicWriteFileUtf8(
      newKordConfig,
      JSON.stringify({ version: 1, libraryTag: "kord" }, null, 2),
    )
  }

  for (const acc of accounts) {
    const id = String(acc?.id || "").trim()
    if (!id) continue
    const up = kordAccountUserStatePath(root, id)
    if (up && fs.existsSync(up)) {
      await migrateMoodsFromTrackInfoToUserState(root, up)
    }
  }
}
