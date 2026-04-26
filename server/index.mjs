import express from "express"
import cors from "cors"
import path from "path"
import fs from "fs/promises"
import { existsSync, statSync } from "fs"
import { spawn } from "child_process"
import { fileURLToPath } from "url"
import { aggregateArtworkSearch } from "./artworkSearch.mjs"
import {
  createAccount,
  deleteAccount,
  getAccountsSnapshot,
  getConfigSnapshot,
  getDefaultAccountId,
  getListenHost,
  getMusicRoot,
  getMusicRootForAccount,
  findAccountById,
  getMusicRootForAccountStrict,
  setListenOnLan,
  setPersistedMusicRoot,
  updateAccount,
} from "./musicRootConfig.mjs"
import { linkSharedAlbumForAccounts } from "./libraryLink.mjs"
import {
  fetchReleaseMetadata,
  fetchTrackMetadata,
  prepareTrackTitleForMeta,
  saveAlbumManualMeta,
  sanitizeTrackTitlesFullLibrary,
  sanitizeTrackTitlesInAlbumDir,
  saveTrackManualMeta,
} from "./albumInfo.mjs"
import {
  buildDashboard,
  buildLibraryIndex,
  coverCandidates,
  isAudioFile,
  toLegacyLibrary,
} from "./musicLibrary.mjs"
import { defaultUserState, readUserState, writeUserState } from "./userState.mjs"
import { resolveYtdlpPath } from "./ytdlpPath.mjs"

const PORT = Number(process.env.PORT) || 3001
const YTDLP_ARGS_LOSSLESS = [
  "-x",
  "--audio-format",
  "flac",
  "--embed-thumbnail",
  "--add-metadata",
]
const YTDLP_ARGS_NATIVE = [
  "-f",
  "bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio",
  "--add-metadata",
]
function ytdlpArgsBase() {
  return process.env.KORD_YTDLP_LOSSLESS === "1" ? YTDLP_ARGS_LOSSLESS : YTDLP_ARGS_NATIVE
}

function isProbablyPlaylistUrl(url) {
  try {
    const u = new URL(url)
    const list = u.searchParams.get("list")
    if (list && list !== "" && list.toUpperCase() !== "WL") return true
    if (/\/playlist(\/|$|\?)/i.test(u.pathname)) return true
    return false
  } catch {
    return false
  }
}

const YTDLP_NAME = "%(track,title)s"

function ytdlpOutputTemplate(url) {
  try {
    const u = new URL(url)
    const host = u.hostname.replace(/^www\./, "")
    if (host.endsWith("bandcamp.com")) {
      return `%(album)s/%(autonumber)02d - ${YTDLP_NAME}.%(ext)s`
    }
    const pl = isProbablyPlaylistUrl(url)
    if (host.includes("music.youtube.com")) {
      if (pl) {
        return `%(playlist_title)s/%(autonumber)02d - ${YTDLP_NAME}.%(ext)s`
      }
      return `%(album)s/%(autonumber)02d - ${YTDLP_NAME}.%(ext)s`
    }
    if (pl) {
      return `%(playlist_title)s/%(autonumber)02d - ${YTDLP_NAME}.%(ext)s`
    }
  } catch {
    /* ignore */
  }
  return `%(title)s/%(autonumber)02d - ${YTDLP_NAME}.%(ext)s`
}

function ytdlpCmdDisplay() {
  const bin = resolveYtdlpPath()
  const base = ytdlpArgsBase()
  const note =
    process.env.KORD_YTDLP_LOSSLESS === "1"
      ? " (FLAC, richiede ffmpeg)"
      : " (audio nativo, senza ffmpeg)"
  return `${bin} ${[...base, "-o", `%(folder)s/%(autonumber)02d - ${YTDLP_NAME}.%(ext)s`]
    .map((a) => (/\s/.test(a) ? `"${a}"` : a))
    .join(" ")} + URL${note} — folder = …, nome file = track|title`
}

const app = express()
app.use(cors())
app.use(express.json({ limit: "2mb" }))

function sendOk(res, data, status = 200) {
  return res.status(status).json({ ok: true, data, error: null })
}

function sendError(res, status, error, details = null) {
  return res.status(status).json({ ok: false, data: null, error, ...(details ? { details } : {}) })
}

function accountIdFromReq(req) {
  return (
    String(req.query?.accountId || "").trim() ||
    String(req.headers["x-kord-account-id"] || "").trim() ||
    getDefaultAccountId()
  )
}

