import { describe, expect, it } from "vitest";
import {
  buildCardPlayQueueFromSeed,
  buildSmartRandomQueue,
} from "./smartShuffle";
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

describe("buildCardPlayQueueFromSeed", () => {
  function tr(
    relPath: string,
    artist: string,
    opts?: {
      moods?: string[];
      genre?: string | null;
    },
  ): EnrichedTrack {
    return {
      id: relPath,
      title: relPath,
      relPath,
      artist,
      album: "Al",
      meta: opts
        ? {
            fileName: relPath,
            size: null,
            mtime: null,
            releaseDate: null,
            genre: opts.genre ?? null,
            moods:
              opts.moods && opts.moods.length ? [...opts.moods] : undefined,
            durationMs: null,
            trackNumber: null,
            discNumber: null,
            source: null,
            url: null,
          }
        : undefined,
    };
  }

  it("priorità mood poi genere poi artista poi resto (blocchi consecutivi)", () => {
    const seed = tr("seed", "Alpha", {
      moods: ["energy_boost"],
      genre: "Rock",
    });
    const moodOnly = tr("mood1", "Other", { moods: ["energy_boost"], genre: "Jazz" });
    const genreOnly = tr("genre1", "Other", {
      moods: [],
      genre: "Rock",
    });
    const artistOnly = tr("artist1", "Alpha", {
      moods: [],
      genre: "Classical",
    });
    const rest = tr("rest1", "Zeta", {
      moods: [],
      genre: "Pop",
    });
    const lib = [seed, moodOnly, genreOnly, artistOnly, rest];
    const q = buildCardPlayQueueFromSeed(seed, lib);
    expect(q[0].relPath).toBe("seed");
    const iMood = q.findIndex((t) => t.relPath === "mood1");
    const iGenre = q.findIndex((t) => t.relPath === "genre1");
    const iArtist = q.findIndex((t) => t.relPath === "artist1");
    const iRest = q.findIndex((t) => t.relPath === "rest1");
    expect(iMood).toBeLessThan(iGenre);
    expect(iGenre).toBeLessThan(iArtist);
    expect(iArtist).toBeLessThan(iRest);
  });
});
