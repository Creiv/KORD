/* eslint-disable react-refresh/only-export-components -- hook + provider */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { mediaUrl } from "../lib/api";
import { enrichTrack } from "../lib/enrichTrack";
import { isTrackAlbumShuffleExcluded } from "../lib/randomExclusions";
import {
  type MediaSessionBridge,
  registerMediaSessionActions,
  setMediaSessionMetadata,
  setMediaSessionPlaybackState,
  setMediaSessionPosition,
} from "../lib/mediaSession";
import { fisherYatesShuffle } from "../lib/smartShuffle";
import { useUserState } from "./UserStateContext";
import type { EnrichedTrack, LibAlbum, LibraryIndex, RepeatMode } from "../types";

const FIXED_VOLUME = 1;
const CROSSFADE_SEC = 3;

type DeckIx = 0 | 1;

type Ctx = {
  audioRef: React.RefObject<HTMLAudioElement | null>;
  getAnalyser: () => AnalyserNode | null;
  current: EnrichedTrack | null;
  queue: EnrichedTrack[];
  currentIndex: number;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  repeat: RepeatMode;
  shuffle: boolean;
  favorites: Set<string>;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  setVolume: (v: number) => void;
  setRepeat: (m: RepeatMode) => void;
  setShuffle: (v: boolean) => void;
  seek: (t: number) => void;
  seekRatio: (r: number) => void;
  playTrack: (
    t: EnrichedTrack,
    list?: EnrichedTrack[],
    at?: number,
    opts?: { preserveQueueOrder?: boolean }
  ) => void;
  playAlbum: (artist: string, al: LibAlbum) => void;
  addToQueue: (t: EnrichedTrack | EnrichedTrack[]) => void;
  removeFromQueue: (index: number) => void;
  isTrackInQueue: (relPath: string) => boolean;
  removeFromQueueByRelPath: (relPath: string) => void;
  moveQueueItem: (from: number, to: number) => void;
  clearQueue: () => void;
  next: () => void;
  prev: () => void;
  toggleFavorite: (relPath: string) => void;
  isFavorite: (relPath: string) => boolean;
  resyncTracksFromIndex: (index: LibraryIndex) => void;
  prepareRemotePlayback: (baseUrl: string | null) => Promise<void>;
};

const PlayerContext = createContext<Ctx | null>(null);

function pickNextIndex(
  len: number,
  cur: number,
  repeat: RepeatMode,
): number | null {
  if (len <= 0) return null;
  if (repeat === "one") return cur;
  if (cur < len - 1) return cur + 1;
  if (repeat === "all") return 0;
  return null;
}

function pickPrevIndex(
  len: number,
  cur: number,
  repeat: RepeatMode
): number | null {
  if (len <= 0) return null;
  if (cur > 0) return cur - 1;
  if (repeat === "all") return len - 1;
  return null;
}

const MAX_QUEUE_LENGTH = 500;

function capQueueAroundFocus<T>(items: T[], focusIndex: number) {
  if (items.length <= MAX_QUEUE_LENGTH) {
    const i = items.length
      ? Math.max(0, Math.min(focusIndex, items.length - 1))
      : 0;
    return { items, index: i };
  }
  const safe = Math.max(0, Math.min(focusIndex, items.length - 1));
  let start = Math.max(0, safe - Math.floor(MAX_QUEUE_LENGTH / 2));
  if (start + MAX_QUEUE_LENGTH > items.length) {
    start = items.length - MAX_QUEUE_LENGTH;
  }
  const sliced = items.slice(start, start + MAX_QUEUE_LENGTH);
  return { items: sliced, index: safe - start };
}

function reorder<T>(items: T[], from: number, to: number) {
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved as T);
  return next;
}

