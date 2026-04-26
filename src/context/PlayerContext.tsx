/* eslint-disable react-refresh/only-export-components -- hook + provider */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { mediaUrl } from "../lib/api";
import { enrichTrack } from "../lib/enrichTrack";
import {
  type MediaSessionBridge,
  registerMediaSessionActions,
  setMediaSessionMetadata,
  setMediaSessionPlaybackState,
  setMediaSessionPosition,
} from "../lib/mediaSession";
import { fisherYatesShuffle } from "../lib/smartShuffle";
import { getVolume, setVolumePref } from "../lib/persisted";
import { useUserState } from "./UserStateContext";
import type { EnrichedTrack, LibAlbum, LibraryIndex, RepeatMode } from "../types";

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
  const restoreSession = user.state.settings.restoreSession;
  const persistedQueue = user.state.queue;
  const pushRecent = user.pushRecent;
  const incrementTrackPlayCount = user.incrementTrackPlayCount;
  const setQueueSnapshot = user.setQueueSnapshot;
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const keepPlayingRef = useRef(true);
  const restoredRef = useRef(false);
  const [current, setCurrent] = useState<EnrichedTrack | null>(null);
  const [queue, setQueue] = useState<EnrichedTrack[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(getVolume);
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
  });
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
    const audio = audioRef.current;
    if (!audio) return;
    const ctx = new AudioContext();
    audioCtxRef.current = ctx;
    const src = ctx.createMediaElementSource(audio);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.62;
    analyser.minDecibels = -88;
    analyser.maxDecibels = -28;
    src.connect(analyser);
    analyser.connect(ctx.destination);
    analyserRef.current = analyser;
    return () => {
      analyserRef.current = null;
      audioCtxRef.current = null;
      void ctx.close();
    };
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = volume;
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
    if (!current) return;
    const audio = audioRef.current;
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
  }, [current?.relPath, pushRecent]);

  useEffect(() => {
    halfListenTrackRef.current = current?.relPath ?? null;
    halfListenCountedRef.current = false;
  }, [current?.relPath]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => {
      setCurrentTime(audio.currentTime);
      if (audio.duration && !Number.isNaN(audio.duration))
        setDuration(audio.duration);
      const relPath = current?.relPath;
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
    };
    const onMeta = () => {
      if (audio.duration && !Number.isNaN(audio.duration))
        setDuration(audio.duration);
    };
    const onEnd = () => {
      if (repeat === "one" && current) {
        audio.currentTime = 0;
        void audio.play();
        return;
      }
      const nextIndex = pickNextIndex(
        queueRef.current.length,
        indexRef.current,
        repeat,
      );
      if (nextIndex == null) {
        setIsPlaying(false);
        return;
      }
      setCurrentIndex(nextIndex);
      setCurrent(queueRef.current[nextIndex] || null);
      keepPlayingRef.current = true;
    };
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("ended", onEnd);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("ended", onEnd);
    };
  }, [current, incrementTrackPlayCount, repeat]);

  const play = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;
    const ctx = audioCtxRef.current;
    if (ctx && ctx.state === "suspended") await ctx.resume();
    try {
      await audio.play();
      keepPlayingRef.current = true;
      setIsPlaying(true);
      if (current) pushRecent(current);
    } catch {
      setIsPlaying(false);
    }
  }, [current, pushRecent]);

  const pause = useCallback(() => {
    audioRef.current?.pause();
    keepPlayingRef.current = false;
    setIsPlaying(false);
  }, []);

  const toggle = useCallback(() => {
    if (isPlaying) pause();
    else void play();
  }, [isPlaying, pause, play]);

  const setVolume = useCallback((next: number) => {
    const value = Math.min(1, Math.max(0, next));
    setVolumeState(value);
    setVolumePref(value);
  }, []);

  const seek = useCallback((time: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.max(0, time);
  }, []);

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
        audioRef.current?.pause();
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
    setQueue([]);
    setCurrentIndex(0);
    setCurrent(null);
    const audio = audioRef.current;
    audio?.pause();
    if (audio) audio.src = "";
    keepPlayingRef.current = false;
    setIsPlaying(false);
  }, []);

  const resyncTracksFromIndex = useCallback((libraryIndex: LibraryIndex) => {
    const byPath = new Map(
      libraryIndex.tracks.map((t) => [t.relPath, t as EnrichedTrack]),
    );
    setQueue((prev) => prev.map((t) => byPath.get(t.relPath) ?? t));
    setCurrent((c) => (c ? byPath.get(c.relPath) ?? c : c));
  }, []);

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
  }, [currentIndex, queue, repeat]);

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
    };
  }, [play, pause, next, prev, seek]);

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
      getAnalyser: () => analyserRef.current,
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
    }),
    [
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
      <audio ref={audioRef} hidden preload="metadata" />
    </PlayerContext.Provider>
  );
}

export function usePlayer() {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error("usePlayer");
  return ctx;
}
