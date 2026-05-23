import { describe, expect, it } from "vitest";
import {
  flushDelayMsForPending,
  FLUSH_DELAY_DEFAULT_MS,
  FLUSH_DELAY_QUEUE_MS,
  mergeSavedUserState,
  mergeUserStatePatches,
} from "./userStatePatch";
import type { UserStateV1 } from "../types";

function baseState(): UserStateV1 {
  return {
    version: 1,
    revision: 2,
    favorites: ["a.mp3"],
    recent: [],
    trackPlayCounts: {},
    playlists: [],
    queue: {
      tracks: [{ id: "1", relPath: "a.mp3", title: "A", artist: "X", album: "Y" }],
      currentIndex: 0,
    },
    settings: {
      theme: "midnight",
      vizMode: "hmb",
      restoreSession: true,
      defaultTab: "dashboard",
      locale: "en",
      libBrowse: "artists",
      libOverviewSort: "name",
      artistAlbumSort: "date",
      audioCrossfadeSec: 3,
    },
    shuffleExcludedAlbumIds: [],
    shuffleExcludedTrackRelPaths: [],
  };
}

describe("userStatePatch", () => {
  it("flushDelayMsForPending uses queue delay only for queue-only pending", () => {
    expect(flushDelayMsForPending({ queue: { tracks: [], currentIndex: 0 } })).toBe(
      FLUSH_DELAY_QUEUE_MS
    );
    expect(
      flushDelayMsForPending({
        queue: { tracks: [], currentIndex: 0 },
        favorites: ["x"],
      })
    ).toBe(FLUSH_DELAY_DEFAULT_MS);
  });

  it("mergeSavedUserState keeps queue when patch was only trackPlayCounts", () => {
    const prev = baseState();
    const saved: UserStateV1 = {
      ...prev,
      revision: 3,
      queue: { tracks: [], currentIndex: 0 },
      trackPlayCounts: { "a.mp3": 5 },
    };
    const merged = mergeSavedUserState(
      prev,
      saved,
      { trackPlayCounts: { "a.mp3": 5 } },
      (s) => s
    );
    expect(merged.queue.tracks).toHaveLength(1);
    expect(merged.trackPlayCounts["a.mp3"]).toBe(5);
  });

  it("mergeUserStatePatches merges queue and favorites", () => {
    const merged = mergeUserStatePatches(
      { favorites: ["old.mp3"] },
      { queue: { tracks: [], currentIndex: 0 }, favorites: ["new.mp3"] }
    );
    expect(merged.favorites).toEqual(["new.mp3"]);
    expect(merged.queue).toEqual({ tracks: [], currentIndex: 0 });
  });

  it("mergeUserStatePatches merges plectrBests by relPath", () => {
    const merged = mergeUserStatePatches(
      {
        plectrBests: {
          "a.mp3": {
            score: 100,
            grade: "B",
            accuracy: 0.8,
            maxCombo: 5,
            hits: 10,
          },
        },
      },
      {
        plectrBests: {
          "b.mp3": {
            score: 200,
            grade: "A",
            accuracy: 0.9,
            maxCombo: 8,
            hits: 15,
          },
        },
      }
    );
    expect(Object.keys(merged.plectrBests ?? {})).toEqual(["a.mp3", "b.mp3"]);
  });
});
