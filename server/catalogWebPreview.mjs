import { randomUUID } from "node:crypto"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { browseIdFromMusicBrowsePageUrl } from "./youtubeMusicBrowse.mjs"

const execFileAsync = promisify(execFile)

const YTM_INNERTUBE_KEY = "AIzaSyC9XL3QWnjsQplBUbSJY1cffBoVwD0aN1U"
const YTM_BROWSE_URL = `https://music.youtube.com/youtubei/v1/browse?key=${YTM_INNERTUBE_KEY}`

const PREVIEW_CACHE_TTL_MS = 90_000

/** @type {Map<string, { streamUrl: string, expires: number }>} */
const previewStreamCache = new Map()

function innertubeClientVersion() {
  return String(
    process.env.REKORD_YTM_INNERTUBE_CLIENT_VERSION || "1.20241127.01.00",
  ).trim()
}

function extractRunsText(node) {
  if (!node) return ""
  if (Array.isArray(node.runs)) {
    return node.runs.map((r) => String(r.text ?? "")).join("")
  }
  if (typeof node.simpleText === "string") return node.simpleText
  return ""
}

function walkCollect(node, key, out) {
  if (!node || typeof node !== "object") return
  if (node[key]) out.push(node[key])
  if (Array.isArray(node)) {
    for (const x of node) walkCollect(x, key, out)
    return
  }
  for (const k of Object.keys(node)) walkCollect(node[k], key, out)
}

function parseYtdlpJsonStdout(buf) {
  const s0 = String(buf ?? "").replace(/^\uFEFF/, "")
  const s = s0.trim()
  if (!s) return null
  const tryParse = (x) => {
    try {
      return JSON.parse(x)
    } catch {
      return null
    }
  }
  let o = tryParse(s)
  if (o) return o
  const i = s.indexOf("{")
  if (i < 0) return null
  return tryParse(s.slice(i))
}

function guessYoutubeUrlFromEntryId(id) {
  const s = String(id ?? "").trim()
  if (!s) return ""
  if (/^[a-zA-Z0-9_-]{11}$/.test(s)) {
    return `https://www.youtube.com/watch?v=${encodeURIComponent(s)}`
  }
  if (/^(?:PL|OLAK5uy_|UU|FL|RD|WL|LL|LM)[a-zA-Z0-9_-]+$/.test(s)) {
    return `https://www.youtube.com/playlist?list=${encodeURIComponent(s)}`
  }
  return ""
}

