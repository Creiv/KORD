import { coverUrlForTrackRelPath } from "./api"
import { COVER_WIDTHS } from "./coverArt"
import type { EnrichedTrack } from "../types"

function toAbsoluteUrl(path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) return path
  if (typeof window === "undefined") return path
  return new URL(path, window.location.origin).href
}

export function canUseMediaSession(): boolean {
  return typeof navigator !== "undefined" && "mediaSession" in navigator
}

export function setMediaSessionMetadata(
  track: EnrichedTrack | null,
): void {
  if (!canUseMediaSession()) return
  if (!track) {
    navigator.mediaSession.metadata = null
    return
  }
  const version = (track as EnrichedTrack & { updatedAt?: number | null }).updatedAt
  const baseCover = coverUrlForTrackRelPath(track.relPath, COVER_WIDTHS.player)
  const cover256 = coverUrlForTrackRelPath(track.relPath, COVER_WIDTHS.card)
  const cover = toAbsoluteUrl(
    version
      ? `${baseCover}${baseCover.includes("?") ? "&" : "?"}v=${Math.floor(version)}`
      : baseCover,
  )
  const coverMid = toAbsoluteUrl(
    version
      ? `${cover256}${cover256.includes("?") ? "&" : "?"}v=${Math.floor(version)}`
      : cover256,
  )
  navigator.mediaSession.metadata = new MediaMetadata({
    title: track.title,
    artist: track.artist,
    album: track.album,
    artwork: [
      { src: cover, sizes: "512x512", type: "image/webp" },
      { src: coverMid, sizes: "256x256", type: "image/webp" },
    ],
  })
  if (typeof Image !== "undefined") {
    const warm = new Image()
    warm.decoding = "async"
    warm.src = cover
  }
}

export function setMediaSessionPlaybackState(
  state: "none" | "paused" | "playing",
): void {
  if (!canUseMediaSession()) return
  navigator.mediaSession.playbackState = state
}

export function setMediaSessionPosition(
  duration: number,
  position: number,
  playbackRate = 1,
): void {
  if (!canUseMediaSession()) return
  if (!("setPositionState" in navigator.mediaSession)) return
  if (!Number.isFinite(duration) || duration <= 0) return
  const pos = Math.max(0, Math.min(position, duration))
  try {
    navigator.mediaSession.setPositionState({
      duration,
      playbackRate,
      position: pos,
    })
  } catch {
    /* */
  }
}

export type MediaSessionBridge = {
  play: () => void
  pause: () => void
  next: () => void
  prev: () => void
  seek: (timeSec: number) => void
  seekBy: (deltaSec: number) => void
  /** Riproduzione casuale (se l’UA espone l’azione, spesso non standard). */
  toggleShuffle: () => void
  /** Ciclo off → tutti → uno (se l’UA espone l’azione, spesso non standard). */
  cycleRepeat: () => void
  /** Preferito sul brano corrente. */
  toggleFavoriteCurrent: () => void
  /** Escludi/include il brano dalla shuffle globale. */
  toggleExcludeCurrent: () => void
}

/** Azioni non incluse nel tipo TS DOM ma accettate da alcuni browser / WebView. */
const EXPERIMENTAL_SHUFFLE_ALIASES = [
  "toggleshuffle",
  "shuffle",
] as const

const EXPERIMENTAL_REPEAT_ALIASES = [
  "switchrepeatmode",
  "repeat",
  "setrepeatmode",
  "togglerepeat",
] as const

const EXPERIMENTAL_FAVORITE_ALIASES = [
  "togglelike",
  "like",
  "favorite",
  "togglefavorite",
] as const

const EXPERIMENTAL_EXCLUDE_ALIASES = [
  "toggleshuffleexclude",
  "toggleexcludetrack",
] as const

function trySetActionHandler(
  ms: MediaSession,
  action: string,
  handler: MediaSessionActionHandler | null,
): void {
  try {
    ms.setActionHandler(action as MediaSessionAction, handler)
  } catch {
    /* */
  }
}

export function registerMediaSessionActions(
  getBridge: () => MediaSessionBridge,
): () => void {
  if (!canUseMediaSession()) return () => {
    /* */
  }
  const ms = navigator.mediaSession
  const run = (fn: () => void) => {
    try {
      fn()
    } catch {
      /* */
    }
  }
  const play = () => run(() => getBridge().play())
  const pause = () => run(() => getBridge().pause())
  const next = () => run(() => getBridge().next())
  const prev = () => run(() => getBridge().prev())

  const safe = (action: MediaSessionAction, h: (() => void) | null) => {
    try {
      ms.setActionHandler(action, h)
    } catch {
      /* */
    }
  }
  const seekto: MediaSessionAction = "seekto"
  const seekback: MediaSessionAction = "seekbackward"
  const seekforw: MediaSessionAction = "seekforward"

  safe("play", play)
  safe("pause", pause)
  safe("previoustrack", prev)
  safe("nexttrack", next)
  try {
    ms.setActionHandler(seekto, (d) => {
      if (d.seekTime != null && Number.isFinite(d.seekTime)) {
        getBridge().seek(d.seekTime)
      }
    })
  } catch {
    /* */
  }
  try {
    ms.setActionHandler(
      seekback,
      (d) => {
        const off = d.seekOffset ?? 10
        getBridge().seekBy(-off)
      },
    )
  } catch {
    /* */
  }
  try {
    ms.setActionHandler(
      seekforw,
      (d) => {
        const off = d.seekOffset ?? 10
        getBridge().seekBy(off)
      },
    )
  } catch {
    /* */
  }

  const toggleShuffle = () => run(() => getBridge().toggleShuffle())
  const cycleRepeat = () => run(() => getBridge().cycleRepeat())
  const toggleFavorite = () => run(() => getBridge().toggleFavoriteCurrent())
  const toggleExclude = () => run(() => getBridge().toggleExcludeCurrent())

  for (const a of EXPERIMENTAL_SHUFFLE_ALIASES) {
    trySetActionHandler(ms, a, toggleShuffle)
  }
  for (const a of EXPERIMENTAL_REPEAT_ALIASES) {
    trySetActionHandler(ms, a, cycleRepeat)
  }
  for (const a of EXPERIMENTAL_FAVORITE_ALIASES) {
    trySetActionHandler(ms, a, toggleFavorite)
  }
  for (const a of EXPERIMENTAL_EXCLUDE_ALIASES) {
    trySetActionHandler(ms, a, toggleExclude)
  }

  return () => {
    safe("play", null)
    safe("pause", null)
    safe("previoustrack", null)
    safe("nexttrack", null)
    try {
      ms.setActionHandler(seekto, null)
    } catch {
      /* */
    }
    try {
      ms.setActionHandler(seekback, null)
    } catch {
      /* */
    }
    try {
      ms.setActionHandler(seekforw, null)
    } catch {
      /* */
    }
    for (const a of EXPERIMENTAL_SHUFFLE_ALIASES) {
      trySetActionHandler(ms, a, null)
    }
    for (const a of EXPERIMENTAL_REPEAT_ALIASES) {
      trySetActionHandler(ms, a, null)
    }
    for (const a of EXPERIMENTAL_FAVORITE_ALIASES) {
      trySetActionHandler(ms, a, null)
    }
    for (const a of EXPERIMENTAL_EXCLUDE_ALIASES) {
      trySetActionHandler(ms, a, null)
    }
  }
}
