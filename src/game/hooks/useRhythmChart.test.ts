import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useRhythmChart } from "./useRhythmChart";
import type { ChartSet } from "../types";
import type { EnrichedTrack } from "../../types";

vi.mock("../lib/analyzeLibraryTrack", () => ({
  analyzeLibraryTrack: vi.fn(),
  prefetchRhythmChart: vi.fn(),
  RhythmAnalyzeError: class RhythmAnalyzeError extends Error {
    code = "fetch" as const;
  },
}));

vi.mock("../lib/chartCache", () => ({
  getCachedChart: vi.fn(() => null),
}));

import { analyzeLibraryTrack } from "../lib/analyzeLibraryTrack";
import { getCachedChart } from "../lib/chartCache";

function track(relPath: string): EnrichedTrack {
  return {
    relPath,
    title: relPath,
    artist: "A",
    album: "B",
    albumId: "a|b",
    meta: {},
  } as EnrichedTrack;
}

describe("useRhythmChart", () => {
  beforeEach(() => {
    vi.mocked(getCachedChart).mockReturnValue(null);
    vi.mocked(analyzeLibraryTrack).mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("restarts load after abort when relPath changes (no stuck loading)", async () => {
    const chartB = {
      baseSongId: "b",
      title: "b",
      duration: 60,
      charts: {},
    } as ChartSet;

    vi.mocked(analyzeLibraryTrack)
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockImplementationOnce(() => Promise.resolve(chartB));

    const { result, rerender } = renderHook(
      ({ tr }) => useRhythmChart(tr),
      { initialProps: { tr: track("a.mp3") } }
    );

    await waitFor(() => expect(result.current.phase).toBe("loading"));

    rerender({ tr: track("b.mp3") });
    await waitFor(() =>
      expect(analyzeLibraryTrack).toHaveBeenCalledWith(
        expect.objectContaining({ relPath: "b.mp3" }),
        expect.any(Function),
        expect.any(AbortSignal)
      )
    );

    await waitFor(() => expect(result.current.phase).toBe("ready"));
  });
});
