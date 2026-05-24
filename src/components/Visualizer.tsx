import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePlayer } from "../context/PlayerContext";
import { binAmplitude, logBinT, sampleSpectrumLinear } from "../lib/freqMap";
import type { VizMode } from "../types";

/**
 * Sensibilità: vedi blocchi commentati in testa nella versione precedente; parametri chiave —
 * SPEC_GAMMA / SPEC_FLOOR, FFT_*, OSC_GAIN; `freqMap.binAmplitude` e `NYQUIST_TAIL` in freqMap.ts;
 * buildSilkLayers gamma inline.
 */
const BARS = 64;
const MIRROR_BARS = 48;
const FFT_SPECTRUM = 2048;
const FFT_OSC = 2048;
const SILK_SOFT_N = 112;
const SILK_SOFT_N_EXPANDED = 74;
const OSC_GAIN = 1;
const OSC_SILK_GAP_STEPS = 8;
const OSC_SILK_R_FRAC = 0.019;
const OSC_SILK_R_MIN = 6;
const OSC_SILK_R_MAX = 36;
const OSC_SILK_TAPE = 0.52;
const SPEC_GAMMA = 0.64;
const SPEC_FLOOR = 0.028;

function barBassCalm(i: number, count: number): number {
  if (count <= 1) return 1;
  const t = i / (count - 1);
  return 0.56 + 0.44 * Math.pow(t, 1.22);
}

function smoothOscBox(
  src: Float32Array,
  dst: Float32Array,
  pref: Float32Array,
  n: number,
  r: number,
) {
  if (n <= 0) return;
  if (r <= 0) {
    for (let i = 0; i < n; i += 1) dst[i] = src[i]!;
    return;
  }
  let acc = 0;
  pref[0] = 0;
  for (let i = 0; i < n; i += 1) {
    acc += src[i]!;
    pref[i + 1] = acc;
  }
  for (let k = 0; k < n; k += 1) {
    const lo = Math.max(0, k - r);
    const hi = Math.min(n - 1, k + r);
    const cnt = hi - lo + 1;
    dst[k] = (pref[hi + 1]! - pref[lo]!) / cnt;
  }
}

function oscUpsampledPolyline(
  amp: Float32Array,
  tSeg: number,
  stepsPerGap: number,
  w: number,
  oscHalf: number,
  midY: number,
  xsOut: Float32Array,
  ysOut: Float32Array,
): number {
  const fiMax = Math.max(1, tSeg - 1);
  const nOut = Math.max(2, fiMax * stepsPerGap + 1);
  const denom = Math.max(1e-9, nOut - 1);
  for (let j = 0; j < nOut; j += 1) {
    const fi = (j / denom) * fiMax;
    const k0 =
      fi >= fiMax ? Math.max(0, tSeg - 2) : Math.min(Math.floor(fi), tSeg - 2);
    const frac = Math.min(1, Math.max(0, fi - k0));
    const v = amp[k0]! * (1 - frac) + amp[k0 + 1]! * frac;
    xsOut[j] = (j / denom) * w;
    ysOut[j] = midY - v * oscHalf;
  }
  return nOut;
}

function softWavePath(
  ctx: CanvasRenderingContext2D,
  xs: Float32Array,
  ys: Float32Array,
  n: number,
) {
  if (n < 2) return;
  ctx.moveTo(xs[0]!, ys[0]!);
  if (n === 2) {
    ctx.lineTo(xs[1]!, ys[1]!);
    return;
  }
  for (let i = 1; i < n - 2; i++) {
    const xc = (xs[i]! + xs[i + 1]!) / 2;
    const yc = (ys[i]! + ys[i + 1]!) / 2;
    ctx.quadraticCurveTo(xs[i]!, ys[i]!, xc, yc);
  }
  ctx.quadraticCurveTo(
    xs[n - 2]!,
    ys[n - 2]!,
    xs[n - 1]!,
    ys[n - 1]!,
  );
}

const TAU = Math.PI * 2;
const SILK_SPEC_DIV = BARS - 1;

function fillSilkRibbon(
  ctx: CanvasRenderingContext2D,
  xs: Float32Array,
  ysTop: Float32Array,
  ysBot: Float32Array,
  n: number,
  fillStyle: CanvasGradient | string,
) {
  ctx.beginPath();
  softWavePath(ctx, xs, ysTop, n);
  ctx.lineTo(xs[n - 1]!, ysBot[n - 1]!);
  for (let k = n - 2; k >= 0; k--) {
    ctx.lineTo(xs[k]!, ysBot[k]!);
  }
  ctx.closePath();
  ctx.fillStyle = fillStyle;
  ctx.fill();
}

