import type { LibraryIndex } from "../types";
import { parseTrackGenres } from "./genres";

function shuffleSlice<T>(items: T[], max: number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i]!;
    a[i] = a[j]!;
    a[j] = t;
  }
  return a.slice(0, max);
}

function fourCoverSlots(relPaths: string[]): (string | null)[] {
  const uniq = [...new Set(relPaths)];
  const picks = shuffleSlice(uniq, 4);
  const out: (string | null)[] = [...picks];
  while (out.length < 4) out.push(null);
  return out.slice(0, 4);
}

export function buildGenreCoverPreviewMap(
  index: LibraryIndex
): Map<string, (string | null)[]> {
  const albumIdsByGenre = new Map<string, Set<string>>();
  const add = (genreKey: string, albumId: string) => {
    let s = albumIdsByGenre.get(genreKey);
    if (!s) {
      s = new Set();
      albumIdsByGenre.set(genreKey, s);
    }
    s.add(albumId);
  };

  for (const t of index.tracks) {
    const albumId = t.albumId;
    if (!albumId) continue;
    const tokens = parseTrackGenres(t.meta?.genre);
    if (tokens.length === 0) add("__none__", albumId);
    else for (const g of tokens) add(g.toLowerCase(), albumId);
  }

  const out = new Map<string, (string | null)[]>();
  for (const [genreKey, albumIdSet] of albumIdsByGenre) {
    const withCover: string[] = [];
    for (const aid of albumIdSet) {
      const al = index.albums.find((a) => a.id === aid);
      if (al?.coverRelPath) withCover.push(al.relPath);
    }
    out.set(genreKey, fourCoverSlots(withCover));
  }
  return out;
}
