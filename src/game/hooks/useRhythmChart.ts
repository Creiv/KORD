import { useCallback, useEffect, useRef, useState } from "react";
import {
  analyzeLibraryTrack,
  prefetchRhythmChart,
  RhythmAnalyzeError,
} from "../lib/analyzeLibraryTrack";
import { getCachedChart } from "../lib/chartCache";
import { sanitizeChartSetForKord } from "../lib/chartSanitize";
import type { ChartSet } from "../types";
import type { EnrichedTrack } from "../../types";

export type RhythmChartPhase = "idle" | "loading" | "ready" | "error";

export function useRhythmChart(track: EnrichedTrack | null) {
  const trackRef = useRef(track);
  trackRef.current = track;
  const loadGenRef = useRef(0);

  const [phase, setPhase] = useState<RhythmChartPhase>("idle");
  const [chartSet, setChartSet] = useState<ChartSet | null>(null);
  const [loadMessage, setLoadMessage] = useState("");
  const [errorCode, setErrorCode] = useState<
    "fetch" | "decode" | "sparse" | "timeout" | null
  >(null);

  const reset = useCallback(() => {
    setPhase("idle");
    setChartSet(null);
    setLoadMessage("");
    setErrorCode(null);
  }, []);

  useEffect(() => {
    if (!track) {
      reset();
      return;
    }

    const relPath = track.relPath;
    const gen = ++loadGenRef.current;
    const cached = getCachedChart(relPath);
    if (cached) {
      setChartSet(sanitizeChartSetForKord(cached));
      setPhase("ready");
      setErrorCode(null);
      prefetchRhythmChart(track);
      return;
    }
    const abort = new AbortController();

    setPhase("loading");
    setChartSet(null);
    setErrorCode(null);
    setLoadMessage("fetch");

    void (async () => {
      const tr = trackRef.current;
      if (!tr || tr.relPath !== relPath) return;

      try {
        const set = await analyzeLibraryTrack(
          tr,
          (_p, message) => {
            if (!abort.signal.aborted && loadGenRef.current === gen) {
              setLoadMessage(message);
            }
          },
          abort.signal
        );
        if (abort.signal.aborted || loadGenRef.current !== gen) return;
        setChartSet(set);
        setPhase("ready");
        setErrorCode(null);
        prefetchRhythmChart(tr);
      } catch (err) {
        if (abort.signal.aborted || loadGenRef.current !== gen) return;
        if (err instanceof RhythmAnalyzeError) {
          setErrorCode(err.code);
        } else {
          setErrorCode("decode");
        }
        setPhase("error");
      }
    })();

    return () => {
      abort.abort();
    };
  }, [track?.relPath, reset]);

  return { phase, chartSet, loadMessage, errorCode, reset };
}