function buildSilkLayers(
  xs: Float32Array,
  ys0: Float32Array,
  ys1: Float32Array,
  ys2: Float32Array,
  n: number,
  w: number,
  midY: number,
  span: number,
  fv: Uint8Array,
  fLen: number,
  tAnim: number,
  pulse: number,
  inst: number,
  playing: boolean,
) {
  const drift = playing ? tAnim * 0.016 : tAnim * 0.0045;
  const drift2 = playing ? tAnim * -0.0105 : tAnim * -0.0028;
  const drift3 = playing ? tAnim * 0.0078 : tAnim * 0.0022;
  const react = Math.min(1.55, pulse * 0.2 + inst * 0.98);
  const breath = 0.16 + 1.08 * react;

  for (let k = 0; k < n; k++) {
    const u = k / Math.max(1, n - 1);
    xs[k] = u * w;
    const ux = Math.min(1 - 1e-6, Math.pow(u, 0.885));
    const barL = Math.min(
      SILK_SPEC_DIV - 12,
      Math.max(0, Math.floor(ux * SILK_SPEC_DIV)),
    );
    const binSpan = Math.min(
      SILK_SPEC_DIV - barL,
      Math.max(8, Math.floor(ux * (SILK_SPEC_DIV - barL) * 1.08) + 8),
    );
    const barR = Math.min(SILK_SPEC_DIV, barL + binSpan);
    const xtL = logBinT(barL, BARS, fLen);
    const xtR = logBinT(barR, BARS, fLen);
    const specL = binAmplitude(sampleSpectrumLinear(fv, fLen, xtL), {
      gamma: 0.33,
      floor: 0.004,
    });
    const specR = binAmplitude(sampleSpectrumLinear(fv, fLen, xtR), {
      gamma: 0.35,
      floor: 0.004,
    });
    const specBlend = 0.5 * specL + 0.5 * specR;
    const fabric =
      0.34 + 1.08 * Math.pow(Math.min(1, specBlend * 1.32), 0.72);
    const drive = fabric * breath;

    const kf = u * TAU;
    const wA = Math.sin(kf * 2.4 + drift + u * 1.15);
    const wB = Math.sin(kf * 1.08 - drift2 * 1.25 + u * 2.35);
    const wC = Math.cos(kf * 3.75 + u * 0.85 + drift3);
    const wD = Math.sin(kf * 5.1 - drift * 0.6 + u * 1.8);
    const ripple = Math.sin(k * 0.14 + tAnim * 0.026);
    const wiggleFast =
      specBlend *
      react *
      (1.85 * Math.sin(kf * 7.4 + drift * 1.5 + inst * TAU) +
        0.55 * Math.sin(kf * 11.2 - drift2 + inst * 4.1));

    const spread = span * 0.2;
    const m0 =
      drive *
        (0.38 * wA +
          0.32 * wB +
          0.24 * wC +
          0.14 * wD +
          0.14 * ripple) +
      wiggleFast * 0.62;
    const m1 =
      drive *
        (0.34 * Math.sin(kf * 2.05 - drift + u) +
          0.3 * Math.cos(kf * 1.65 + drift2) -
          0.28 * Math.sin(kf * 4.15 + u * 1.2) +
          0.2 * ripple) +
      wiggleFast * 0.52;
    const m2 =
      drive *
        (-0.38 * wB +
          0.36 * Math.sin(kf * 2.75 + drift * 0.85) +
          0.28 * wD -
          0.18 * wA) -
      wiggleFast * 0.48;

    ys0[k] = midY - spread + span * 0.24 * m0;
    ys1[k] = midY + span * 0.22 * m1;
    ys2[k] = midY + spread + span * 0.2 * m2;
  }
}

function clampSilkBandsVertically(
  midY: number,
  yTop: number,
  yBot: number,
  ys0: Float32Array,
  ys1: Float32Array,
  ys2: Float32Array,
  n: number,
) {
  let lo = Infinity;
  let hi = -Infinity;
  for (let k = 0; k < n; k++) {
    lo = Math.min(lo, ys0[k]!, ys1[k]!, ys2[k]!);
    hi = Math.max(hi, ys0[k]!, ys1[k]!, ys2[k]!);
  }
  let s = 1;
  const up = midY - lo;
  const dn = hi - midY;
  if (up > 1e-4 && lo < yTop) {
    s = Math.min(s, (midY - yTop) / up);
  }
  if (dn > 1e-4 && hi > yBot) {
    s = Math.min(s, (yBot - midY) / dn);
  }
  s = Math.min(1, s * 0.992);
  if (s < 1) {
    for (let k = 0; k < n; k++) {
      ys0[k] = midY + (ys0[k]! - midY) * s;
      ys1[k] = midY + (ys1[k]! - midY) * s;
      ys2[k] = midY + (ys2[k]! - midY) * s;
    }
  }
}

type RGB = { r: number; g: number; b: number };

function parseCssColor(raw: string): RGB | null {
  const s = raw.trim();
  if (!s) return null;
  if (s.startsWith("#")) {
    const h = s.slice(1);
    if (h.length === 3) {
      return {
        r: parseInt(h[0]! + h[0]!, 16),
        g: parseInt(h[1]! + h[1]!, 16),
        b: parseInt(h[2]! + h[2]!, 16),
      };
    }
    if (h.length === 6) {
      return {
        r: parseInt(h.slice(0, 2), 16),
        g: parseInt(h.slice(2, 4), 16),
        b: parseInt(h.slice(4, 6), 16),
      };
    }
    return null;
  }
  const m = s.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (m) {
    return { r: +m[1]!, g: +m[2]!, b: +m[3]! };
  }
  return null;
}