function musicRootFromReq(req) {
  return getMusicRootForAccount(accountIdFromReq(req))
}

function underRoot(full, musicRoot = getMusicRoot()) {
  const root = path.resolve(musicRoot)
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

function extractLastItemProgress(text) {
  const clean = stripAnsi(String(text))
  const rows = [...clean.matchAll(/Downloading item\s+(\d+)\s+of\s+(\d+)/gi)]
  const last = rows.length ? rows[rows.length - 1] : null
  return last ? { current: Number(last[1]), total: Number(last[2]) } : null
}

async function getLibraryIndex(root = getMusicRoot()) {
  if (!existsSync(root) || !underRoot(root, root)) {
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
    const root = musicRootFromReq(req)
    express
      .static(root, {
        index: false,
        setHeaders: (res, filePath) => {
          if (filePath.endsWith(".flac")) res.setHeader("Content-Type", "audio/flac")
          else if (filePath.endsWith(".m4a")) res.setHeader("Content-Type", "audio/mp4")
          else if (filePath.endsWith(".webm")) res.setHeader("Content-Type", "audio/webm")
        },
      })(req, res, next)
  },
)

app.get("/api/health", async (req, res) => {
  try {
    const accountId = accountIdFromReq(req)
    const root = musicRootFromReq(req)
    const state = await readUserState(root, accountId)
    return sendOk(res, {
      musicRoot: root,
      exists: existsSync(root),
      userStateVersion: state.version,
      accountId,
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
    const body = req.body || {}
    let did = false
    if (body.musicRoot != null) {
      const next = String(body.musicRoot).trim()
      if (!next) {
        return sendError(
          res,
          400,
          "Provide the absolute path to your music folder"
        )
      }
      await setPersistedMusicRoot(next)
      did = true
    }
    if (typeof body.listenOnLan === "boolean") {
      await setListenOnLan(body.listenOnLan)
      did = true
    }
    if (!did) {
      return sendError(res, 400, "No valid config fields in request body")
    }
    return sendOk(res, getConfigSnapshot())
  } catch (error) {
    if (error?.code === "ENV_LOCKED") return sendError(res, 403, error.message)
    return sendError(res, 400, String(error?.message || error))
  }
})

app.get("/api/accounts", (_req, res) => {
  return sendOk(res, getAccountsSnapshot())
})

app.post("/api/accounts", async (req, res) => {
  try {
    const body = req.body || {}
    return sendOk(
      res,
      await createAccount({
        name: body.name,
        musicRoot: body.musicRoot,
      }),
      201,
    )
  } catch (error) {
    if (error?.code === "ENV_LOCKED") return sendError(res, 403, error.message)
    return sendError(res, 400, String(error?.message || error))
  }
})

app.put("/api/accounts/:id", async (req, res) => {
  try {
    return sendOk(res, await updateAccount(req.params.id, req.body || {}))
  } catch (error) {
    if (error?.code === "ENV_LOCKED") return sendError(res, 403, error.message)
    if (error?.code === "ACCOUNT_NOT_FOUND") return sendError(res, 404, error.message)
    return sendError(res, 400, String(error?.message || error))
  }
})

app.delete("/api/accounts/:id", async (req, res) => {
  try {
    return sendOk(res, await deleteAccount(req.params.id))
  } catch (error) {
    if (error?.code === "ACCOUNT_NOT_FOUND") return sendError(res, 404, error.message)
    if (error?.code === "LAST_ACCOUNT") return sendError(res, 400, error.message)
    return sendError(res, 400, String(error?.message || error))
  }
})

app.get("/api/library", async (req, res) => {
  try {
    const index = await getLibraryIndex(musicRootFromReq(req))
    return res.json(toLegacyLibrary(index))
  } catch (error) {
    console.error(error)
    return sendError(res, 500, String(error?.message || error))
  }
})

app.get("/api/library-index", async (req, res) => {
  try {
    const index = await getLibraryIndex(musicRootFromReq(req))
    res.set("Cache-Control", "no-store, must-revalidate")
    return sendOk(res, index)
  } catch (error) {
    console.error(error)
    return sendError(res, 500, String(error?.message || error))
  }
})

app.get("/api/accounts/:id/library-index", async (req, res) => {
  try {
    const id = String(req.params.id || "").trim()
    if (!id || !findAccountById(id)) {
      return sendError(res, 404, "Account not found")
    }
    const root = getMusicRootForAccountStrict(id)
    const index = await getLibraryIndex(root)
    res.set("Cache-Control", "no-store, must-revalidate")
    return sendOk(res, index)
  } catch (error) {
    console.error(error)
    if (error?.code === "ACCOUNT_NOT_FOUND") {
      return sendError(res, 404, String(error.message || error))
    }
    return sendError(res, 500, String(error?.message || error))
  }
})

app.get("/api/dashboard", async (req, res) => {
  try {
    const accountId = accountIdFromReq(req)
    const root = musicRootFromReq(req)
    const [index, state] = await Promise.all([
      getLibraryIndex(root),
      readUserState(root, accountId),
    ])
    res.set("Cache-Control", "no-store, must-revalidate")
    return sendOk(res, buildDashboard(index, state))
  } catch (error) {
    console.error(error)
    return sendError(res, 500, String(error?.message || error))
  }
})

app.get("/api/user-state", async (req, res) => {
  try {
    const state = await readUserState(musicRootFromReq(req), accountIdFromReq(req))
    return sendOk(res, state)
  } catch (error) {
    return sendError(res, 500, String(error?.message || error))
  }
})

app.put("/api/user-state", async (req, res) => {
  try {
    const payload = req.body?.state ?? req.body ?? defaultUserState()
    const state = await writeUserState(musicRootFromReq(req), payload, accountIdFromReq(req))
    return sendOk(res, state)
  } catch (error) {
    console.error(error)
    return sendError(res, 500, String(error?.message || error))
  }
})

app.get("/api/cover", (req, res) => {
  const root = musicRootFromReq(req)
  const relPath = String(req.query.path || "")
  if (!relPath || relPath.includes("..") || hasReservedPathSegment(relPath)) {
    return res.status(400).end()
  }
  const filePath = path.join(root, relPath.replaceAll("/", path.sep))
  if (!underRoot(filePath, root) || !existsSync(filePath)) return res.status(404).end()
  const dir = statSync(filePath).isDirectory() ? filePath : path.dirname(filePath)
  for (const name of coverCandidates()) {
    const full = path.join(dir, name)
    if (existsSync(full) && underRoot(full, root)) return res.sendFile(full)
  }
  return res.status(404).end()
})

app.get("/api/track-stat", (req, res) => {
  const root = musicRootFromReq(req)
  const relPath = safeRelSeg(String(req.query.path || ""))
  if (!relPath) return sendError(res, 400, "Missing path parameter")
  const filePath = path.join(root, relPath.replaceAll("/", path.sep))
  if (!underRoot(filePath, root) || !existsSync(filePath)) return sendError(res, 404, "File not found")
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
      text: ytdlpCmdDisplay(),
      program: resolveYtdlpPath(),
      args: [
        ...ytdlpArgsBase(),
        "-o",
        "%(playlist_title)s/%(autonumber)02d - %(title)s.%(ext)s",
      ],
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
    const root = musicRootFromReq(req)
    const program = resolveYtdlpPath()
    const outTmpl = ytdlpOutputTemplate(url)
    const args = [...ytdlpArgsBase(), "-o", outTmpl]
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
    const command = `${program} ${args.map((arg) => (/\s/.test(arg) ? `"${arg}"` : arg)).join(" ")}`
    res.status(200)
    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8")
    res.setHeader("Cache-Control", "no-store")
    let responded = false
    let lastProgressEmitted = null
    const finish = (fn) => {
      if (responded) return
      responded = true
      fn()
    }
    const emitProgressIfNew = () => {
      if (responded) return
      const p = extractLastItemProgress(result.stderr + "\n" + result.stdout)
      if (
        p &&
        (lastProgressEmitted?.current !== p.current ||
          lastProgressEmitted?.total !== p.total)
      ) {
        lastProgressEmitted = p
        res.write(`${JSON.stringify({ type: "progress", progress: p })}\n`)
      }
    }
    const child = spawn(program, args, {
      cwd: root,
      env: { ...process.env, FORCE_COLOR: "0" },
    })
    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", (chunk) => {
      result.stdout += chunk
      emitProgressIfNew()
    })
    child.stderr.on("data", (chunk) => {
      result.stderr += chunk
      emitProgressIfNew()
    })
    child.on("close", (code) => {
      result.code = code ?? -1
      const combined = `${result.stdout}\n${result.stderr}`
      const progress =
        extractLastItemProgress(combined) ?? lastProgressEmitted
      finish(() => {
        res.write(
          `${JSON.stringify({
            type: "done",
            ok: result.code === 0,
            stdout: result.stdout,
            stderr: result.stderr,
            code: result.code,
            progress,
            musicRoot: root,
            command,
          })}\n`,
        )
        res.end()
      })
    })
    child.on("error", (error) => {
      result.code = -1
      result.stderr += `\n${error.message}`
      finish(() => {
        res.write(
          `${JSON.stringify({
            type: "done",
            ok: false,
            stdout: result.stdout,
            stderr: result.stderr,
            code: result.code,
            progress: lastProgressEmitted,
            error: error.message,
            musicRoot: root,
            command,
          })}\n`,
        )
        res.end()
      })
    })
  } catch (error) {
    return sendError(res, 500, String(error?.message || error))
  }
})