export function normalizeCatalogWebUrl(raw) {
  let s = String(raw ?? "").trim()
  if (!s) return ""
  if (s.startsWith("//")) s = `https:${s}`
  if (!/^https?:\/\//i.test(s)) return ""
  try {
    const u = new URL(s)
    u.searchParams.delete("accountId")
    u.searchParams.delete("r")
    const h = u.hostname.replace(/^www\./, "").toLowerCase()
    if (
      h === "music.youtube.com" ||
      h === "youtube.com" ||
      h === "m.youtube.com" ||
      h === "youtu.be"
    ) {
      return u.toString()
    }
  } catch {
    return ""
  }
  return ""
}

export function isYoutubePlaylistUrl(url) {
  try {
    const u = new URL(url)
    return Boolean(u.searchParams.get("list")?.trim())
  } catch {
    return false
  }
}

export function isWatchSingleUrl(url) {
  try {
    const u = new URL(url)
    if (u.hostname.replace(/^www\./, "").toLowerCase() === "youtu.be") {
      const id = u.pathname.replace(/^\//, "").split("/")[0]
      return Boolean(id)
    }
    if (!u.hostname.includes("youtube")) return false
    if (u.searchParams.get("list")) return false
    return Boolean(u.searchParams.get("v"))
  } catch {
    return false
  }
}

function watchUrlFromEndpoint(ep) {
  const vid = ep?.watchEndpoint?.videoId
  if (!vid) return ""
  return `https://music.youtube.com/watch?v=${encodeURIComponent(String(vid).trim())}`
}

function parseTrackFromResponsiveRenderer(renderer) {
  const title = extractRunsText(
    renderer.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text,
  ).trim()
  const ep =
    renderer.overlay?.musicItemThumbnailOverlayRenderer?.content
      ?.musicPlayButtonRenderer?.playNavigationEndpoint ??
    renderer.navigationEndpoint
  const url = watchUrlFromEndpoint(ep)
  if (!title || !url) return null
  const id = String(ep?.watchEndpoint?.videoId ?? url).trim()
  return { id, title, url }
}

function parseTrackFromPlaylistVideoRenderer(renderer) {
  const title = extractRunsText(renderer.title).trim()
  const vid = String(
    renderer.videoId ??
      renderer.navigationEndpoint?.watchEndpoint?.videoId ??
      "",
  ).trim()
  if (!title || !vid) return null
  return {
    id: vid,
    title,
    url: `https://music.youtube.com/watch?v=${encodeURIComponent(vid)}`,
  }
}

export function playlistIdFromPageUrl(pageUrl) {
  try {
    const u = new URL(String(pageUrl).trim())
    const list = u.searchParams.get("list")
    if (list?.trim()) return list.trim()
  } catch {
    /* ignore */
  }
  return null
}

/** URL canonica per yt-dlp (youtube.com invece di music.youtube.com). */
export function urlForYtdlpFetch(pageUrl) {
  const norm = normalizeCatalogWebUrl(pageUrl)
  if (!norm) return ""
  try {
    const u = new URL(norm)
    const host = u.hostname.replace(/^www\./, "").toLowerCase()
    if (host === "music.youtube.com") {
      const list = u.searchParams.get("list")
      const v = u.searchParams.get("v")
      if (list) {
        return `https://www.youtube.com/playlist?list=${encodeURIComponent(list)}`
      }
      if (v) {
        return `https://www.youtube.com/watch?v=${encodeURIComponent(v)}`
      }
    }
  } catch {
    /* ignore */
  }
  return norm
}

export function parseTracksFromBrowseJson(json) {
  const responsive = []
  const playlistVideos = []
  walkCollect(json, "musicResponsiveListItemRenderer", responsive)
  walkCollect(json, "playlistVideoRenderer", playlistVideos)
  const seen = new Set()
  const tracks = []
  const push = (item) => {
    if (!item || seen.has(item.id)) return
    seen.add(item.id)
    tracks.push(item)
  }
  for (const r of responsive) {
    push(parseTrackFromResponsiveRenderer(r))
  }
  for (const r of playlistVideos) {
    push(parseTrackFromPlaylistVideoRenderer(r))
  }
  return tracks
}

function innertubePlaylistBrowseIds(playlistId) {
  const pid = String(playlistId ?? "").trim()
  if (!pid) return []
  const out = [pid]
  if (pid.startsWith("VL")) {
    const bare = pid.slice(2)
    if (bare) out.push(bare)
  } else {
    out.push(`VL${pid}`)
  }
  return [...new Set(out)]
}

async function fetchTracksViaInnertubePlaylist(playlistId) {
  for (const browseId of innertubePlaylistBrowseIds(playlistId)) {
    try {
      const json = await fetchBrowsePayload(browseId)
      const tracks = parseTracksFromBrowseJson(json)
      if (tracks.length) {
        return {
          tracks,
          title: listTitleFromBrowseResponse(json),
        }
      }
    } catch {
      /* prova altro browseId */
    }
  }
  return null
}

async function fetchBrowsePayload(browseId) {
  const clientVersion = innertubeClientVersion()
  const body = {
    context: {
      client: {
        clientName: "WEB_REMIX",
        clientVersion,
        hl: "en",
        gl: "US",
      },
    },
    browseId,
  }
  const res = await fetch(YTM_BROWSE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-YouTube-Client-Name": "67",
      "X-YouTube-Client-Version": clientVersion,
    },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(
      `YouTube Music browse HTTP ${res.status}: ${text.slice(0, 400)}`,
    )
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new Error("YouTube Music browse returned non-JSON")
  }
}

function listTitleFromBrowseResponse(json) {
  const h = json?.header?.musicHeaderRenderer?.title
  return extractRunsText(h).trim()
}

/**
 * @param {string} program
 * @param {string} pageUrl
 * @param {number} timeoutMs
 * @param {() => string[]} ytdlpExtraArgs
 */
async function ytdlpFlatPlaylistTracks(
  program,
  pageUrl,
  timeoutMs,
  ytdlpExtraArgs,
) {
  const args = [
    "-J",
    "--flat-playlist",
    "--no-download",
    "--no-warnings",
    ...ytdlpExtraArgs(),
    pageUrl,
  ]
  const { stdout } = await execFileAsync(program, args, {
    maxBuffer: 16 * 1024 * 1024,
    encoding: "utf8",
    timeout: timeoutMs,
  })
  const j = parseYtdlpJsonStdout(stdout)
  if (!j || typeof j !== "object") return []
  const rawEntries =
    j._type === "video"
      ? [j]
      : Array.isArray(j.entries)
        ? j.entries
        : []
  const seen = new Set()
  const tracks = []
  for (const e of rawEntries) {
    if (!e || typeof e !== "object") continue
    const id = String(e.id ?? e.url ?? "").trim()
    const title = String(e.title ?? "").trim() || id
    let url = String(e.url ?? "").trim()
    if (url.startsWith("//")) url = `https:${url}`
    if (!url) url = guessYoutubeUrlFromEntryId(id)
    url = normalizeCatalogWebUrl(url)
    if (!url || !id || seen.has(id)) continue
    seen.add(id)
    tracks.push({ id, title, url })
  }
  return tracks
}

/**
 * @param {object} opts
 * @param {string} opts.pageUrl
 * @param {string | null} opts.ytdlpProgram
 * @param {() => string[]} opts.ytdlpExtraArgs
 * @param {number} [opts.timeoutMs]
 */
export async function fetchCatalogWebReleaseTracks({
  pageUrl,
  ytdlpProgram,
  ytdlpExtraArgs,
  timeoutMs = 22_000,
}) {
  const url = normalizeCatalogWebUrl(pageUrl)
  if (!url) {
    return { tracks: [], title: "", error: "Invalid URL" }
  }

  if (isWatchSingleUrl(url)) {
    let title = ""
    try {
      const u = new URL(url)
      const id =
        u.hostname.includes("youtu.be")
          ? u.pathname.replace(/^\//, "").split("/")[0]
          : u.searchParams.get("v")
      if (id) {
        return {
          tracks: [
            {
              id: String(id),
              title: title || "Track",
              url,
            },
          ],
          title: "",
          error: null,
        }
      }
    } catch {
      /* ignore */
    }
  }

  const browseId = browseIdFromMusicBrowsePageUrl(url)
  if (browseId?.startsWith("MPREb_")) {
    try {
      const json = await fetchBrowsePayload(browseId)
      const tracks = parseTracksFromBrowseJson(json)
      if (tracks.length) {
        return {
          tracks,
          title: listTitleFromBrowseResponse(json),
          error: null,
        }
      }
    } catch (e) {
      if (!ytdlpProgram) {
        return {
          tracks: [],
          title: "",
          error: String(e?.message || e),
        }
      }
    }
  }

  const playlistId = playlistIdFromPageUrl(url)
  if (playlistId) {
    const fromPlaylist = await fetchTracksViaInnertubePlaylist(playlistId)
    if (fromPlaylist?.tracks?.length) {
      return {
        tracks: fromPlaylist.tracks,
        title: fromPlaylist.title || "",
        error: null,
      }
    }
  }

  if (!ytdlpProgram) {
    return {
      tracks: [],
      title: "",
      error: "Preview track list requires yt-dlp (ENABLE_YTDLP)",
    }
  }

  const ytdlpUrl = urlForYtdlpFetch(url) || url
  try {
    const tracks = await ytdlpFlatPlaylistTracks(
      ytdlpProgram,
      ytdlpUrl,
      timeoutMs,
      ytdlpExtraArgs,
    )
    return { tracks, title: "", error: tracks.length ? null : "No tracks found" }
  } catch (e) {
    return {
      tracks: [],
      title: "",
      error: String(e?.message || e),
    }
  }
}

/** Formato leggero muxato: webm/m4a in stdout per avvio rapido (streaming chunked). */
export const CATALOG_WEB_PREVIEW_YTDLP_FORMAT =
  "bestaudio[ext=webm]/bestaudio[ext=m4a]/bestaudio/best"

/** Anteprima Discover: solo i primi 30 secondi (meno dati). */
export const CATALOG_WEB_PREVIEW_MAX_SECONDS = 30

/**
 * Argomenti yt-dlp per anteprima in pipe (-o -): il browser riceve i primi byte subito.
 * @param {string} watchUrl
 * @param {() => string[]} ytdlpExtraArgs
 */
export function buildCatalogWebPreviewYtdlpArgs(watchUrl, ytdlpExtraArgs) {
  const url = urlForYtdlpFetch(normalizeCatalogWebUrl(watchUrl) || watchUrl)
  if (!url) throw new Error("Invalid URL")
  const playlist = isYoutubePlaylistUrl(url)
  return {
    url,
    contentType: "audio/*",
    args: [
      "-f",
      CATALOG_WEB_PREVIEW_YTDLP_FORMAT,
      "-o",
      "-",
      "--no-warnings",
      "--no-progress",
      "--socket-timeout",
      "15",
      ...(playlist ? ["--playlist-items", "1"] : ["--no-playlist"]),
      ...ytdlpExtraArgs(),
      url,
    ],
  }
}

export function prunePreviewStreamCache() {
  const now = Date.now()
  for (const [k, v] of previewStreamCache) {
    if (v.expires <= now) previewStreamCache.delete(k)
  }
}

/**
 * @param {object} opts
 * @param {string} opts.watchUrl
 * @param {string} opts.ytdlpProgram
 * @param {() => string[]} opts.ytdlpExtraArgs
 * @param {number} [opts.timeoutMs]
 */
export async function createCatalogWebPreviewPlayToken({
  watchUrl,
  ytdlpProgram,
  ytdlpExtraArgs,
  timeoutMs = 28_000,
}) {
  const url = normalizeCatalogWebUrl(watchUrl)
  if (!url) throw new Error("Invalid URL")
  const ytdlpUrl = urlForYtdlpFetch(url) || url
  prunePreviewStreamCache()
  const playlist = isYoutubePlaylistUrl(ytdlpUrl)
  const args = [
    "-g",
    "-f",
    "bestaudio[acodec^=mp4a]/bestaudio/best",
    ...(playlist ? ["--playlist-items", "1"] : ["--no-playlist"]),
    "--no-warnings",
    ...ytdlpExtraArgs(),
    ytdlpUrl,
  ]
  const { stdout } = await execFileAsync(ytdlpProgram, args, {
    maxBuffer: 4 * 1024 * 1024,
    encoding: "utf8",
    timeout: timeoutMs,
  })
  const line = String(stdout ?? "")
    .trim()
    .split(/\r?\n/)
    .map((s) => s.trim())
    .find(Boolean)
  if (!line || !/^https?:\/\//i.test(line)) {
    throw new Error("Could not resolve preview stream (yt-dlp)")
  }
  const token = randomUUID()
  previewStreamCache.set(token, {
    streamUrl: line,
    expires: Date.now() + PREVIEW_CACHE_TTL_MS,
  })
  return token
}

export function getPreviewStreamForToken(token) {
  prunePreviewStreamCache()
  const entry = previewStreamCache.get(String(token ?? "").trim())
  if (!entry || entry.expires <= Date.now()) return null
  return entry.streamUrl
}