function rgba(c: RGB, a: number): string {
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${a})`;
}

function mix(c1: RGB, c2: RGB, t: number): RGB {
  return {
    r: Math.round(c1.r * (1 - t) + c2.r * t),
    g: Math.round(c1.g * (1 - t) + c2.g * t),
    b: Math.round(c1.b * (1 - t) + c2.b * t),
  };
}


export function Visualizer({ mode }: { mode: VizMode }) {
  const { getAnalyser, isPlaying, current, currentTime, duration } = usePlayer();
  const currentLyricsRaw = String(current?.meta?.lyrics || "").trim();
  const parsedLrc = useMemo(() => {
    const out: { atSec: number; text: string }[] = [];
    const rows = currentLyricsRaw.split(/\r?\n/);
    for (const row of rows) {
      const text = row.replace(/\[[^\]]*]/g, "").trim();
      const tags = [...row.matchAll(/\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
      for (const m of tags) {
        const mm = Number(m[1] || 0);
        const ss = Number(m[2] || 0);
        const fracRaw = String(m[3] || "");
        const frac =
          fracRaw.length === 0
            ? 0
            : fracRaw.length === 1
              ? Number(fracRaw) / 10
              : fracRaw.length === 2
                ? Number(fracRaw) / 100
                : Number(fracRaw) / 1000;
        const atSec = mm * 60 + ss + frac;
        if (Number.isFinite(atSec)) out.push({ atSec, text });
      }
    }
    out.sort((a, b) => a.atSec - b.atSec);
    return out;
  }, [currentLyricsRaw]);
  const currentLrcIdx = useMemo(() => {
    if (!parsedLrc.length) return -1;
    let idx = -1;
    for (let i = 0; i < parsedLrc.length; i += 1) {
      if (currentTime >= parsedLrc[i]!.atSec) idx = i;
      else break;
    }
    return idx;
  }, [parsedLrc, currentTime]);
  const currentLrcText =
    currentLrcIdx >= 0 ? parsedLrc[currentLrcIdx]?.text?.trim() || "" : "";
  const previousLrcText =
    currentLrcIdx > 0 ? parsedLrc[currentLrcIdx - 1]?.text?.trim() || "" : "";
  const nextLrcText =
    currentLrcIdx >= 0 ? parsedLrc[currentLrcIdx + 1]?.text?.trim() || "" : "";
  const plainLyricsLines = useMemo(
    () =>
      currentLyricsRaw
        .split(/\r?\n/)
        .map((line) => line.replace(/\[[^\]]*]/g, "").trim())
        .filter(Boolean),
    [currentLyricsRaw],
  );
  const plainLyricsIdx = useMemo(() => {
    if (!plainLyricsLines.length) return -1;
    const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 180;
    const progress = Math.min(0.999, Math.max(0, currentTime / safeDuration));
    return Math.min(plainLyricsLines.length - 1, Math.floor(progress * plainLyricsLines.length));
  }, [currentTime, duration, plainLyricsLines.length]);
  const karaokeHasLrc = parsedLrc.length > 0;
  const karaokeIdx = karaokeHasLrc ? currentLrcIdx : plainLyricsIdx;
  const karaokeCurrent =
    karaokeHasLrc
      ? currentLrcText
      : karaokeIdx >= 0
        ? plainLyricsLines[karaokeIdx] || ""
        : current?.title || "";
  const karaokePrevious =
    karaokeHasLrc
      ? previousLrcText
      : karaokeIdx > 0
        ? plainLyricsLines[karaokeIdx - 1] || ""
        : "";
  const karaokeNext =
    karaokeHasLrc
      ? nextLrcText
      : karaokeIdx >= 0
        ? plainLyricsLines[karaokeIdx + 1] || ""
        : "";
  const wrapRef = useRef<HTMLDivElement>(null);
  const cRef = useRef<HTMLCanvasElement>(null);
  const [expanded, setExpanded] = useState(false);
  const freq = useRef(new Uint8Array(2048));
  const time = useRef(new Uint8Array(FFT_OSC));
  const tRef = useRef(0);
  const peaksBars = useRef(new Float32Array(BARS));
  const peaksMir = useRef(new Float32Array(MIRROR_BARS));
  const softXsRef = useRef<Float32Array | null>(null);
  const softYs0Ref = useRef<Float32Array | null>(null);
  const softYs1Ref = useRef<Float32Array | null>(null);
  const softYs2Ref = useRef<Float32Array | null>(null);
  const softPulseRef = useRef(0);
  const oscWaveScratchRef = useRef<{
    amp: Float32Array;
    ampSm: Float32Array;
    pref: Float32Array;
    xs: Float32Array;
    ys: Float32Array;
  } | null>(null);
  const oscSoftTapeRef = useRef<Float32Array | null>(null);
  const hmbScratchRef = useRef<{
    sig: Float32Array;
    blurB: Float32Array;
    blurM: Float32Array;
    blurF: Float32Array;
    pref: Float32Array;
  } | null>(null);
  const visibleRef = useRef(
    typeof document !== "undefined" ? !document.hidden : true,
  );

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

  useEffect(() => {
    peaksBars.current.fill(0);
    peaksMir.current.fill(0);
    if (mode === "signals") {
      softPulseRef.current = 0;
      softYs0Ref.current = null;
      softYs1Ref.current = null;
      softYs2Ref.current = null;
    }
    if (mode !== "oscSoft") {
      oscWaveScratchRef.current = null;
      oscSoftTapeRef.current = null;
    }
    if (mode !== "hmb") hmbScratchRef.current = null;
  }, [mode]);

  useEffect(() => {
    const an = getAnalyser();
    if (an) {
      an.fftSize =
        mode === "osc" || mode === "oscSoft" || mode === "hmb"
          ? FFT_OSC
          : FFT_SPECTRUM;
    }
  }, [getAnalyser, mode]);

  useEffect(() => {
    const c = cRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let backingScale = typeof window !== "undefined"
      ? window.devicePixelRatio || 1
      : 1;
    const dpr = () =>
      typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;

    const size = () => {
      const p = c.parentElement;
      const lw = p ? p.clientWidth : 400;
      const lh = p ? Math.max(100, p.clientHeight || 200) : 200;
      let s = dpr();
      if (expanded) {
        s = Math.min(s, mode === "signals" ? 1.38 : 1.52);
      }
      backingScale = s;
      c.width = lw * s;
      c.height = lh * s;
      c.style.width = `${lw}px`;
      c.style.height = `${lh}px`;
      ctx.setTransform(s, 0, 0, s, 0, 0);
    };
    size();
    const ro = new ResizeObserver(size);
    if (c.parentElement) ro.observe(c.parentElement);

    const pal = {
      accent: { r: 255, g: 143, b: 92 } as RGB,
      accent2: { r: 100, g: 212, b: 255 } as RGB,
      pageL1: { r: 7, g: 16, b: 27 } as RGB,
      pageL2: { r: 8, g: 17, b: 29 } as RGB,
    };
    let lastTheme: string | undefined;

    const refreshPalette = () => {
      const st = getComputedStyle(document.documentElement);
      const a = parseCssColor(st.getPropertyValue("--accent"));
      const a2 = parseCssColor(st.getPropertyValue("--accent2"));
      const p1 = parseCssColor(st.getPropertyValue("--page-lg-1"));
      const p2 = parseCssColor(st.getPropertyValue("--page-lg-2"));
      const bg = parseCssColor(st.getPropertyValue("--bg"));
      if (a) pal.accent = a;
      if (a2) pal.accent2 = a2;
      if (p1) pal.pageL1 = p1;
      else if (bg) pal.pageL1 = bg;
      if (p2) pal.pageL2 = p2;
      else if (bg) pal.pageL2 = bg;
    };

    const gbar = (h: number, y0: number) => {
      const g = ctx.createLinearGradient(0, y0, 0, h);
      g.addColorStop(0, rgba(pal.accent2, 0.9));
      g.addColorStop(0.5, rgba(pal.accent, 0.75));
      g.addColorStop(1, rgba(pal.pageL2, 0.15));
      return g;
    };

    const onVis = () => {
      visibleRef.current = !document.hidden;
      if (visibleRef.current && raf === 0) {
        raf = requestAnimationFrame(step);
      }
    };
    document.addEventListener("visibilitychange", onVis);

    const step = () => {
      if (!visibleRef.current) {
        raf = 0;
        return;
      }
      raf = requestAnimationFrame(step);
      tRef.current += 1;
      const tId = document.documentElement.dataset.theme ?? "";
      if (tId !== lastTheme) {
        lastTheme = tId;
        refreshPalette();
      }
      const w = c.width / backingScale;
      const h = c.height / backingScale;
      const edgePad = expanded ? 0 : h * 0.04;
      const an = getAnalyser();
      const f = freq.current;
      const t = time.current;

      if (an) {
        if (mode === "osc" || mode === "oscSoft" || mode === "hmb") {
          an.fftSize = FFT_OSC;
          const fLen0 = an.frequencyBinCount;
          if (freq.current.length < fLen0) {
            freq.current = new Uint8Array(fLen0);
          }
          if (time.current.length < an.fftSize) {
            time.current = new Uint8Array(an.fftSize);
          }
          an.getByteTimeDomainData(
            time.current.subarray(0, an.fftSize) as never,
          );
        } else {
          an.fftSize = FFT_SPECTRUM;
          const fLen0 = an.frequencyBinCount;
          if (freq.current.length < fLen0) {
            freq.current = new Uint8Array(fLen0);
          }
          an.getByteFrequencyData(freq.current.subarray(0, fLen0) as never);
        }
      } else {
        f.fill(0);
        t.fill(128);
      }

      const fv = freq.current;
      const tv = time.current;
      const fLen = an ? an.frequencyBinCount : 128;

      ctx.clearRect(0, 0, w, h);
      const bgg = ctx.createLinearGradient(0, 0, 0, h);
      bgg.addColorStop(0, rgba(pal.pageL1, 0.98));
      bgg.addColorStop(1, rgba(pal.pageL2, 0.99));
      ctx.fillStyle = bgg;
      ctx.fillRect(0, 0, w, h);

      if (mode === "osc") {
        ctx.shadowBlur = 0;
        ctx.shadowColor = "transparent";
        ctx.globalAlpha = 1;

        const tLenFull = an?.fftSize ?? 1024;
        const narrowOsc = !expanded && w < 560;
        const trim = narrowOsc ? Math.round(tLenFull * 0.2) : 0;
        const i0 = Math.max(0, trim);
        const i1 = Math.min(tLenFull - 1, tLenFull - 1 - trim);
        const tSeg = Math.max(2, i1 - i0 + 1);
        const padY = edgePad;
        const span = h - padY * 2;
        const midY = padY + span * 0.5;
        const oscAmp = OSC_GAIN * (narrowOsc ? 1.14 : 1);
        const oscHalf = (span * 0.5) * 0.97;
        const oscSample = (b: number) =>
          Math.max(-1, Math.min(1, ((b - 128) / 128) * oscAmp));
        const samp = (k: number) =>
          tv[
            Math.min(
              i1,
              i0 + Math.round((k / Math.max(1, tSeg - 1)) * (i1 - i0)),
            )
          ]!;
        const xDen = Math.max(1, tSeg - 1);

        ctx.beginPath();
        for (let k = 0; k < tSeg; k += 1) {
          const v = oscSample(samp(k));
          const x = (k / xDen) * w;
          const y = midY - v * oscHalf;
          if (k === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.lineTo(w, midY);
        ctx.lineTo(0, midY);
        ctx.closePath();
        const mid = mix(pal.accent, pal.accent2, 0.48);
        const fillG = ctx.createLinearGradient(0, padY, 0, h - padY);
        fillG.addColorStop(0, rgba(pal.accent2, 0.12));
        fillG.addColorStop(0.5, rgba(mid, 0.08));
        fillG.addColorStop(1, rgba(pal.accent, 0.1));
        ctx.fillStyle = fillG;
        ctx.fill();

        ctx.beginPath();
        for (let k = 0; k < tSeg; k += 1) {
          const v = oscSample(samp(k));
          const x = (k / xDen) * w;
          const y = midY - v * oscHalf;
          if (k === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        const gl = ctx.createLinearGradient(0, 0, w, 0);
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        gl.addColorStop(0, rgba(pal.accent2, 0.55));
        gl.addColorStop(0.5, rgba(mid, 0.98));
        gl.addColorStop(1, rgba(pal.accent, 0.62));
        ctx.strokeStyle = gl;
        ctx.lineWidth = expanded ? 3.35 : narrowOsc ? 3.25 : 2.85;
        ctx.stroke();
        return;
      }

      if (mode === "oscSoft") {
        ctx.shadowBlur = 0;
        ctx.shadowColor = "transparent";
        ctx.globalAlpha = 1;

        const tLenFull = an?.fftSize ?? 1024;
        const narrowOsc = !expanded && w < 560;
        const trim = narrowOsc ? Math.round(tLenFull * 0.2) : 0;
        const i0 = Math.max(0, trim);
        const i1 = Math.min(tLenFull - 1, tLenFull - 1 - trim);
        const tSeg = Math.max(2, i1 - i0 + 1);
        const padY = edgePad;
        const span = h - padY * 2;
        const midY = padY + span * 0.5;
        const oscAmp = OSC_GAIN * (narrowOsc ? 1.14 : 1);
        const oscHalf = (span * 0.5) * 0.97;
        const oscSample = (b: number) =>
          Math.max(-1, Math.min(1, ((b - 128) / 128) * oscAmp));
        const samp = (k: number) =>
          tv[
            Math.min(
              i1,
              i0 + Math.round((k / Math.max(1, tSeg - 1)) * (i1 - i0)),
            )
          ]!;

        const fiMax = Math.max(1, tSeg - 1);
        const nUps = Math.max(2, fiMax * OSC_SILK_GAP_STEPS + 1);
        const rSilk = Math.min(
          OSC_SILK_R_MAX,
          Math.max(OSC_SILK_R_MIN, Math.round(tSeg * OSC_SILK_R_FRAC)),
        );
        let wx = oscWaveScratchRef.current;
        const needPref = tSeg + 1;
        if (
          !wx ||
          wx.amp.length < tSeg ||
          wx.ampSm.length < tSeg ||
          wx.pref.length < needPref ||
          wx.xs.length < nUps ||
          wx.ys.length < nUps
        ) {
          wx = {
            amp: new Float32Array(Math.max(tSeg, 4096)),
            ampSm: new Float32Array(Math.max(tSeg, 4096)),
            pref: new Float32Array(Math.max(needPref, 4098)),
            xs: new Float32Array(Math.max(nUps, 32768)),
            ys: new Float32Array(Math.max(nUps, 32768)),
          };
          oscWaveScratchRef.current = wx;
        }
        const wa = wx.amp;
        const wsm = wx.ampSm;
        const pref = wx.pref;
        for (let k = 0; k < tSeg; k += 1)
          wa[k] = oscSample(samp(k));
        smoothOscBox(wa, wsm, pref, tSeg, rSilk);
        smoothOscBox(wsm, wa, pref, tSeg, rSilk);

        let tape = oscSoftTapeRef.current;
        if (!tape || tape.length !== tSeg) {
          tape = new Float32Array(tSeg);
          oscSoftTapeRef.current = tape;
          tape.set(wa.subarray(0, tSeg));
        } else {
          const bt = OSC_SILK_TAPE;
          for (let k = 0; k < tSeg; k += 1)
            tape[k] = tape[k]! * (1 - bt) + wa[k]! * bt;
        }

        const nSilkPath = oscUpsampledPolyline(
          tape,
          tSeg,
          OSC_SILK_GAP_STEPS,
          w,
          oscHalf,
          midY,
          wx.xs,
          wx.ys,
        );

        ctx.beginPath();
        softWavePath(ctx, wx.xs, wx.ys, nSilkPath);
        ctx.lineTo(w, midY);
        ctx.lineTo(0, midY);
        ctx.closePath();
        const mid = mix(pal.accent, pal.accent2, 0.48);
        const fillG = ctx.createLinearGradient(0, padY, 0, h - padY);
        fillG.addColorStop(0, rgba(pal.accent2, 0.22));
        fillG.addColorStop(0.5, rgba(mid, 0.15));
        fillG.addColorStop(1, rgba(pal.accent, 0.2));
        ctx.fillStyle = fillG;
        ctx.fill();

        ctx.beginPath();
        softWavePath(ctx, wx.xs, wx.ys, nSilkPath);
        const gl = ctx.createLinearGradient(0, 0, w, 0);
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        gl.addColorStop(0, rgba(pal.accent2, 0.8));
        gl.addColorStop(0.5, rgba(mid, 1));
        gl.addColorStop(1, rgba(pal.accent, 0.84));
        ctx.strokeStyle = gl;
        ctx.lineWidth = expanded ? 3.55 : narrowOsc ? 3.45 : 3.05;
        ctx.stroke();
        return;
      }

      if (mode === "hmb") {
        ctx.shadowBlur = 0;
        ctx.shadowColor = "transparent";
        ctx.globalAlpha = 1;

        const tLenFull = an?.fftSize ?? 1024;
        const narrowOsc = !expanded && w < 560;
        const trim = narrowOsc ? Math.round(tLenFull * 0.2) : 0;
        const i0 = Math.max(0, trim);
        const i1 = Math.min(tLenFull - 1, tLenFull - 1 - trim);
        const tSeg = Math.max(32, i1 - i0 + 1);
        const padY = edgePad;
        const innerH = Math.max(1, h - padY * 2);
        const rowH = innerH / 3;
        const labelW = expanded ? 34 : 28;
        const x0 = labelW;
        const plotW = Math.max(1, w - labelW - 4);
        const oscAmp = OSC_GAIN * (narrowOsc ? 1.18 : 1.06);
        const oscSample = (b: number) =>
          Math.max(-1, Math.min(1, ((b - 128) / 128) * oscAmp));
        const samp = (k: number) =>
          tv[
            Math.min(
              i1,
              i0 + Math.round((k / Math.max(1, tSeg - 1)) * (i1 - i0)),
            )
          ]!;
        const xDen = Math.max(1, tSeg - 1);

        const needPref = tSeg + 1;
        let hx = hmbScratchRef.current;
        if (
          !hx ||
          hx.sig.length < tSeg ||
          hx.blurB.length < tSeg ||
          hx.blurM.length < tSeg ||
          hx.blurF.length < tSeg ||
          hx.pref.length < needPref
        ) {
          hx = {
            sig: new Float32Array(Math.max(tSeg, 2048)),
            blurB: new Float32Array(Math.max(tSeg, 2048)),
            blurM: new Float32Array(Math.max(tSeg, 2048)),
            blurF: new Float32Array(Math.max(tSeg, 2048)),
            pref: new Float32Array(Math.max(needPref, 4098)),
          };
          hmbScratchRef.current = hx;
        }
        const sig = hx.sig;
        const blurB = hx.blurB;
        const blurM = hx.blurM;
        const blurF = hx.blurF;
        const pref = hx.pref;
        for (let k = 0; k < tSeg; k += 1) sig[k] = oscSample(samp(k));

        const rB = Math.min(
          Math.floor(tSeg * 0.29),
          Math.max(5, Math.floor(tSeg * 0.05)),
        );
        const rM = Math.min(
          Math.max(2, Math.floor(tSeg * 0.016)),
          Math.max(2, rB - 1),
        );
        const rF = Math.max(1, Math.floor(tSeg * 0.0055));

        smoothOscBox(sig, blurB, pref, tSeg, rB);
        smoothOscBox(sig, blurM, pref, tSeg, rM);
        smoothOscBox(sig, blurF, pref, tSeg, rF);

        const gb = 1.04;
        const gm = 1.34;
        const gh = 1.46;

        const drawRow = (
          rowIdx: number,
          sample: (k: number) => number,
          label: string,
          strokeA: RGB,
          strokeB: RGB,
        ) => {
          const yTop = padY + rowIdx * rowH;
          const midY = yTop + rowH * 0.5;
          const oscHalf = rowH * 0.36;
          if (rowIdx > 0) {
            ctx.beginPath();
            ctx.moveTo(x0, yTop);
            ctx.lineTo(w, yTop);
            ctx.strokeStyle = rgba(mix(pal.accent, pal.pageL2, 0.72), 0.14);
            ctx.lineWidth = 1;
            ctx.stroke();
          }
          ctx.beginPath();
          for (let k = 0; k < tSeg; k += 1) {
            const v = Math.max(-1, Math.min(1, sample(k)));
            const x = x0 + (k / xDen) * plotW;
            const y = midY - v * oscHalf;
            if (k === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.lineTo(x0 + plotW, midY);
          ctx.lineTo(x0, midY);
          ctx.closePath();
          const fillG = ctx.createLinearGradient(0, yTop, 0, yTop + rowH);
          fillG.addColorStop(0, rgba(strokeB, 0.1));
          fillG.addColorStop(0.5, rgba(mix(strokeA, strokeB, 0.5), 0.07));
          fillG.addColorStop(1, rgba(strokeA, 0.09));
          ctx.fillStyle = fillG;
          ctx.fill();

          ctx.beginPath();
          for (let k = 0; k < tSeg; k += 1) {
            const v = Math.max(-1, Math.min(1, sample(k)));
            const x = x0 + (k / xDen) * plotW;
            const y = midY - v * oscHalf;
            if (k === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          const gl = ctx.createLinearGradient(x0, 0, x0 + plotW, 0);
          gl.addColorStop(0, rgba(strokeB, 0.82));
          gl.addColorStop(0.5, rgba(mix(strokeA, strokeB, 0.45), 0.95));
          gl.addColorStop(1, rgba(strokeA, 0.78));
          ctx.strokeStyle = gl;
          ctx.lineWidth = expanded ? 2.55 : narrowOsc ? 2.35 : 2.1;
          ctx.lineJoin = "round";
          ctx.lineCap = "round";
          ctx.stroke();

          ctx.save();
          ctx.font = `600 ${expanded ? 13 : 11}px Manrope, system-ui, sans-serif`;
          ctx.fillStyle = rgba(mix(strokeA, strokeB, 0.4), 0.88);
          ctx.textBaseline = "middle";
          ctx.textAlign = "center";
          ctx.fillText(label, labelW * 0.48, midY);
          ctx.restore();
        };

        const midRgb = mix(pal.accent, pal.accent2, 0.48);
        drawRow(0, (k) => (sig[k]! - blurF[k]!) * gh, "H", pal.accent2, pal.accent);
        drawRow(1, (k) => (blurM[k]! - blurB[k]!) * gm, "M", midRgb, pal.accent2);
        drawRow(2, (k) => blurB[k]! * gb, "B", pal.accent, pal.accent2);
        return;
      }

      if (mode === "signals") {
        const silkN = expanded ? SILK_SOFT_N_EXPANDED : SILK_SOFT_N;
        const padY = edgePad;
        const span = h - padY * 2;
        const midY = padY + span * 0.5;
        const midRgb = mix(pal.accent, pal.accent2, 0.48);

        let sumB = 0;
        let sumW = 0;
        const bassN = Math.min(56, fLen);
        const wideN = Math.min(160, fLen);
        for (let i = 0; i < bassN; i++) sumB += fv[i]!;
        for (let i = 0; i < wideN; i++) sumW += fv[i]!;
        const instB = sumB / (bassN * 255);
        const instW = sumW / (wideN * 255);
        const inst = Math.min(1, instB * 0.38 + instW * 0.82);
        const pr = softPulseRef.current;
        softPulseRef.current = pr * 0.58 + inst * 0.42;
        const pulse = softPulseRef.current;

        let xs = softXsRef.current;
        let ys0 = softYs0Ref.current;
        let ys1 = softYs1Ref.current;
        let ys2 = softYs2Ref.current;
        if (!xs || xs.length !== silkN) {
          xs = new Float32Array(silkN);
          softXsRef.current = xs;
        }
        if (!ys0 || ys0.length !== silkN) {
          ys0 = new Float32Array(silkN);
          softYs0Ref.current = ys0;
        }
        if (!ys1 || ys1.length !== silkN) {
          ys1 = new Float32Array(silkN);
          softYs1Ref.current = ys1;
        }
        if (!ys2 || ys2.length !== silkN) {
          ys2 = new Float32Array(silkN);
          softYs2Ref.current = ys2;
        }

        buildSilkLayers(
          xs,
          ys0,
          ys1,
          ys2,
          silkN,
          w,
          midY,
          span,
          fv,
          fLen,
          tRef.current,
          pulse,
          inst,
          isPlaying,
        );

        const clipPad = 5;
        const yTop = padY + clipPad;
        const yBot = h - padY - clipPad;
        clampSilkBandsVertically(midY, yTop, yBot, ys0, ys1, ys2, silkN);

        const gLow = ctx.createLinearGradient(0, midY - span * 0.2, 0, midY + span * 0.22);
        gLow.addColorStop(0, rgba(pal.accent2, 0.14));
        gLow.addColorStop(0.45, rgba(midRgb, 0.1));
        gLow.addColorStop(1, rgba(pal.accent, 0.13));

        const gMid = ctx.createLinearGradient(0, midY - span * 0.18, 0, midY + span * 0.18);
        gMid.addColorStop(0, rgba(pal.accent2, 0.2));
        gMid.addColorStop(0.5, rgba(midRgb, 0.14));
        gMid.addColorStop(1, rgba(pal.accent, 0.18));

        ctx.save();
        ctx.beginPath();
        ctx.rect(0, padY, w, Math.max(1, h - padY * 2));
        ctx.clip();
        ctx.globalAlpha = 0.92;
        fillSilkRibbon(ctx, xs, ys1, ys2, silkN, gLow);
        ctx.globalAlpha = 1;
        fillSilkRibbon(ctx, xs, ys0, ys1, silkN, gMid);

        const strokeLayer = (
          ys: Float32Array,
          width: number,
          alpha: number,
          blur: number,
        ) => {
          ctx.save();
          ctx.shadowBlur = expanded ? 0 : blur;
          ctx.shadowColor = expanded
            ? "transparent"
            : rgba(midRgb, alpha * 0.35);
          ctx.beginPath();
          softWavePath(ctx, xs, ys, silkN);
          const gl = ctx.createLinearGradient(0, 0, w, 0);
          gl.addColorStop(0, rgba(pal.accent2, 0.35 + alpha * 0.25));
          gl.addColorStop(0.5, rgba(midRgb, 0.55 + alpha * 0.35));
          gl.addColorStop(1, rgba(pal.accent, 0.38 + alpha * 0.22));
          ctx.strokeStyle = gl;
          ctx.lineWidth = width * (expanded ? 0.88 : 1);
          ctx.lineJoin = "round";
          ctx.lineCap = "round";
          ctx.stroke();
          ctx.restore();
        };

        strokeLayer(ys2, expanded ? 1.75 : 2.1, 0.25, 10);
        strokeLayer(ys1, expanded ? 2 : 2.45, 0.38, 14);
        strokeLayer(ys0, expanded ? 1.85 : 2.15, 0.32, 12);
        ctx.restore();
        return;
      }

      if (mode === "bars") {
        const pad = 2;
        const bar = (w - pad * 2) / BARS;
        const base = h * 0.2;
        const span = h * 0.68;
        const pk = peaksBars.current;
        const pDecay = isPlaying ? 0.94 : 0.9;
        for (let i = 0; i < BARS; i++) {
          const xt = logBinT(i, BARS, fLen);
          const raw = sampleSpectrumLinear(fv, fLen, xt);
          const amp = binAmplitude(raw, {
            gamma: SPEC_GAMMA,
            floor: SPEC_FLOOR,
          });
          const wobble = isPlaying ? 0.01 * Math.sin(tRef.current * 0.02 + i) : 0;
          const nh = Math.min(1, amp * barBassCalm(i, BARS) + wobble);
          pk[i] = Math.max(nh, pk[i]! * pDecay);
          const hy = base + nh * span;
          const peakH = base + pk[i]! * span;
          const x = pad + i * bar;
          const bw = Math.max(1, bar * 0.7);
          ctx.fillStyle = gbar(h, h - hy);
          ctx.beginPath();
          if (ctx.roundRect) {
            ctx.roundRect(x, h - hy, bw, hy, 3);
          } else {
            ctx.rect(x, h - hy, bw, hy);
          }
          ctx.fill();
          if (pk[i]! > nh + 0.02) {
            ctx.fillStyle = rgba(mix(pal.accent, pal.accent2, 0.35), 0.95);
            ctx.fillRect(x, h - peakH, bw, 2);
          }
        }
        return;
      }

      if (mode === "mirror") {
        const n = MIRROR_BARS;
        const bar = (w - 4) / n;
        const mid = h * 0.5;
        const midRgb = mix(pal.accent, pal.accent2, 0.45);
        const maxHalf = mid - 10;
        const pk = peaksMir.current;
        const pDecay = isPlaying ? 0.94 : 0.9;
        for (let i = 0; i < n; i++) {
          const xt = logBinT(i, n, fLen);
          const raw = sampleSpectrumLinear(fv, fLen, xt);
          const v =
            binAmplitude(raw, { gamma: SPEC_GAMMA, floor: SPEC_FLOOR }) *
            barBassCalm(i, n);
          pk[i] = Math.max(v, pk[i]! * pDecay);
          const he = 4 + v * maxHalf * 0.9;
          const peakHe = 4 + pk[i]! * maxHalf * 0.9;
          const x = 2 + i * bar;
          const bw = Math.max(1, bar * 0.75);
          const g2 = ctx.createLinearGradient(0, mid - he, 0, mid + he);
          g2.addColorStop(0, rgba(pal.accent2, 0.86));
          g2.addColorStop(0.5, rgba(midRgb, 0.92));
          g2.addColorStop(1, rgba(pal.accent, 0.78));
          ctx.fillStyle = g2;
          ctx.beginPath();
          if (ctx.roundRect) {
            ctx.roundRect(x, mid - he, bw, he * 2, 2);
          } else {
            ctx.rect(x, mid - he, bw, he * 2);
          }
          ctx.fill();
          if (pk[i]! > v + 0.02) {
            ctx.fillStyle = rgba(pal.accent2, 0.85);
            ctx.fillRect(x, mid - peakHe, bw, 1.5);
            ctx.fillRect(x, mid + peakHe - 1.5, bw, 1.5);
          }
        }
        return;
      }
    };
    visibleRef.current = !document.hidden;
    if (visibleRef.current) raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVis);
      ro.disconnect();
    };
  }, [getAnalyser, isPlaying, mode, expanded]);

  const wrap = (
    <div
      className={`viz-wrap ${expanded ? "is-expanded" : ""}${
        mode === "karaoke" ? " is-karaoke" : ""
      }`}
      ref={wrapRef}
      role="button"
      tabIndex={0}
      aria-label={
        expanded
          ? "Chiudi visualizzatore espanso"
          : "Espandi visualizzatore"
      }
      onClick={() => toggleExpanded()}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          toggleExpanded();
        }
      }}
    >
      <canvas className="viz-canvas" ref={cRef} />
      {mode === "karaoke" && karaokeCurrent ? (
        <div className="viz-karaoke-overlay" aria-live="polite">
          {expanded && karaokePrevious ? (
            <p className="viz-karaoke-overlay__line viz-karaoke-overlay__line--prev">
              {karaokePrevious}
            </p>
          ) : null}
          <p className="viz-karaoke-overlay__line viz-karaoke-overlay__line--current">
            {karaokeCurrent}
          </p>
          {expanded && karaokeNext ? (
            <p className="viz-karaoke-overlay__line viz-karaoke-overlay__line--next">
              {karaokeNext}
            </p>
          ) : null}
        </div>
      ) : expanded && currentLrcText ? (
        <div className="viz-lyrics-overlay" aria-live="polite">
          {previousLrcText ? (
            <p className="viz-lyrics-overlay__prev">{previousLrcText}</p>
          ) : null}
          <p className="viz-lyrics-overlay__current">{currentLrcText}</p>
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
