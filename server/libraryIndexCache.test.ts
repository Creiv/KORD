// @vitest-environment node
import fs from "fs/promises";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  invalidateLibraryIndexCache,
  readLibraryIndexCache,
  writeLibraryIndexCache,
} from "./libraryIndexCache.mjs";

function minimalIndex(musicRoot) {
  return {
    musicRoot,
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
  };
}

describe("libraryIndexCache", () => {
  it("scrive e rilegge la cache sotto .kord/", async () => {
    const musicRoot = await fs.mkdtemp(path.join(os.tmpdir(), "kord-idx-cache-"));
    const idx = minimalIndex(musicRoot);
    await writeLibraryIndexCache(musicRoot, idx);
    const read = await readLibraryIndexCache(musicRoot);
    expect(read?.stats?.trackCount).toBe(0);
    expect(path.resolve(read?.musicRoot || "")).toBe(path.resolve(musicRoot));
    await invalidateLibraryIndexCache(musicRoot);
    expect(await readLibraryIndexCache(musicRoot)).toBeNull();
  });
});
