import type { StudioDownloadKind } from "./api"

/** Singolo brano vs album/playlist (come i pulsanti in Classico). */
export type StudioDownloadScope = "single" | "playlist"

export function normalizeDownloadDestPath(value: string | null | undefined) {
  return String(value || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .trim()
}

export function isValidDownloadDestPath(value: string | null | undefined) {
  return normalizeDownloadDestPath(value).length > 0
}

export function relPathLooksLikeAlbumFolderDest(relPath: string | null | undefined) {
  return normalizeDownloadDestPath(relPath).split("/").filter(Boolean).length >= 2
}

export function joinMusicDestRelPath(base: string, title: string): string {
  const b = normalizeDownloadDestPath(base)
  const seg = normalizeDownloadDestPath(
    title.replace(/[/\\]+/g, " ").replace(/\s+/g, " ").trim(),
  )
  return b && seg ? `${b}/${seg}` : seg || b
}

export function studioDownloadKindForScope(
  scope: StudioDownloadScope,
): StudioDownloadKind {
  return scope === "single" ? "download_single" : "download_playlist"
}

/**
 * Cartella di output per yt-dlp.
 * Playlist/album sotto cartella artista → sottocartella col titolo (come in Classico).
 * Singolo → usa la destinazione scelta così com'è (cartella album = traccia piatta).
 */
export function resolveStudioDownloadOutputDir(
  dlPath: string,
  scope: StudioDownloadScope,
  releaseTitle?: string,
): string {
  const norm = normalizeDownloadDestPath(dlPath)
  if (
    scope === "playlist" &&
    releaseTitle?.trim() &&
    !relPathLooksLikeAlbumFolderDest(norm)
  ) {
    return joinMusicDestRelPath(norm, releaseTitle)
  }
  return norm
}

export function buildStudioDownloadConfirm(args: {
  dlPath: string
  scope: StudioDownloadScope
  releaseTitle?: string
  trackCount?: number | null
  t: (key: string, vars?: Record<string, string | number>) => string
  /** Es. riga «Brano: …» in Esplora; Classico non la passa. */
  preamble?: string
}): { variant: "danger" | "warning"; message: string } {
  const pickedNorm = normalizeDownloadDestPath(args.dlPath)
  const outputDir = resolveStudioDownloadOutputDir(
    args.dlPath,
    args.scope,
    args.releaseTitle,
  )
  const artistFolderTarget =
    args.scope === "single"
      ? !relPathLooksLikeAlbumFolderDest(pickedNorm)
      : !relPathLooksLikeAlbumFolderDest(outputDir)

  let msg = args.preamble?.trim() ?? ""
  if (msg) msg += "\n\n"
  msg += artistFolderTarget
    ? args.t("tools.dlConfirmArtistFolderDl", { path: outputDir })
    : args.t("tools.dlConfirmAlbumFolderTracks", { path: outputDir })
  if (
    args.scope === "playlist" &&
    args.trackCount != null &&
    args.trackCount > 0
  ) {
    msg +=
      "\n\n" + args.t("tools.exploreConfirmTrackCount", { n: args.trackCount })
  }
  return {
    variant: artistFolderTarget ? "danger" : "warning",
    message: msg,
  }
}
