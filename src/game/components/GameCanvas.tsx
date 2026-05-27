import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  COUNTDOWN_SECONDS,
  DOCK_HIT_LINE_BOTTOM_MAX_PX,
  DOCK_HIT_LINE_BOTTOM_MIN_PX,
  DOCK_HIT_LINE_Y,
  DOCK_NOTE_SPEED,
  HIT_LINE_Y,
  HIT_WINDOWS,
  HOLD_WIDTH,
  LANES,
  NOTE_SPEED,
} from "../config/gameConfig";
import { roundedRect } from "../lib/canvasDrawing";
import { clamp } from "../lib/math";
import { resolveRunEndTime } from "../lib/runTiming";
import { buildGameResult } from "../lib/runResult";
import type { Chart, ChartNote, GameResult, Lane } from "../types";
import { FeedbackBadge } from "./FeedbackBadge";

export interface PlayerSyncBridge {
  getCurrentTime: () => number;
  getAudio: () => HTMLAudioElement | null;
  seek: (seconds: number) => void;
  play: () => Promise<void>;
  pause: () => void;
}

interface GameCanvasProps {
  chart: Chart;
  runId: number;
  onFinish: (result: GameResult) => void;
  /** Aggiornamento punteggio in corso (dock / sync live). */
  onRunUpdate?: (result: GameResult) => void;
  audioUrl?: string;
  playerSync?: PlayerSyncBridge;
  /** Integrato nel player dock: layout compatto, senza trappola history. */
  embedded?: boolean;
  /** Avvia countdown subito (modalità standalone). */
  autoBegin?: boolean;
  /** Segue il player RE-KORD: niente countdown, note in sync col tempo corrente. */
  syncLive?: boolean;
  labels?: {
    score: string;
    combo: string;
    start: string;
    pause: string;
    resume: string;
    timeAria: string;
  };
}

interface RunState {
  notes: ChartNote[];
  activeHolds: ChartNote[];
  score: number;
  combo: number;
  maxCombo: number;
  hits: number;
  misses: number;
  health: number;
  feedback: string;
  feedbackPulse: number;
  songTime: number;
  offset: number;
  paused: boolean;
  started: boolean;
  startedAt: number;
  countdownUntil: number;
  playStartAt: number;
  audioStartRequested: boolean;
  pressedLanes: boolean[];
  laneFlash: Array<{ kind: "hit" | "miss"; until: number } | null>;
  /** Orologio fluido: ancorato al player audio ma avanzato con performance.now(). */
  clockAnchorSong: number;
  clockAnchorPerf: number;
  /** Ultimo frame per delta nel clock fluido (syncLive). */
  smoothFramePerf: number;
  missScanIndex: number;
  finished: boolean;
  /** syncLive: note esaurite, in attesa della fine del brano nel player. */
  awaitingTrackEnd: boolean;
}

type LaneFlashKind = "hit" | "miss" | null;

/** Aggiorna i pad DOM solo al flash hit/miss (non ogni frame). */
const laneFlashNotifier = { sync: null as (() => void) | null };

interface DrawContext {
  cssWidth: number;
  cssHeight: number;
  hitY: number;
  laneWidth: number;
  noteSpeed: number;
  songTime: number;
  state: RunState;
  lite: boolean;
}

const DEFAULT_LABELS = {
  score: "Score",
  combo: "Combo",
  start: "Start",
  pause: "Pause",
  resume: "Resume",
  timeAria: "Song progress",
};

/** Seek / drift grande: riallinea subito al player. */
const CLOCK_HARD_SYNC_THRESHOLD_SECONDS = 0.45;
/** Costante tempo per inseguire audio.currentTime senza scatti a intervalli fissi. */
const CLOCK_SMOOTH_TAU_SECONDS = 0.14;
/** Sotto questa soglia l’extrapolazione performance.now basta (niente micro-correzioni). */
const CLOCK_MIN_CORRECTION_SECONDS = 0.0025;

