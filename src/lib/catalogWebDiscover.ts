import type {
  CatalogWebDiscoverAlbum,
  CatalogWebDiscoverSong,
} from "./api"

export type CatalogWebDiscoverItem =
  | CatalogWebDiscoverAlbum
  | CatalogWebDiscoverSong

/** Sottotitoli YTM: «Album • Artista», «Single · …», ecc. */
const SUBTITLE_LINE_RE =
  /^(Album|EP|Single|Singolo|Video)\s*(?:[•·|–—\-]|\s*-\s*)\s*(.+)$/i

export function parseCatalogWebSubtitle(subtitle: string): {
  releaseType: string | null
  artistName: string
} {
  const raw = String(subtitle ?? "").trim()
  const m = raw.match(SUBTITLE_LINE_RE)
  if (m) {
    return {
      releaseType: m[1],
      artistName: m[2].trim(),
    }
  }
  return {
    releaseType: null,
    artistName: raw,
  }
}

export function releaseTypeToDiscoverKind(
  releaseType: string | null | undefined,
): "album" | "song" {
  const t = String(releaseType ?? "")
    .trim()
    .toLowerCase()
  if (t === "single" || t === "singolo" || t === "video") return "song"
  return "album"
}

export function enrichCatalogWebDiscoverItem<T extends CatalogWebDiscoverItem>(
  item: T,
): T & {
  type: "album" | "song"
  releaseType: string | null
  artistName: string
} {
  const parsed = parseCatalogWebSubtitle(item.subtitle)
  const releaseType = item.releaseType ?? parsed.releaseType
  const artistName = (item.artistName || parsed.artistName || "").trim()
  const type = releaseType
    ? releaseTypeToDiscoverKind(releaseType)
    : item.type === "song"
      ? "song"
      : "album"
  return {
    ...item,
    releaseType,
    artistName: artistName || parsed.artistName || item.subtitle.trim(),
    type,
  }
}

export function partitionCatalogWebDiscover(items: CatalogWebDiscoverItem[]): {
  albums: CatalogWebDiscoverAlbum[]
  songs: CatalogWebDiscoverSong[]
} {
  const albums: CatalogWebDiscoverAlbum[] = []
  const songs: CatalogWebDiscoverSong[] = []
  for (const raw of items) {
    const item = enrichCatalogWebDiscoverItem(raw)
    if (item.type === "song") songs.push(item)
    else albums.push(item)
  }
  return { albums, songs }
}
