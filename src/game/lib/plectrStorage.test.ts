import { describe, expect, it } from "vitest";
import {
  countPlectrTracksPlayed,
  hasPlectrPlayRecord,
  isBetterPlectrScore,
  pickBetterPlectrScore,
  plectrBestFromUserState,
} from "./plectrStorage";
import { buildGameResult } from "./runResult";
import {
  getSessionTrackBest,
  saveSessionTrackBest,
} from "./sessionScores";

describe("plectrStorage", () => {
  it("counts distinct saved records from user state", () => {
    expect(
      countPlectrTracksPlayed({
        "a.mp3": {
          score: 1200,
          grade: "A",
          accuracy: 0.9,
          maxCombo: 10,
          hits: 20,
        },
        "b.mp3": { score: 0, grade: "", accuracy: 0, maxCombo: 0, hits: 0 },
      })
    ).toBe(1);
  });

  it("picks better score by points then accuracy", () => {
    const low = buildGameResult({ score: 100, maxCombo: 1, hits: 5, misses: 1 });
    const high = buildGameResult({ score: 200, maxCombo: 2, hits: 8, misses: 0 });
    expect(pickBetterPlectrScore(low, high)).toEqual(high);
    expect(isBetterPlectrScore(high, low)).toBe(true);
  });

  it("requires positive score or hits for a play record", () => {
    expect(hasPlectrPlayRecord({ score: 0, grade: "", accuracy: 0, maxCombo: 0, hits: 0 })).toBe(false);
    expect(hasPlectrPlayRecord({ score: 0, grade: "", accuracy: 0, maxCombo: 0, hits: 3 })).toBe(true);
  });

  it("persists when session already matches but account has no record", () => {
    const relPath = "song.mp3";
    const result = buildGameResult({ score: 500, maxCombo: 5, hits: 10, misses: 1 });
    saveSessionTrackBest(relPath, result);
    const accountBest = plectrBestFromUserState(undefined, relPath);
    expect(isBetterPlectrScore(result, accountBest)).toBe(true);
    expect(
      isBetterPlectrScore(
        result,
        pickBetterPlectrScore(getSessionTrackBest(relPath), accountBest)
      )
    ).toBe(false);
  });
});