export function GameCanvas({
  chart,
  audioUrl,
  runId,
  onFinish,
  onRunUpdate,
  playerSync,
  embedded = false,
  autoBegin = false,
  syncLive = false,
  labels: labelsProp,
}: GameCanvasProps) {
  const labels = { ...DEFAULT_LABELS, ...labelsProp };
  const usePlayer = Boolean(playerSync);
  const gameRef = useRef<HTMLElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef(0);
  const drawRef = useRef<() => void>(() => {});
  const stateRef = useRef<RunState | null>(null);
  const hudSyncRef = useRef({
    score: -1,
    combo: -1,
    feedback: "",
    feedbackPulse: -1,
    at: 0,
  });
  const lastRunUpdateScoreRef = useRef(-1);
  const lanePressReleaseTimersRef = useRef<
    Array<ReturnType<typeof setTimeout> | null>
  >([null, null, null, null]);
  const [pressedLanes, setPressedLanes] = useState([false, false, false, false]);
  const [holdingLanes, setHoldingLanes] = useState([false, false, false, false]);
  const [laneFlash, setLaneFlash] = useState<LaneFlashKind[]>([null, null, null, null]);
  const canvasLayoutRef = useRef({ width: 0, height: 0, dpr: 1, bufferW: 0, bufferH: 0 });

  const syncLaneFlashUi = useCallback(() => {
    const s = stateRef.current;
    if (!s) return;
    const now = performance.now();
    setLaneFlash(s.laneFlash.map((f) => (f && f.until > now ? f.kind : null)));
    const nextHold = LANES.map((_, i) =>
      s.activeHolds.some(
        (n) =>
          n.holding &&
          !n.completed &&
          (n.lane === i || noteEndLane(n) === i),
      ),
    );
    setHoldingLanes((prev) =>
      prev.every((v, i) => v === nextHold[i]) ? prev : nextHold,
    );
  }, []);

  useLayoutEffect(() => {
    laneFlashNotifier.sync = syncLaneFlashUi;
    return () => {
      laneFlashNotifier.sync = null;
    };
  }, [syncLaneFlashUi]);
  const [waitingForStart, setWaitingForStart] = useState(true);
  const canvasLite = embedded || syncLive;

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const applySize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
      const width = Math.max(1, rect.width);
      const height = Math.max(1, rect.height);
      const bufferW = Math.max(1, Math.floor(width * dpr));
      const bufferH = Math.max(1, Math.floor(height * dpr));
      canvasLayoutRef.current = { width, height, dpr, bufferW, bufferH };
      if (canvas.width !== bufferW || canvas.height !== bufferH) {
        canvas.width = bufferW;
        canvas.height = bufferH;
      }
    };

    applySize();
    const ro = new ResizeObserver(applySize);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  const [hud, setHud] = useState({
    score: 0,
    combo: 0,
    health: 100,
    feedback: "Ready",
    feedbackPulse: 0,
    paused: false,
    countdown: COUNTDOWN_SECONDS,
    elapsed: 0,
    progress: 0,
  });

  const resetAudio = useCallback(() => {
    if (usePlayer && syncLive) {
      return;
    }
    if (usePlayer) {
      playerSync?.pause();
      return;
    }
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.onended = null;
    }
  }, [playerSync, syncLive, usePlayer]);

  const finish = useCallback(
    (failed: boolean) => {
      const state = stateRef.current;
      if (!state || state.finished) return;
      state.finished = true;
      resetAudio();
      cancelAnimationFrame(rafRef.current);
      onFinish(
        buildGameResult(
          {
            score: state.score,
            maxCombo: state.maxCombo,
            hits: state.hits,
            misses: state.misses,
          },
          failed
        )
      );
    },
    [onFinish, resetAudio]
  );

  const maybeReportRunProgress = useCallback(
    (state: RunState) => {
      if (!onRunUpdate || !state.started || state.finished) return;
      if (state.score <= 0 && state.hits + state.misses <= 0) return;
      if (state.score <= lastRunUpdateScoreRef.current) return;
      lastRunUpdateScoreRef.current = state.score;
      onRunUpdate(
        buildGameResult({
          score: state.score,
          maxCombo: state.maxCombo,
          hits: state.hits,
          misses: state.misses,
        })
      );
    },
    [onRunUpdate]
  );

  const vibrateMiss = useCallback(() => {
    if ("vibrate" in navigator) navigator.vibrate(45);
  }, []);

  const startAudioAt = useCallback(
    async (offset: number) => {
      if (usePlayer && playerSync) {
        const t = clamp(offset, 0, Math.max(0, chart.duration - 0.05));
        playerSync.seek(t);
        const audio = playerSync.getAudio();
        if (audio) {
          try {
            await audio.play();
            return;
          } catch {
            /* fallback sotto */
          }
        }
        await playerSync.play();
        return;
      }
      const audio = audioRef.current;
      if (!audio) return;
      audio.pause();
      audio.currentTime = clamp(offset, 0, Math.max(0, chart.duration - 0.05));
      audio.onended = () => {
        const state = stateRef.current;
        if (state && !state.finished && !state.paused) finish(false);
      };
      await audio.play();
    },
    [chart.duration, finish, playerSync, usePlayer]
  );

  const draw = useCallback(() => {
    const state = stateRef.current;
    const canvas = canvasRef.current;
    if (!state || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let layout = canvasLayoutRef.current;
    if (layout.width < 1 || layout.height < 1) {
      const rect = canvas.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
      layout = {
        width: rect.width,
        height: rect.height,
        dpr,
        bufferW: Math.max(1, Math.floor(rect.width * dpr)),
        bufferH: Math.max(1, Math.floor(rect.height * dpr)),
      };
      canvasLayoutRef.current = layout;
      if (canvas.width !== layout.bufferW || canvas.height !== layout.bufferH) {
        canvas.width = layout.bufferW;
        canvas.height = layout.bufferH;
      }
    }
    const dpr = layout.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cssWidth = layout.width;
    const cssHeight = layout.height;
    const laneWidth = cssWidth / LANES.length;
    const hitY = canvasLite ? dockHitLineY(cssHeight) : cssHeight * HIT_LINE_Y;
    const noteSpeed = canvasLite ? DOCK_NOTE_SPEED : NOTE_SPEED;
    const now = performance.now();

    let songTime = state.offset;
    const audio = usePlayer ? null : audioRef.current;
    const clockReady = usePlayer ? Boolean(playerSync) : Boolean(audio);
    if (syncLive && usePlayer && playerSync) {
      state.started = true;
      state.paused = false;
      songTime = resolveSmoothSongTime(state, now, playerSync);
    } else if (!state.paused && state.playStartAt > 0 && clockReady) {
      if (!state.started && !state.audioStartRequested && now >= state.countdownUntil) {
        state.audioStartRequested = true;
        startAudioAt(state.offset)
          .then(() => {
            const current = stateRef.current;
            if (!current || current.finished || current.paused) return;
            current.started = true;
            current.startedAt = performance.now();
          })
          .catch(() => {
            const current = stateRef.current;
            if (!current || current.finished) return;
            current.audioStartRequested = false;
            setFeedback(current, "Tap Start again");
            setHud((prev) => ({
              ...prev,
              feedback: current.feedback,
              feedbackPulse: current.feedbackPulse,
            }));
            if (embedded) {
              setWaitingForStart(true);
            } else {
              current.paused = true;
              current.playStartAt = 0;
              setHud((prev) => ({ ...prev, paused: true }));
              setWaitingForStart(true);
            }
          });
      } else if (state.started) {
        songTime = usePlayer
          ? playerSync!.getCurrentTime()
          : audio!.currentTime;
      }
    }
    state.songTime = songTime;

    const drawCtx = {
      cssWidth,
      cssHeight,
      hitY,
      laneWidth,
      noteSpeed,
      songTime,
      state,
      lite: canvasLite,
    };
    drawStage(ctx, drawCtx);
    drawNotes(ctx, drawCtx);
    if (!syncLive) drawCountdown(ctx, { cssWidth, cssHeight, now, state });
    applyMisses({ songTime, state, vibrateMiss });
    completeHeldNotes({ songTime, state, vibrateMiss });
    maybeReportRunProgress(state);

    if (!state.finished && isChartRunComplete(state, songTime)) {
      if (syncLive && usePlayer) {
        if (!state.awaitingTrackEnd) {
          state.awaitingTrackEnd = true;
          setFeedback(state, "Complete");
          setHud((prev) => ({
            ...prev,
            feedback: state.feedback,
            feedbackPulse: state.feedbackPulse,
          }));
        }
      } else {
        finish(false);
        return;
      }
    }

    const runEnd = resolveRunEndTime(
      chart.duration,
      usePlayer && playerSync ? playerSync.getAudio()?.duration : undefined
    );
    if (!state.finished && songTime >= runEnd - 0.06) {
      finish(false);
      return;
    }

    const hudSyncMinMs = embedded ? 120 : 0;
    const sync = hudSyncRef.current;
    const hudDirty =
      state.score !== sync.score ||
      state.combo !== sync.combo ||
      state.feedback !== sync.feedback ||
      state.feedbackPulse !== sync.feedbackPulse;
    if (hudDirty) {
      const feedbackChanged = state.feedback !== sync.feedback;
      const elapsed = now - sync.at;
      if (
        hudSyncMinMs === 0 ||
        feedbackChanged ||
        elapsed >= hudSyncMinMs
      ) {
        hudSyncRef.current = {
          score: state.score,
          combo: state.combo,
          feedback: state.feedback,
          feedbackPulse: state.feedbackPulse,
          at: now,
        };
        setHud((prev) => ({
          ...prev,
          score: state.score,
          combo: state.combo,
          feedback: state.feedback,
          feedbackPulse: state.feedbackPulse,
          paused: state.paused,
        }));
      }
    }

    rafRef.current = requestAnimationFrame(() => drawRef.current());
  }, [
    canvasLite,
    chart.duration,
    embedded,
    finish,
    maybeReportRunProgress,
    playerSync,
    startAudioAt,
    syncLive,
    usePlayer,
    vibrateMiss,
  ]);

  useLayoutEffect(() => {
    drawRef.current = draw;
  }, [draw]);

  const beginRef = useRef<(offset?: number) => void>(() => {});

  const begin = useCallback(
    (offset = 0) => {
      const state = stateRef.current;
      if (!state) return;
      if (offset >= chart.duration) {
        finish(false);
        return;
      }
      state.paused = false;
      state.offset = offset;
      state.countdownUntil = performance.now() + COUNTDOWN_SECONDS * 1000;
      state.playStartAt = performance.now();
      state.started = false;
      state.startedAt = 0;
      state.audioStartRequested = false;
      cancelAnimationFrame(rafRef.current);
      setWaitingForStart(false);
      rafRef.current = requestAnimationFrame(draw);
    },
    [chart.duration, draw, finish]
  );

  useLayoutEffect(() => {
    beginRef.current = begin;
  }, [begin]);

  const beginLiveRef = useRef<(offset?: number) => void>(() => {});

  const beginLive = useCallback(
    (offset?: number) => {
      const state = stateRef.current;
      if (!state) return;
      const t = clamp(
        offset ?? (playerSync?.getCurrentTime() ?? 0),
        0,
        Math.max(0, chart.duration - 0.02)
      );
      if (t >= chart.duration) {
        finish(false);
        return;
      }
      state.paused = false;
      state.offset = t;
      state.countdownUntil = 0;
      state.playStartAt = performance.now();
      state.started = true;
      state.startedAt = performance.now();
      state.audioStartRequested = true;
      resetSongClock(state, t, performance.now());
      if (!embedded) setFeedback(state, "Stay on track");
      cancelAnimationFrame(rafRef.current);
      setWaitingForStart(false);
      rafRef.current = requestAnimationFrame(draw);
    },
    [chart.duration, draw, embedded, finish, playerSync]
  );

  useLayoutEffect(() => {
    beginLiveRef.current = beginLive;
  }, [beginLive]);

  const canJudge = useCallback(() => {
    const state = stateRef.current;
    if (!state || state.finished) return false;
    if (syncLive && usePlayer) return state.started;
    return state.started && !state.paused;
  }, [syncLive, usePlayer]);

  const syncHudNow = useCallback((state: RunState) => {
    hudSyncRef.current = {
      score: state.score,
      combo: state.combo,
      feedback: state.feedback,
      feedbackPulse: state.feedbackPulse,
      at: performance.now(),
    };
    setHud((prev) => ({
      ...prev,
      score: state.score,
      combo: state.combo,
      health: state.health,
      feedback: state.feedback,
      feedbackPulse: state.feedbackPulse,
    }));
    syncLaneFlashUi();
  }, [syncLaneFlashUi]);

  const releaseLanePress = useCallback((laneIndex: number) => {
    const timers = lanePressReleaseTimersRef.current;
    const pending = timers[laneIndex];
    if (pending) {
      clearTimeout(pending);
      timers[laneIndex] = null;
    }
    const state = stateRef.current;
    if (!state) return;
    const hadActiveHold = state.activeHolds.some(
      (note) =>
        note.holding &&
        !note.completed &&
        !note.missed &&
        (note.lane === laneIndex || noteEndLane(note) === laneIndex),
    );
    state.pressedLanes[laneIndex] = false;
    setPressedLanes([...state.pressedLanes]);

    if (canJudge() && hadActiveHold) {
      if (syncLive && usePlayer && playerSync) {
        state.songTime = resolveSmoothSongTime(
          state,
          performance.now(),
          playerSync,
        );
      } else {
        const nextSongTime = usePlayer
          ? playerSync?.getCurrentTime()
          : audioRef.current?.currentTime;
        if (typeof nextSongTime === "number" && Number.isFinite(nextSongTime)) {
          state.songTime = nextSongTime;
        }
      }
      const pulseBefore = state.feedbackPulse;
      judgeHoldRelease(state, laneIndex);
      if (state.feedbackPulse !== pulseBefore) {
        if (state.feedback === "Hold Miss") {
          vibrateMiss();
        }
        syncHudNow(state);
      }
    }
  }, [canJudge, playerSync, syncHudNow, syncLive, usePlayer, vibrateMiss]);

  const judgeLane = useCallback(
    (laneIndex: number, pressed: boolean) => {
      const state = stateRef.current;
      if (!state || state.finished) return;
      if (!pressed) {
        releaseLanePress(laneIndex);
        return;
      }
      state.pressedLanes[laneIndex] = true;
      setPressedLanes([...state.pressedLanes]);
      if (!canJudge()) {
        if (embedded) {
          const timers = lanePressReleaseTimersRef.current;
          const pending = timers[laneIndex];
          if (pending) clearTimeout(pending);
          timers[laneIndex] = window.setTimeout(
            () => releaseLanePress(laneIndex),
            90
          );
        }
        return;
      }
      if (syncLive && usePlayer && playerSync) {
        state.songTime = resolveSmoothSongTime(state, performance.now(), playerSync);
      }
      const startedHold = judgeHoldStart(state, laneIndex);
      if (!startedHold) {
        judgeTap(state, laneIndex);
      }
      setPressedLanes([...state.pressedLanes]);
      if (embedded) {
        const timers = lanePressReleaseTimersRef.current;
        const pending = timers[laneIndex];
        if (pending) clearTimeout(pending);
        const holdingLane = state.activeHolds.some(
          (n) =>
            n.holding &&
            (n.lane === laneIndex || noteEndLane(n) === laneIndex),
        );
        if (!holdingLane) {
          timers[laneIndex] = window.setTimeout(
            () => releaseLanePress(laneIndex),
            90,
          );
        }
      }
    },
    [canJudge, embedded, playerSync, releaseLanePress, syncLive, usePlayer]
  );

  useEffect(() => {
    const gameElement = gameRef.current;
    const preventNativeGesture = (event: Event) => event.preventDefault();
    const preventGameTouch = (event: Event) => {
      if (event.target instanceof Element && event.target.closest(".start-overlay, .lane-pad")) return;
      event.preventDefault();
    };
    const trapBackNavigation = () => {
      const state = stateRef.current;
      if (state && !state.finished) {
        window.history.pushState({ rekordRhythmPlaying: true }, "", window.location.href);
        setFeedback(state, "Stay on track");
        setHud((prev) => ({ ...prev, feedback: state.feedback, feedbackPulse: state.feedbackPulse }));
      }
    };

    if (!embedded) {
      window.history.pushState({ rekordRhythmPlaying: true }, "", window.location.href);
      window.addEventListener("popstate", trapBackNavigation);
    }
    document.addEventListener("gesturestart", preventNativeGesture);
    document.addEventListener("gesturechange", preventNativeGesture);
    document.addEventListener("gestureend", preventNativeGesture);
    gameElement?.addEventListener("touchstart", preventGameTouch, { passive: false, capture: true });
    gameElement?.addEventListener("touchmove", preventGameTouch, { passive: false, capture: true });
    gameElement?.addEventListener("touchend", preventGameTouch, { passive: false, capture: true });

    return () => {
      if (!embedded) {
        window.removeEventListener("popstate", trapBackNavigation);
      }
      document.removeEventListener("gesturestart", preventNativeGesture);
      document.removeEventListener("gesturechange", preventNativeGesture);
      document.removeEventListener("gestureend", preventNativeGesture);
      gameElement?.removeEventListener("touchstart", preventGameTouch, { capture: true });
      gameElement?.removeEventListener("touchmove", preventGameTouch, { capture: true });
      gameElement?.removeEventListener("touchend", preventGameTouch, { capture: true });
    };
  }, [embedded]);

  useEffect(() => {
    const shouldLive = embedded && syncLive;
    const shouldCountdownBegin = embedded && autoBegin && !syncLive;
    let cancelled = false;
    stateRef.current = initialRunState(chart.notes);
    lastRunUpdateScoreRef.current = -1;
    queueMicrotask(() => {
      if (!cancelled) {
        setWaitingForStart(!(shouldLive || shouldCountdownBegin));
      }
    });
    cancelAnimationFrame(rafRef.current);

    if (shouldLive) {
      beginLiveRef.current();
    } else if (shouldCountdownBegin) {
      beginRef.current(0);
    } else {
      rafRef.current = requestAnimationFrame(draw);
    }

    return () => {
      cancelled = true;
      const state = stateRef.current;
      if (state) state.finished = true;
      cancelAnimationFrame(rafRef.current);
      for (const lane of lanePressReleaseTimersRef.current) {
        if (lane) clearTimeout(lane);
      }
      lanePressReleaseTimersRef.current = [null, null, null, null];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runId + songId
  }, [runId, chart.songId, embedded, autoBegin, onRunUpdate, syncLive]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(rafRef.current);
        return;
      }
      const state = stateRef.current;
      if (state && !state.finished && state.started) {
        rafRef.current = requestAnimationFrame(draw);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [draw]);

  useEffect(() => {
    if (!syncLive || !playerSync) return;
    const audio = playerSync.getAudio();
    if (!audio) return;
    const syncClockToPlayer = () => {
      const state = stateRef.current;
      if (!state || state.finished) return;
      const t = playerSync.getCurrentTime();
      resetSongClock(state, t, performance.now());
    };
    const onPlay = () => {
      const state = stateRef.current;
      if (!state || state.finished) return;
      state.paused = false;
      state.started = true;
      if (state.playStartAt <= 0) state.playStartAt = performance.now();
      syncClockToPlayer();
    };
    const onPause = () => {
      syncClockToPlayer();
    };
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("seeking", syncClockToPlayer);
    audio.addEventListener("seeked", syncClockToPlayer);
    audio.addEventListener("ratechange", syncClockToPlayer);
    return () => {
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("seeking", syncClockToPlayer);
      audio.removeEventListener("seeked", syncClockToPlayer);
      audio.removeEventListener("ratechange", syncClockToPlayer);
    };
  }, [playerSync, syncLive]);

  useEffect(() => {
    const keyMap = new Map([
      ["d", 0],
      ["f", 1],
      ["j", 2],
      ["k", 3],
    ]);
    const down = (event: KeyboardEvent) => {
      if (event.repeat) return;
      const lane = keyMap.get(event.key.toLowerCase());
      if (lane === undefined) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT")
      ) {
        return;
      }
      event.preventDefault();
      judgeLane(lane, true);
    };
    const up = (event: KeyboardEvent) => {
      const lane = keyMap.get(event.key.toLowerCase());
      if (lane === undefined) return;
      const state = stateRef.current;
      if (state) {
        state.pressedLanes[lane] = false;
        setPressedLanes([...state.pressedLanes]);
      }
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [judgeLane]);

  return (
    <main
      ref={gameRef}
      className={["game-screen", embedded ? "game-screen--dock" : ""]
        .filter(Boolean)
        .join(" ")}
      onContextMenu={(event) => event.preventDefault()}
    >
      {!usePlayer && audioUrl ? (
        <audio ref={audioRef} src={audioUrl} preload="auto" playsInline />
      ) : null}
      <canvas ref={canvasRef} className="note-canvas" aria-label="Note highway" />
      <div className="hud top hud--rekord">
        <div className="hud-stat hud-stat--score">
          <span className="hud-stat__label">{labels.score}</span>
          <strong className="hud-stat__value">{hud.score.toLocaleString()}</strong>
        </div>
        <div className="hud-stat hud-stat--combo">
          <span className="hud-stat__label">{labels.combo}</span>
          <strong className="hud-stat__value">{hud.combo}x</strong>
        </div>
      </div>
      <FeedbackBadge
        feedback={hud.feedback}
        combo={hud.combo}
        pulse={hud.feedbackPulse}
        compact={embedded}
      />
      {hud.combo >= 8 ? (
        <div key={hud.combo} className="combo-burst" aria-hidden="true">
          <strong>{hud.combo}</strong>
          <span>{hud.combo >= 32 ? "ON FIRE" : "CHAIN"}</span>
        </div>
      ) : null}
      {waitingForStart && !(embedded && autoBegin) ? (
        <div className="start-overlay">
          <button
            className="primary-action"
            type="button"
            onPointerDown={(event) => {
              event.preventDefault();
              begin(0);
            }}
            onClick={() => begin(0)}
          >
            {labels.start}
          </button>
        </div>
      ) : null}
      <div className="rhythm-lane-strip" aria-hidden>
        {LANES.map((lane, index) => (
          <div
            key={`${lane.name}-strip`}
            className={[
              "rhythm-lane-strip__cell",
              laneFlash[index] ? `rhythm-lane-strip__cell--${laneFlash[index]}` : "",
            ]
              .filter(Boolean)
              .join(" ")}
            style={
              {
                "--lane-color": lane.color,
                "--lane-shadow": lane.shadow,
              } as React.CSSProperties
            }
          >
            <span className="rhythm-lane-strip__mark" />
          </div>
        ))}
      </div>
      <div className="touch-pads" aria-label="Lane controls">
        {LANES.map((lane, index) => (
          <button
            key={lane.name}
            className={[
              "lane-pad",
              pressedLanes[index] || holdingLanes[index] ? "is-pressed" : "",
              holdingLanes[index] ? "lane-pad--holding" : "",
              laneFlash[index] ? `lane-pad--${laneFlash[index]}` : "",
            ]
              .filter(Boolean)
              .join(" ")}
            style={{ "--lane-color": lane.color, "--lane-shadow": lane.shadow } as React.CSSProperties}
            type="button"
            tabIndex={-1}
            onPointerDown={(event) => {
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
              judgeLane(index, true);
            }}
            onPointerUp={(event) => {
              event.preventDefault();
              releaseLanePress(index);
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
            }}
            onPointerCancel={(event) => {
              event.preventDefault();
              releaseLanePress(index);
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
            }}
            onPointerLeave={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) return;
              if (event.buttons !== 0) return;
              releaseLanePress(index);
            }}
            aria-label={`${lane.name} lane`}
          >
            <span className="lane-pip" aria-hidden="true" />
          </button>
        ))}
      </div>
    </main>
  );
}

