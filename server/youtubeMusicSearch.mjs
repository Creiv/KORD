const YTM_INNERTUBE_KEY = "AIzaSyC9XL3QWnjsQplBUbSJY1cffBoVwD0aN1U"
const YTM_SEARCH_URL = `https://music.youtube.com/youtubei/v1/search?key=${YTM_INNERTUBE_KEY}`

/** @type {Record<string, string | null>} */
const SEARCH_FILTER_PARAMS = {
  all: null,
  songs: "EgWKAQIIAWoKEAMQBBAJEAoQBQ%3D%3D",
  albums: "EgWKAQIYAWoKEAMQBBAJEAoQBQ%3D%3D",
  artists: "EgWKAQIgAWoKEAMQBBAJEAoQBQ%3D%3D",
}

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

/** Migliore URL copertina da musicThumbnailRenderer o array thumbnails YT. */
function pickBestThumbnailUrl(thumbnails) {
  if (!Array.isArray(thumbnails) || !thumbnails.length) return null
  const best = [...thumbnails].sort(
    (a, b) => (Number(b.width) || 0) - (Number(a.width) || 0),
  )[0]
  const url = String(best?.url ?? "").trim()
  return url || null
}

function thumbnailFromMusicThumbnailRenderer(mtr) {
  return pickBestThumbnailUrl(mtr?.thumbnail?.thumbnails)
}

function thumbnailFromRenderer(renderer) {
  return (
    thumbnailFromMusicThumbnailRenderer(renderer?.thumbnail?.musicThumbnailRenderer) ||
    thumbnailFromMusicThumbnailRenderer(
      renderer?.thumbnailRenderer?.musicThumbnailRenderer,
    ) ||
    thumbnailFromMusicThumbnailRenderer(renderer?.musicThumbnailRenderer) ||
    null
  )
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

function urlFromWatchEndpoint(ep) {
  const vid = ep?.watchEndpoint?.videoId
  if (vid) return `https://music.youtube.com/watch?v=${encodeURIComponent(vid)}`
  return ""
}

function urlFromPlaylistEndpoint(ep) {
  const pid = ep?.watchPlaylistEndpoint?.playlistId
  if (pid) {
    return `https://music.youtube.com/playlist?list=${encodeURIComponent(pid)}`
  }
  return ""
}

function urlFromBrowseEndpoint(ep) {
  const bid = ep?.browseEndpoint?.browseId
  if (!bid) return ""
  const id = String(bid).trim()
  if (id.startsWith("UC") || id.startsWith("MPREb_")) {
    if (id.startsWith("UC")) {
      return `https://music.youtube.com/channel/${encodeURIComponent(id)}`
    }
    return `https://music.youtube.com/browse/${encodeURIComponent(id)}`
  }
  return ""
}

function parseResponsiveListItem(renderer) {
  const title = extractRunsText(
    renderer.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text,
  ).trim()
  if (!title) return null
  const subtitle = extractRunsText(
    renderer.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text,
  ).trim()
  const ep =
    renderer.overlay?.musicItemThumbnailOverlayRenderer?.content
      ?.musicPlayButtonRenderer?.playNavigationEndpoint ??
    renderer.navigationEndpoint
  const watchUrl = urlFromWatchEndpoint(ep)
  const playlistUrl = urlFromPlaylistEndpoint(ep)
  const url = watchUrl || playlistUrl
  if (!url) return null
  const id =
    ep?.watchEndpoint?.videoId ||
    ep?.watchPlaylistEndpoint?.playlistId ||
    url
  const thumbnailUrl = thumbnailFromRenderer(renderer)
  return {
    id: String(id),
    type: playlistUrl && !watchUrl ? "album" : "song",
    title,
    subtitle,
    url,
    ...(thumbnailUrl ? { thumbnailUrl } : {}),
  }
}

function parseTwoRowItem(renderer) {
  const title = extractRunsText(renderer.title).trim()
  if (!title) return null
  const subtitle = extractRunsText(renderer.subtitle).trim()
  const ep = renderer.navigationEndpoint
  const playlistUrl = urlFromPlaylistEndpoint(ep)
  const browseUrl = urlFromBrowseEndpoint(ep)
  const watchUrl = urlFromWatchEndpoint(ep)
  let type = "album"
  let url = playlistUrl || browseUrl || watchUrl
  if (browseUrl && browseUrl.includes("/channel/")) type = "artist"
  else if (watchUrl && !playlistUrl) type = "song"
  else if (playlistUrl) type = "album"
  else if (browseUrl) type = "album"
  if (!url) return null
  const id =
    ep?.watchPlaylistEndpoint?.playlistId ||
    ep?.browseEndpoint?.browseId ||
    ep?.watchEndpoint?.videoId ||
    url
  const thumbnailUrl = thumbnailFromRenderer(renderer)
  return {
    id: String(id),
    type,
    title,
    subtitle,
    url,
    ...(thumbnailUrl ? { thumbnailUrl } : {}),
  }
}

function parseSearchResponse(json) {
  const responsive = []
  const twoRow = []
  walkCollect(json, "musicResponsiveListItemRenderer", responsive)
  walkCollect(json, "musicTwoRowItemRenderer", twoRow)
  const seen = new Set()
  const results = []
  for (const r of responsive) {
    const item = parseResponsiveListItem(r)
    if (!item || seen.has(item.id)) continue
    seen.add(item.id)
    results.push(item)
  }
  for (const r of twoRow) {
    const item = parseTwoRowItem(r)
    if (!item || seen.has(item.id)) continue
    seen.add(item.id)
    results.push(item)
  }
  return results
}

async function fetchYoutubeMusicSearchPayload(query, filter) {
  const q = String(query ?? "").trim()
  if (!q) {
    return { results: [], error: "Empty query" }
  }
  const filterKey = String(filter ?? "all").toLowerCase()
  const params = SEARCH_FILTER_PARAMS[filterKey] ?? SEARCH_FILTER_PARAMS.all
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
    query: q,
  }
  if (params) body.params = params
  const res = await fetch(YTM_SEARCH_URL, {
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
    return {
      results: [],
      error: `YouTube Music search HTTP ${res.status}: ${text.slice(0, 400)}`,
    }
  }
  let json
  try {
    json = JSON.parse(text)
  } catch {
    return { results: [], error: "YouTube Music search returned non-JSON" }
  }
  const results = parseSearchResponse(json)
  return { results, error: null }
}

function compareExploreTitles(a, b) {
  const ta = String(a.title ?? "")
    .trim()
    .toLocaleLowerCase()
  const tb = String(b.title ?? "")
    .trim()
    .toLocaleLowerCase()
  const byTitle = ta.localeCompare(tb, undefined, {
    sensitivity: "base",
    numeric: true,
  })
  if (byTitle !== 0) return byTitle
  const sa = String(a.subtitle ?? "")
    .trim()
    .toLocaleLowerCase()
  const sb = String(b.subtitle ?? "")
    .trim()
    .toLocaleLowerCase()
  return sa.localeCompare(sb, undefined, {
    sensitivity: "base",
    numeric: true,
  })
}

function orderExploreResults(results) {
  const albums = results.filter((r) => r.type === "album").sort(compareExploreTitles)
  const songs = results.filter((r) => r.type === "song").sort(compareExploreTitles)
  return [...albums, ...songs].slice(0, 48)
}

/**
 * @param {string} query
 */
export async function searchYoutubeMusicCatalog(query) {
  const { results, error } = await fetchYoutubeMusicSearchPayload(query, "all")
  if (error) return { results: [], error }
  return { results: orderExploreResults(results), error: null }
}
