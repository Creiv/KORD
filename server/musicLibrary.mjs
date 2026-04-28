import fs from "fs/promises"
import { existsSync, statSync } from "fs"
import { stat as statAsync } from "fs/promises"
import path from "path"
import { loadAlbumJsonMetaFromDir, loadTrackJsonMetaMapFromDir } from "./albumInfo.mjs"
import { reorderTracksByAlbumExpectedRelease } from "./albumExpectedOrder.mjs"
import { parseTrackGenres } from "./genres.mjs"

const AUDIO = /\.(mp3|flac|m4a|ogg|opus|wav|aac|webm)$/i
const EXCLUDE = new Set([
  "kord",
  "node_modules",
  ".git",
  ".trash",
  ".wpp",
  ".kord",
])
const COVER_FILES = [
  "cover.jpg",
  "folder.jpg",
  "front.jpg",
  "cover.png",
  "folder.png",
  "artwork.jpg",
]

function numOrNull(v) {
  return Number.isFinite(v) ? Number(v) : null
}

function cmpByDateThenName(ax, bx) {
  const da = String(ax?.releaseDate || ax?.meta?.releaseDate || "")
  const db = String(bx?.releaseDate || bx?.meta?.releaseDate || "")
  if (!da && !db) {
    return String(ax?.name || ax?.title || "").localeCompare(
      String(bx?.name || bx?.title || ""),
      undefined,
      { numeric: true },
    )
  }
  if (!da) return 1
  if (!db) return -1
  const dcmp = da.localeCompare(db, undefined, { numeric: true })
  if (dcmp !== 0) return dcmp
  return String(ax?.name || ax?.title || "").localeCompare(
    String(bx?.name || bx?.title || ""),
    undefined,
    { numeric: true },
  )
}

function hasAudio(name) {
  return AUDIO.test(name)
}

function trackHasFileMeta(t) {
  return Boolean(
    (t?.meta?.genre && parseTrackGenres(t.meta.genre).length > 0) ||
      t?.meta?.releaseDate,
  )
}

function relify(parts) {
  return parts.filter(Boolean).join("/").replaceAll(path.sep, "/")
}

function albumKey(artistName, albumName) {
  return `${artistName}::${albumName}`
}

function trackFromFile({
  artistName,
  albumFolderName,
  albumDisplayName,
  fileName,
  fullPath,
  trackMeta,
  albumMeta,
  loose,
}) {
  const relPath = relify([artistName, albumFolderName, fileName])
  const fromFile = fileName.replace(AUDIO, "").trim() || fileName
  const tOverride =
    trackMeta?.title && String(trackMeta.title).trim()
      ? String(trackMeta.title).trim()
      : null
  const title = tOverride || fromFile
  const st = statSync(fullPath)
  const trackNumberGuess = fromFile.match(/^\d{1,2}/)
  return {
    id: relPath,
    title,
    relPath,
    artist: artistName,
    album: albumDisplayName || albumFolderName,
    albumId: albumKey(artistName, albumFolderName),
    meta: {
      fileName,
      size: numOrNull(st.size),
      mtime: numOrNull(st.mtimeMs),
      releaseDate: trackMeta?.releaseDate || null,
      genre: trackMeta?.genre || null,
      durationMs: numOrNull(trackMeta?.durationMs),
      trackNumber: numOrNull(
        trackMeta?.trackNumber || (trackNumberGuess ? Number(trackNumberGuess[0]) : null),
      ),
      discNumber: numOrNull(trackMeta?.discNumber),
      source: trackMeta?.source || null,
      url: trackMeta?.url || null,
    },
    ...(albumMeta ? { albumMeta } : {}),
    loose: Boolean(loose),
    addedAt: numOrNull(st.birthtimeMs || st.ctimeMs || st.mtimeMs),
    updatedAt: numOrNull(st.mtimeMs),
  }
}

function getCoverForAlbumDir(albumDir, albumRelPath) {
  for (const name of COVER_FILES) {
    const full = path.join(albumDir, name)
    if (existsSync(full)) {
      return `${albumRelPath}/${name}`.replaceAll(path.sep, "/")
    }
  }
  return null
}

async function entryIsAudioInDir(entry, dir) {
  if (!hasAudio(entry.name)) return false
  if (entry.isFile()) return true
  if (entry.isSymbolicLink()) {
    try {
      const st = await statAsync(path.join(dir, entry.name))
      return st.isFile()
    } catch {
      return false
    }
  }
  return false
}

