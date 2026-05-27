import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { usePlayer } from "../context/PlayerContext";
import { useRhythmChart } from "../game/hooks/useRhythmChart";
import type { ChartNote } from "../game/types";
import { useI18n } from "../i18n/useI18n";
import {
  buildTriads,
  burstPoint,
  collectMotifs,
  createSceneStyleWeights,
  frameHues,
  mathPixelHue,
  pixelMathPhase,
  buildPlectrFieldGrid,
  prepareConstellationTaps,
  samplePlectrFieldGrid,
  seededNoise,
  writeSceneStyleWeights,
} from "../views/discowallPlectr";

const MAX_CELLS_PANEL = 1800;
const MAX_CELLS_EXPANDED = 4000;
const MIN_CELL = 9;
const MAX_CELL = 18;
const FPS_PANEL = 30;
const FPS_EXPANDED_CALM = 45;
const FPS_EXPANDED_ACTIVE = 60;

function clamp(v: number, lo = 0, hi = 1) {
  return Math.max(lo, Math.min(hi, v));
}

function hashText(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function lastNoteIndexAt(notes: ChartNote[], time: number, slack = 0.035): number {
  if (!notes.length) return -1;
  const target = time + slack;
  let lo = 0;
  let hi = notes.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (notes[mid]!.time <= target) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

function hslToRgb(h: number, sPct: number, lPct: number): [number, number, number] {
  const hue = ((h % 360) + 360) % 360;
  const s = clamp(sPct / 100, 0, 1);
  const l = clamp(lPct / 100, 0, 1);
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  let rp = 0;
  let gp = 0;
  let bp = 0;
  if (hue < 60) {
    rp = c;
    gp = x;
  } else if (hue < 120) {
    rp = x;
    gp = c;
  } else if (hue < 180) {
    gp = c;
    bp = x;
  } else if (hue < 240) {
    gp = x;
    bp = c;
  } else if (hue < 300) {
    rp = x;
    bp = c;
  } else {
    rp = c;
    bp = x;
  }
  return [
    (rp + m) * 255 + 0.5 | 0,
    (gp + m) * 255 + 0.5 | 0,
    (bp + m) * 255 + 0.5 | 0,
  ];
}

function blendPixel(
  data: Uint8ClampedArray,
  idx: number,
  r: number,
  g: number,
  b: number,
  a: number,
) {
  const inv = 1 - a;
  data[idx] = (r * a + data[idx]! * inv + 0.5) | 0;
  data[idx + 1] = (g * a + data[idx + 1]! * inv + 0.5) | 0;
  data[idx + 2] = (b * a + data[idx + 2]! * inv + 0.5) | 0;
}

function fillCellRgb(
  data: Uint8ClampedArray,
  bufW: number,
  bufH: number,
  x0: number,
  y0: number,
  size: number,
  r: number,
  g: number,
  b: number,
  a: number,
) {
  const x1 = Math.min(bufW, x0 + size);
  const y1 = Math.min(bufH, y0 + size);
  const xStart = Math.max(0, x0);
  const yStart = Math.max(0, y0);
  for (let py = yStart; py < y1; py += 1) {
    let idx = (py * bufW + xStart) * 4;
    for (let px = xStart; px < x1; px += 1) {
      blendPixel(data, idx, r, g, b, a);
      idx += 4;
    }
  }
}

function chooseNotes(chartSet: ReturnType<typeof useRhythmChart>["chartSet"]) {
  const raw =
    chartSet?.charts.hard?.notes ??
    chartSet?.charts.normal?.notes ??
    chartSet?.charts.easy?.notes ??
    [];
  return [...raw].sort((a, b) => a.time - b.time);
}

export function DiscoWallVisualizer() {
  const { t } = useI18n();
  const { audioRef, current, currentTime, getAnalyser } = usePlayer();
  const { chartSet } = useRhythmChart(current);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const resizeRef = useRef<(() => void) | null>(null);
  const pulseRef = useRef(0);
  const flashRef = useRef(0);
  const colorNudgeRef = useRef(0);
  const burstRef = useRef({ x: 0.5, y: 0.5 });
  const lastNoteRef = useRef(-1);
  const currentTimeRef = useRef(currentTime);
  const notesRef = useRef<ChartNote[]>([]);
  const visibleRef = useRef(
    typeof document !== "undefined" ? !document.hidden : true,
  );
  const inViewRef = useRef(true);
  const drawKickRef = useRef<(() => void) | null>(null);
  const [expanded, setExpanded] = useState(false);

  const notes = useMemo(() => chooseNotes(chartSet), [chartSet]);
  const bpm = chartSet?.charts.hard?.stats.bpm ?? chartSet?.charts.normal?.stats.bpm ?? null;
  const seed = useMemo(
    () => hashText(current?.relPath ?? current?.title ?? "rekord-discowall"),
    [current?.relPath, current?.title],
  );
  const triads = useMemo(() => buildTriads(seed, bpm), [seed, bpm]);

  const showIdle = !current;

  const toggleExpanded = useCallback(() => {
    setExpanded((v) => !v);
  }, []);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  useEffect(() => {
    if (!expanded || typeof document === "undefined") return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [expanded]);

  useLayoutEffect(() => {
    visibleRef.current = !document.hidden;
    resizeRef.current?.();
    const id = requestAnimationFrame(() => resizeRef.current?.());
    const id2 = requestAnimationFrame(() => resizeRef.current?.());
    return () => {
      cancelAnimationFrame(id);
      cancelAnimationFrame(id2);
    };
  }, [expanded]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        inViewRef.current = Boolean(entry?.isIntersecting);
        if (inViewRef.current && visibleRef.current) drawKickRef.current?.();
      },
      { threshold: [0, 0.04, 0.12] },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [expanded]);

  useEffect(() => {
    currentTimeRef.current = currentTime;
  }, [currentTime]);

  useEffect(() => {
    notesRef.current = notes;
    lastNoteRef.current = -1;
    pulseRef.current = 0;
    flashRef.current = 0;
    colorNudgeRef.current = 0;
  }, [notes, current?.relPath]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;

    let raf = 0;
    let width = 1;
    let height = 1;
    let dpr = 1;
    let bufW = 1;
    let bufH = 1;
    let cols = 1;
    let rows = 1;
    let cell = 12;
    let pad = 1;
    let fftScratch: Uint8Array | null = null;
    let frameIx = 0;
    let lastFrameMs = 0;
    let lastLiveEnergy = 0;
    let lastBassEnergy = 0;
    let frameImage: ImageData | null = null;
    let noiseArr: Float32Array | null = null;
    let grainArr: Float32Array | null = null;
    let xnArr: Float32Array | null = null;
    let ynArr: Float32Array | null = null;
    const styleW = createSceneStyleWeights();

    const rebuildCellCaches = () => {
      const n = cols * rows;
      if (!noiseArr || !grainArr || noiseArr.length !== n) {
        noiseArr = new Float32Array(n);
        grainArr = new Float32Array(n);
      }
      const noise = noiseArr;
      const grain = grainArr;
      for (let i = 0; i < n; i += 1) {
        noise[i] = seededNoise(seed, i);
        grain[i] = seededNoise(seed + 31, i);
      }
      if (!xnArr || xnArr.length !== cols) xnArr = new Float32Array(cols);
      if (!ynArr || ynArr.length !== rows) ynArr = new Float32Array(rows);
      const colDenom = cols <= 1 ? 1 : cols - 1;
      const rowDenom = rows <= 1 ? 1 : rows - 1;
      for (let x = 0; x < cols; x += 1) xnArr[x] = cols <= 1 ? 0 : x / colDenom;
      for (let y = 0; y < rows; y += 1) ynArr[y] = rows <= 1 ? 0 : y / rowDenom;
    };

    const resize = () => {
      const parent = wrapRef.current ?? canvas.parentElement;
      let nextW = parent?.clientWidth ?? canvas.clientWidth ?? 0;
      let nextH = parent?.clientHeight ?? canvas.clientHeight ?? 0;
      if (expanded && (nextW < 120 || nextH < 120)) {
        const sideW =
          parseFloat(
            getComputedStyle(document.documentElement).getPropertyValue("--side-w") ||
              "0",
          ) || 0;
        nextW = Math.max(nextW, window.innerWidth - sideW);
        nextH = Math.max(nextH, window.innerHeight);
      }
      width = Math.max(120, nextW || 320);
      height = Math.max(120, nextH || 200);
      dpr = expanded
        ? Math.min(window.devicePixelRatio || 1, 1.25)
        : 1;
      const maxCells = expanded ? MAX_CELLS_EXPANDED : MAX_CELLS_PANEL;
      cell = clamp(Math.round(width / 92), MIN_CELL, MAX_CELL);
      cols = Math.max(18, Math.floor(width / cell));
      rows = Math.max(12, Math.floor(height / cell));
      while (cols * rows > maxCells) {
        cell += 1;
        cols = Math.max(18, Math.floor(width / cell));
        rows = Math.max(12, Math.floor(height / cell));
      }
      pad = Math.max(1, cell * 0.11);
      bufW = Math.round(width * dpr);
      bufH = Math.round(height * dpr);
      canvas.width = bufW;
      canvas.height = bufH;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      if (!frameImage || frameImage.width !== bufW || frameImage.height !== bufH) {
        frameImage = ctx.createImageData(bufW, bufH);
      }
      rebuildCellCaches();
    };

    const onVisibility = () => {
      visibleRef.current = !document.hidden;
      if (visibleRef.current && inViewRef.current && raf === 0) {
        raf = requestAnimationFrame(draw);
      }
    };

    const notePulseAt = (time: number) => {
      const chartNotes = notesRef.current;
      if (!chartNotes.length) return 0;

      const idx = lastNoteIndexAt(chartNotes, time);
      const prev = lastNoteRef.current;
      if (idx > prev) {
        for (let i = prev + 1; i <= idx; i += 1) {
          const note = chartNotes[i]!;
          flashRef.current = Math.max(flashRef.current, 1);
          colorNudgeRef.current = Math.min(
            1.2,
            colorNudgeRef.current + 0.22 + seededNoise(seed, note.id) * 0.18,
          );
          burstRef.current = burstPoint(note, seed);
        }
      }
      lastNoteRef.current = idx;

      let p = 0;
      const k0 = Math.max(0, idx - 3);
      const k1 = Math.min(chartNotes.length, idx + 5);
      for (let k = k0; k < k1; k += 1) {
        const note = chartNotes[k]!;
        const dist = Math.abs(note.time - time);
        if (dist > 0.42) continue;
        const laneBoost = 0.95 + seededNoise(seed, note.id) * 0.18;
        p = Math.max(p, Math.pow(1 - dist / 0.42, 2.4) * laneBoost);
      }
      return clamp(p);
    };

    const draw = () => {
      if (!visibleRef.current || !inViewRef.current) {
        raf = 0;
        return;
      }
      raf = requestAnimationFrame(draw);

      const now = performance.now();
      const prevPulse = pulseRef.current;
      const prevFlash = flashRef.current;
      const targetFps = expanded
        ? prevPulse > 0.12 || prevFlash > 0.08
          ? FPS_EXPANDED_ACTIVE
          : FPS_EXPANDED_CALM
        : FPS_PANEL;
      const minInterval = 1000 / targetFps;
      if (now - lastFrameMs < minInterval) return;
      lastFrameMs = now;
      frameIx += 1;

      const analyser = getAnalyser();
      let liveEnergy = lastLiveEnergy;
      let bassEnergy = lastBassEnergy;
      if (analyser && frameIx % 2 === 0) {
        const len = Math.min(96, analyser.frequencyBinCount);
        if (!fftScratch || fftScratch.length < len) fftScratch = new Uint8Array(len);
        const scratch = fftScratch.subarray(0, len);
        analyser.getByteFrequencyData(scratch as never);
        let sum = 0;
        let bass = 0;
        const bassN = Math.min(12, len);
        for (let i = 0; i < len; i += 1) {
          const v = scratch[i] ?? 0;
          sum += v;
          if (i < bassN) bass += v;
        }
        liveEnergy = sum / (len * 255);
        bassEnergy = bass / (bassN * 255);
        lastLiveEnergy = liveEnergy;
        lastBassEnergy = bassEnergy;
      }

      const audioTime = audioRef.current?.currentTime;
      const liveTime =
        typeof audioTime === "number" && Number.isFinite(audioTime)
          ? audioTime
          : currentTimeRef.current;
      const mappedPulse = notePulseAt(liveTime);
      const pulseTarget = Math.max(
        liveEnergy * 0.5 + bassEnergy * 0.26,
        mappedPulse * 1.02,
      );
      pulseRef.current += (pulseTarget - pulseRef.current) * 0.16;
      pulseRef.current *= 0.992;
      flashRef.current *= 0.91;
      colorNudgeRef.current *= 0.965;

      const pulse = pulseRef.current;
      const flash = flashRef.current;
      const chartNotes = notesRef.current;

      const beatHz = bpm ? bpm / 60 : 1.25;
      const beatIndex = liveTime * beatHz;
      const hasChart = chartNotes.length > 0;
      const hues = frameHues(
        triads,
        beatIndex,
        liveTime,
        hasChart ? colorNudgeRef.current : 0,
      );
      const motifs = hasChart ? collectMotifs(chartNotes, liveTime, seed) : [];
      const constellationTaps = hasChart
        ? prepareConstellationTaps(motifs, liveTime)
        : [];
      if (hasChart) writeSceneStyleWeights(styleW, beatIndex, seed);
      const plectrGrid = hasChart
        ? buildPlectrFieldGrid(motifs, styleW, liveTime, constellationTaps)
        : null;

      if (!frameImage || frameImage.width !== bufW || frameImage.height !== bufH) {
        frameImage = ctx.createImageData(bufW, bufH);
      }
      const pixels = frameImage.data;
      const [bgR, bgG, bgB] = hslToRgb(228 + (seed % 20), 22, 4 + pulse * 1.1);
      for (let i = 0; i < pixels.length; i += 4) {
        pixels[i] = bgR;
        pixels[i + 1] = bgG;
        pixels[i + 2] = bgB;
        pixels[i + 3] = 255;
      }

      const burst = burstRef.current;
      const noise = noiseArr!;
      const grain = grainArr!;
      const xnRow = xnArr!;
      const ynCol = ynArr!;

      for (let y = 0; y < rows; y += 1) {
        const yn = ynCol[y]!;
        for (let x = 0; x < cols; x += 1) {
          const xn = xnRow[x]!;
          const i = y * cols + x;

          let field: number;
          let accent = 0;
          let colorW0 = 0.2;
          let colorW1 = 0.2;
          let colorW2 = 0.2;

          if (hasChart && plectrGrid) {
            const sampled = samplePlectrFieldGrid(plectrGrid, xn, yn);
            field = sampled.field;
            accent = sampled.accent;
            colorW0 = sampled.colorW[0];
            colorW1 = sampled.colorW[1];
            colorW2 = sampled.colorW[2];
          } else {
            // Parete spenta (pre-chart / silenzio): pochi pixel, solo energia audio
            field = 0.05 + pulse * 0.14 + bassEnergy * 0.06;
          }

          const bdx = xn - burst.x;
          const bdy = yn - burst.y;
          const burstDist = Math.sqrt(bdx * bdx + bdy * bdy);
          const burstHit = hasChart
            ? flash > 0.08
              ? Math.max(0, 1 - burstDist * (3 - flash * 0.7)) ** 1.7
              : 0
            : 0;

          const phase = pixelMathPhase(seed, i, beatIndex, field, accent);
          const shimmer = hasChart
            ? 0.08 * (0.5 + 0.5 * Math.sin(phase * 1.25))
            : 0.03 * (0.5 + 0.5 * Math.sin(phase * 1.1));
          field += shimmer;

          const gateThreshold = hasChart
            ? 0.4 - field * 0.18 + Math.sin(phase * 2.1) * 0.05
            : 0.5 - field * 0.12 + Math.sin(phase * 2.1) * 0.04;
          const pixelGate = grain[i]! > gateThreshold;
          const core = clamp(
            field * (hasChart ? 1.08 : 0.92) +
              pulse * (hasChart ? 0.16 : 0.1) +
              bassEnergy * 0.08 +
              burstHit * (0.48 + flash * 0.45) -
              (pixelGate ? 0.1 : 0),
          );
          const coreMin = hasChart ? 0.14 : 0.2;
          const coreGate = hasChart ? 0.34 : 0.4;
          if (core < coreMin || (pixelGate && core < coreGate)) continue;

          const hue =
            mathPixelHue(hues, [colorW0, colorW1, colorW2], phase, accent * 0.2) +
            (noise[i]! - 0.5) * 2.5 +
            burstHit * 4;
          const sat = 44 + clamp(accent + pulse * 0.5) * 26;
          const light = 16 + core * 28 + flash * burstHit * 9;
          const sizeBoost = clamp(core * 0.9 + flash * burstHit * 0.34);
          const s = Math.max(1.2, cell - pad * 2) * (0.18 + sizeBoost * 0.9);
          const px = (x * cell + pad * 0.5 + (cell - s) * 0.5) * dpr;
          const py = (y * cell + pad * 0.5 + (cell - s) * 0.5) * dpr;
          const sD = Math.max(1, Math.round(s * dpr));
          const [r, g, b] = hslToRgb(hue, sat, light);
          const alpha = clamp(0.11 + core * 0.76, 0.1, 0.88);
          fillCellRgb(pixels, bufW, bufH, px | 0, py | 0, sD, r, g, b, alpha);
        }
      }

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.putImageData(frameImage, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const scrim = expanded
        ? 0.28 - Math.min(0.08, flash * 0.06)
        : 0.38 - Math.min(0.1, flash * 0.08);
      ctx.fillStyle = `rgba(0, 0, 0, ${scrim})`;
      ctx.fillRect(0, 0, width, height);
    };

    resizeRef.current = resize;
    drawKickRef.current = () => {
      if (raf === 0 && visibleRef.current && inViewRef.current) {
        raf = requestAnimationFrame(draw);
      }
    };
    resize();
    const ro = new ResizeObserver(() => resize());
    const observeTarget = wrapRef.current ?? canvas.parentElement;
    if (observeTarget) ro.observe(observeTarget);
    const onWindowResize = () => resize();
    if (expanded) window.addEventListener("resize", onWindowResize);
    document.addEventListener("visibilitychange", onVisibility);
    visibleRef.current = !document.hidden;
    raf = requestAnimationFrame(draw);

    return () => {
      resizeRef.current = null;
      drawKickRef.current = null;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onWindowResize);
      document.removeEventListener("visibilitychange", onVisibility);
      ro.disconnect();
    };
  }, [audioRef, bpm, current?.relPath, expanded, getAnalyser, seed, triads]);

  const wrap = (
    <div
      ref={wrapRef}
      className={`viz-wrap is-discowall ${expanded ? "is-expanded" : ""}`}
      role="button"
      tabIndex={0}
      aria-label={
        expanded
          ? t("settings.vizCloseExpanded")
          : t("settings.vizExpand")
      }
      onClick={() => toggleExpanded()}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          toggleExpanded();
        }
      }}
    >
      <canvas ref={canvasRef} className="viz-canvas" aria-hidden />
      {showIdle ? (
        <div className="viz-discowall-status" role="status">
          <p>{t("settings.vizDiscowallIdle")}</p>
        </div>
      ) : null}
    </div>
  );

  if (expanded && typeof document !== "undefined") {
    return (
      <>
        <div className="listen-stage__viz-placeholder" aria-hidden />
        {createPortal(wrap, document.body)}
      </>
    );
  }

  return wrap;
}

export default DiscoWallVisualizer;
