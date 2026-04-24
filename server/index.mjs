import express from "express"
import cors from "cors"
import path from "path"
import fs from "fs/promises"
import { existsSync, statSync } from "fs"
import { spawn } from "child_process"
import { fileURLToPath } from "url"
import { aggregateArtworkSearch } from "./artworkSearch.mjs"
import {
  getConfigSnapshot,
  getMusicRoot,
  setPersistedMusicRoot,
} from "./musicRootConfig.mjs"
import {
  fetchReleaseMetadata,
  fetchTrackMetadata,
  prepareTrackTitleForMeta,
  sanitizeTrackTitlesFullLibrary,
  sanitizeTrackTitlesInAlbumDir,
} from "./albumInfo.mjs"
import {
  buildDashboard,
  buildLibraryIndex,
  coverCandidates,
  isAudioFile,
  toLegacyLibrary,
} from "./musicLibrary.mjs"
import { defaultUserState, readUserState, writeUserState } from "./userState.mjs"

const PORT = Number(process.env.PORT) || 3001
const YTDLP_BIN = process.env.YTDLP_PATH || "yt-dlp"
const YTDLP_OUT_TMPL =
  "%(album_artist)s/%(album)s/%(playlist_index)s - %(title)s.%(ext)s"
const YTDLP_ARGS_BASE = [
  "-x",
  "--audio-format",
  "flac",
  "--embed-thumbnail",
  "--add-metadata",
  "-o",
  YTDLP_OUT_TMPL,
]
const YTDLP_CMD_DISPLAY = `yt-dlp ${YTDLP_ARGS_BASE.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" ")}`

const app = express()
app.use(cors())
app.use(express.json({ limit: "2mb" }))

function sendOk(res, data, status = 200) {
  return res.status(status).json({ ok: true, data, error: null })
}

function sendError(res, status, error, details = null) {
  return res.status(status).json({ ok: false, data: null, error, ...(details ? { details } : {}) })
}

function underRoot(full) {
  const root = path.resolve(getMusicRoot())
  const resolved = path.resolve(full)
  return resolved === root || resolved.startsWith(root + path.sep)
}

const RESERVED_MUSIC_DIR_NAMES = new Set(["kord"])

function hasReservedPathSegment(p) {
  for (const seg of String(p || "").replace(/\\/g, "/").split("/")) {
    if (!seg) continue
    if (RESERVED_MUSIC_DIR_NAMES.has(seg.toLowerCase())) return true
  }
  return false
}

function safeRelSeg(value) {
  if (value == null) return null
  const normalized = String(value).replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "")
  for (const seg of normalized.split("/")) {
    if (seg === "..") return null
    if (RESERVED_MUSIC_DIR_NAMES.has(seg.toLowerCase())) return null
  }
  return normalized
}

