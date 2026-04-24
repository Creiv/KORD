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
import { getVolume, setVolumePref } from "../lib/persisted";
import { useUserState } from "./UserStateContext";
import type { EnrichedTrack, LibAlbum, RepeatMode } from "../types";

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
  playTrack: (t: EnrichedTrack, list?: EnrichedTrack[], at?: number) => void;
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
};

const PlayerContext = createContext<Ctx | null>(null);

function fisherYatesShuffle<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j] as T, a[i] as T];
  }
  return a;
}

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

function reorder<T>(items: T[], from: number, to: number) {
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved as T);
  return next;
}

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const user = useUserState();
  const userReady = user.ready;
  const restoreSession = user.state.settings.restoreSession;
  const persistedQueue = user.state.queue;
  const pushRecent = user.pushRecent;
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

  useEffect(() => {
    queueRef.current = queue;
    indexRef.current = currentIndex;
  }, [queue, currentIndex]);

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
        setQueue(persistedQueue.tracks);
        setCurrentIndex(persistedQueue.currentIndex);
        setCurrent(
          persistedQueue.tracks[persistedQueue.currentIndex] ||
            persistedQueue.tracks[0] ||
            null
        );
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
  }, [current, pushRecent]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => {
      setCurrentTime(audio.currentTime);
      if (audio.duration && !Number.isNaN(audio.duration))
        setDuration(audio.duration);
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
  }, [current, repeat]);

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
    (track: EnrichedTrack, list?: EnrichedTrack[], at?: number) => {
      const nextQueue = list?.length ? [...list] : [track];
      const nextIndex =
        at ?? nextQueue.findIndex((item) => item.relPath === track.relPath);
      const safeIndex = nextIndex >= 0 ? nextIndex : 0;
      const currentTrack = nextQueue[safeIndex] || track;
      const newSig = nextQueue.map((t) => t.relPath).join("\0");
      const oldSig = queueRef.current.map((t) => t.relPath).join("\0");
      const queueReplaced = newSig !== oldSig;
      if (nextQueue.length > 1 && shuffle && queueReplaced) {
        const shuffled = fisherYatesShuffle(nextQueue);
        const r = shuffled.findIndex(
          (item) => item.relPath === currentTrack.relPath,
        );
        const idx = r >= 0 ? r : 0;
        setQueue(shuffled);
        setCurrentIndex(idx);
        setCurrent(shuffled[idx] || null);
      } else {
        setQueue(nextQueue);
        setCurrentIndex(safeIndex);
        setCurrent(nextQueue[safeIndex] || null);
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
      setQueue((prev) => [...prev, ...items]);
      if (!current && items[0]) setCurrent(items[0]);
    },
    [current]
  );

  const removeFromQueue = useCallback((index: number) => {
    const snapshot = queueRef.current;
    const currentAt = indexRef.current;
    const nextQueue = snapshot.filter((_, itemIndex) => itemIndex !== index);
    setQueue(nextQueue);
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
    setQueue([]);
    setCurrentIndex(0);
    setCurrent(null);
    const audio = audioRef.current;
    audio?.pause();
    if (audio) audio.src = "";
    keepPlayingRef.current = false;
    setIsPlaying(false);
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
    setShuffleState(enable);
    if (!enable) return;
    const q = queueRef.current;
    const idx = indexRef.current;
    if (q.length < 2) return;
    const cur = q[idx];
    const shuffled = fisherYatesShuffle([...q]);
    const newIdx = cur
      ? shuffled.findIndex((t) => t.relPath === cur.relPath)
      : 0;
    setQueue(shuffled);
    setCurrentIndex(newIdx >= 0 ? newIdx : 0);
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
    }),
    [
      addToQueue,
      clearQueue,
      isTrackInQueue,
      removeFromQueueByRelPath,
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