function initialRunState(notes: ChartNote[]): RunState {
  return {
    notes: notes.map((note) => ({ ...note })),
    activeHolds: [],
    score: 0,
    combo: 0,
    maxCombo: 0,
    hits: 0,
    misses: 0,
    health: 100,
    feedback: "Ready",
    feedbackPulse: 0,
    songTime: 0,
    offset: 0,
    paused: false,
    started: false,
    startedAt: 0,
    countdownUntil: 0,
    playStartAt: 0,
    audioStartRequested: false,
    pressedLanes: [false, false, false, false],
    laneFlash: [null, null, null, null],
    clockAnchorSong: 0,
    clockAnchorPerf: 0,
    smoothFramePerf: 0,
    missScanIndex: 0,
    finished: false,
    awaitingTrackEnd: false,
  };
}

function resetSongClock(state: RunState, songTime: number, perfNow: number): void {
  state.clockAnchorSong = songTime;
  state.clockAnchorPerf = perfNow;
  state.smoothFramePerf = perfNow;
}

function resolveSmoothSongTime(
  state: RunState,
  perfNow: number,
  playerSync: PlayerSyncBridge
): number {
  const audio = playerSync.getAudio();
  const audioT = playerSync.getCurrentTime();
  const playing = Boolean(audio && !audio.paused && !audio.ended);
  const playbackRate = audio?.playbackRate && Number.isFinite(audio.playbackRate)
    ? audio.playbackRate
    : 1;

  if (!playing) {
    resetSongClock(state, audioT, perfNow);
    return audioT;
  }

  if (state.clockAnchorPerf <= 0) {
    resetSongClock(state, audioT, perfNow);
    return audioT;
  }

  const prevPerf = state.smoothFramePerf > 0 ? state.smoothFramePerf : perfNow;
  const dtSec = Math.min(0.05, Math.max(0, (perfNow - prevPerf) / 1000));
  state.smoothFramePerf = perfNow;

  const t =
    state.clockAnchorSong +
    ((perfNow - state.clockAnchorPerf) / 1000) * playbackRate;
  const err = audioT - t;

  if (Math.abs(err) > CLOCK_HARD_SYNC_THRESHOLD_SECONDS) {
    resetSongClock(state, audioT, perfNow);
    return audioT;
  }

  if (Math.abs(err) <= CLOCK_MIN_CORRECTION_SECONDS) {
    return t;
  }

  const blend = 1 - Math.exp(-dtSec / CLOCK_SMOOTH_TAU_SECONDS);
  const corrected = t + err * blend;
  resetSongClock(state, corrected, perfNow);
  return corrected;
}