function stripAnsi(value) {
  return String(value || "").replace(/\x1b\[[0-9;]*m/g, "")
}

async function getLibraryIndex() {
  const root = getMusicRoot()
  if (!existsSync(root) || !underRoot(root)) {
    throw new Error("Music library folder is not available")
  }
  return buildLibraryIndex(root)
}

function albumFolderFromRelPath(relPath) {
  const parts = String(relPath || "").split("/").filter(Boolean)
  if (parts.length < 2) return null
  return parts.slice(0, -1).join("/")
}

app.use("/media", (req, res, next) => {
  const reqPath = req.path || ""
  if (reqPath.includes("..") || hasReservedPathSegment(reqPath)) return res.status(404).end()
  next()
})

app.use(
  "/media",
  (req, res, next) => {
    express
      .static(getMusicRoot(), {
        index: false,
        setHeaders: (res, filePath) => {
          if (filePath.endsWith(".flac")) res.setHeader("Content-Type", "audio/flac")
        },
      })(req, res, next)
  },
)

app.get("/api/health", async (_req, res) => {
  try {
    const root = getMusicRoot()
    const state = await readUserState(root)
    return sendOk(res, {
      musicRoot: root,
      exists: existsSync(root),
      userStateVersion: state.version,
    })
  } catch (error) {
    return sendError(res, 500, String(error?.message || error))
  }
})

app.get("/api/config", (_req, res) => {
  return sendOk(res, getConfigSnapshot())
})

app.put("/api/config", async (req, res) => {
  try {
    const next = String(req.body?.musicRoot ?? "").trim()
    if (!next) return sendError(res, 400, "Provide the absolute path to your music folder")
    await setPersistedMusicRoot(next)
    return sendOk(res, getConfigSnapshot())
  } catch (error) {
    if (error?.code === "ENV_LOCKED") return sendError(res, 403, error.message)
    return sendError(res, 400, String(error?.message || error))
  }
})

app.get("/api/library", async (_req, res) => {
  try {
    const index = await getLibraryIndex()
    return res.json(toLegacyLibrary(index))
  } catch (error) {
    console.error(error)
    return sendError(res, 500, String(error?.message || error))
  }
})

app.get("/api/library-index", async (_req, res) => {
  try {
    const index = await getLibraryIndex()
    return sendOk(res, index)
  } catch (error) {
    console.error(error)
    return sendError(res, 500, String(error?.message || error))
  }
})

app.get("/api/dashboard", async (_req, res) => {
  try {
    const [index, state] = await Promise.all([getLibraryIndex(), readUserState(getMusicRoot())])
    return sendOk(res, buildDashboard(index, state))
  } catch (error) {
    console.error(error)
    return sendError(res, 500, String(error?.message || error))
  }
})

app.get("/api/user-state", async (_req, res) => {
  try {
    const state = await readUserState(getMusicRoot())
    return sendOk(res, state)
  } catch (error) {
    return sendError(res, 500, String(error?.message || error))
  }
})

app.put("/api/user-state", async (req, res) => {
  try {
    const payload = req.body?.state ?? req.body ?? defaultUserState()
    const state = await writeUserState(getMusicRoot(), payload)
    return sendOk(res, state)
  } catch (error) {
    console.error(error)
    return sendError(res, 500, String(error?.message || error))
  }
})

app.get("/api/cover", (req, res) => {
  const relPath = String(req.query.path || "")
  if (!relPath || relPath.includes("..") || hasReservedPathSegment(relPath)) {
    return res.status(400).end()
  }
  const filePath = path.join(getMusicRoot(), relPath.replaceAll("/", path.sep))
  if (!underRoot(filePath) || !existsSync(filePath)) return res.status(404).end()
  const dir = statSync(filePath).isDirectory() ? filePath : path.dirname(filePath)
  for (const name of coverCandidates()) {
    const full = path.join(dir, name)
    if (existsSync(full) && underRoot(full)) return res.sendFile(full)
  }
  return res.status(404).end()
})

app.get("/api/track-stat", (req, res) => {
  const relPath = safeRelSeg(String(req.query.path || ""))
  if (!relPath) return sendError(res, 400, "Missing path parameter")
  const filePath = path.join(getMusicRoot(), relPath.replaceAll("/", path.sep))
  if (!underRoot(filePath) || !existsSync(filePath)) return sendError(res, 404, "File not found")
  try {
    const st = statSync(filePath)
    return sendOk(res, { size: st.size, mtime: st.mtimeMs })
  } catch (error) {
    return sendError(res, 500, String(error?.message || error))
  }
})

app.get("/api/download-preset", async (_req, res) => {
  try {
    return sendOk(res, {
      found: true,
      file: null,
      text: YTDLP_CMD_DISPLAY,
      program: YTDLP_BIN,
      args: [...YTDLP_ARGS_BASE],
      exampleUrl: null,
    })
  } catch (error) {
    return sendError(res, 500, String(error?.message || error))
  }
})

app.post("/api/download", async (req, res) => {
  if (process.env.ENABLE_YTDLP === "0") return sendError(res, 403, "Download disabled (ENABLE_YTDLP=0)")
  const url = String(req.body?.url || "").trim()
  if (!/^https?:\/\//i.test(url)) return sendError(res, 400, "Provide a valid http(s) URL")
  try {
    const root = getMusicRoot()
    const program = YTDLP_BIN
    const args = [...YTDLP_ARGS_BASE]
    const outputDir = safeRelSeg(String(req.body?.outputDir || ""))
    if (outputDir != null && outputDir.length > 0) {
      const oi = args.findIndex((arg) => arg === "-o" || arg === "--output")
      if (oi >= 0 && args[oi + 1] != null) {
        const prefix = outputDir.replace(/\\/g, "/").replace(/\/+$/, "")
        args[oi + 1] = `${prefix}/${String(args[oi + 1]).replace(/^\//, "")}`
      }
    }
    args.push(url)
    const result = { stdout: "", stderr: "", code: -1 }
    const child = spawn(program, args, {
      cwd: root,
      env: { ...process.env, FORCE_COLOR: "0" },
    })
    let responded = false
    const finish = (fn) => {
      if (responded) return
      responded = true
      fn()
    }
    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", (chunk) => {
      result.stdout += chunk
    })
    child.stderr.on("data", (chunk) => {
      result.stderr += chunk
    })
    child.on("close", (code) => {
      result.code = code ?? -1
      const combined = stripAnsi(`${result.stdout}\n${result.stderr}`)
      const progressRows = [...combined.matchAll(/Downloading item\s+(\d+)\s+of\s+(\d+)/gi)]
      const last = progressRows.length ? progressRows[progressRows.length - 1] : null
      const progress = last ? { current: Number(last[1]), total: Number(last[2]) } : null
      finish(() =>
        res.json({
          ok: result.code === 0,
          stdout: result.stdout,
          stderr: result.stderr,
          code: result.code,
          progress,
          musicRoot: root,
          command: `${program} ${args.map((arg) => (/\s/.test(arg) ? `"${arg}"` : arg)).join(" ")}`,
        }),
      )
    })
    child.on("error", (error) => {
      result.code = -1
      result.stderr += `\n${error.message}`
      finish(() =>
        res.status(500).json({
          ok: false,
          stdout: result.stdout,
          stderr: result.stderr,
          code: result.code,
          error: error.message,
          musicRoot: root,
          command: `${program} ${args.map((arg) => (/\s/.test(arg) ? `"${arg}"` : arg)).join(" ")}`,
        }),
      )
    })
  } catch (error) {
    return sendError(res, 500, String(error?.message || error))
  }
})

