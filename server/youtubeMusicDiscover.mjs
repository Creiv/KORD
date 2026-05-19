const YTM_INNERTUBE_KEY = "AIzaSyC9XL3QWnjsQplBUbSJY1cffBoVwD0aN1U"
const YTM_BROWSE_URL = `https://music.youtube.com/youtubei/v1/browse?key=${YTM_INNERTUBE_KEY}`

/** Pagina https://music.youtube.com/new_releases/albums (ytmusicapi). */
const NEW_RELEASES_ALBUMS_BROWSE_ID = "FEmusic_new_releases_albums"

function innertubeClientVersion() {
  return String(
    process.env.KORD_YTM_INNERTUBE_CLIENT_VERSION || "1.20241127.01.00",
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

function pickBestThumbnailUrl(thumbnails) {
  if (!Array.isArray(thumbnails) || !thumbnails.length) return null
  const best = [...thumbnails].sort(
    (a, b) => (Number(b.width) || 0) - (Number(a.width) || 0),
  )[0]
  const url = String(best?.url ?? "").trim()
  return url || null
}

function thumbnailFromRenderer(renderer) {
  const mtr =
    renderer?.thumbnail?.musicThumbnailRenderer ||
    renderer?.thumbnailRenderer?.musicThumbnailRenderer ||
    renderer?.musicThumbnailRenderer
  return pickBestThumbnailUrl(mtr?.thumbnail?.thumbnails)
}

function playlistIdFromEndpoint(ep) {
  const pid = ep?.watchPlaylistEndpoint?.playlistId
  return pid ? String(pid).trim() : ""
}

function playlistIdFromMenu(renderer) {
  const items = renderer?.menu?.menuRenderer?.items ?? []
  for (const it of items) {
    const ep =
      it?.menuNavigationItemRenderer?.navigationEndpoint ??
      it?.menuServiceItemRenderer?.navigationEndpoint
    const pid = playlistIdFromEndpoint(ep)
    if (pid) return pid
  }
  return ""
}

function urlFromPlaylistId(playlistId) {
  const pid = String(playlistId ?? "").trim()
  if (!pid) return ""
  return `https://music.youtube.com/playlist?list=${encodeURIComponent(pid)}`
}

function urlFromPlaylistEndpoint(ep) {
  return urlFromPlaylistId(playlistIdFromEndpoint(ep))
}

function urlFromBrowseEndpoint(ep) {
  const bid = ep?.browseEndpoint?.browseId
  if (!bid) return ""
  const id = String(bid).trim()
  if (id.startsWith("MPREb_")) {
    return `https://music.youtube.com/browse/${encodeURIComponent(id)}`
  }
  return ""
}

function resolveAlbumUrl(renderer) {
  const ep =
    renderer.overlay?.musicItemThumbnailOverlayRenderer?.content
      ?.musicPlayButtonRenderer?.playNavigationEndpoint ??
    renderer.navigationEndpoint
  const menuPid = playlistIdFromMenu(renderer)
  const navPid = playlistIdFromEndpoint(ep)
  const url =
    urlFromPlaylistId(menuPid) ||
    urlFromPlaylistId(navPid) ||
    urlFromBrowseEndpoint(ep)
  const id = menuPid || navPid || ep?.browseEndpoint?.browseId || url
  return { url, id: String(id) }
}

function parseAlbumRow(renderer) {
  const title = extractRunsText(renderer.title).trim()
  if (!title) return null
  const subtitle = extractRunsText(renderer.subtitle).trim()
  const { url, id } = resolveAlbumUrl(renderer)
  if (!url) return null
  const thumbnailUrl = thumbnailFromRenderer(renderer)
  return {
    id: String(id),
    type: "album",
    title,
    subtitle,
    url,
    ...(thumbnailUrl ? { thumbnailUrl } : {}),
  }
}

function parseAlbumResponsive(renderer) {
  const title = extractRunsText(
    renderer.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text,
  ).trim()
  if (!title) return null
  const subtitle = extractRunsText(
    renderer.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text,
  ).trim()
  const { url, id } = resolveAlbumUrl(renderer)
  if (!url) return null
  const thumbnailUrl = thumbnailFromRenderer(renderer)
  return {
    id: String(id),
    type: "album",
    title,
    subtitle,
    url,
    ...(thumbnailUrl ? { thumbnailUrl } : {}),
  }
}

function parseNewReleasesAlbumsBrowse(json) {
  const twoRow = []
  const responsive = []
  walkCollect(json, "musicTwoRowItemRenderer", twoRow)
  walkCollect(json, "musicResponsiveListItemRenderer", responsive)
  const seen = new Set()
  const out = []
  for (const r of responsive) {
    const item = parseAlbumResponsive(r)
    if (!item || seen.has(item.id)) continue
    seen.add(item.id)
    out.push(item)
  }
  for (const r of twoRow) {
    const item = parseAlbumRow(r)
    if (!item || seen.has(item.id)) continue
    seen.add(item.id)
    out.push(item)
  }
  return out
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

export function normalizeDiscoverLabel(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

export function buildLibraryDiscoverLookup(index) {
  const artists = new Set()
  const albumKeys = new Set()
  for (const a of index?.artists ?? []) {
    const k = normalizeDiscoverLabel(a.name)
    if (k) artists.add(k)
  }
  for (const al of index?.albums ?? []) {
    const artist = normalizeDiscoverLabel(al.artist)
    const name = normalizeDiscoverLabel(al.name)
    if (artist && name) albumKeys.add(`${artist}|${name}`)
    if (name) albumKeys.add(name)
  }
  return { artists, albumKeys }
}

function isNewDiscoverAlbum(item, lookup) {
  const artist = normalizeDiscoverLabel(item.subtitle)
  const title = normalizeDiscoverLabel(item.title)
  if (artist && title && lookup.albumKeys.has(`${artist}|${title}`)) {
    return false
  }
  if (title && lookup.albumKeys.has(title)) return false
  return Boolean(title)
}

/** Campione casuale senza reinserimento (Fisher–Yates parziale). */
function pickRandomSubset(items, count) {
  const pool = [...items]
  const n = Math.min(Math.max(0, count), pool.length)
  const out = []
  for (let i = 0; i < n; i += 1) {
    const j = i + Math.floor(Math.random() * (pool.length - i))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
    out.push(pool[i])
  }
  return out
}

const WEB_DISCOVER_DISPLAY_COUNT = 36

/**
 * @param {import("./musicLibrary.mjs").LibraryIndex} index
 */
export async function fetchCatalogWebDiscover(index) {
  const lookup = buildLibraryDiscoverLookup(index)
  let raw = []
  let fetchError = null
  try {
    const json = await fetchBrowsePayload(NEW_RELEASES_ALBUMS_BROWSE_ID)
    raw = parseNewReleasesAlbumsBrowse(json)
  } catch (e) {
    fetchError = String(e?.message || e)
  }

  const seenAlbums = new Set()
  const albums = []
  for (const item of raw) {
    if (seenAlbums.has(item.id) || !isNewDiscoverAlbum(item, lookup)) continue
    seenAlbums.add(item.id)
    albums.push({
      id: item.id,
      title: item.title,
      subtitle: item.subtitle || "",
      artistName: item.subtitle || "",
      url: item.url,
      thumbnailUrl: item.thumbnailUrl ?? null,
    })
  }

  return {
    artists: [],
    albums: pickRandomSubset(albums, WEB_DISCOVER_DISPLAY_COUNT),
    error: fetchError && !albums.length ? fetchError : null,
  }
}
