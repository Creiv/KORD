import {
  memo,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePlayer } from "../../context/PlayerContext";
import { useRhythmMode } from "../../context/RhythmModeContext";
import { useUserState } from "../../context/UserStateContext";
import { useI18n } from "../../i18n/useI18n";
import { GameCanvas } from "../../game/components/GameCanvas";
import { DIFFICULTIES } from "../../game/config/gameConfig";
import { useRhythmChart } from "../../game/hooks/useRhythmChart";
import { prefetchRhythmChart } from "../../game/lib/analyzeLibraryTrack";
import { buildExtremeChart } from "../../game/lib/extremeChart";
import {
  loadPlectrPlayMode,
  savePlectrPlayMode,
  type PlectrPlayMode,
} from "../../game/lib/plectrDifficultyStorage";
import {
  getSessionTrackBest,
  hydrateSessionTrackBest,
  saveSessionTrackBest,
} from "../../game/lib/sessionScores";
import {
  isBetterPlectrScore,
  persistPlectrBest,
  pickBetterPlectrScore,
  plectrBestFromUserState,
} from "../../game/lib/plectrStorage";
import type { Chart, GameResult } from "../../game/types";
import { audioElementMatchesTrack } from "../../lib/mediaTrackMatch";
import type { EnrichedTrack, LibraryEntityDelta, PlectrBestScore } from "../../types";
import { UiClose, UiEmojiEvents, UiPlectrum } from "../KordUiIcons";

function resolveDisplayBest(
  relPath: string,
  plectrBests: Record<string, PlectrBestScore> | undefined
): GameResult | null {
  return pickBetterPlectrScore(
    getSessionTrackBest(relPath),
    plectrBestFromUserState(plectrBests, relPath)
  );
}

interface RhythmDockPanelProps {
  track: EnrichedTrack;
  onLibraryDelta?: (delta: LibraryEntityDelta, reconcile?: boolean) => void;
}