function shuffleTailFromCurrent<T>(items: T[], currentIdx: number): T[] {
  if (items.length <= 1) return items;
  const i = Math.min(Math.max(0, currentIdx), items.length - 1);
  const prefix = items.slice(0, i + 1);
  const tail = items.slice(i + 1);
  if (tail.length < 2) return [...prefix, ...tail];
  return [...prefix, ...fisherYatesShuffle(tail)];
}

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const user = useUserState();
  const userReady = user.ready;
  const restoreSession = true;
  const persistedQueue = user.state.queue;
  const pushRecent = user.pushRecent;
  const incrementTrackPlayCount = user.incrementTrackPlayCount;
  const setQueueSnapshot = user.setQueueSnapshot;
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioDeck0Ref = useRef<HTMLAudioElement | null>(null);
  const audioDeck1Ref = useRef<HTMLAudioElement | null>(null);
  const gain0Ref = useRef<GainNode | null>(null);
  const gain1Ref = useRef<GainNode | null>(null);
  const [activeDeckIx, setActiveDeckIx] = useState<DeckIx>(0);
  const activeDeckRef = useRef<DeckIx>(0);
  const crossfadeBusyRef = useRef(false);
  const crossfadeTimerRef = useRef(0);
  const crossfadeGenRef = useRef(0);
  const crossfadeOutIxRef = useRef<DeckIx | null>(null);
  const crossfadeInIxRef = useRef<DeckIx | null>(null);
  const crossfadeNextIdxRef = useRef<number | null>(null);
  const skipNextCurrentLoadRef = useRef(false);
  const crossfadeEnabledRef = useRef(true);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const getAnalyser = useCallback(() => analyserRef.current, []);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const keepPlayingRef = useRef(true);
  const restoredRef = useRef(false);
  const repeatRef = useRef<RepeatMode>("all");
  const lastTrackBoundaryAdvanceAtRef = useRef(0);
  const [current, setCurrent] = useState<EnrichedTrack | null>(null);
  const [queue, setQueue] = useState<EnrichedTrack[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume] = useState(FIXED_VOLUME);
  const [repeat, setRepeat] = useState<RepeatMode>("all");
  const [shuffle, setShuffleState] = useState(false);
  const queueRef = useRef(queue);
  const indexRef = useRef(currentIndex);
  const shuffleRef = useRef(false);
  const preShuffleRelPathsRef = useRef<string[] | null>(null);
  const mediaBridgeRef = useRef<MediaSessionBridge>({
    play: () => {
      return;
    },
    pause: () => {
      return;
    },
    next: () => {
      return;
    },
    prev: () => {
      return;
    },
    seek: (time: number) => {
      void time;
      return;
    },
    seekBy: (delta: number) => {
      void delta;
      return;
    },
    toggleShuffle: () => {
      return;
    },
    cycleRepeat: () => {
      return;
    },
    toggleFavoriteCurrent: () => {
      return;
    },
    toggleExcludeCurrent: () => {
      return;
    },
  });
  const currentRef = useRef<EnrichedTrack | null>(null);
  const lastMediaPosAtRef = useRef(0);
  const lastMediaRelPathRef = useRef<string | null>(null);
  const halfListenCountedRef = useRef(false);
  const halfListenTrackRef = useRef<string | null>(null);

  useEffect(() => {
    queueRef.current = queue;
    indexRef.current = currentIndex;
  }, [queue, currentIndex]);

  useEffect(() => {
    shuffleRef.current = shuffle;
  }, [shuffle]);

  useEffect(() => {
    repeatRef.current = repeat;
  }, [repeat]);

  useEffect(() => {
    currentRef.current = current;
  }, [current]);

  useEffect(() => {
    activeDeckRef.current = activeDeckIx;
  }, [activeDeckIx]);

  useLayoutEffect(() => {
    audioRef.current =
      activeDeckIx === 0 ? audioDeck0Ref.current : audioDeck1Ref.current;
  }, [activeDeckIx]);

  useEffect(() => {
    crossfadeEnabledRef.current =
      user.state.settings.trackChangeTransitions !== false;
  }, [user.state.settings.trackChangeTransitions]);

  const snapGainsToSolo = useCallback((ix: DeckIx) => {
    const ctx = audioCtxRef.current;
    const g0 = gain0Ref.current;
    const g1 = gain1Ref.current;
    if (!ctx || !g0 || !g1) return;
    const t = ctx.currentTime;
    g0.gain.cancelScheduledValues(t);
    g1.gain.cancelScheduledValues(t);
    if (ix === 0) {
      g0.gain.setValueAtTime(1, t);
      g1.gain.setValueAtTime(0, t);
    } else {
      g0.gain.setValueAtTime(0, t);
      g1.gain.setValueAtTime(1, t);
    }
  }, []);

  const finalizeCrossfade = useCallback(() => {
    if (!crossfadeBusyRef.current) return;
    window.clearTimeout(crossfadeTimerRef.current);
    crossfadeTimerRef.current = 0;

    const outIx = crossfadeOutIxRef.current;
    const inIx = crossfadeInIxRef.current;
    const nextIdx = crossfadeNextIdxRef.current;
    crossfadeOutIxRef.current = null;
    crossfadeInIxRef.current = null;
    crossfadeNextIdxRef.current = null;
    crossfadeBusyRef.current = false;

    if (outIx == null || inIx == null || nextIdx == null) {
      snapGainsToSolo(activeDeckRef.current);
      return;
    }

    const nextTr = queueRef.current[nextIdx];
    if (!nextTr) {
      snapGainsToSolo(activeDeckRef.current);
      return;
    }

    const outEl = outIx === 0 ? audioDeck0Ref.current : audioDeck1Ref.current;
    if (!outEl) {
      snapGainsToSolo(activeDeckRef.current);
      return;
    }

    outEl.pause();
    outEl.removeAttribute("src");
    void outEl.load();

    const ctx = audioCtxRef.current;
    const gOut = outIx === 0 ? gain0Ref.current : gain1Ref.current;
    const gIn = inIx === 0 ? gain0Ref.current : gain1Ref.current;
    if (ctx && gOut && gIn) {
      const t = ctx.currentTime;
      gOut.gain.cancelScheduledValues(t);
      gIn.gain.cancelScheduledValues(t);
      gOut.gain.setValueAtTime(1, t);
      gIn.gain.setValueAtTime(1, t);
    }

    activeDeckRef.current = inIx;
    setActiveDeckIx(inIx);
    skipNextCurrentLoadRef.current = true;
    setCurrentIndex(nextIdx);
    setCurrent(nextTr);
    keepPlayingRef.current = true;
    pushRecent(nextTr);
  }, [pushRecent, snapGainsToSolo]);

  const abortCrossfade = useCallback(() => {
    crossfadeGenRef.current += 1;
    window.clearTimeout(crossfadeTimerRef.current);
    crossfadeTimerRef.current = 0;
    crossfadeBusyRef.current = false;
    crossfadeOutIxRef.current = null;
    crossfadeInIxRef.current = null;
    crossfadeNextIdxRef.current = null;

    const ctx = audioCtxRef.current;
    const g0 = gain0Ref.current;
    const g1 = gain1Ref.current;
    if (ctx && g0 && g1) {
      const t = ctx.currentTime;
      g0.gain.cancelScheduledValues(t);
      g1.gain.cancelScheduledValues(t);
    }
    snapGainsToSolo(activeDeckRef.current);

    const a = activeDeckRef.current;
    const inIx: DeckIx = a === 0 ? 1 : 0;
    const inactiveEl = inIx === 0 ? audioDeck0Ref.current : audioDeck1Ref.current;
    if (inactiveEl) {
      inactiveEl.pause();
      inactiveEl.removeAttribute("src");
      void inactiveEl.load();
    }
  }, [snapGainsToSolo]);

  const startCrossfade = useCallback(async () => {
    if (!crossfadeEnabledRef.current) return;
    if (crossfadeBusyRef.current) return;
    if (repeatRef.current === "one") return;

    const q = queueRef.current;
    const idx = indexRef.current;
    const nextIdx = pickNextIndex(q.length, idx, repeatRef.current);
    if (nextIdx == null) return;

    const outIx = activeDeckRef.current;
    const inIx: DeckIx = outIx === 0 ? 1 : 0;
    const outEl = outIx === 0 ? audioDeck0Ref.current : audioDeck1Ref.current;
    const inEl = inIx === 0 ? audioDeck0Ref.current : audioDeck1Ref.current;
    if (!outEl || !inEl) return;

    const d = outEl.duration;
    if (!Number.isFinite(d) || d <= 0) return;
    const ct = outEl.currentTime;
    const fadeWindow = Math.min(CROSSFADE_SEC, d);
    if (ct < d - fadeWindow - 0.02) return;
    const remain = d - ct;
    if (remain < 0.08) return;

    const nextTr = q[nextIdx];
    if (!nextTr) return;

    const ctx = audioCtxRef.current;
    const gOut = outIx === 0 ? gain0Ref.current : gain1Ref.current;
    const gIn = inIx === 0 ? gain0Ref.current : gain1Ref.current;
    if (!ctx || !gOut || !gIn) return;

    crossfadeBusyRef.current = true;
    crossfadeOutIxRef.current = outIx;
    crossfadeInIxRef.current = inIx;
    crossfadeNextIdxRef.current = nextIdx;

    inEl.src = mediaUrl(nextTr.relPath);
    inEl.load();

    try {
      if (ctx.state === "suspended") await ctx.resume();
      inEl.currentTime = 0;
      await inEl.play();
    } catch {
      crossfadeBusyRef.current = false;
      crossfadeOutIxRef.current = null;
      crossfadeInIxRef.current = null;
      crossfadeNextIdxRef.current = null;
      snapGainsToSolo(outIx);
      inEl.pause();
      inEl.removeAttribute("src");
      void inEl.load();
      return;
    }

    if (!crossfadeBusyRef.current) return;

    const fadeLen = Math.min(CROSSFADE_SEC, Math.max(remain, 0.05));
    const token = crossfadeGenRef.current;
    const now = ctx.currentTime;
    const vOut = gOut.gain.value;
    const vIn = gIn.gain.value;
    gOut.gain.cancelScheduledValues(now);
    gIn.gain.cancelScheduledValues(now);
    gOut.gain.setValueAtTime(vOut, now);
    gIn.gain.setValueAtTime(vIn, now);
    gOut.gain.linearRampToValueAtTime(0, now + fadeLen);
    gIn.gain.linearRampToValueAtTime(1, now + fadeLen);

    crossfadeTimerRef.current = window.setTimeout(() => {
      if (token !== crossfadeGenRef.current) return;
      finalizeCrossfade();
    }, fadeLen * 1000 + 40);
  }, [finalizeCrossfade, snapGainsToSolo]);

  /** Fine brano: su mobile con schermo spento `ended` / `timeupdate` possono arrivare tardi o mancare. */
  const advanceAfterTrackCompleted = useCallback(() => {
    const now = performance.now();
    if (now - lastTrackBoundaryAdvanceAtRef.current < 450) return;
    if (crossfadeBusyRef.current) return;
    const audio = audioRef.current;
    const cur = currentRef.current;
    if (!audio || !cur) return;

    const d = audio.duration;
    const atEnd =
      audio.ended ||
      (Number.isFinite(d) && d > 0 && audio.currentTime >= d - 0.35);
    if (!atEnd) return;

    lastTrackBoundaryAdvanceAtRef.current = now;

    if (repeatRef.current === "one") {
      audio.currentTime = 0;
      void audio.play().catch(() => setIsPlaying(false));
      return;
    }

    const nextIndex = pickNextIndex(
      queueRef.current.length,
      indexRef.current,
      repeatRef.current,
    );
    if (nextIndex == null) {
      setIsPlaying(false);
      return;
    }
    setCurrentIndex(nextIndex);
    setCurrent(queueRef.current[nextIndex] || null);
    keepPlayingRef.current = true;
  }, []);

  useLayoutEffect(() => {
    const a0 = audioDeck0Ref.current;
    const a1 = audioDeck1Ref.current;
    if (!a0 || !a1 || audioCtxRef.current) return;

    let ctx: AudioContext;
    try {
      ctx = new AudioContext();
    } catch {
      return;
    }

    let src0: MediaElementAudioSourceNode;
    let src1: MediaElementAudioSourceNode;
    try {
      src0 = ctx.createMediaElementSource(a0);
      src1 = ctx.createMediaElementSource(a1);
    } catch {
      void ctx.close();
      return;
    }

    const g0 = ctx.createGain();
    const g1 = ctx.createGain();
    g0.gain.value = 1;
    g1.gain.value = 0;
    gain0Ref.current = g0;
    gain1Ref.current = g1;

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.62;
    analyser.minDecibels = -88;
    analyser.maxDecibels = -28;

    src0.connect(g0);
    src1.connect(g1);
    g0.connect(analyser);
    g1.connect(analyser);
    analyser.connect(ctx.destination);

    audioCtxRef.current = ctx;
    analyserRef.current = analyser;

    return () => {
      analyserRef.current = null;
      gain0Ref.current = null;
      gain1Ref.current = null;
      audioCtxRef.current = null;
      void ctx.close();
    };
  }, []);

  useEffect(() => {
    const a0 = audioDeck0Ref.current;
    const a1 = audioDeck1Ref.current;
    if (a0) a0.volume = volume;
    if (a1) a1.volume = volume;
  }, [volume]);

  useEffect(() => {
    if (!userReady || restoredRef.current) return;
    restoredRef.current = true;
    if (restoreSession && persistedQueue.tracks.length > 0) {
      const timer = window.setTimeout(() => {
        const { items, index } = capQueueAroundFocus(
          persistedQueue.tracks,
          persistedQueue.currentIndex,
        );
        setQueue(items);
        setCurrentIndex(index);
        setCurrent(items[index] || items[0] || null);
        keepPlayingRef.current = false;
      }, 0);
      return () => window.clearTimeout(timer);
    }
  }, [persistedQueue, restoreSession, userReady]);

  useEffect(() => {
    if (!userReady) return;
    setQueueSnapshot(
      restoreSession
        ? { tracks: queue, currentIndex }
        : { tracks: [], currentIndex: 0 }
    );
  }, [currentIndex, queue, restoreSession, setQueueSnapshot, userReady]);

  useEffect(() => {
    if (!current) {
      void abortCrossfade();
      activeDeckRef.current = 0;
      setActiveDeckIx(0);
      snapGainsToSolo(0);
      const a0 = audioDeck0Ref.current;
      const a1 = audioDeck1Ref.current;
      a0?.pause();
      a1?.pause();
      a0?.removeAttribute("src");
      a1?.removeAttribute("src");
      void a0?.load();
      void a1?.load();
      return;
    }
    if (skipNextCurrentLoadRef.current) {
      skipNextCurrentLoadRef.current = false;
      return;
    }

    void abortCrossfade();

    const ix = activeDeckRef.current;
    const audio = ix === 0 ? audioDeck0Ref.current : audioDeck1Ref.current;
    if (!audio) return;
    audio.src = mediaUrl(current.relPath);
    audio.load();
    if (keepPlayingRef.current) {
      const run = async () => {
        const ctx = audioCtxRef.current;
        if (ctx && ctx.state === "suspended") await ctx.resume();
        try {
          await audio.play();
          setIsPlaying(true);
          pushRecent(current);
        } catch {
          setIsPlaying(false);
        }
      };
      void run();
    }
  }, [abortCrossfade, current?.relPath, pushRecent, snapGainsToSolo]);

  useEffect(() => {
    halfListenTrackRef.current = current?.relPath ?? null;
    halfListenCountedRef.current = false;
  }, [current?.relPath]);

  useEffect(() => {
    const a0 = audioDeck0Ref.current;
    const a1 = audioDeck1Ref.current;
    if (!a0 || !a1) return;

    const ixFor = (el: HTMLAudioElement): DeckIx => (el === a0 ? 0 : 1);

    const bind = (audio: HTMLAudioElement) => {
      const onTime = () => {
        if (ixFor(audio) !== activeDeckRef.current) return;
        setCurrentTime(audio.currentTime);
        if (audio.duration && !Number.isNaN(audio.duration))
          setDuration(audio.duration);
        const relPath = currentRef.current?.relPath;
        if (!relPath) return;
        if (halfListenTrackRef.current !== relPath) {
          halfListenTrackRef.current = relPath;
          halfListenCountedRef.current = false;
        }
        const safeDuration =
          audio.duration && !Number.isNaN(audio.duration) ? audio.duration : 0;
        if (!safeDuration) return;
        if (halfListenCountedRef.current && audio.currentTime < safeDuration * 0.1) {
          halfListenCountedRef.current = false;
        }
        if (!halfListenCountedRef.current && audio.currentTime >= safeDuration * 0.5) {
          halfListenCountedRef.current = true;
          incrementTrackPlayCount(relPath);
        }

        if (crossfadeEnabledRef.current && repeatRef.current !== "one") {
          void startCrossfade();
        }
      };
      const onMeta = () => {
        if (ixFor(audio) !== activeDeckRef.current) return;
        if (audio.duration && !Number.isNaN(audio.duration))
          setDuration(audio.duration);
      };
      const onEnd = () => {
        if (ixFor(audio) !== activeDeckRef.current) return;
        if (crossfadeBusyRef.current) {
          finalizeCrossfade();
          return;
        }
        advanceAfterTrackCompleted();
      };
      audio.addEventListener("timeupdate", onTime);
      audio.addEventListener("loadedmetadata", onMeta);
      audio.addEventListener("ended", onEnd);
      return () => {
        audio.removeEventListener("timeupdate", onTime);
        audio.removeEventListener("loadedmetadata", onMeta);
        audio.removeEventListener("ended", onEnd);
      };
    };

    const u0 = bind(a0);
    const u1 = bind(a1);
    return () => {
      u0();
      u1();
    };
  }, [
    advanceAfterTrackCompleted,
    finalizeCrossfade,
    incrementTrackPlayCount,
    startCrossfade,
  ]);

  useEffect(() => {
    const recoverAfterForeground = () => {
      if (document.visibilityState !== "visible") return;
      const wctx = audioCtxRef.current;
      if (wctx?.state === "suspended") void wctx.resume();
      const audio = audioRef.current;
      if (!audio) return;
      if (audio.ended) {
        if (crossfadeBusyRef.current) finalizeCrossfade();
        else advanceAfterTrackCompleted();
        return;
      }
      if (keepPlayingRef.current && audio.paused) {
        void audio
          .play()
          .then(() => setIsPlaying(true))
          .catch(() => setIsPlaying(false));
      }
    };
    document.addEventListener("visibilitychange", recoverAfterForeground);
    window.addEventListener("pageshow", recoverAfterForeground);
    return () => {
      document.removeEventListener("visibilitychange", recoverAfterForeground);
      window.removeEventListener("pageshow", recoverAfterForeground);
    };
  }, [advanceAfterTrackCompleted, finalizeCrossfade]);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState !== "hidden") return;
      if (!keepPlayingRef.current) return;
      advanceAfterTrackCompleted();
    }, 900);
    return () => window.clearInterval(id);
  }, [advanceAfterTrackCompleted]);

  const play = useCallback(async () => {
    void abortCrossfade();
    const ix = activeDeckRef.current;
    const audio = ix === 0 ? audioDeck0Ref.current : audioDeck1Ref.current;
    if (!audio) return;
    const ctx = audioCtxRef.current;
    if (ctx && ctx.state === "suspended") await ctx.resume();
    try {
      await audio.play();
      keepPlayingRef.current = true;
      setIsPlaying(true);
      const cur = currentRef.current;
      if (cur) pushRecent(cur);
    } catch {
      setIsPlaying(false);
    }
  }, [abortCrossfade, pushRecent]);

  const pause = useCallback(() => {
    void abortCrossfade();
    audioDeck0Ref.current?.pause();
    audioDeck1Ref.current?.pause();
    keepPlayingRef.current = false;
    setIsPlaying(false);
  }, [abortCrossfade]);

  const toggle = useCallback(() => {
    if (isPlaying) pause();
    else void play();
  }, [isPlaying, pause, play]);

  const setVolume = useCallback((next: number) => {
    void next;
  }, []);

  const seek = useCallback((time: number) => {
    void abortCrossfade();
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.max(0, time);
  }, [abortCrossfade]);

  const seekRatio = useCallback(
    (ratio: number) => {
      if (!duration) return;
      seek(ratio * duration);
    },
    [duration, seek]
  );

  const playTrack = useCallback(
    (
      track: EnrichedTrack,
      list?: EnrichedTrack[],
      at?: number,
      opts?: { preserveQueueOrder?: boolean }
    ) => {
      const fullQueue = list?.length ? [...list] : [track];
      const nextIndex =
        at ?? fullQueue.findIndex((item) => item.relPath === track.relPath);
      const preCapIndex = nextIndex >= 0 ? nextIndex : 0;
      const { items: nextQueue, index: safeIndex } = capQueueAroundFocus(
        fullQueue,
        preCapIndex,
      );
      const newSig = nextQueue.map((t) => t.relPath).join("\0");
      const oldSig = queueRef.current.map((t) => t.relPath).join("\0");
      const queueReplaced = newSig !== oldSig;
      const shouldShuffle =
        nextQueue.length > 1 &&
        shuffle &&
        queueReplaced &&
        !opts?.preserveQueueOrder;
      if (shouldShuffle) {
        preShuffleRelPathsRef.current = nextQueue.map((t) => t.relPath);
        const shuffled = shuffleTailFromCurrent(nextQueue, safeIndex);
        setQueue(shuffled);
        setCurrentIndex(safeIndex);
        setCurrent(shuffled[safeIndex] || null);
      } else {
        setQueue(nextQueue);
        setCurrentIndex(safeIndex);
        setCurrent(nextQueue[safeIndex] || null);
        if (queueReplaced) {
          if (shuffle) {
            preShuffleRelPathsRef.current = nextQueue.map((t) => t.relPath);
          } else {
            preShuffleRelPathsRef.current = null;
          }
        }
      }
      keepPlayingRef.current = true;
    },
    [shuffle],
  );

  const playAlbum = useCallback(
    (artist: string, album: LibAlbum) => {
      const tracks = album.tracks.map((track) =>
        enrichTrack(artist, album.name, track, album.meta)
      );
      if (!tracks.length) return;
      playTrack(tracks[0], tracks, 0);
    },
    [playTrack]
  );

  const addToQueue = useCallback(
    (track: EnrichedTrack | EnrichedTrack[]) => {
      const items = Array.isArray(track) ? track : [track];
      const prev = queueRef.current;
      const space = Math.max(0, MAX_QUEUE_LENGTH - prev.length);
      const toAdd = items.slice(0, space);
      if (!toAdd.length) return;
      if (!current && toAdd[0]) setCurrent(toAdd[0]);
      setQueue((p) => {
        const sp = Math.max(0, MAX_QUEUE_LENGTH - p.length);
        const add = items.slice(0, sp);
        if (shuffleRef.current) {
          preShuffleRelPathsRef.current = [
            ...(preShuffleRelPathsRef.current ?? p.map((t) => t.relPath)),
            ...add.map((t) => t.relPath),
          ];
        }
        if (!add.length) return p;
        return [...p, ...add];
      });
    },
    [current]
  );

  const removeFromQueue = useCallback((index: number) => {
    const snapshot = queueRef.current;
    const currentAt = indexRef.current;
    const removedPath = snapshot[index]?.relPath;
    const nextQueue = snapshot.filter((_, itemIndex) => itemIndex !== index);
    setQueue(nextQueue);
    if (
      shuffleRef.current &&
      preShuffleRelPathsRef.current &&
      removedPath
    ) {
      preShuffleRelPathsRef.current = preShuffleRelPathsRef.current.filter(
        (p) => p !== removedPath
      );
    }
    if (index < currentAt) {
      setCurrentIndex(currentAt - 1);
      return;
    }
    if (index === currentAt) {
      if (!nextQueue.length) {
        setCurrent(null);
        setCurrentIndex(0);
        keepPlayingRef.current = false;
        audioDeck0Ref.current?.pause();
        audioDeck1Ref.current?.pause();
        setIsPlaying(false);
        return;
      }
      const nextIndex = Math.min(index, nextQueue.length - 1);
      setCurrent(nextQueue[nextIndex] || null);
      setCurrentIndex(nextIndex);
    }
  }, []);

  const isTrackInQueue = useCallback(
    (relPath: string) => queue.some((t) => t.relPath === relPath),
    [queue],
  );

  const removeFromQueueByRelPath = useCallback(
    (relPath: string) => {
      const i = queueRef.current.findIndex((t) => t.relPath === relPath);
      if (i < 0) return;
      removeFromQueue(i);
    },
    [removeFromQueue],
  );

  const moveQueueItem = useCallback((from: number, to: number) => {
    if (
      from === to ||
      from < 0 ||
      to < 0 ||
      from >= queueRef.current.length ||
      to >= queueRef.current.length
    ) {
      return;
    }
    const nextQueue = reorder(queueRef.current, from, to);
    const active = indexRef.current;
    setQueue(nextQueue);
    if (active === from) setCurrentIndex(to);
    else if (from < active && to >= active) setCurrentIndex(active - 1);
    else if (from > active && to <= active) setCurrentIndex(active + 1);
  }, []);

  const clearQueue = useCallback(() => {
    preShuffleRelPathsRef.current = null;
    void abortCrossfade();
    audioDeck0Ref.current?.pause();
    audioDeck1Ref.current?.pause();
    setQueue([]);
    setCurrentIndex(0);
    setCurrent(null);
    keepPlayingRef.current = false;
    setIsPlaying(false);
  }, [abortCrossfade]);

  const resyncTracksFromIndex = useCallback((libraryIndex: LibraryIndex) => {
    const byPath = new Map(
      libraryIndex.tracks.map((t) => [t.relPath, t as EnrichedTrack]),
    );
    setQueue((prev) => prev.map((t) => byPath.get(t.relPath) ?? t));
    setCurrent((c) => (c ? byPath.get(c.relPath) ?? c : c));
  }, []);

  const prepareRemotePlayback = useCallback(
    async (baseUrl: string | null) => {
      if (!current || !baseUrl) return;
      const audio = audioRef.current;
      if (!audio) return;
      const nextSrc = mediaUrl(current.relPath, baseUrl);
      if (audio.src === nextSrc) return;
      const wasPlaying = !audio.paused;
      const at = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
      audio.src = nextSrc;
      audio.load();
      try {
        audio.currentTime = at;
      } catch {
        /* metadata may not be ready yet */
      }
      if (wasPlaying) {
        try {
          await audio.play();
        } catch {
          /* the Cast picker can still be opened by the caller */
        }
      }
    },
    [current],
  );

  const next = useCallback(() => {
    if (!queue.length) return;
    const nextIndex = pickNextIndex(
      queue.length,
      currentIndex,
      repeat,
    );
    if (nextIndex == null) {
      setIsPlaying(false);
      return;
    }
    setCurrentIndex(nextIndex);
    setCurrent(queue[nextIndex] || null);
    keepPlayingRef.current = true;
  }, [currentIndex, queue, repeat]);

  const setShuffle = useCallback((enable: boolean) => {
    if (!enable) {
      const paths = preShuffleRelPathsRef.current;
      preShuffleRelPathsRef.current = null;
      setShuffleState(false);
      if (!paths?.length) return;
      const q = queueRef.current;
      const idx = indexRef.current;
      const cur = q[idx];
      const byPath = new Map(q.map((t) => [t.relPath, t]));
      const seen = new Set<string>();
      const restored: EnrichedTrack[] = [];
      for (const p of paths) {
        const t = byPath.get(p);
        if (t && !seen.has(p)) {
          restored.push(t);
          seen.add(p);
        }
      }
      for (const t of q) {
        if (!seen.has(t.relPath)) restored.push(t);
      }
      if (!restored.length) return;
      const newIdx = cur
        ? restored.findIndex((t) => t.relPath === cur.relPath)
        : 0;
      const j = newIdx >= 0 ? newIdx : 0;
      const { items, index: i } = capQueueAroundFocus(restored, j);
      setQueue(items);
      setCurrentIndex(i);
      setCurrent(items[i] || null);
      return;
    }
    setShuffleState(true);
    const q = queueRef.current;
    const idx = indexRef.current;
    if (q.length < 2) return;
    preShuffleRelPathsRef.current = q.map((t) => t.relPath);
    const shuffled = shuffleTailFromCurrent(q, idx);
    setQueue(shuffled);
    setCurrentIndex(idx);
    setCurrent(shuffled[idx] || null);
  }, []);

  const prev = useCallback(() => {
    if (!queue.length) return;
    void abortCrossfade();
    const audio = audioRef.current;
    if (audio && audio.currentTime > 3) {
      audio.currentTime = 0;
      return;
    }
    const prevIndex = pickPrevIndex(queue.length, currentIndex, repeat);
    if (prevIndex == null) return;
    setCurrentIndex(prevIndex);
    setCurrent(queue[prevIndex] || null);
    keepPlayingRef.current = true;
  }, [abortCrossfade, currentIndex, queue, repeat]);

  useEffect(() => {
    mediaBridgeRef.current = {
      play: () => {
        void play();
      },
      pause,
      next,
      prev,
      seek: (t) => {
        seek(t);
      },
      seekBy: (d) => {
        const a = audioRef.current;
        if (!a) return;
        const nextT = a.currentTime + d;
        seek(Math.max(0, nextT));
      },
      toggleShuffle: () => {
        setShuffle(!shuffleRef.current);
      },
      cycleRepeat: () => {
        setRepeat((r) =>
          r === "off" ? "all" : r === "all" ? "one" : "off",
        );
      },
      toggleFavoriteCurrent: () => {
        const cur = currentRef.current;
        if (!cur) return;
        user.toggleFavorite(cur.relPath);
      },
      toggleExcludeCurrent: () => {
        const cur = currentRef.current;
        if (!cur) return;
        const exAlbums = new Set(user.state.shuffleExcludedAlbumIds);
        if (isTrackAlbumShuffleExcluded(cur, exAlbums)) return;
        user.toggleShuffleExcludedTrack(cur.relPath);
      },
    };
  }, [
    play,
    pause,
    next,
    prev,
    seek,
    setShuffle,
    setRepeat,
    user.toggleFavorite,
    user.toggleShuffleExcludedTrack,
    user.state.shuffleExcludedAlbumIds,
  ]);

  useEffect(() => {
    return registerMediaSessionActions(() => mediaBridgeRef.current);
  }, []);

  useEffect(() => {
    if (!current) {
      setMediaSessionMetadata(null);
      setMediaSessionPlaybackState("none");
      lastMediaPosAtRef.current = 0;
      lastMediaRelPathRef.current = null;
      return;
    }
    setMediaSessionMetadata(current);
    setMediaSessionPlaybackState(isPlaying ? "playing" : "paused");
  }, [current, isPlaying]);

  useEffect(() => {
    if (!current) return;
    if (current.relPath !== lastMediaRelPathRef.current) {
      lastMediaRelPathRef.current = current.relPath;
      lastMediaPosAtRef.current = 0;
    }
    const a = audioRef.current;
    if (!a) return;
    const dur = Number.isFinite(duration) && duration > 0
      ? duration
      : a.duration;
    if (!dur || Number.isNaN(dur) || dur <= 0) return;
    const pos = a.currentTime;
    const now = performance.now();
    const needSeekBar =
      !isPlaying || now - lastMediaPosAtRef.current > 1000;
    if (needSeekBar) {
      lastMediaPosAtRef.current = now;
      setMediaSessionPosition(dur, pos, a.playbackRate || 1);
    }
  }, [current, isPlaying, duration, currentTime]);

  const value = useMemo<Ctx>(
    () => ({
      audioRef,
      getAnalyser,
      current,
      queue,
      currentIndex,
      isPlaying,
      currentTime,
      duration,
      volume,
      repeat,
      shuffle,
      favorites: user.favorites,
      play: () => {
        void play();
      },
      pause,
      toggle,
      setVolume,
      setRepeat,
      setShuffle,
      seek,
      seekRatio,
      playTrack,
      playAlbum,
      addToQueue,
      removeFromQueue,
      isTrackInQueue,
      removeFromQueueByRelPath,
      moveQueueItem,
      clearQueue,
      next,
      prev,
      toggleFavorite: user.toggleFavorite,
      isFavorite: user.isFavorite,
      resyncTracksFromIndex,
      prepareRemotePlayback,
    }),
    [
      getAnalyser,
      addToQueue,
      clearQueue,
      isTrackInQueue,
      removeFromQueueByRelPath,
      resyncTracksFromIndex,
      current,
      currentIndex,
      currentTime,
      duration,
      isPlaying,
      moveQueueItem,
      next,
      pause,
      play,
      playAlbum,
      playTrack,
      prepareRemotePlayback,
      prev,
      queue,
      removeFromQueue,
      repeat,
      seek,
      seekRatio,
      setShuffle,
      setVolume,
      shuffle,
      toggle,
      user.favorites,
      user.isFavorite,
      user.toggleFavorite,
      volume,
    ]
  );

  return (
    <PlayerContext.Provider value={value}>
      {children}
      <audio ref={audioDeck0Ref} hidden preload="auto" crossOrigin="anonymous" />
      <audio ref={audioDeck1Ref} hidden preload="auto" crossOrigin="anonymous" />
    </PlayerContext.Provider>
  );
}

export function usePlayer() {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error("usePlayer");
  return ctx;
}
