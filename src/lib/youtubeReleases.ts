import { releaseTypeToDiscoverKind } from "./catalogWebDiscover"

export type YoutubeReleaseKind = "album" | "song"

export type YoutubeReleaseClassifyInput = {
  title: string
  url: string
  trackCount: number | null
}

function isWatchSingleUrl(url: string): boolean {
  try {
    const u = new URL(String(url).trim())
    const h = u.hostname.replace(/^www\./, "").toLowerCase()
    if (h === "youtu.be") {
      const id = u.pathname.replace(/^\//, "").split("/")[0]
      return Boolean(id)
    }
    if (!h.includes("youtube.com")) return false
    if (u.searchParams.get("list")) return false
    return Boolean(u.searchParams.get("v"))
  } catch {
    return false
  }
}

/** Come Scopri web: album/EP vs singoli da titolo, URL e conteggio brani. */
export function classifyYoutubeReleaseEntry(
  entry: YoutubeReleaseClassifyInput,
): YoutubeReleaseKind {
  const title = String(entry.title ?? "").trim()
  const prefix = title.match(
    /^(Album|EP|Single|Singolo|Video)\s*(?:[•·|–—-]|\s*-\s*)/i,
  )
  if (prefix) {
    return releaseTypeToDiscoverKind(prefix[1])
  }
  if (/^(?:single|singolo|video)\b/i.test(title)) return "song"
  if (/\s[-–—]\s*(?:single|singolo|video)\s*$/i.test(title)) return "song"

  if (entry.trackCount === 1) return "song"
  if (entry.trackCount != null && entry.trackCount > 1) return "album"

  if (isWatchSingleUrl(entry.url)) return "song"

  try {
    const u = new URL(entry.url)
    const list = u.searchParams.get("list")?.trim() ?? ""
    if (list.startsWith("RD")) return "song"
  } catch {
    /* ignore */
  }

  return "album"
}

export function partitionYoutubeReleaseEntries<T extends YoutubeReleaseClassifyInput>(
  entries: T[],
): { albums: T[]; songs: T[] } {
  const albums: T[] = []
  const songs: T[] = []
  for (const entry of entries) {
    if (classifyYoutubeReleaseEntry(entry) === "song") songs.push(entry)
    else albums.push(entry)
  }
  return { albums, songs }
}