async function readAlbumTracks(artistName, albumFolderName, albumDir, albumMeta) {
  const albumDisplayName =
    albumMeta?.title && String(albumMeta.title).trim()
      ? String(albumMeta.title).trim()
      : albumFolderName
  const trackMetaMap = await loadTrackJsonMetaMapFromDir(albumDir)
  const entries = await fs.readdir(albumDir, { withFileTypes: true })
  const tracks = []
  for (const entry of entries) {
    if (!(await entryIsAudioInDir(entry, albumDir))) continue
    tracks.push(
      trackFromFile({
        artistName,
        albumFolderName,
        albumDisplayName,
        fileName: entry.name,
        fullPath: path.join(albumDir, entry.name),
        trackMeta: trackMetaMap?.[entry.name] || null,
        albumMeta,
      }),
    )
  }
  const compareAlbumTracksDefault = (a, b) => {
    const ta = a.meta?.trackNumber ?? null
    const tb = b.meta?.trackNumber ?? null
    if (ta != null && tb != null && ta !== tb) return ta - tb
    if (ta != null && tb == null) return -1
    if (ta == null && tb != null) return 1
    return cmpByDateThenName(a, b)
  }
  tracks.sort(compareAlbumTracksDefault)

  const reordered = reorderTracksByAlbumExpectedRelease(
    tracks,
    albumMeta?.expectedTracks,
    artistName,
    compareAlbumTracksDefault,
  )
  if (reordered) {
    tracks.length = 0
    tracks.push(...reordered)
  }

  return tracks
}

async function readLooseTracks(artistName, artistDir) {
  const entries = await fs.readdir(artistDir, { withFileTypes: true })
  const tracks = []
  for (const entry of entries) {
    if (!(await entryIsAudioInDir(entry, artistDir))) continue
    tracks.push(
      trackFromFile({
        artistName,
        albumFolderName: "Tracce",
        albumDisplayName: "Tracce",
        fileName: entry.name,
        fullPath: path.join(artistDir, entry.name),
        trackMeta: null,
        albumMeta: null,
        loose: true,
      }),
    )
  }
  tracks.sort((a, b) => cmpByDateThenName(a, b))
  return tracks
}

export function isAudioFile(name) {
  return hasAudio(name)
}

export function coverCandidates() {
  return [...COVER_FILES]
}

export async function buildLibraryIndex(musicRoot) {
  const top = await fs.readdir(musicRoot, { withFileTypes: true })
  const artists = []
  const albums = []
  const tracks = []

  for (const entry of top) {
    if (!entry.isDirectory() || entry.name.startsWith(".") || EXCLUDE.has(entry.name)) continue
    const artistDir = path.join(musicRoot, entry.name)
    const subs = await fs.readdir(artistDir, { withFileTypes: true })
    const artistAlbums = []
    const artistLooseTracks = await readLooseTracks(entry.name, artistDir)

    for (const sub of subs) {
      if (!sub.isDirectory() || sub.name.startsWith(".")) continue
      const albumDir = path.join(artistDir, sub.name)
      const albumMeta = await loadAlbumJsonMetaFromDir(albumDir)
      const albumDisplayName =
        albumMeta?.title && String(albumMeta.title).trim()
          ? String(albumMeta.title).trim()
          : sub.name
      const albumTracks = await readAlbumTracks(entry.name, sub.name, albumDir, albumMeta)
      if (!albumTracks.length) continue
      const albumRelPath = relify([entry.name, sub.name])
      const st = statSync(albumDir)
      const coverRelPath = getCoverForAlbumDir(albumDir, albumRelPath)
      const albumItem = {
        id: albumKey(entry.name, sub.name),
        artistId: entry.name,
        artist: entry.name,
        name: albumDisplayName,
        relPath: albumRelPath,
        trackCount: albumTracks.length,
        coverRelPath,
        title: albumMeta?.title || null,
        releaseDate: albumMeta?.releaseDate || null,
        label: albumMeta?.label || null,
        country: albumMeta?.country || null,
        musicbrainzReleaseId: albumMeta?.musicbrainzReleaseId || null,
        expectedTrackCount:
          typeof albumMeta?.expectedTrackCount === "number"
            ? albumMeta.expectedTrackCount
            : Array.isArray(albumMeta?.expectedTracks)
              ? albumMeta.expectedTracks.length
              : null,
        expectedTracks: Array.isArray(albumMeta?.expectedTracks)
          ? albumMeta.expectedTracks
          : null,
        hasCover: Boolean(coverRelPath),
        hasAlbumMeta: Boolean(albumMeta),
        hasTrackMeta: albumTracks.some(trackHasFileMeta),
        tracksWithoutFileMetaCount: albumTracks.filter(
          (track) => !trackHasFileMeta(track),
        ).length,
        loose: false,
        addedAt: numOrNull(st.birthtimeMs || st.ctimeMs || st.mtimeMs),
        updatedAt: numOrNull(st.mtimeMs),
        tracks: albumTracks.map((track) => track.relPath),
      }
      artistAlbums.push(albumItem)
      albums.push(albumItem)
      tracks.push(...albumTracks)
    }

    if (artistLooseTracks.length) {
      const looseAlbum = {
        id: albumKey(entry.name, "Tracce"),
        artistId: entry.name,
        artist: entry.name,
        name: "Tracce",
        relPath: relify([entry.name]),
        trackCount: artistLooseTracks.length,
        coverRelPath: null,
        releaseDate: null,
        label: null,
        country: null,
        musicbrainzReleaseId: null,
        expectedTrackCount: null,
        expectedTracks: null,
        hasCover: false,
        hasAlbumMeta: false,
        hasTrackMeta: false,
        tracksWithoutFileMetaCount: artistLooseTracks.filter(
          (track) => !trackHasFileMeta(track),
        ).length,
        loose: true,
        addedAt: artistLooseTracks[0]?.addedAt || null,
        updatedAt: artistLooseTracks[0]?.updatedAt || null,
        tracks: artistLooseTracks.map((track) => track.relPath),
      }
      artistAlbums.unshift(looseAlbum)
      albums.push(looseAlbum)
      tracks.push(...artistLooseTracks)
    }

    artistAlbums.sort((a, b) => cmpByDateThenName(a, b))
    if (!artistAlbums.length) continue
    const albumsWithoutFileMetaCount = artistAlbums.filter(
      (a) => !a.loose && !a.hasAlbumMeta,
    ).length
    const tracksWithoutFileMetaCount = artistAlbums.reduce(
      (sum, a) => sum + (a.tracksWithoutFileMetaCount || 0),
      0,
    )
    artists.push({
      id: entry.name,
      name: entry.name,
      albumCount: artistAlbums.length,
      trackCount: artistAlbums.reduce((sum, album) => sum + album.trackCount, 0),
      releaseDate: artistAlbums[0]?.releaseDate || null,
      coverRelPath: artistAlbums.find((album) => album.coverRelPath)?.coverRelPath || null,
      albums: artistAlbums.map((album) => album.id),
      albumsWithoutFileMetaCount,
      tracksWithoutFileMetaCount,
    })
  }

  artists.sort((a, b) => cmpByDateThenName(a, b))
  albums.sort((a, b) => cmpByDateThenName(a, b))
  tracks.sort((a, b) => cmpByDateThenName(a, b))

  const stats = {
    artistCount: artists.length,
    albumCount: albums.length,
    trackCount: tracks.length,
    favoriteCapableCount: tracks.length,
    albumsWithoutCover: albums.filter((album) => !album.hasCover && !album.loose).length,
    albumsWithoutMeta: albums.filter((album) => !album.hasAlbumMeta && !album.loose).length,
    tracksWithoutMeta: tracks.filter(
      (track) =>
        !parseTrackGenres(track.meta?.genre).length && !track.meta?.releaseDate,
    ).length,
    looseAlbumCount: albums.filter((album) => album.loose).length,
  }

  return {
    musicRoot,
    artists,
    albums,
    tracks,
    stats,
  }
}