function isChartRunComplete(state: RunState, songTime: number): boolean {
  if (!state.notes.length) return false;
  if (!state.notes.every((note) => note.hit || note.missed)) return false;
  const lastEnd = state.notes.reduce(
    (max, note) => Math.max(max, note.time + note.duration),
    0
  );
  return songTime >= lastEnd + HIT_WINDOWS.ok;
}

const laneFlashClearTimers: Array<ReturnType<typeof setTimeout> | null> = [
  null,
  null,
  null,
  null,
];

function flashLane(state: RunState, lane: number, kind: "hit" | "miss"): void {
  const until = performance.now() + 420;
  state.laneFlash[lane] = { kind, until };
  laneFlashNotifier.sync?.();
  const pending = laneFlashClearTimers[lane];
  if (pending) clearTimeout(pending);
  laneFlashClearTimers[lane] = window.setTimeout(() => {
    laneFlashClearTimers[lane] = null;
    laneFlashNotifier.sync?.();
  }, Math.max(0, until - performance.now()) + 16);
}

function setFeedback(state: RunState, feedback: string): void {
  state.feedback = feedback;
  state.feedbackPulse += 1;
}

function awardScore(state: RunState, points: number, multiplier = 1): void {
  state.score += Math.round(points * multiplier);
}

function laneCenterX(laneIndex: number, laneWidth: number): number {
  return laneIndex * laneWidth + laneWidth / 2;
}

