import { coverUrlForTrackRelPath } from "./api"
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
  const cover = toAbsoluteUrl(coverUrlForTrackRelPath(track.relPath))
  navigator.mediaSession.metadata = new MediaMetadata({
    title: track.title,
    artist: track.artist,
    album: track.album,
    artwork: [
      { src: cover, sizes: "512x512", type: "image/jpeg" },
      { src: cover, sizes: "256x256", type: "image/jpeg" },
    ],
  })
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
  }
}