app.get("/api/fs/list", async (req, res) => {
  const relPath = safeRelSeg(String(req.query.path || ""))
  if (relPath == null) return sendError(res, 400, "Invalid path")
  try {
    const full = path.join(getMusicRoot(), relPath.replaceAll("/", path.sep))
    if (!underRoot(full) || !existsSync(full))
      return sendError(res, 400, "Path is outside the library or does not exist")
    const st = statSync(full)
    if (!st.isDirectory()) return sendError(res, 400, "Not a directory")
    const entries = await fs.readdir(full, { withFileTypes: true })
    const dirs = entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .filter((entry) => entry.name !== "kord" && entry.name !== "node_modules")
      .map((entry) => ({
        name: entry.name,
        relPath: relPath ? `${relPath}/${entry.name}` : entry.name,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    return res.json({
      path: relPath,
      parent: relPath.split("/").filter(Boolean).slice(0, -1).join("/") || "",
      dirs,
      musicRoot: getMusicRoot(),
    })
  } catch (error) {
    return sendError(res, 500, String(error?.message || error))
  }
})

app.post("/api/fs/mkdir", async (req, res) => {
  const parentRaw = req.body?.parent
  const parent = safeRelSeg(String(parentRaw == null ? "" : parentRaw))
  if (parent == null && parentRaw != null && String(parentRaw) !== "") {
    return sendError(res, 400, "Invalid parent path")
  }
  const name = String(req.body?.name || "").trim()
  if (name.length < 1 || name.length > 200) return sendError(res, 400, "Name too short or too long")
  if (name.includes("/") || name.includes("..") || name === "kord" || name === "node_modules") {
    return sendError(res, 400, "Invalid name")
  }
  try {
    const relPath = parent ? `${parent}/${name}` : name
    const full = path.join(getMusicRoot(), relPath.replaceAll("/", path.sep))
    if (!underRoot(full)) return sendError(res, 400, "Invalid path")
    if (existsSync(full)) return sendError(res, 400, "Folder already exists")
    await fs.mkdir(full, { recursive: false })
    return res.json({ ok: true, relPath: relPath.replaceAll(path.sep, "/") })
  } catch (error) {
    return sendError(res, 500, String(error?.message || error))
  }
})

app.get("/api/artwork/search", async (req, res) => {
  const q = String(req.query.q || req.query.term || "").trim()
  const artist = String(req.query.artist || "").trim()
  const album = String(req.query.album || "").trim()
  const terms = []
  if (q) terms.push(q)
  else {
    const both = [artist, album].filter(Boolean).join(" ")
    if (both) terms.push(both)
    if (artist) terms.push(artist)
    if (album) terms.push(album)
  }
  const unique = [...new Set(terms.map((term) => term.trim()).filter((term) => term.length > 1))]
  if (!unique.length) return sendOk(res, { results: [] })
  try {
    const results = await aggregateArtworkSearch(unique)
    return sendOk(res, { results })
  } catch (error) {
    return sendError(res, 500, String(error?.message || error))
  }
})

app.post("/api/artwork/apply", async (req, res) => {
  const albumPath = safeRelSeg(String(req.body?.albumPath || ""))
  const imageUrl = String(req.body?.imageUrl || "").trim()
  if (!albumPath) return sendError(res, 400, "albumPath: relative folder (e.g. Artist/Album)")
  if (!/^https?:\/\//i.test(imageUrl))
    return sendError(res, 400, "Provide a valid http(s) image URL")
  try {
    const full = path.join(getMusicRoot(), albumPath.replaceAll("/", path.sep))
    if (!underRoot(full) || !existsSync(full)) return sendError(res, 400, "Folder does not exist")
    if (!statSync(full).isDirectory()) return sendError(res, 400, "Not a directory")
    const response = await fetch(imageUrl, { headers: { "User-Agent": "Kord/2.0" } })
    if (!response.ok) return sendError(res, 400, "Image download failed")
    const type = (response.headers.get("content-type") || "").toLowerCase()
    if (!type.startsWith("image/")) return sendError(res, 400, "URL is not an image")
    const ext = type.includes("png") ? "png" : "jpg"
    const dest = path.join(full, `cover.${ext}`)
    const data = await response.arrayBuffer()
    await fs.writeFile(dest, Buffer.from(data))
    return sendOk(res, { saved: path.basename(dest), albumPath, abs: dest })
  } catch (error) {
    return sendError(res, 500, String(error?.message || error))
  }
})

app.post("/api/album-info/fetch", async (req, res) => {
  const albumPath = safeRelSeg(String(req.body?.albumPath || ""))
  const artist = String(req.body?.artist || "").trim()
  const album = String(req.body?.album || "").trim()
  if (!albumPath) return sendError(res, 400, "albumPath is required")
  try {
    const full = path.join(getMusicRoot(), albumPath.replaceAll("/", path.sep))
    if (!underRoot(full) || !existsSync(full)) return sendError(res, 400, "Folder does not exist")
    if (!statSync(full).isDirectory()) return sendError(res, 400, "Not a directory")
    const meta = await fetchReleaseMetadata(artist, album)
    if (meta.error) return sendError(res, 404, meta.error)
    const payload = { ...meta, fetchedAt: new Date().toISOString() }
    delete payload.error
    await fs.writeFile(path.join(full, "kord-albuminfo.json"), JSON.stringify(payload, null, 2), "utf8")
    return res.json({ ok: true, albumPath, meta: payload })
  } catch (error) {
    return sendError(res, 500, String(error?.message || error))
  }
})

app.post("/api/track-info/fetch", async (req, res) => {
  const relPath = safeRelSeg(String(req.body?.relPath || ""))
  if (!relPath) return sendError(res, 400, "relPath is required")
  try {
    const fullTrackPath = path.join(getMusicRoot(), relPath.replaceAll("/", path.sep))
    if (!underRoot(fullTrackPath) || !existsSync(fullTrackPath) || !isAudioFile(fullTrackPath)) {
      return sendError(res, 404, "Track not found")
    }
    const parts = relPath.split("/").filter(Boolean)
    const fileName = parts[parts.length - 1]
    const artist = parts[0] || ""
    const album = parts.length >= 3 ? parts[1] : ""
    const albumRel = albumFolderFromRelPath(relPath)
    if (!albumRel) return sendError(res, 400, "Invalid track path")
    const albumDir = path.join(getMusicRoot(), albumRel.replaceAll("/", path.sep))
    if (!underRoot(albumDir) || !existsSync(albumDir)) return sendError(res, 404, "Album folder not found")
    const titleRaw = String(fileName)
      .replace(/\.(mp3|flac|m4a|ogg|opus|wav|aac)$/i, "")
      .trim() || fileName
    const title = prepareTrackTitleForMeta(artist, titleRaw) || titleRaw
    const meta = await fetchTrackMetadata(artist, title, album, titleRaw)
    if (meta.error) return sendError(res, 404, meta.error)
    const fp = path.join(albumDir, "kord-trackinfo.json")
    let json = {}
    if (existsSync(fp)) {
      try {
        json = JSON.parse(await fs.readFile(fp, "utf8")) || {}
      } catch {
        json = {}
      }
    }
    json[fileName] = { ...meta, fetchedAt: new Date().toISOString() }
    await fs.writeFile(fp, JSON.stringify(json, null, 2), "utf8")
    return res.json({ ok: true, relPath, meta: json[fileName] })
  } catch (error) {
    return sendError(res, 500, String(error?.message || error))
  }
})

app.post("/api/studio/sanitize-track-titles", async (req, res) => {
  const scope = String(req.body?.scope || "album")
  const dryRun = Boolean(req.body?.dryRun)
  const albumPath = safeRelSeg(String(req.body?.albumPath || ""))
  try {
    const root = getMusicRoot()
    if (scope === "all") {
      const data = await sanitizeTrackTitlesFullLibrary(root, dryRun)
      return sendOk(res, data)
    }
    if (!albumPath) {
      return sendError(res, 400, "albumPath is required for album scope")
    }
    const full = path.join(root, albumPath.replaceAll("/", path.sep))
    if (!underRoot(full) || !existsSync(full) || !statSync(full).isDirectory()) {
      return sendError(res, 400, "Invalid album folder")
    }
    const r = await sanitizeTrackTitlesInAlbumDir(full, dryRun)
    return sendOk(res, { ...r, albumPath })
  } catch (error) {
    return sendError(res, 500, String(error?.message || error))
  }
})

const distPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist")
if (existsSync(path.join(distPath, "index.html"))) {
  app.use(express.static(distPath))
  app.use((req, res, next) => {
    if (req.path.startsWith("/api") || req.path.startsWith("/media")) return next()
    if (req.method !== "GET" && req.method !== "HEAD") return next()
    return res.sendFile(path.join(distPath, "index.html"), (error) => {
      if (error) res.status(500).end()
    })
  })
}

app.use((error, _req, res, _next) => {
  console.error(error)
  return sendError(res, 500, "Internal server error")
})

const httpServer = app.listen(PORT, "127.0.0.1", () => {
  console.log(`[music-server] http://127.0.0.1:${PORT} -> ${getMusicRoot()}`)
})
httpServer.on("error", (err) => {
  console.error("[music-server] listen", err)
  process.exit(1)
})