function noteEndLane(note: ChartNote): number {
  return note.endLane ?? note.lane;
}

function dockHitLineY(cssHeight: number): number {
  const y = cssHeight * DOCK_HIT_LINE_Y;
  return Math.min(
    cssHeight - DOCK_HIT_LINE_BOTTOM_MIN_PX,
    Math.max(cssHeight - DOCK_HIT_LINE_BOTTOM_MAX_PX, y)
  );
}

function noteVisibleTimeRange(
  songTime: number,
  hitY: number,
  cssHeight: number,
  noteSpeed: number
): { min: number; max: number } {
  const topLead = 56;
  const bottomTrail = 56;
  return {
    min: songTime - (cssHeight - hitY + bottomTrail) / noteSpeed,
    max: songTime + (hitY + topLead) / noteSpeed,
  };
}

function holdReleaseAt(note: ChartNote): number {
  return note.time + note.duration;
}

function failHoldRelease(state: RunState, note: ChartNote, message: string): void {
  note.holding = false;
  note.missed = true;
  state.combo = 0;
  state.misses += 1;
  flashLane(state, note.lane, "miss");
  const endLane = noteEndLane(note);
  if (endLane !== note.lane) {
    flashLane(state, endLane, "miss");
  }
  setFeedback(state, message);
}

function isHoldLanePressed(state: RunState, note: ChartNote): boolean {
  const endLane = noteEndLane(note);
  return state.pressedLanes[note.lane] || state.pressedLanes[endLane];
}

function completeHeldNote(note: ChartNote): void {
  note.holding = false;
  note.completed = true;
  laneFlashNotifier.sync?.();
}

