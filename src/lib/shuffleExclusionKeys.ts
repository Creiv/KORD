import type { LibraryIndex } from "../types"

/**
 * Stabilize album keys: `artist/Display` (legacy) → `album.id` (artist::folder).
 */
export function normalizeShuffleAlbumKeysWithIndex(
  index: LibraryIndex,
  albumKeys: string[]
): string[] {
  const byLegacy = new Map<string, string>();
  for (const al of index.albums) {
    byLegacy.set(`${al.artist}/${al.name}`, al.id);
  }
  const out = new Set<string>();
  for (const raw of albumKeys) {
    const s = raw?.trim();
    if (!s) continue;
    if (s.includes("::")) {
      if (index.albums.some((a) => a.id === s)) out.add(s);
      continue;
    }
    if (s.includes("/")) {
      const id = byLegacy.get(s);
      if (id) out.add(id);
      continue;
    }
    if (index.albums.some((a) => a.id === s)) out.add(s);
  }
  return [...out]
}
