const YT_WEB_INNERTUBE_KEY = "AIzaSyAO_FJ2SlqU8f4OVGT0GmJnYTKVrplsZIk"
const YT_BROWSE_URL = `https://www.youtube.com/youtubei/v1/browse?key=${YT_WEB_INNERTUBE_KEY}`

function webInnertubeClientVersion() {
  return String(
    process.env.KORD_YT_WEB_INNERTUBE_CLIENT_VERSION || "2.20241124.01.00",
  ).trim()
}

function innertubeWebContext() {
  const clientVersion = webInnertubeClientVersion()
  return {
    client: {
      clientName: "WEB",
      clientVersion,
      hl: "en",
      gl: "US",
    },
  }
}

function sliceYtInitialDataJson(html) {
  const prefix = "var ytInitialData = "
  const i = html.indexOf(prefix)
  if (i < 0) return null
  let j = i + prefix.length
  let depth = 0
  let start = j
  let inStr = false
  let esc = false
  let q = ""
  for (; j < html.length; j++) {
    const c = html[j]
    if (inStr) {
      if (esc) {
        esc = false
        continue
      }
      if (c === "\\") {
        esc = true
        continue
      }
      if (c === q) inStr = false
      continue
    }
    if (c === '"' || c === "'") {
      inStr = true
      q = c
      continue
    }
    if (c === "{") {
      if (depth === 0) start = j
      depth++
    } else if (c === "}") {
      depth--
      if (depth === 0) return html.slice(start, j + 1)
    }
  }
  return null
}

function parseYtInitialData(html) {
  const raw = sliceYtInitialDataJson(html)
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function tabTitleText(tr) {
  const t = tr?.title
  if (typeof t === "string") return t
  if (t?.simpleText) return t.simpleText
  if (Array.isArray(t?.runs)) return t.runs.map((r) => String(r.text ?? "")).join("")
  return ""
}

function isReleasesChannelTab(tr) {
  const url = tr?.endpoint?.commandMetadata?.webCommandMetadata?.url || ""
  if (url.includes("/releases")) return true
  const text = tabTitleText(tr).trim().toLowerCase()
  return (
    text === "releases" ||
    text === "uscite" ||
    text === "lanzamientos" ||
    text === "sorties" ||
    text === "veröffentlichungen"
  )
}

function releasesBrowseFromInitialData(data) {
  const tabs = data?.contents?.twoColumnBrowseResultsRenderer?.tabs || []
  for (const wrap of tabs) {
    const tr = wrap.tabRenderer || wrap.expandableTabRenderer
    if (!tr || !isReleasesChannelTab(tr)) continue
    const be = tr.endpoint?.browseEndpoint
    if (be?.browseId && be?.params) {
      return { browseId: String(be.browseId), params: String(be.params) }
    }
  }
  return null
}

function playlistTitleFromRenderer(pr) {
  const t = pr?.title
  if (t?.simpleText) return String(t.simpleText).trim()
  if (Array.isArray(t?.runs)) {
    return t.runs.map((r) => String(r.text ?? "")).join("").trim()
  }
  return ""
}

function walkCollectPlaylistRenderers(node, out) {
  if (!node || typeof node !== "object") return
  if (node.playlistRenderer) {
    out.push(node.playlistRenderer)
  }
  if (Array.isArray(node)) {
    for (const x of node) walkCollectPlaylistRenderers(x, out)
    return
  }
  for (const k of Object.keys(node)) {
    walkCollectPlaylistRenderers(node[k], out)
  }
}

function gridContinuationToken(node) {
  let token = null
  function walk(o) {
    if (token || !o || typeof o !== "object") return
    const cir = o.continuationItemRenderer
    if (
      cir?.trigger === "CONTINUATION_TRIGGER_ON_ITEM_SHOWN" &&
      cir?.continuationEndpoint?.continuationCommand?.token
    ) {
      const t = cir.continuationEndpoint.continuationCommand.token
      if (typeof t === "string" && t.length > 10) {
        token = t
        return
      }
    }
    if (Array.isArray(o)) {
      for (const x of o) {
        walk(x)
        if (token) return
      }
      return
    }
    for (const k of Object.keys(o)) {
      walk(o[k])
      if (token) return
    }
  }
  walk(node)
  return token
}

function listMetaFromBrowseJson(json) {
  const cm = json?.metadata?.channelMetadataRenderer
  const title = String(cm?.title ?? "").trim()
  const channelUrl = String(cm?.channelUrl ?? cm?.ownerUrls?.[0] ?? "").trim()
  return { channelTitle: title, channelUrl }
}

function entriesFromPlaylistRenderers(renderers) {
  const seen = new Set()
  const entries = []
  for (const pr of renderers) {
    const playlistId = String(pr.playlistId ?? "").trim()
    const title = playlistTitleFromRenderer(pr)
    if (!playlistId || !title) continue
    if (seen.has(playlistId)) continue
    seen.add(playlistId)
    entries.push({
      id: playlistId,
      title,
      url: `https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId)}`,
    })
  }
  return entries
}

async function innertubeBrowse(body) {
  const cv = webInnertubeClientVersion()
  const res = await fetch(YT_BROWSE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-YouTube-Client-Name": "1",
      "X-YouTube-Client-Version": cv,
    },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(
      `YouTube browse API HTTP ${res.status}: ${text.slice(0, 400)}`,
    )
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new Error("YouTube browse API returned non-JSON")
  }
}

