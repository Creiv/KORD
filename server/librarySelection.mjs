import { existsSync } from "fs"
import {
  atomicWriteFileUtf8,
  kordAccountLibrarySelectionPath,
  readJsonFile,
} from "./kordDataStore.mjs"

const DEFAULT_ACCOUNT_ID = "default"

function uniqStrings(arr) {
  return [...new Set((Array.isArray(arr) ? arr : []).filter((v) => typeof v === "string" && v.trim()))]
}

export function sanitizeRelPathForSelection(relPath) {
  if (relPath == null) return null
  const normalized = String(relPath)
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
  if (!normalized) return null
  for (const seg of normalized.split("/")) {
    if (seg === "..") return null
    if (seg === "." || seg === "") return null
  }
  return normalized
}

export function sanitizeLibrarySelection(input) {
  const src = input && typeof input === "object" ? input : {}
  return {
    version: 1,
    includeAll: src.includeAll === true,
    artists: uniqStrings(src.artists).slice(0, 100_000),
    albums: uniqStrings(src.albums)
      .map((a) => sanitizeRelPathForSelection(a))
      .filter(Boolean)
      .slice(0, 200_000),
    tracks: uniqStrings(src.tracks)
      .map((t) => sanitizeRelPathForSelection(t))
      .filter(Boolean)
      .slice(0, 500_000),
  }
}

export function removeAlbumsFromSelectionSets(index, artists, albums, removeRawList) {
  const albumPathSet = new Set(index.albums.map((a) => a.relPath))
  for (const raw of Array.isArray(removeRawList) ? removeRawList : []) {
    const rel = sanitizeRelPathForSelection(String(raw || ""))
    if (!rel) continue
    albums.delete(rel)
    const alMeta = index.albums.find((a) => a.relPath === rel)
    if (!alMeta) continue
    const aid = String(alMeta.artistId || alMeta.artist || "").trim()
    if (!aid || !artists.has(aid)) continue
    artists.delete(aid)
    for (const o of index.albums) {
      const oid = String(o.artistId || o.artist || "").trim()
      if (oid !== aid || o.relPath === rel) continue
      const orp = sanitizeRelPathForSelection(o.relPath)
      if (orp && albumPathSet.has(orp)) albums.add(orp)
    }
  }
}

export async function readLibrarySelection(libraryRoot, accountId) {
  const p = kordAccountLibrarySelectionPath(libraryRoot, accountId)
  if (!p || !existsSync(p)) return null
  const j = await readJsonFile(p)
  if (!j) return null
  return sanitizeLibrarySelection(j)
}

export async function writeLibrarySelection(libraryRoot, accountId, data) {
  const p = kordAccountLibrarySelectionPath(libraryRoot, accountId)
  if (!p) throw new Error("Invalid account")
  const sanitized = sanitizeLibrarySelection(data)
  await atomicWriteFileUtf8(p, JSON.stringify(sanitized, null, 2))
  return sanitized
}

/**
 * @returns {"all"|"empty"|"filter"}
 */
export function getSelectionFilterMode(selection, accountId) {
  if (selection == null) {
    return accountId === DEFAULT_ACCOUNT_ID ? "all" : "empty"
  }
  if (selection.includeAll) return "all"
  const has =
    selection.artists.length > 0 ||
    selection.albums.length > 0 ||
    selection.tracks.length > 0
  if (!has) return "empty"
  return "filter"
}

function stripMusicRootFromIndex(index) {
  return {
    ...index,
    musicRoot: "",
  }
}

export function filterLibraryIndexBySelection(index, selection, accountId) {
  const mode = getSelectionFilterMode(selection, accountId)
  if (mode === "all") {
    return stripMusicRootFromIndex(index)
  }
  if (mode === "empty") {
    return {
      ...index,
      musicRoot: "",
      artists: [],
      albums: [],
      tracks: [],
      stats: {
        artistCount: 0,
        albumCount: 0,
        trackCount: 0,
        favoriteCapableCount: 0,
        albumsWithoutCover: 0,
        albumsWithoutMeta: 0,
        tracksWithoutMeta: 0,
        looseAlbumCount: 0,
      },
    }
  }

  const artistSet = new Set(selection.artists)
  const albumSet = new Set(selection.albums)
  const trackSet = new Set(selection.tracks)

  const albums = index.albums.filter((album) => {
    if (albumSet.has(album.relPath)) return true
    if (artistSet.has(album.artistId) || artistSet.has(album.artist)) return true
    return false
  })
  const albumIds = new Set(albums.map((a) => a.id))
  const tracks = index.tracks.filter((track) => {
    if (trackSet.has(track.relPath)) return true
    if (albumIds.has(track.albumId)) return true
    return false
  })
  const trackRelSet = new Set(tracks.map((t) => t.relPath))
  const artists = index.artists
    .filter((artist) => {
      if (artistSet.has(artist.id) || artistSet.has(artist.name)) return true
      const anyAlbum = artist.albums.some((albumId) => albumIds.has(albumId))
      if (anyAlbum) return true
      const anyTrack = tracks.some((t) => t.artist === artist.name)
      return anyTrack
    })
    .map((artist) => ({
      ...artist,
      albums: artist.albums.filter((albumId) => albumIds.has(albumId)),
    }))
    .filter((artist) => artist.albums.length > 0)

  const albumsFiltered = albums.map((album) => ({
    ...album,
    tracks: album.tracks.filter((rel) => trackRelSet.has(rel)),
  }))

  const stats = {
    artistCount: artists.length,
    albumCount: albumsFiltered.length,
    trackCount: tracks.length,
    favoriteCapableCount: tracks.length,
    albumsWithoutCover: albumsFiltered.filter((album) => !album.loose && !album.coverRelPath).length,
    albumsWithoutMeta: albumsFiltered.filter((album) => !album.loose && !album.hasAlbumMeta).length,
    tracksWithoutMeta: tracks.filter((track) => !track.meta?.genre && !track.meta?.releaseDate).length,
    looseAlbumCount: albumsFiltered.filter((album) => album.loose).length,
  }

  return {
    ...index,
    musicRoot: "",
    artists,
    albums: albumsFiltered,
    tracks,
    stats,
  }
}

export function buildCatalogFromIndex(index) {
  return {
    artists: index.artists.map((a) => ({
      id: a.id,
      name: a.name,
      albumCount: a.albumCount,
      trackCount: a.trackCount,
      relAlbums: (a.albums || [])
        .map((albumId) => index.albums.find((al) => al.id === albumId))
        .filter(Boolean)
        .map((album) => ({
          id: album.id,
          name: album.name,
          relPath: album.relPath,
          artist: album.artist,
          artistId: album.artistId,
          trackCount: album.trackCount,
          loose: Boolean(album.loose),
          coverRelPath: album.coverRelPath || null,
        })),
    })),
  }
}

export function mergeTrackMoodsIntoIndex(index, trackMoods) {
  if (!trackMoods || typeof trackMoods !== "object") return index
  const tracks = index.tracks.map((t) => {
    const m = trackMoods[t.relPath]
    if (!m || !Array.isArray(m) || !m.length) {
      return { ...t, meta: { ...t.meta, moods: [] } }
    }
    return { ...t, meta: { ...t.meta, moods: [...new Set(m.map(String).filter(Boolean))] } }
  })
  return { ...index, tracks }
}
