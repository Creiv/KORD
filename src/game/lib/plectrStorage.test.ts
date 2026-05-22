import { beforeEach, describe, expect, it } from "vitest";
import {
  collectPlectrPlayedRelPaths,
  countPlectrTracksPlayed,
  PLECTR_BEST_LS_PREFIX,
  writePlectrBestLocal,
} from "./plectrStorage";
import type { LibraryIndex } from "../../types";

function miniIndex(
  tracks: { relPath: string; plectrBest?: { score: number; hits?: number } }[]
): LibraryIndex {
  return {
    tracks: tracks.map((t) => ({
      id: t.relPath,
      relPath: t.relPath,
      title: t.relPath,
      artist: "A",
      album: "B",
      albumId: "a|b",
      meta: t.plectrBest
        ? {
            plectrBest: {
              score: t.plectrBest.score,
              grade: "B",
              accuracy: 80,
              maxCombo: 5,
              hits: t.plectrBest.hits ?? 10,
              misses: 1,
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          }
        : {},
    })),
    albums: [],
    artists: [],
    stats: { trackCount: tracks.length, albumCount: 0, artistCount: 0 },
  } as unknown as LibraryIndex;
}

describe("plectrStorage play count", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("counts tracks with meta plectrBest and local-only records", () => {
    const index = miniIndex([
      { relPath: "a.mp3", plectrBest: { score: 1200 } },
      { relPath: "b.mp3" },
    ]);
    writePlectrBestLocal("b.mp3", {
      score: 800,
      grade: "C",
      accuracy: 70,
      maxCombo: 3,
      hits: 8,
      misses: 2,
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    writePlectrBestLocal("orphan.mp3", {
      score: 500,
      grade: "D",
      accuracy: 60,
      maxCombo: 1,
      hits: 5,
      misses: 4,
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    const paths = collectPlectrPlayedRelPaths(index);
    expect(paths.size).toBe(3);
    expect(paths.has("a.mp3")).toBe(true);
    expect(paths.has("b.mp3")).toBe(true);
    expect(paths.has("orphan.mp3")).toBe(true);
    expect(countPlectrTracksPlayed(index)).toBe(3);
  });

  it("ignores empty or zero-score records without hits", () => {
    writePlectrBestLocal("zero.mp3", {
      score: 0,
      grade: "F",
      accuracy: 0,
      maxCombo: 0,
      hits: 0,
      misses: 10,
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(countPlectrTracksPlayed(null)).toBe(0);
    expect(localStorage.getItem(`${PLECTR_BEST_LS_PREFIX}zero.mp3`)).toBeTruthy();
  });
});
