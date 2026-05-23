import { describe, expect, it } from "vitest";
import { buildExtremeChart } from "./extremeChart";
import type { Chart } from "../types";

function tapChart(notes: { time: number; lane: number }[]): Chart {
  return {
    songId: "test:hard",
    baseSongId: "test",
    difficulty: {
      id: "hard",
      label: "Hard",
      tag: "4B",
      level: 14,
      onsetAdjust: 0,
      cooldownBase: 0.2,
      cooldownDrop: 0.1,
      cooldownMin: 0.1,
      pulseModulo: 3,
      holdEvery: 2,
      holdIntensity: 0.2,
      swipeEvery: 0,
      swipeIntensity: 1,
    },
    title: "Test",
    duration: 60,
    notes: notes.map((n, id) => ({
      id,
      type: "tap" as const,
      direction: null,
      time: n.time,
      lane: n.lane,
      endLane: null,
      duration: 0,
      hit: false,
      missed: false,
      holding: false,
      completed: false,
    })),
    stats: { bpm: 120, rmsAvg: 0.1, density: 1 },
  };
}

describe("buildExtremeChart", () => {
  it("adds spaced hold notes without mirroring every hard tap", () => {
    const base = tapChart(
      Array.from({ length: 24 }, (_, i) => ({
        time: 4 + i * 0.35,
        lane: i % 4,
      })),
    );
    const extreme = buildExtremeChart(base);
    const holds = extreme.notes.filter((n) => n.type === "hold" && n.duration > 0);
    const taps = extreme.notes.filter((n) => n.type === "tap");
    expect(holds.length).toBeGreaterThan(0);
    expect(taps.length).toBeGreaterThan(holds.length);
    expect(extreme.songId).toContain("extreme");
  });
});
