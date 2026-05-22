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
import { useI18n } from "../../i18n/useI18n";
import { GameCanvas } from "../../game/components/GameCanvas";
import { DIFFICULTIES } from "../../game/config/gameConfig";
import { useRhythmChart } from "../../game/hooks/useRhythmChart";
import { prefetchRhythmChart } from "../../game/lib/analyzeLibraryTrack";
import {
  getSessionTrackBest,
  hydrateSessionTrackBest,
  saveSessionTrackBest,
} from "../../game/lib/sessionScores";
import {
  cachePlectrBestLocal,
  isBetterPlectrScore,
  persistPlectrBest,
  pickBetterPlectrScore,
  plectrBestFromTrack,
} from "../../game/lib/plectrStorage";
import type {
  Chart,
  DifficultyId,
  GameResult,
} from "../../game/types";
import type { EnrichedTrack, LibraryEntityDelta } from "../../types";
import { UiClose, UiJoystick } from "../KordUiIcons";

const DIFFICULTY_KEY = "kord-plectr-difficulty";

function migrateDifficulty(raw: string | null): DifficultyId {
  if (raw === "extreme") return "hard";
  if (raw === "hard") return "normal";
  if (raw === "normal") return "easy";
  if (raw === "easy" || raw === "normal" || raw === "hard") return raw;
  return "easy";
}

function loadDifficulty(): DifficultyId {
  try {
    return migrateDifficulty(localStorage.getItem(DIFFICULTY_KEY));
  } catch {
    /* ignore */
  }
  return "easy";
}

function resolveDisplayBest(
  relPath: string,
  track: EnrichedTrack
): GameResult | null {
  return pickBetterPlectrScore(
    getSessionTrackBest(relPath),
    plectrBestFromTrack(track)
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

  const [difficulty, setDifficulty] = useState<DifficultyId>(loadDifficulty);
  const [runId, setRunId] = useState(0);
  const [lastResult, setLastResult] = useState<GameResult | null>(null);
  const [bestRevision, setBestRevision] = useState(0);
  const wasPlayingRef = useRef(false);
  const lastRunRef = useRef<GameResult | null>(null);

  const displayBest = useMemo(
    () => resolveDisplayBest(track.relPath, track),
    [track, track.relPath, track.meta?.plectrBest, bestRevision]
  );

  const chart = useMemo((): Chart | null => {
    if (!chartSet) return null;
    return chartSet.charts[difficulty] ?? null;
  }, [chartSet, difficulty]);

  useLayoutEffect(() => {
    wasPlayingRef.current = p.isPlaying;
  }, []);

  useLayoutEffect(() => {
    setLastResult(null);
    setRunId(0);
    lastRunRef.current = null;
    hydrateSessionTrackBest(track.relPath, track);
    setBestRevision((n) => n + 1);
  }, [track.relPath]);

  useLayoutEffect(() => {
    hydrateSessionTrackBest(track.relPath, track);
    setBestRevision((n) => n + 1);
  }, [track.meta?.plectrBest, track.relPath]);

  const playerSync = useMemo(
    () => ({
      getCurrentTime: () => {
        const audio = p.audioRef.current;
        return audio ? audio.currentTime : p.currentTime;
      },
      getAudio: () => p.audioRef.current,
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
    [p]
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

  const onDifficulty = useCallback((id: DifficultyId) => {
    setDifficulty(id);
    setLastResult(null);
    setRunId((n) => n + 1);
    try {
      localStorage.setItem(DIFFICULTY_KEY, id);
    } catch {
      /* ignore */
    }
  }, []);

  const syncRunScore = useCallback(
    (result: GameResult) => {
      if (result.score <= 0 && result.hits <= 0) return;
      lastRunRef.current = result;
      const baseline = resolveDisplayBest(track.relPath, track);
      saveSessionTrackBest(track.relPath, result);
      cachePlectrBestLocal(track.relPath, result, baseline);
      setBestRevision((n) => n + 1);
    },
    [track]
  );

  const persistRunScore = useCallback(
    (result: GameResult, showLast = false) => {
      if (result.score <= 0 && result.hits <= 0) return;
      lastRunRef.current = result;
      const baseline = resolveDisplayBest(track.relPath, track);
      saveSessionTrackBest(track.relPath, result);
      setBestRevision((n) => n + 1);
      if (showLast) setLastResult(result);
      if (!isBetterPlectrScore(result, baseline)) return;
      void persistPlectrBest(track.relPath, result, baseline).then(({ delta }) => {
        if (delta && onLibraryDelta) onLibraryDelta(delta, false);
      });
    },
    [onLibraryDelta, track]
  );

  const onRunUpdate = useCallback(
    (result: GameResult) => {
      syncRunScore(result);
    },
    [syncRunScore]
  );

  const onFinish = useCallback(
    (result: GameResult) => {
      persistRunScore(result, true);
    },
    [persistRunScore]
  );

  const onReplay = useCallback(() => {
    setLastResult(null);
    setRunId((n) => n + 1);
  }, []);

  const onClose = useCallback(() => {
    if (lastRunRef.current) {
      persistRunScore(lastRunRef.current, false);
    }
    setOpen(false);
    if (wasPlayingRef.current && !p.isPlaying) {
      p.play();
    }
  }, [p, persistRunScore, setOpen]);

  return (
    <section
      className="rhythm-dock-panel"
      aria-label={t("plectr.title")}
    >
      <header className="rhythm-dock-panel__head">
        <div className="rhythm-dock-panel__head-top">
          <div className="rhythm-dock-panel__brand">
            <UiJoystick className="rhythm-dock-panel__brand-ic" aria-hidden />
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
                <span className="rhythm-dock-panel__record-label">
                  {t("rhythm.statBest")}
                </span>
                <strong>
                  {displayBest.score.toLocaleString()}
                  {displayBest.grade ? ` · ${displayBest.grade}` : ""}
                </strong>
              </>
            ) : (
              <>
                <span className="rhythm-dock-panel__record-label">
                  {t("rhythm.statBest")}
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
                  difficulty === d.id ? " is-active" : ""
                }`}
                disabled={disabled || phase !== "ready"}
                aria-pressed={difficulty === d.id}
                onClick={() => onDifficulty(d.id)}
              >
                {d.label}
              </button>
            );
          })}
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
            key={`${chart.songId}-${difficulty}-${runId}`}
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
