import { describe, expect, it } from "vitest";
import {
  ACHIEVEMENT_DEFINITIONS,
  ACHIEVEMENT_TITLES,
  ACHIEVEMENT_XP_TIERS,
  buildAchievementsSnapshot,
  computeAchievementXpBonus,
  computeBaseXp,
  computeTotalXp,
  LEVEL_XP_SCALE,
  levelForXp,
  numericLevelForXp,
  titleForNumericLevel,
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
  it("has 10 titles, unchanged XP tiers, and 65 achievements", () => {
    expect(ACHIEVEMENT_XP_TIERS).toHaveLength(10);
    expect(ACHIEVEMENT_TITLES[9]).toBe("KING OF KORD");
    expect(ACHIEVEMENT_DEFINITIONS).toHaveLength(65);
  });

  it("levelForXp maps numeric levels with title every 3 levels", () => {
    expect(levelForXp(0)).toMatchObject({ level: 1, title: "KICKER" });
    expect(levelForXp(99).level).toBe(2);
    expect(levelForXp(99).title).toBe("KICKER");
    expect(levelForXp(125).level).toBe(3);
    expect(levelForXp(125).title).toBe("KICKER");
    expect(levelForXp(250).level).toBe(4);
    expect(levelForXp(250).title).toBe("KRAFTER");
    expect(levelForXp(5499).level).toBe(17);
    expect(levelForXp(5499).title).toBe("KOMPONER");
    expect(levelForXp(5938).level).toBe(18);
    expect(levelForXp(6875)).toMatchObject({ level: 19, title: "KREATOR" });
    expect(levelForXp(7813).level).toBe(20);
    expect(levelForXp(7813).title).toBe("KREATOR");
    expect(levelForXp(9000).level).toBe(21);
    expect(levelForXp(9000).title).toBe("KREATOR");
  });

  it("LEVEL_XP_SCALE makes progression slightly harder", () => {
    expect(LEVEL_XP_SCALE).toBeGreaterThan(1);
    expect(levelForXp(1781)).toMatchObject({ level: 10, title: "KEEPER OF KORD" });
  });

  it("max completion XP unlocks all badges", () => {
    const signals = {
      totalPlays: 7500,
      favoritesCount: 200,
      playlistsCount: 20,
      artistsWithPlays: 100,
      genresWithPlays: 20,
      tracksWithPlays: 1500,
      shuffleBlocks: 25,
      libraryTrackCount: 2000,
      topArtistPlays: 100,
      topTrackPlays: 20,
      albumsWithPlays: 50,
      playlistTrackCount: 30,
      streak: 30,
      plectrTracksPlayed: 500,
    };
    const unlocked = ACHIEVEMENT_DEFINITIONS.filter((a) =>
      a.check(signals)
    ).length;
    expect(unlocked).toBe(65);
    expect(computeBaseXp(signals)).toBe(9050);
    expect(computeAchievementXpBonus(signals)).toBe(6105);
    expect(computeTotalXp(signals)).toBe(15155);
  });

  it("titleForNumericLevel changes every 3 levels and caps at KING OF KORD", () => {
    expect(titleForNumericLevel(1)).toBe("KICKER");
    expect(titleForNumericLevel(3)).toBe("KICKER");
    expect(titleForNumericLevel(4)).toBe("KRAFTER");
    expect(titleForNumericLevel(28)).toBe("KING OF KORD");
    expect(titleForNumericLevel(30)).toBe("KING OF KORD");
    expect(titleForNumericLevel(50)).toBe("KING OF KORD");
  });

  it("numericLevelForXp grows without cap", () => {
    expect(numericLevelForXp(20_000)).toBeGreaterThan(20);
  });

  it("xpProgressInLevel advances within numeric level", () => {
    const tier = levelForXp(150);
    expect(tier.level).toBe(3);
    expect(xpProgressInLevel(150, tier).pct).toBe(20);
    const top = levelForXp(374);
    expect(top.level).toBe(4);
    expect(xpProgressInLevel(374, top).pct).toBe(99);
    const high = levelForXp(9000);
    expect(xpProgressInLevel(9000, high).pct).toBeLessThan(100);
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