app.get("/api/fs/list", async (req, res) => {
  const root = musicRootFromReq(req)
  const relPath = safeRelSeg(String(req.query.path || ""))
  if (relPath == null) return sendError(res, 400, "Invalid path")
  try {
    const full = path.join(root, relPath.replaceAll("/", path.sep))
    if (!underRoot(full, root) || !existsSync(full))
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
      musicRoot: root,
    })
  } catch (error) {
    return sendError(res, 500, String(error?.message || error))
  }
})

app.post("/api/fs/mkdir", async (req, res) => {
  const root = musicRootFromReq(req)
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
    const full = path.join(root, relPath.replaceAll("/", path.sep))
    if (!underRoot(full, root)) return sendError(res, 400, "Invalid path")
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
  const root = musicRootFromReq(req)
  const albumPath = safeRelSeg(String(req.body?.albumPath || ""))
  const imageUrl = String(req.body?.imageUrl || "").trim()
  if (!albumPath) return sendError(res, 400, "albumPath: relative folder (e.g. Artist/Album)")
  if (!/^https?:\/\//i.test(imageUrl))
    return sendError(res, 400, "Provide a valid http(s) image URL")
  try {
    const full = path.join(root, albumPath.replaceAll("/", path.sep))
    if (!underRoot(full, root) || !existsSync(full)) return sendError(res, 400, "Folder does not exist")
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
  const root = musicRootFromReq(req)
  const albumPath = safeRelSeg(String(req.body?.albumPath || ""))
  const artist = String(req.body?.artist || "").trim()
  const album = String(req.body?.album || "").trim()
  if (!albumPath) return sendError(res, 400, "albumPath is required")
  try {
    const full = path.join(root, albumPath.replaceAll("/", path.sep))
    if (!underRoot(full, root) || !existsSync(full)) return sendError(res, 400, "Folder does not exist")
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

app.post("/api/album-info/save", async (req, res) => {
  const root = musicRootFromReq(req)
  const albumPath = safeRelSeg(String(req.body?.albumPath || ""))
  const patch = req.body?.patch
  if (!albumPath) return sendError(res, 400, "albumPath is required")
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    return sendError(res, 400, "patch object is required")
  }
  try {
    const full = path.join(root, albumPath.replaceAll("/", path.sep))
    if (!underRoot(full, root) || !existsSync(full)) return sendError(res, 400, "Folder does not exist")
    if (!statSync(full).isDirectory()) return sendError(res, 400, "Not a directory")
    const allowed = [
      "title",
      "releaseDate",
      "label",
      "country",
      "musicbrainzReleaseId",
    ]
    const safe = {}
    for (const k of allowed) {
      if (Object.prototype.hasOwnProperty.call(patch, k)) safe[k] = patch[k]
    }
    if (!Object.keys(safe).length) return sendError(res, 400, "No valid fields in patch")
    const meta = await saveAlbumManualMeta(full, safe)
    return sendOk(res, { albumPath, meta })
  } catch (error) {
    return sendError(res, 500, String(error?.message || error))
  }
})

app.post("/api/track-info/fetch", async (req, res) => {
  const root = musicRootFromReq(req)
  const relPath = safeRelSeg(String(req.body?.relPath || ""))
  if (!relPath) return sendError(res, 400, "relPath is required")
  try {
    const fullTrackPath = path.join(root, relPath.replaceAll("/", path.sep))
    if (!underRoot(fullTrackPath, root) || !existsSync(fullTrackPath) || !isAudioFile(fullTrackPath)) {
      return sendError(res, 404, "Track not found")
    }
    const parts = relPath.split("/").filter(Boolean)
    const fileName = parts[parts.length - 1]
    const artist = parts[0] || ""
    const album = parts.length >= 3 ? parts[1] : ""
    const albumRel = albumFolderFromRelPath(relPath)
    if (!albumRel) return sendError(res, 400, "Invalid track path")
    const albumDir = path.join(root, albumRel.replaceAll("/", path.sep))
    if (!underRoot(albumDir, root) || !existsSync(albumDir)) return sendError(res, 404, "Album folder not found")
    const titleRaw = String(fileName)
      .replace(/\.(mp3|flac|m4a|ogg|opus|wav|aac|webm)$/i, "")
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

app.post("/api/track-info/save", async (req, res) => {
  const root = musicRootFromReq(req)
  const relPath = safeRelSeg(String(req.body?.relPath || ""))
  const patch = req.body?.patch
  if (!relPath) return sendError(res, 400, "relPath is required")
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    return sendError(res, 400, "patch object is required")
  }
  try {
    const fullTrackPath = path.join(root, relPath.replaceAll("/", path.sep))
    if (!underRoot(fullTrackPath, root) || !existsSync(fullTrackPath) || !isAudioFile(fullTrackPath)) {
      return sendError(res, 404, "Track not found")
    }
    const parts = relPath.split("/").filter(Boolean)
    const fileName = parts[parts.length - 1]
    const albumRel = albumFolderFromRelPath(relPath)
    if (!albumRel) return sendError(res, 400, "Invalid track path")
    const albumDir = path.join(root, albumRel.replaceAll("/", path.sep))
    if (!underRoot(albumDir, root) || !existsSync(albumDir)) return sendError(res, 404, "Album folder not found")
    const allowed = [
      "title",
      "releaseDate",
      "genre",
      "durationMs",
      "trackNumber",
      "discNumber",
      "source",
      "url",
    ]
    const safe = {}
    for (const k of allowed) {
      if (Object.prototype.hasOwnProperty.call(patch, k)) safe[k] = patch[k]
    }
    if (!Object.keys(safe).length) return sendError(res, 400, "No valid fields in patch")
    const meta = await saveTrackManualMeta(albumDir, fileName, safe)
    return res.json({ ok: true, relPath, meta })
  } catch (error) {
    return sendError(res, 500, String(error?.message || error))
  }
})

app.post("/api/studio/link-shared-album", async (req, res) => {
  try {
    const destId = accountIdFromReq(req)
    const data = await linkSharedAlbumForAccounts(req.body || {}, destId)
    return sendOk(res, data)
  } catch (error) {
    const code = error?.code
    if (code === "ACCOUNT_NOT_FOUND") {
      return sendError(res, 404, String(error.message || error))
    }
    if (
      code === "SAME_ROOT" ||
      code === "SAME_ACCOUNT" ||
      code === "INVALID_REL" ||
      code === "NOT_FOUND" ||
      code === "NOT_DIR" ||
      code === "NO_AUDIO" ||
      code === "DEST_EXISTS" ||
      code === "CLASH" ||
      code === "BAD_BODY" ||
      code === "NO_ALBUMS" ||
      code === "ARTIST_NOTHING_LINKED"
    ) {
      return sendError(res, 400, String(error.message || error))
    }
    console.error(error)
    return sendError(res, 500, String(error?.message || error))
  }
})

app.post("/api/studio/sanitize-track-titles", async (req, res) => {
  const scope = String(req.body?.scope || "album")
  const dryRun = Boolean(req.body?.dryRun)
  const albumPath = safeRelSeg(String(req.body?.albumPath || ""))
  try {
    const root = musicRootFromReq(req)
    if (scope === "all") {
      const data = await sanitizeTrackTitlesFullLibrary(root, dryRun)
      return sendOk(res, data)
    }
    if (!albumPath) {
      return sendError(res, 400, "albumPath is required for album scope")
    }
    const full = path.join(root, albumPath.replaceAll("/", path.sep))
    if (!underRoot(full, root) || !existsSync(full) || !statSync(full).isDirectory()) {
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

const LISTEN_HOST = getListenHost()
const httpServer = app.listen(PORT, LISTEN_HOST, () => {
  console.log(
    `[music-server] http://${LISTEN_HOST}:${PORT} -> ${getMusicRoot()}`
  )
})
httpServer.on("error", (err) => {
  console.error("[music-server] listen", err)
  process.exit(1)
})
