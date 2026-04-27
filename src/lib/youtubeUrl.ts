export type YoutubeLinkKind = "single" | "playlist" | "releases" | "other"

/** Classifica link YouTube: playlist se c'è `list=`, altrimenti /releases, altrimenti singolo watch/short. */
export function classifyYoutubeUrl(raw: string): YoutubeLinkKind {
  let u: URL
  try {
    u = new URL(String(raw).trim())
  } catch {
    return "other"
  }
  const h = u.hostname.replace(/^www\./, "").toLowerCase()
  const yt =
    h === "youtu.be" ||
    h === "m.youtube.com" ||
    h.endsWith("music.youtube.com") ||
    h.endsWith("youtube.com")
  if (!yt) return "other"
  if (u.pathname.includes("/releases")) return "releases"
  const list = u.searchParams.get("list")
  if (list && list.length > 0) return "playlist"
  if (u.pathname.includes("/playlist")) return "playlist"
  if (u.pathname === "/watch" || u.pathname.startsWith("/watch/") || h === "youtu.be")
    return "single"
  return "other"
}

export function isLikelyReleasesListUrl(url: string): boolean {
  try {
    const u = new URL(url.trim())
    const h = u.hostname.replace(/^www\./, "").toLowerCase()
    if (!/youtube\.com$/.test(h) && !h.endsWith("music.youtube.com")) return false
    return u.pathname.includes("/releases")
  } catch {
    return false
  }
}