function lowerBoundNoteIndex(notes: ChartNote[], time: number): number {
  let lo = 0;
  let hi = notes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (notes[mid].time < time) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function upperBoundNoteIndex(notes: ChartNote[], time: number): number {
  let lo = 0;
  let hi = notes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (notes[mid].time <= time) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function drawStage(ctx: CanvasRenderingContext2D, { cssWidth, cssHeight, hitY, laneWidth, songTime, state, lite }: DrawContext): void {
  const feverActive = false;
  if (lite) {
    const now = performance.now();
    ctx.fillStyle = "#080a12";
    ctx.fillRect(0, 0, cssWidth, cssHeight);
    for (let lane = 0; lane < LANES.length; lane += 1) {
      const x = lane * laneWidth;
      const pressed = state.pressedLanes[lane];
      const flash = state.laneFlash[lane];
      const flashKind =
        flash && flash.until > now ? flash.kind : null;
      if (pressed) {
        ctx.fillStyle = LANES[lane].color;
        ctx.globalAlpha = 0.2;
        ctx.fillRect(x, 0, laneWidth, cssHeight);
        ctx.globalAlpha = 1;
      } else {
        ctx.fillStyle = lane % 2 === 0 ? "rgba(255,255,255,0.02)" : "rgba(255,255,255,0.035)";
        ctx.fillRect(x, 0, laneWidth, cssHeight);
      }
      ctx.fillStyle = LANES[lane].color;
      ctx.globalAlpha = pressed ? 0.55 : flashKind === "hit" ? 0.38 : flashKind === "miss" ? 0.32 : 0.14;
      ctx.fillRect(x + 1, 0, 2, cssHeight);
      ctx.fillRect(x + laneWidth - 3, 0, 2, cssHeight);
      ctx.globalAlpha = 1;
    }
    drawReceptors(ctx, { cssWidth, hitY, laneWidth, state, lite: true, songTime });
    return;
  }
  const gradient = ctx.createLinearGradient(0, 0, 0, cssHeight);
  gradient.addColorStop(0, feverActive ? "#08060f" : "#04050c");
  gradient.addColorStop(0.38, feverActive ? "#171028" : "#0b1020");
  gradient.addColorStop(0.72, feverActive ? "#1b1730" : "#11152a");
  gradient.addColorStop(1, "#030409");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, cssWidth, cssHeight);

  const centerGlow = ctx.createRadialGradient(cssWidth / 2, hitY, 20, cssWidth / 2, hitY, cssWidth * 0.72);
  centerGlow.addColorStop(0, feverActive ? "rgba(255, 232, 102, 0.34)" : "rgba(70, 231, 255, 0.22)");
  centerGlow.addColorStop(0.36, feverActive ? "rgba(244, 76, 255, 0.2)" : "rgba(244, 76, 255, 0.08)");
  centerGlow.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = centerGlow;
  ctx.fillRect(0, 0, cssWidth, cssHeight);

  if (feverActive) {
    const pulse = 0.08 + Math.sin(songTime * 10) * 0.025;
    ctx.fillStyle = `rgba(255, 232, 102, ${pulse})`;
    ctx.fillRect(0, 0, cssWidth, cssHeight);
  }

  ctx.fillStyle = "rgba(255,255,255,0.03)";
  for (let y = 20 - ((songTime * (feverActive ? 126 : 72)) % 28); y < cssHeight; y += 28) ctx.fillRect(0, y, cssWidth, feverActive ? 2 : 1);

  ctx.fillStyle = "rgba(0,0,0,0.44)";
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(cssWidth * 0.1, 0);
  ctx.lineTo(cssWidth * 0.02, cssHeight);
  ctx.lineTo(0, cssHeight);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cssWidth, 0);
  ctx.lineTo(cssWidth * 0.9, 0);
  ctx.lineTo(cssWidth * 0.98, cssHeight);
  ctx.lineTo(cssWidth, cssHeight);
  ctx.closePath();
  ctx.fill();

  for (let lane = 0; lane < LANES.length; lane += 1) {
    const x = lane * laneWidth;
    const laneGradient = ctx.createLinearGradient(x, 0, x + laneWidth, 0);
    laneGradient.addColorStop(0, lane % 2 === 0 ? "rgba(255,255,255,0.035)" : "rgba(255,255,255,0.055)");
    laneGradient.addColorStop(0.5, state.pressedLanes[lane] ? "rgba(255,255,255,0.17)" : feverActive ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.085)");
    laneGradient.addColorStop(1, lane % 2 === 0 ? "rgba(255,255,255,0.035)" : "rgba(255,255,255,0.055)");
    ctx.fillStyle = laneGradient;
    ctx.fillRect(x, 0, laneWidth, cssHeight);
    ctx.fillStyle = LANES[lane].color;
    ctx.globalAlpha = state.pressedLanes[lane] ? 0.42 : feverActive ? 0.28 : 0.18;
    ctx.fillRect(x + 1, 0, 2, cssHeight);
    ctx.fillRect(x + laneWidth - 3, 0, 2, cssHeight);
    ctx.globalAlpha = 1;
  }

  drawReceptors(ctx, { cssWidth, hitY, laneWidth, state, lite: false });
}

function drawReceptors(
  ctx: CanvasRenderingContext2D,
  { cssWidth, hitY, laneWidth, state, lite }: Pick<DrawContext, "cssWidth" | "hitY" | "laneWidth" | "state" | "lite"> & { songTime?: number }
): void {
  const feverActive = false;
  const holdLanes = new Set<number>();
  for (const note of state.activeHolds) {
    if (!note.holding || note.completed) continue;
    holdLanes.add(note.lane);
    holdLanes.add(noteEndLane(note));
  }
  if (lite) {
    const now = performance.now();
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.fillRect(0, hitY - 2, cssWidth, 4);
    for (let lane = 0; lane < LANES.length; lane += 1) {
      const x = lane * laneWidth + laneWidth * 0.08;
      const w = laneWidth * 0.84;
      const pressed = state.pressedLanes[lane];
      const flash = state.laneFlash[lane];
      const flashKind =
        flash && flash.until > now ? flash.kind : null;
      const holding = holdLanes.has(lane);
      if (flashKind === "hit") {
        ctx.fillStyle = LANES[lane].color;
      } else if (flashKind === "miss") {
        ctx.fillStyle = "#ff6f82";
      } else if (holding) {
        ctx.fillStyle = LANES[lane].color;
      } else if (pressed) {
        ctx.fillStyle = LANES[lane].color;
      } else {
        ctx.fillStyle = "rgba(255,255,255,0.22)";
      }
      ctx.fillRect(x, hitY - 11, w, 22);
    }
    return;
  }
  const deckGradient = ctx.createLinearGradient(0, hitY - 38, 0, hitY + 56);
  deckGradient.addColorStop(0, "rgba(255,255,255,0.02)");
  deckGradient.addColorStop(0.43, feverActive ? "rgba(255,232,102,0.34)" : "rgba(70,231,255,0.22)");
  deckGradient.addColorStop(0.58, feverActive ? "rgba(255,255,255,0.3)" : "rgba(255,255,255,0.18)");
  deckGradient.addColorStop(1, "rgba(0,0,0,0.36)");
  ctx.fillStyle = deckGradient;
  ctx.fillRect(0, hitY - 40, cssWidth, 92);
  ctx.shadowColor = feverActive ? "rgba(255,232,102,0.85)" : "rgba(255,255,255,0.75)";
  ctx.shadowBlur = feverActive ? 34 : 24;
  for (let lane = 0; lane < LANES.length; lane += 1) {
    const x = lane * laneWidth + laneWidth * 0.12;
    const receptor = ctx.createLinearGradient(0, hitY - 18, 0, hitY + 18);
    receptor.addColorStop(0, "#ffffff");
    receptor.addColorStop(0.28, LANES[lane].color);
    receptor.addColorStop(1, state.pressedLanes[lane] ? "#ffffff" : "rgba(0,0,0,0.34)");
    ctx.fillStyle = receptor;
    roundedRect(ctx, x, hitY - 15, laneWidth * 0.76, 30, 4);
    ctx.fill();
  }
  ctx.shadowBlur = 0;
}