function isYoutubeWebReleasesPageUrl(raw) {
  try {
    const u = new URL(String(raw).trim())
    const h = u.hostname.replace(/^www\./, "").toLowerCase()
    if (h === "music.youtube.com") return false
    if (!h.endsWith("youtube.com")) return false
    return u.pathname.includes("/releases")
  } catch {
    return false
  }
}

/**
 * Elenco playlist dalla tab «Releases» su youtube.com (non music.youtube.com).
 * Sperimentale: Innertube + ytInitialData dalla pagina HTML.
 */
export async function fetchYoutubeWebReleasesList(pageUrl) {
  if (!isYoutubeWebReleasesPageUrl(pageUrl)) {
    return {
      entries: [],
      title: "",
      uploader: "",
      channel_url: "",
      error: "Not a youtube.com /releases page (or is music.youtube.com)",
    }
  }
  const htmlRes = await fetch(String(pageUrl).trim(), {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
    },
    redirect: "follow",
  })
  const html = await htmlRes.text()
  const initial = parseYtInitialData(html)
  if (!initial) {
    return {
      entries: [],
      title: "",
      uploader: "",
      channel_url: "",
      error: "Could not parse ytInitialData from releases page",
    }
  }
  const rel = releasesBrowseFromInitialData(initial)
  if (!rel) {
    return {
      entries: [],
      title: "",
      uploader: "",
      channel_url: "",
      error: "No Releases tab in channel data (channel may not have releases)",
    }
  }
  const ctx = innertubeWebContext()
  const renderers = []
  let token = null
  let json = await innertubeBrowse({
    context: ctx,
    browseId: rel.browseId,
    params: rel.params,
  })
  const meta = listMetaFromBrowseJson(json)
  for (let page = 0; page < 40; page++) {
    walkCollectPlaylistRenderers(json, renderers)
    token = gridContinuationToken(json)
    if (!token) break
    json = await innertubeBrowse({
      context: ctx,
      continuation: token,
    })
  }
  const entries = entriesFromPlaylistRenderers(renderers)
  const listTitle = meta.channelTitle
    ? `${meta.channelTitle} - Releases`
    : "Releases"
  return {
    entries,
    title: listTitle,
    uploader: meta.channelTitle,
    channel_url: meta.channelUrl,
    error: null,
  }
}

export { isYoutubeWebReleasesPageUrl }