export const RhythmDockPanel = memo(function RhythmDockPanel({
  track,
  onLibraryDelta,
}: RhythmDockPanelProps) {
  const { t } = useI18n();
  const p = usePlayer();
  const user = useUserState();
  const { setOpen } = useRhythmMode();
  const { phase, chartSet, loadMessage, errorCode } = useRhythmChart(track);

  useLayoutEffect(() => {
    if (phase !== "ready" || p.queue.length < 2) return;
    const idx = p.currentIndex;
    if (idx < 0 || idx >= p.queue.length) return;
    const nextIdx = (idx + 1) % p.queue.length;
    const next = p.queue[nextIdx];
    if (next && next.relPath !== track.relPath) {
      prefetchRhythmChart(next);
    }
  }, [phase, p.currentIndex, p.queue, track.relPath]);

  const [playMode, setPlayMode] = useState<PlectrPlayMode>(loadPlectrPlayMode);
  const [runId, setRunId] = useState(0);
  const [lastResult, setLastResult] = useState<GameResult | null>(null);
  const [bestRevision, setBestRevision] = useState(0);
  const resumePlaybackOnCloseRef = useRef(false);
  const lastRunRef = useRef<GameResult | null>(null);
  const prevTrackRelRef = useRef(track.relPath);

  const displayBest = useMemo(
    () => resolveDisplayBest(track.relPath, user.state.plectrBests),
    [track.relPath, user.state.plectrBests, bestRevision]
  );

  const chart = useMemo((): Chart | null => {
    if (playMode === "extreme") {
      const hard = chartSet?.charts.hard;
      return hard ? buildExtremeChart(hard) : null;
    }
    if (!chartSet) return null;
    return chartSet.charts[playMode] ?? null;
  }, [chartSet, playMode]);

  useLayoutEffect(() => {
    resumePlaybackOnCloseRef.current = p.isPlaying;
  }, [p.isPlaying]);

  const persistRunScore = useCallback(
    (relPath: string, result: GameResult, showLast = false) => {
      if (result.score <= 0 && result.hits <= 0) return;
      lastRunRef.current = result;
      const accountBest = plectrBestFromUserState(user.state.plectrBests, relPath);
      saveSessionTrackBest(relPath, result);
      setBestRevision((n) => n + 1);
      if (showLast && relPath === track.relPath) setLastResult(result);
      // Confronta solo col record account: la sessione può già avere lo stesso
      // punteggio (syncRunScore) e altrimenti non si persiste mai su server.
      if (!isBetterPlectrScore(result, accountBest)) return;
      user.savePlectrBest(relPath, result);
      void persistPlectrBest(relPath, result, accountBest).then(({ delta }) => {
        if (delta && onLibraryDelta) onLibraryDelta(delta, false);
      });
    },
    [onLibraryDelta, track.relPath, user]
  );

  const flushPendingRun = useCallback(
    (relPath: string) => {
      const pending = lastRunRef.current;
      if (!pending) return;
      persistRunScore(relPath, pending, false);
      lastRunRef.current = null;
      user.flushUserStateNow();
    },
    [persistRunScore, user]
  );

  useLayoutEffect(() => {
    const prevRel = prevTrackRelRef.current;
    if (prevRel !== track.relPath) {
      flushPendingRun(prevRel);
      prevTrackRelRef.current = track.relPath;
      setLastResult(null);
      setRunId((n) => n + 1);
      lastRunRef.current = null;
    }
    hydrateSessionTrackBest(track.relPath, user.state.plectrBests);
    setBestRevision((n) => n + 1);
  }, [track.relPath, user.state.plectrBests, flushPendingRun]);

  const playerSync = useMemo(
    () => ({
      getCurrentTime: () => {
        const audio = p.audioRef.current;
        if (audio && audioElementMatchesTrack(audio, track.relPath)) {
          return audio.currentTime;
        }
        return 0;
      },
      getAudio: () => {
        const audio = p.audioRef.current;
        if (audio && audioElementMatchesTrack(audio, track.relPath)) {
          return audio;
        }
        return null;
      },
      seek: (seconds: number) => {
        p.seek(seconds);
      },
      play: async () => {
        p.play();
      },
      pause: () => {
        if (p.isPlaying) p.pause();
      },
    }),
    [p, track.relPath]
  );

  const gameLabels = useMemo(
    () => ({
      score: t("rhythm.hudScore"),
      combo: t("rhythm.hudCombo"),
      start: t("rhythm.start"),
      pause: "",
      resume: "",
      timeAria: t("rhythm.timeAria"),
    }),
    [t]
  );

  const loadLabel = useMemo(() => {
    if (loadMessage === "fetch") return t("rhythm.analyzingFetch");
    if (loadMessage === "decode") return t("rhythm.analyzingDecode");
    return t("rhythm.analyzingChart");
  }, [loadMessage, t]);

  const onPlayMode = useCallback((id: PlectrPlayMode) => {
    setPlayMode(id);
    savePlectrPlayMode(id);
    setLastResult(null);
    setRunId((n) => n + 1);
  }, []);

  const syncRunScore = useCallback(
    (result: GameResult) => {
      if (result.score <= 0 && result.hits <= 0) return;
      lastRunRef.current = result;
      saveSessionTrackBest(track.relPath, result);
      setBestRevision((n) => n + 1);
    },
    [track.relPath]
  );

  const onRunUpdate = useCallback(
    (result: GameResult) => {
      syncRunScore(result);
    },
    [syncRunScore]
  );

  const onFinish = useCallback(
    (result: GameResult) => {
      persistRunScore(track.relPath, result, true);
    },
    [persistRunScore, track.relPath]
  );

  const onReplay = useCallback(() => {
    setLastResult(null);
    setRunId((n) => n + 1);
  }, []);

  const flushPendingRunRef = useRef(flushPendingRun);
  const flushUserStateNowRef = useRef(user.flushUserStateNow);
  flushPendingRunRef.current = flushPendingRun;
  flushUserStateNowRef.current = user.flushUserStateNow;

  const onClose = useCallback(() => {
    flushPendingRun(track.relPath);
    user.flushUserStateNow();
    setOpen(false);
    if (resumePlaybackOnCloseRef.current && !p.isPlaying) {
      p.play();
    }
  }, [flushPendingRun, p, setOpen, track.relPath, user]);

  useLayoutEffect(() => {
    return () => {
      flushPendingRunRef.current(prevTrackRelRef.current);
      flushUserStateNowRef.current();
    };
  }, []);

  return (
    <section
      className="rhythm-dock-panel"
      aria-label={t("plectr.title")}
    >
      <header className="rhythm-dock-panel__head">
        <div className="rhythm-dock-panel__head-top">
          <div className="rhythm-dock-panel__brand">
            <UiPlectrum className="rhythm-dock-panel__brand-ic" aria-hidden />
            <span>{t("plectr.title")}</span>
          </div>
          <p className="rhythm-dock-panel__record" aria-live="polite">
            {lastResult ? (
              <>
                <span className="rhythm-dock-panel__record-label">
                  {t("rhythm.lastRun")}
                </span>
                <strong>
                  {lastResult.score.toLocaleString()}
                  {lastResult.grade ? ` · ${lastResult.grade}` : ""}
                </strong>
              </>
            ) : displayBest ? (
              <>
                <span
                  className="rhythm-dock-panel__record-label rhythm-dock-panel__record-label--trophy"
                  aria-label={t("rhythm.statBest")}
                >
                  <UiEmojiEvents
                    className="rhythm-dock-panel__trophy-ic"
                    aria-hidden
                  />
                </span>
                <strong>
                  {displayBest.score.toLocaleString()}
                  {displayBest.grade ? ` · ${displayBest.grade}` : ""}
                </strong>
              </>
            ) : (
              <>
                <span
                  className="rhythm-dock-panel__record-label rhythm-dock-panel__record-label--trophy"
                  aria-label={t("rhythm.statBest")}
                >
                  <UiEmojiEvents
                    className="rhythm-dock-panel__trophy-ic"
                    aria-hidden
                  />
                </span>
                <span className="rhythm-dock-panel__record-empty">—</span>
              </>
            )}
          </p>
          <div className="rhythm-dock-panel__head-actions">
            {lastResult ? (
              <button
                type="button"
                className="rhythm-dock-panel__replay"
                onClick={onReplay}
              >
                {t("rhythm.replay")}
              </button>
            ) : null}
            <button
              type="button"
              className="rhythm-dock-panel__close"
              onClick={onClose}
              aria-label={t("rhythm.exit")}
            >
              <UiClose className="rhythm-dock-panel__close-ic" />
            </button>
          </div>
        </div>

        <div
          className="rhythm-dock-panel__diffs"
          role="group"
          aria-label={t("rhythm.difficulty")}
        >
          {DIFFICULTIES.map((d) => {
            const count = chartSet?.charts[d.id]?.notes.length ?? 0;
            const disabled = count < 12;
            return (
              <button
                key={d.id}
                type="button"
                className={`rhythm-dock-panel__diff${
                  playMode === d.id ? " is-active" : ""
                }`}
                disabled={disabled || phase !== "ready"}
                aria-pressed={playMode === d.id}
                onClick={() => onPlayMode(d.id)}
              >
                {d.label}
              </button>
            );
          })}
          <button
            type="button"
            className={`rhythm-dock-panel__diff rhythm-dock-panel__diff--extreme${
              playMode === "extreme" ? " is-active" : ""
            }`}
            disabled={
              (chartSet?.charts.hard?.notes.length ?? 0) < 12 ||
              phase !== "ready"
            }
            aria-pressed={playMode === "extreme"}
            onClick={() => onPlayMode("extreme")}
          >
            Extreme
          </button>
        </div>
      </header>

      <div className="rhythm-dock-panel__body">
        {phase === "loading" ? (
          <div className="rhythm-dock-panel__status">
            <p>{loadLabel}</p>
            <p className="rhythm-dock-panel__status-sub">
              {t("rhythm.analyzingKeepPlaying")}
            </p>
          </div>
        ) : null}

        {phase === "error" ? (
          <div className="rhythm-dock-panel__status rhythm-dock-panel__status--error">
            <p>
              {errorCode
                ? t(`rhythm.errors.${errorCode}`)
                : t("rhythm.errors.decode")}
            </p>
          </div>
        ) : null}

        {phase === "ready" && chart ? (
          <GameCanvas
            key={`${track.relPath}-${playMode}-${runId}`}
            chart={chart}
            runId={runId}
            embedded
            syncLive
            playerSync={playerSync}
            onFinish={onFinish}
            onRunUpdate={onRunUpdate}
            labels={gameLabels}
          />
        ) : null}
      </div>
    </section>
  );
});