function drawNotes(ctx: CanvasRenderingContext2D, drawCtx: DrawContext): void {
  const { cssHeight, hitY, laneWidth, noteSpeed, songTime, state, lite } = drawCtx;
  const travel = hitY + 140;
  const yMin = -travel;
  const yMax = cssHeight + 80;
  const { min, max } = noteVisibleTimeRange(songTime, hitY, cssHeight, noteSpeed);
  let start = lowerBoundNoteIndex(state.notes, min);
  let end = upperBoundNoteIndex(state.notes, max);
  for (const holdNote of state.activeHolds) {
    if (!holdNote.holding || holdNote.completed) continue;
    start = Math.min(start, holdNote.id);
    end = Math.max(end, holdNote.id + 1);
  }
  const noteWidth = laneWidth * 0.62;
  const noteHeight = lite ? 14 : 20;

  if (lite) {
    const feverActive = false;
    for (let i = start; i < end; i += 1) {
      const note = state.notes[i];
      if (note.completed || note.missed) continue;
      const y = hitY - (note.time - songTime) * noteSpeed;
      const holdEndY =
        note.duration > 0
          ? hitY - (note.time + note.duration - songTime) * noteSpeed
          : y;
      const holdingActive = note.duration > 0 && note.holding;
      const headOnScreen = y >= yMin && y <= yMax;
      const trailOnScreen =
        note.duration > 0 &&
        Math.min(y, holdEndY) <= yMax + noteHeight &&
        Math.max(y, holdEndY) >= yMin;
      if (!holdingActive && !headOnScreen && !trailOnScreen) continue;
      const lane = LANES[note.lane];
      if (!lane) continue;
      const centerX = laneCenterX(note.lane, laneWidth);
      const noteX = centerX - noteWidth / 2;
      if (note.duration > 0) {
        drawHoldTrail(ctx, {
          centerX,
          feverActive,
          hitY,
          lane,
          laneWidth,
          note,
          noteHeight,
          noteSpeed,
          songTime,
          headY: y,
        });
      }
      if (!holdingActive && headOnScreen) {
        ctx.fillStyle = lane.color;
        drawNoteHead(ctx, {
          feverActive,
          isSwipeNote: false,
          lane,
          noteHeight,
          noteWidth,
          noteX,
          y,
          lite: true,
        });
      }
    }
    return;
  }

  const feverActive = false;
  for (let i = start; i < end; i += 1) {
    const note = state.notes[i];
    if (note.completed || note.missed) continue;
    const y = hitY - (note.time - songTime) * noteSpeed;
    const holdEndY =
      note.duration > 0
        ? hitY - (note.time + note.duration - songTime) * noteSpeed
        : y;
    const holdingActive = note.duration > 0 && note.holding;
    const headOnScreen = y >= yMin && y <= yMax;
    const trailOnScreen =
      note.duration > 0 &&
      Math.min(y, holdEndY) <= yMax + noteHeight &&
      Math.max(y, holdEndY) >= yMin;
    if (!holdingActive && !headOnScreen && !trailOnScreen) continue;
    const lane = LANES[note.lane];
    if (!lane) continue;
    const centerX = laneCenterX(note.lane, laneWidth);
    const noteX = centerX - noteWidth / 2;

    if (note.duration > 0) {
      drawHoldTrail(ctx, {
        centerX,
        feverActive,
        hitY,
        lane,
        laneWidth,
        note,
        noteHeight,
        noteSpeed,
        songTime,
        headY: y,
      });
    }
    if (!holdingActive && headOnScreen) {
      drawNoteHead(ctx, {
        feverActive,
        isSwipeNote: false,
        lane,
        noteHeight,
        noteWidth,
        noteX,
        y,
        lite,
      });
    }
  }
}

