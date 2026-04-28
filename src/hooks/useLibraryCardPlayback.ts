import { useCallback } from "react";
import type { EnrichedTrack } from "../types";
import { usePlayer } from "../context/PlayerContext";
import { buildCardPlayQueueFromSeed } from "../lib/smartShuffle";

export function useLibraryCardPlayback(
  libraryTracks: readonly EnrichedTrack[] | undefined
) {
  const p = usePlayer();
  return useCallback(
    (seed: EnrichedTrack) => {
      if (!libraryTracks?.length) {
        p.playTrack(seed, [seed], 0);
        return;
      }
      const q = buildCardPlayQueueFromSeed(seed, libraryTracks);
      if (!q.length) return;
      p.playTrack(q[0]!, q, 0, { preserveQueueOrder: true });
    },
    [libraryTracks, p]
  );
}