export function toLegacyLibrary(index) {
  return {
    musicRoot: index.musicRoot,
    artists: index.artists.map((artist) => ({
      id: artist.id,
      name: artist.name,
      trackCount: artist.trackCount,
      albums: artist.albums
        .map((albumId) => index.albums.find((album) => album.id === albumId))
        .filter(Boolean)
        .map((album) => ({
          id: album.loose ? "__loose__" : album.name,
          name: album.name,
          relPath: album.relPath,
          trackCount: album.trackCount,
          tracks: album.tracks
            .map((relPath) => index.tracks.find((track) => track.relPath === relPath))
            .filter(Boolean)
            .map((track) => ({
              id: track.id,
              title: track.title,
              relPath: track.relPath,
              meta: track.meta,
            })),
          ...(album.releaseDate || album.label || album.country || album.musicbrainzReleaseId
            ? {
                meta: {
                  releaseDate: album.releaseDate,
                  label: album.label,
                  country: album.country,
                  musicbrainzReleaseId: album.musicbrainzReleaseId,
                },
              }
            : {}),
        })),
    })),
  }
}

export function buildDashboard(index, userState) {
  const favoriteSet = new Set(userState?.favorites || [])
  const recentSet = new Set((userState?.recent || []).map((track) => track.relPath))
  const favoriteTracks = index.tracks.filter((track) => favoriteSet.has(track.relPath)).slice(0, 8)
  const recentTracks = index.tracks.filter((track) => recentSet.has(track.relPath)).slice(0, 8)
  const recentlyUpdatedAlbums = [...index.albums]
    .filter((album) => !album.loose)
    .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
    .slice(0, 24)
  const qualityAlerts = [
    {
      id: "albums-without-cover",
      label: "Albums without cover art",
      count: index.stats.albumsWithoutCover,
      severity: index.stats.albumsWithoutCover > 0 ? "warning" : "ok",
    },
    {
      id: "albums-without-meta",
      label: "Albums without metadata",
      count: index.stats.albumsWithoutMeta,
      severity: index.stats.albumsWithoutMeta > 0 ? "warning" : "ok",
    },
    {
      id: "tracks-without-meta",
      label: "Brani senza metadati",
      count: index.stats.tracksWithoutMeta,
      severity: index.stats.tracksWithoutMeta > 0 ? "warning" : "ok",
    },
    {
      id: "loose-albums",
      label: "Folders with loose tracks",
      count: index.stats.looseAlbumCount,
      severity: index.stats.looseAlbumCount > 0 ? "info" : "ok",
    },
  ]
  return {
    stats: index.stats,
    continueListening: (userState?.queue?.tracks || []).slice(0, 8),
    recentTracks,
    favoriteTracks,
    recentlyUpdatedAlbums,
    qualityAlerts,
  }
}