function drawHoldTrail(
  ctx: CanvasRenderingContext2D,
  {
    centerX,
    hitY,
    lane,
    laneWidth,
    note,
    noteHeight,
    noteSpeed,
    songTime,
    headY,
  }: {
    centerX: number;
    feverActive: boolean;
    hitY: number;
    lane: Lane;
    laneWidth: number;
    note: ChartNote;
    noteHeight: number;
    noteSpeed: number;
    songTime: number;
    headY: number;
  }
): void {
  const holdEndY = hitY - (note.time + note.duration - songTime) * noteSpeed;
  const endX = laneCenterX(noteEndLane(note), laneWidth);
  const trailW = HOLD_WIDTH + (note.holding ? 4 : 0);

  ctx.shadowBlur = 0;

  if (endX !== centerX) {
    const anchorY = note.holding ? hitY : headY;
    ctx.fillStyle = note.holding ? lane.color : lane.shadow;
    ctx.globalAlpha = note.holding ? 0.72 : 1;
    ctx.shadowColor = lane.shadow;
    ctx.shadowBlur = note.holding ? 16 : 10;
    const switchY = anchorY + (holdEndY - anchorY) * 0.54;
    ctx.lineWidth = HOLD_WIDTH;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(centerX, anchorY);
    ctx.lineTo(centerX, switchY);
    ctx.lineTo(endX, switchY);
    ctx.lineTo(endX, holdEndY);
    ctx.strokeStyle = ctx.fillStyle as string;
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.beginPath();
    ctx.arc(endX, holdEndY, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    return;
  }

  if (note.holding) {
    const topY = Math.min(holdEndY, hitY - noteHeight * 0.5);
    const bottomY = hitY;
    const height = Math.max(6, bottomY - topY);
    const progress = clamp((songTime - note.time) / Math.max(0.001, note.duration), 0, 1);

    ctx.fillStyle = "rgba(255,255,255,0.12)";
    roundedRect(ctx, centerX - trailW / 2, topY, trailW, height, 6);
    ctx.fill();

    const filledH = height * progress;
    if (filledH > 2) {
      ctx.fillStyle = lane.color;
      ctx.globalAlpha = 0.58;
      roundedRect(ctx, centerX - trailW / 2, bottomY - filledH, trailW, filledH, 6);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    ctx.fillStyle = lane.color;
    ctx.fillRect(
      centerX - trailW / 2,
      hitY - noteHeight / 2,
      trailW,
      noteHeight,
    );
    return;
  }

  const topY = Math.min(headY, holdEndY);
  const barHeight = Math.max(headY, holdEndY) - topY + noteHeight;

  ctx.fillStyle = "rgba(255,255,255,0.08)";
  roundedRect(ctx, centerX - trailW / 2, topY, trailW, barHeight, 8);
  ctx.fill();

  ctx.strokeStyle = lane.color;
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 4]);
  roundedRect(ctx, centerX - trailW / 2, topY, trailW, barHeight, 8);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawNoteHead(
  ctx: CanvasRenderingContext2D,
  {
    feverActive,
    lane,
    noteHeight,
    noteWidth,
    noteX,
    y,
    lite,
  }: {
    feverActive: boolean;
    isSwipeNote: boolean;
    lane: Lane;
    noteHeight: number;
    noteWidth: number;
    noteX: number;
    y: number;
    lite: boolean;
  }
): void {
  if (lite) {
    ctx.fillStyle = lane.color;
    roundedRect(ctx, noteX, y - noteHeight / 2, noteWidth, noteHeight, 2);
    ctx.fill();
    return;
  }
  const noteGradient = ctx.createLinearGradient(noteX, y - noteHeight / 2, noteX, y + noteHeight / 2);
  noteGradient.addColorStop(0, "#ffffff");
  noteGradient.addColorStop(0.16, feverActive ? "#ffe866" : lane.color);
  noteGradient.addColorStop(0.42, lane.color);
  noteGradient.addColorStop(1, feverActive ? "rgba(244,76,255,0.34)" : "rgba(0,0,0,0.28)");
  ctx.fillStyle = noteGradient;
  ctx.shadowColor = feverActive ? "#ffe866" : lane.shadow;
  ctx.shadowBlur = feverActive ? 34 : 22;
  roundedRect(ctx, noteX, y - noteHeight / 2, noteWidth, noteHeight, 3);
  ctx.fill();
  ctx.shadowBlur = 0;
}

function drawCountdown(ctx: CanvasRenderingContext2D, { cssWidth, cssHeight, now, state }: { cssWidth: number; cssHeight: number; now: number; state: RunState }): void {
  if (state.countdownUntil <= now) return;
  const remaining = Math.ceil((state.countdownUntil - now) / 1000);
  ctx.fillStyle = "rgba(0,0,0,0.42)";
  ctx.fillRect(0, 0, cssWidth, cssHeight);
  ctx.fillStyle = "#fff";
  ctx.font = "700 72px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(remaining > 0 ? String(remaining) : "Go", cssWidth / 2, cssHeight * 0.42);
}

function applyMisses({ songTime, state, vibrateMiss }: { songTime: number; state: RunState; vibrateMiss: () => void }): void {
  const missLine = songTime - HIT_WINDOWS.ok;
  const notes = state.notes;
  let i = state.missScanIndex;
  while (i < notes.length && notes[i].time < missLine) {
    const note = notes[i];
    i += 1;
    if (note.hit || note.missed) continue;
    note.missed = true;
    state.combo = 0;
    state.misses += 1;
    flashLane(state, note.lane, "miss");
    setFeedback(state, "Miss");
    vibrateMiss();
  }
  state.missScanIndex = i;
}

function completeHeldNotes({ songTime, state, vibrateMiss }: { songTime: number; state: RunState; vibrateMiss: () => void }): void {
  for (const note of state.activeHolds) {
    if (!note.holding || note.completed || note.missed) continue;
    const holdEnd = holdReleaseAt(note);

    if (songTime >= holdReleaseAt(note) - HIT_WINDOWS.holdSlack) {
      const requiredLane = noteEndLane(note);
      if (requiredLane !== note.lane && !state.pressedLanes[requiredLane]) {
        note.holding = false;
        note.missed = true;
        state.combo = 0;
        state.misses += 1;
        flashLane(state, note.lane, "miss");
        flashLane(state, requiredLane, "miss");
        setFeedback(state, "Slide Miss");
        vibrateMiss();
        continue;
      }
    }

    if (!isHoldLanePressed(state, note) && songTime < holdEnd) {
      failHoldRelease(state, note, "Hold Miss");
      vibrateMiss();
      continue;
    }

    if (songTime >= holdEnd) {
      completeHeldNote(note);
    }
  }
  state.activeHolds = state.activeHolds.filter((note) => note.holding && !note.completed);
}

function judgeHoldStart(state: RunState, laneIndex: number): boolean {
  const songTime = state.songTime;
  let best: ChartNote | null = null;
  let bestDelta = Infinity;
  const start = lowerBoundNoteIndex(state.notes, songTime - HIT_WINDOWS.ok);
  const end = upperBoundNoteIndex(state.notes, songTime + HIT_WINDOWS.ok);
  for (let i = start; i < end; i += 1) {
    const note = state.notes[i];
    if (
      note.type !== "hold" ||
      note.lane !== laneIndex ||
      note.hit ||
      note.missed ||
      note.holding
    ) {
      continue;
    }
    const delta = Math.abs(note.time - songTime);
    if (delta < bestDelta) {
      best = note;
      bestDelta = delta;
    }
  }
  if (!best) return false;
  best.hit = true;
  best.holding = true;
  state.activeHolds.push(best);
  state.hits += 1;
  state.combo += 1;
  state.maxCombo = Math.max(state.maxCombo, state.combo);
  const perfect = bestDelta <= HIT_WINDOWS.perfect;
  const good = bestDelta <= HIT_WINDOWS.good;
  const points = perfect ? 300 : good ? 180 : 90;
  const multiplier = 1 + Math.min(3, Math.floor(state.combo / 12));
  awardScore(state, points, multiplier);
  setFeedback(
    state,
    perfect ? "Perfect" : good ? "Good" : songTime > best.time ? "Late" : "Early",
  );
  flashLane(state, laneIndex, "hit");
  return true;
}

function judgeHoldRelease(state: RunState, laneIndex: number): void {
  const songTime = state.songTime;
  let best: ChartNote | null = null;
  let bestEnd = Infinity;

  for (const note of state.activeHolds) {
    if (!note.holding || note.completed || note.missed) continue;
    const endLane = noteEndLane(note);
    if (note.lane !== laneIndex && endLane !== laneIndex) continue;
    const holdEnd = holdReleaseAt(note);
    if (holdEnd < bestEnd) {
      best = note;
      bestEnd = holdEnd;
    }
  }

  if (best) {
    if (songTime < bestEnd) {
      failHoldRelease(state, best, "Hold Miss");
    } else {
      completeHeldNote(best);
    }
  }

  state.activeHolds = state.activeHolds.filter(
    (n) => n.holding && !n.completed,
  );
}

function judgeTap(state: RunState, laneIndex: number): void {
  const songTime = state.songTime;
  let best: ChartNote | null = null;
  let bestDelta = Infinity;
  for (const note of state.notes) {
    if (note.type !== "tap" || note.lane !== laneIndex || note.hit || note.missed) continue;
    const delta = Math.abs(note.time - songTime);
    if (delta < bestDelta) {
      best = note;
      bestDelta = delta;
    }
    if (note.time - songTime > HIT_WINDOWS.ok) break;
  }
  if (!best || bestDelta > HIT_WINDOWS.ok) {
    flashLane(state, laneIndex, "miss");
    return;
  }
  best.hit = true;
  flashLane(state, laneIndex, "hit");
  state.hits += 1;
  state.combo += 1;
  state.maxCombo = Math.max(state.maxCombo, state.combo);
  const perfect = bestDelta <= HIT_WINDOWS.perfect;
  const good = bestDelta <= HIT_WINDOWS.good;
  const points = perfect ? 300 : good ? 180 : 90;
  const multiplier = 1 + Math.min(3, Math.floor(state.combo / 12));
  awardScore(state, points, multiplier);
  setFeedback(state, perfect ? "Perfect" : good ? "Good" : songTime > best.time ? "Late" : "Early");
  best.completed = true;
}
