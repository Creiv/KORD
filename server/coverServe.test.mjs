// @vitest-environment node
import fs from "fs/promises";
import os from "os";
import path from "path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  findCoverFilePath,
  getOrCreateCoverThumb,
  parseCoverThumbWidth,
} from "./coverServe.mjs";

describe("coverServe", () => {
  it("parseCoverThumbWidth accetta solo larghezze note", () => {
    expect(parseCoverThumbWidth("128")).toBe(128);
    expect(parseCoverThumbWidth("999")).toBeNull();
    expect(parseCoverThumbWidth("")).toBeNull();
  });

  it("trova cover.jpg in cartella album da path brano", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "rekord-cover-"));
    const albumDir = path.join(root, "Artist", "Album");
    await fs.mkdir(albumDir, { recursive: true });
    const coverPath = path.join(albumDir, "cover.jpg");
    await sharp({
      create: { width: 800, height: 800, channels: 3, background: "#336699" },
    })
      .jpeg()
      .toFile(coverPath);
    await fs.writeFile(path.join(albumDir, "01 Song.mp3"), "");

    const found = findCoverFilePath(
      root,
      "Artist/Album/01 Song.mp3",
    );
    expect(found).toBe(coverPath);

    const thumb = await getOrCreateCoverThumb(root, found, 128);
    const st = await fs.stat(thumb);
    expect(st.size).toBeGreaterThan(0);
    expect(st.size).toBeLessThan(await fs.stat(coverPath).then((s) => s.size));

    const again = await getOrCreateCoverThumb(root, found, 128);
    expect(again).toBe(thumb);

    const parallel = await Promise.all(
      Array.from({ length: 8 }, () => getOrCreateCoverThumb(root, found, 96)),
    );
    expect(new Set(parallel).size).toBe(1);
    for (const p of parallel) {
      expect(await fs.stat(p)).toBeTruthy();
    }
  });
});
