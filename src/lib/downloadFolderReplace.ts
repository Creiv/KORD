import type { LibraryIndex, UserStateV1 } from "../types"

function uniqStr(list: string[]) {
  return [...new Set(list.filter(Boolean))]
}

/**
 * Chiave per considerare "lo stesso brano" tra file diversi: solo **nome file** (senza estensione),
 * dopo normalizzazione. Criteri: stessa cartella destinazione, stem uguale; per togliere doppi serve
 * almeno un percorso **nuovo** (non era nell'indice prima del download) con quello stem.
 */
export function normalizeStemFromRelPath(relPath: string): string {
  const base = relPath.split("/").pop() || relPath
  let s = base.replace(/\.[^.]+$/i, "")
  s = s.normalize("NFC").toLowerCase()
  s = s.replace(/_/g, " ")
  s = s.replace(/^\d+(?:\s*[-–—._)]\s*|\s+)/, "")
  s = s.replace(
    /\s*\([^)]*(?:official|lyric|lyrics|visuali[sz]er|full\s*album|music\s*video|mv\b)[^)]*\)\s*$/i,
    "",
  )
  s = s.replace(/\s*\[[^\]]*(?:official|lyric)[^\]]*]\s*$/i, "")
  s = s.replace(/\s*【[^】]+】\s*$/g, "")
  s = s.replace(/\s*[\u2010-\u2015\u2212]\s*/g, " ")
  s = s.replace(/\s{2,}/g, " ")
  return s.trim()
}

export type FolderReplaceSnapshot = {
  stemMeta: Record<
    string,
    { favorite: boolean; excluded: boolean; playCount: number }
  >
  excludedAlbumIds: string[]
}

function underFolder(relPath: string, folder: string): boolean {
  const pfx = folder.replace(/\/+$/, "")
  if (!relPath) return false
  return relPath === pfx || relPath.startsWith(pfx + "/")
}

export function relPathsForTracksInFolder(
  index: LibraryIndex,
  folderRelPrefix: string,
): string[] {
  const pfx = folderRelPrefix.replace(/\/+$/, "")
  return index.tracks
    .filter((t) => underFolder(t.relPath, pfx))
    .map((t) => t.relPath)
}

/** Snapshot prima del download, da tutte le tracce attuali nella cartella. */
export function buildFolderReplaceSnapshotForFolder(
  user: UserStateV1,
  index: LibraryIndex,
  folderRelPrefix: string,
): FolderReplaceSnapshot {
  const pfx = folderRelPrefix.replace(/\/+$/, "")
  const stemMeta: FolderReplaceSnapshot["stemMeta"] = {}
  for (const t of index.tracks) {
    if (!underFolder(t.relPath, pfx)) continue
    const st = normalizeStemFromRelPath(t.relPath)
    if (!st) continue
    const cur = stemMeta[st] || {
      favorite: false,
      excluded: false,
      playCount: 0,
    }
    if (user.favorites.includes(t.relPath)) cur.favorite = true
    if (user.shuffleExcludedTrackRelPaths.includes(t.relPath)) cur.excluded = true
    cur.playCount = Math.max(cur.playCount, user.trackPlayCounts[t.relPath] ?? 0)
    stemMeta[st] = cur
  }
  const excludedAlbumIds: string[] = []
  for (const al of index.albums) {
    if (!underFolder(al.relPath, pfx)) continue
    if (user.shuffleExcludedAlbumIds.includes(al.id)) {
      excludedAlbumIds.push(al.id)
    }
  }
  return { stemMeta, excludedAlbumIds }
}

