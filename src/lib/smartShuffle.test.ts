import { describe, expect, it } from "vitest";
import { buildSmartRandomQueue } from "./smartShuffle";
import type { EnrichedTrack } from "../types";

function tr(relPath: string, artist: string): EnrichedTrack {
  return {
    id: relPath,
    title: relPath,
    relPath,
    artist,
    album: "Al",
  };
}

describe("buildSmartRandomQueue", () => {
  it("mette i brani non recenti prima di quelli in recent", () => {
    const a = tr("a", "A");
    const b = tr("b", "B");
    const out = buildSmartRandomQueue([a, b], {
      recentRelPaths: new Set(["a"]),
    });
    expect(out[0].relPath).toBe("b");
  });

  it("restituisce [] su lista vuota", () => {
    expect(buildSmartRandomQueue([])).toEqual([]);
  });
});
