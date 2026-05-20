import { describe, expect, it } from "vitest";
import {
  ACHIEVEMENT_DEFINITIONS,
  ACHIEVEMENT_RANKS,
  buildAchievementsSnapshot,
  computeTotalXp,
  levelForXp,
  xpProgressInLevel,
  touchListeningActivity,
  writeStreakState,
} from "./achievements";
import type { UserStateV1 } from "../types";

function emptyState(): Pick<
  UserStateV1,
  | "trackPlayCounts"
  | "favorites"
  | "playlists"
  | "shuffleExcludedAlbumIds"
  | "shuffleExcludedTrackRelPaths"
> {
  return {
    trackPlayCounts: {},
    favorites: [],
    playlists: [],
    shuffleExcludedAlbumIds: [],
    shuffleExcludedTrackRelPaths: [],
  };
}

describe("achievements", () => {
  it("has 10 levels and at least 40 achievements", () => {
    expect(ACHIEVEMENT_RANKS).toHaveLength(10);
    expect(ACHIEVEMENT_RANKS[9].title).toBe("KING OF KORD");
    expect(ACHIEVEMENT_DEFINITIONS).toHaveLength(60);
  });

  it("levelForXp maps tiers", () => {
    expect(levelForXp(0).level).toBe(1);
    expect(levelForXp(0).title).toBe("KICKER");
    expect(levelForXp(99).level).toBe(1);
    expect(levelForXp(100).level).toBe(2);
    expect(levelForXp(5500).level).toBe(10);
  });

  it("xpProgressInLevel fills bar at max rank and within tier", () => {
    const max = levelForXp(9000);
    expect(xpProgressInLevel(9000, max).pct).toBe(100);
    const tier = levelForXp(150);
    expect(tier.level).toBe(2);
    expect(xpProgressInLevel(150, tier).pct).toBe(25);
    expect(xpProgressInLevel(299, tier).pct).toBe(100);
  });

  it("computeTotalXp grows with plays and achievements", () => {
    const signals = buildAchievementsSnapshot(
      {
        ...emptyState(),
        trackPlayCounts: { "a.mp3": 10 },
        favorites: ["a.mp3"],
      },
      null
    ).signals;
    expect(computeTotalXp(signals)).toBeGreaterThan(10);
  });

  it("touchListeningActivity increments streak on consecutive days", () => {
    writeStreakState({ count: 2, lastDate: "2026-05-19" });
    const next = touchListeningActivity(new Date("2026-05-20T12:00:00"));
    expect(next.count).toBe(3);
    expect(next.lastDate).toBe("2026-05-20");
  });

  it("touchListeningActivity resets after a gap", () => {
    writeStreakState({ count: 5, lastDate: "2026-05-10" });
    const next = touchListeningActivity(new Date("2026-05-20T12:00:00"));
    expect(next.count).toBe(1);
  });
});