/** Dopo download: stesso stem, almeno un file nuovo; tieni un file e proponi di eliminare il resto. */
export function computePostDownloadRedundantRemovals(
  indexBefore: LibraryIndex,
  indexAfter: LibraryIndex,
  folderRelPrefix: string,
): { toDelete: string[]; newPathSet: Set<string> } {
  const pfx = folderRelPrefix.replace(/\/+$/, "")
  const beforeList = relPathsForTracksInFolder(indexBefore, pfx)
  const beforeSet = new Set(beforeList)
  const afterList = relPathsForTracksInFolder(indexAfter, pfx)
  const newPathSet = new Set(
    afterList.filter((p) => !beforeSet.has(p)),
  )
  const byStem = new Map<string, string[]>()
  for (const p of afterList) {
    const s = normalizeStemFromRelPath(p)
    if (!s) continue
    const a = byStem.get(s) || []
    a.push(p)
    byStem.set(s, a)
  }
  const toDelete: string[] = []
  for (const paths of byStem.values()) {
    if (paths.length <= 1) continue
    const hasNew = paths.some((p) => newPathSet.has(p))
    if (!hasNew) continue
    const fromNew = paths.filter((p) => newPathSet.has(p)).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true }),
    )
    const keeper = fromNew[0]!
    for (const p of paths) {
      if (p !== keeper) toDelete.push(p)
    }
  }
  return { toDelete, newPathSet }
}

export function applyStripToUserStateForPathsOnly(
  prev: UserStateV1,
  deletedRelPaths: string[],
): UserStateV1 {
  const deleted = new Set(deletedRelPaths)
  return {
    ...prev,
    favorites: prev.favorites.filter((f) => !deleted.has(f)),
    shuffleExcludedTrackRelPaths: prev.shuffleExcludedTrackRelPaths.filter(
      (t) => !deleted.has(t),
    ),
    trackPlayCounts: Object.fromEntries(
      Object.entries(prev.trackPlayCounts || {}).filter(
        ([k]) => !deleted.has(k),
      ),
    ) as UserStateV1["trackPlayCounts"],
    recent: prev.recent.filter((t) => !deleted.has(t.relPath)),
    playlists: prev.playlists.map((pl) => ({
      ...pl,
      tracks: pl.tracks.filter((tr) => !deleted.has(tr.relPath)),
    })),
    queue: (() => {
      const oldT = prev.queue.tracks
      const tr = oldT.filter((t) => !deleted.has(t.relPath))
      let cur = 0
      if (tr.length) {
        const oi = prev.queue.currentIndex
        const at = oldT[oi]
        if (at && !deleted.has(at.relPath)) {
          const before = oldT
            .slice(0, oi + 1)
            .filter((t) => !deleted.has(t.relPath))
          cur = Math.max(0, before.length - 1)
        }
        cur = Math.min(cur, tr.length - 1)
      }
      return { tracks: tr, currentIndex: cur }
    })(),
  }
}

export function applyRemapToUserState(
  prev: UserStateV1,
  snap: FolderReplaceSnapshot,
  indexAfter: LibraryIndex,
  folderRelPrefix: string,
): UserStateV1 {
  const pfx = folderRelPrefix.replace(/\/+$/, "")
  const toFav: string[] = []
  const toExcl: string[] = []
  const plays: Record<string, number> = {}
  for (const t of indexAfter.tracks) {
    if (!underFolder(t.relPath, pfx)) continue
    const st = normalizeStemFromRelPath(t.relPath)
    const o = st ? snap.stemMeta[st] : undefined
    if (!o) continue
    if (o.favorite) toFav.push(t.relPath)
    if (o.excluded) toExcl.push(t.relPath)
    if (o.playCount > 0) plays[t.relPath] = o.playCount
  }
  const idSet = new Set(indexAfter.albums.map((a) => a.id))
  const albumReadd = snap.excludedAlbumIds.filter((id) => idSet.has(id))
  return {
    ...prev,
    favorites: uniqStr([...prev.favorites, ...toFav]),
    shuffleExcludedTrackRelPaths: uniqStr([
      ...prev.shuffleExcludedTrackRelPaths,
      ...toExcl,
    ]),
    trackPlayCounts: { ...prev.trackPlayCounts, ...plays },
    shuffleExcludedAlbumIds: uniqStr([
      ...prev.shuffleExcludedAlbumIds,
      ...albumReadd,
    ]),
  }
}
