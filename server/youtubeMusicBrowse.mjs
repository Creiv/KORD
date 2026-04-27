const YTM_INNERTUBE_KEY = "AIzaSyC9XL3QWnjsQplBUbSJY1cffBoVwD0aN1U"
const YTM_BROWSE_URL = `https://music.youtube.com/youtubei/v1/browse?key=${YTM_INNERTUBE_KEY}`

function innertubeClientVersion() {
  return String(
    process.env.KORD_YTM_INNERTUBE_CLIENT_VERSION || "1.20241127.01.00",
  ).trim()
}

function browseIdFromMusicBrowsePageUrl(raw) {
  try {
    const u = new URL(String(raw).trim())
    const h = u.hostname.replace(/^www\./, "").toLowerCase()
    if (h !== "music.youtube.com") return null
    const m = u.pathname.match(/\/browse\/([^/?#]+)/)
    return m ? decodeURIComponent(m[1]) : null
  } catch {
    return null
  }
}

function extractRunsText(node) {
  if (!node) return ""
  if (Array.isArray(node.runs)) {
    return node.runs.map((r) => String(r.text ?? "")).join("")
  }
  if (typeof node.simpleText === "string") return node.simpleText
  return ""
}

function listTitleFromBrowseResponse(json) {
  const h = json?.header?.musicHeaderRenderer?.title
  const t = extractRunsText(h)
  return t.trim()
}

function walkCollectMusicTwoRowRenderers(node, out) {
  if (!node || typeof node !== "object") return
  if (node.musicTwoRowItemRenderer) {
    out.push(node.musicTwoRowItemRenderer)
  }
  if (Array.isArray(node)) {
    for (const x of node) walkCollectMusicTwoRowRenderers(x, out)
    return
  }
  for (const k of Object.keys(node)) {
    walkCollectMusicTwoRowRenderers(node[k], out)
  }
}

function albumPlaylistIdFromTwoRowRenderer(renderer) {
  const items = renderer.menu?.menuRenderer?.items
  if (Array.isArray(items)) {
    for (const it of items) {
      const e = it.menuNavigationItemRenderer?.navigationEndpoint
      const pid = e?.watchPlaylistEndpoint?.playlistId
      if (pid && pid.startsWith("OLAK5uy_")) return pid
    }
    for (const it of items) {
      const q =
        it.menuServiceItemRenderer?.serviceEndpoint?.queueAddEndpoint
          ?.queueTarget?.playlistId
      if (q && q.startsWith("OLAK5uy_")) return q
    }
  }
  return null
}

function fallbackBrowseUrlFromTwoRowRenderer(renderer) {
  const bid = renderer.navigationEndpoint?.browseEndpoint?.browseId
  if (bid && String(bid).startsWith("MPREb_")) {
    return `https://music.youtube.com/browse/${encodeURIComponent(bid)}`
  }
  return ""
}

function buildEntriesFromBrowseJson(json) {
  const buckets = []
  walkCollectMusicTwoRowRenderers(json, buckets)
  const seen = new Set()
  const entries = []
  for (const r of buckets) {
    const title = extractRunsText(r.title).trim()
    const playlistId = albumPlaylistIdFromTwoRowRenderer(r)
    let url = ""
    let id = ""
    if (playlistId) {
      id = playlistId
      url = `https://music.youtube.com/playlist?list=${encodeURIComponent(playlistId)}`
    } else {
      url = fallbackBrowseUrlFromTwoRowRenderer(r)
      id = String(
        r.navigationEndpoint?.browseEndpoint?.browseId ?? "",
      ).trim()
    }
    if (!title || !url || !id) continue
    if (seen.has(id)) continue
    seen.add(id)
    entries.push({ id, title, url })
  }
  return entries
}

async function fetchYoutubeMusicBrowsePayload(browseId) {
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
      `YouTube Music browse API HTTP ${res.status}: ${text.slice(0, 500)}`,
    )
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new Error("YouTube Music browse API returned non-JSON")
  }
}

/**
 * Elenco album da pagina music.youtube.com/browse/… (formato simile a yt-dlp -J flat-playlist).
 */
export async function fetchYoutubeMusicBrowseReleasesList(pageUrl) {
  const browseId = browseIdFromMusicBrowsePageUrl(pageUrl)
  if (!browseId) {
    return {
      entries: [],
      title: "",
      uploader: "",
      channel_url: "",
      error: "Not a YouTube Music browse URL",
    }
  }
  const json = await fetchYoutubeMusicBrowsePayload(browseId)
  const listTitle = listTitleFromBrowseResponse(json)
  const entries = buildEntriesFromBrowseJson(json)
  return {
    entries,
    title: listTitle,
    uploader: listTitle,
    channel_url: "",
    error: null,
  }
}

export { browseIdFromMusicBrowsePageUrl }
