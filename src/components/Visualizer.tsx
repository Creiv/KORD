import { useEffect, useRef } from "react";
import { KordMascotOverlay } from "./KordMascotOverlay";
import { usePlayer } from "../context/PlayerContext";
import { binAmplitude, logBinT, sampleSpectrumLinear } from "../lib/freqMap";
import type { VizMode } from "../lib/vizMode";

const BARS = 64;
const MIRROR_BARS = 48;
const FFT_SPECTRUM = 2048;
const FFT_OSC = 2048;
const SOFT_N = 112;
const OSC_GAIN = 1;
const SPEC_GAMMA = 0.64;
const SPEC_FLOOR = 0.028;

function barBassCalm(i: number, count: number): number {
  if (count <= 1) return 1;
  const t = i / (count - 1);
  return 0.56 + 0.44 * Math.pow(t, 1.22);
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
    const barL = Math.min(SILK_SPEC_DIV, Math.floor(u * SILK_SPEC_DIV));
    const barR = Math.min(SILK_SPEC_DIV, barL + 10);
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

type P = { mode: VizMode };

export function Visualizer({ mode }: P) {
  const { getAnalyser, isPlaying } = usePlayer();
  const cRef = useRef<HTMLCanvasElement>(null);
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
  const kordBeatRef = useRef(0);
  const visibleRef = useRef(
    typeof document !== "undefined" ? !document.hidden : true,
  );

  useEffect(() => {
    peaksBars.current.fill(0);
    peaksMir.current.fill(0);
    if (mode === "signals") {
      softPulseRef.current = 0;
      softYs0Ref.current = null;
      softYs1Ref.current = null;
      softYs2Ref.current = null;
    }
    if (mode !== "kord") kordBeatRef.current = 0;
  }, [mode]);

  useEffect(() => {
    const an = getAnalyser();
    if (an) {
      an.fftSize = mode === "osc" ? FFT_OSC : FFT_SPECTRUM;
    }
  }, [getAnalyser, mode]);

  useEffect(() => {
    const c = cRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    const dpr = () =>
      typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;

    const size = () => {
      const p = c.parentElement;
      const w = p ? p.clientWidth : 400;
      const h = p ? Math.max(100, p.clientHeight || 200) : 200;
      const s = dpr();
      c.width = w * s;
      c.height = h * s;
      c.style.width = `${w}px`;
      c.style.height = `${h}px`;
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
      const w = c.width / dpr();
      const h = c.height / dpr();
      const an = getAnalyser();
      const f = freq.current;
      const t = time.current;

      if (an) {
        if (mode === "osc") {
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
        const tLen = an?.fftSize ?? 1024;
        const padY = h * 0.04;
        const span = h - padY * 2;
        const midY = padY + span * 0.5;
        const oscHalf = (span * 0.5) * 0.97;
        const oscSample = (b: number) =>
          Math.max(
            -1,
            Math.min(1, ((b - 128) / 128) * OSC_GAIN),
          );
        ctx.beginPath();
        ctx.lineWidth = 1.75;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        for (let i = 0; i < tLen; i += 1) {
          const v = oscSample(tv[i]!);
          const x = (i / (tLen - 1)) * w;
          const y = midY - v * oscHalf;
          if (i === 0) ctx.moveTo(x, y);
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
        for (let i = 0; i < tLen; i += 1) {
          const v = oscSample(tv[i]!);
          const x = (i / (tLen - 1)) * w;
          const y = midY - v * oscHalf;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        const gl = ctx.createLinearGradient(0, 0, w, 0);
        gl.addColorStop(0, rgba(pal.accent2, 0.55));
        gl.addColorStop(0.5, rgba(mid, 0.98));
        gl.addColorStop(1, rgba(pal.accent, 0.62));
        ctx.strokeStyle = gl;
        ctx.stroke();
        return;
      }

      if (mode === "signals") {
        const padY = h * 0.04;
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
        if (!xs || xs.length !== SOFT_N) {
          xs = new Float32Array(SOFT_N);
          softXsRef.current = xs;
        }
        if (!ys0 || ys0.length !== SOFT_N) {
          ys0 = new Float32Array(SOFT_N);
          softYs0Ref.current = ys0;
        }
        if (!ys1 || ys1.length !== SOFT_N) {
          ys1 = new Float32Array(SOFT_N);
          softYs1Ref.current = ys1;
        }
        if (!ys2 || ys2.length !== SOFT_N) {
          ys2 = new Float32Array(SOFT_N);
          softYs2Ref.current = ys2;
        }

        buildSilkLayers(
          xs,
          ys0,
          ys1,
          ys2,
          SOFT_N,
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
        clampSilkBandsVertically(midY, yTop, yBot, ys0, ys1, ys2, SOFT_N);

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
        fillSilkRibbon(ctx, xs, ys1, ys2, SOFT_N, gLow);
        ctx.globalAlpha = 1;
        fillSilkRibbon(ctx, xs, ys0, ys1, SOFT_N, gMid);

        const strokeLayer = (
          ys: Float32Array,
          width: number,
          alpha: number,
          blur: number,
        ) => {
          ctx.save();
          ctx.shadowColor = rgba(midRgb, alpha * 0.35);
          ctx.shadowBlur = blur;
          ctx.beginPath();
          softWavePath(ctx, xs, ys, SOFT_N);
          const gl = ctx.createLinearGradient(0, 0, w, 0);
          gl.addColorStop(0, rgba(pal.accent2, 0.35 + alpha * 0.25));
          gl.addColorStop(0.5, rgba(midRgb, 0.55 + alpha * 0.35));
          gl.addColorStop(1, rgba(pal.accent, 0.38 + alpha * 0.22));
          ctx.strokeStyle = gl;
          ctx.lineWidth = width;
          ctx.lineJoin = "round";
          ctx.lineCap = "round";
          ctx.stroke();
          ctx.restore();
        };

        strokeLayer(ys2, 2.1, 0.25, 10);
        strokeLayer(ys1, 2.45, 0.38, 14);
        strokeLayer(ys0, 2.15, 0.32, 12);
        ctx.restore();
        return;
      }

      if (mode === "embers") {
        const padY = h * 0.04;
        const span = h - padY * 2;
        const midY = padY + span * 0.5;
        const tick = tRef.current;
        const ph = tick * 0.0021;
        const ph2 = tick * 0.0014;

        let sum = 0;
        const nn = Math.min(100, fLen);
        for (let j = 0; j < nn; j++) sum += fv[j]!;
        const room = Math.min(1, (sum / (nn * 255)) * 1.06);
        const beat = isPlaying ? 0.32 + 0.68 * room : 0.18 + 0.38 * room;

        const bandAt = (frac: number) => {
          const bi = Math.min(
            SILK_SPEC_DIV,
            Math.max(0, Math.floor(frac * SILK_SPEC_DIV)),
          );
          const xt = logBinT(bi, BARS, fLen);
          return binAmplitude(sampleSpectrumLinear(fv, fLen, xt), {
            gamma: 0.48,
            floor: 0.018,
          });
        };

        ctx.save();
        ctx.beginPath();
        ctx.rect(0, padY, w, Math.max(1, h - 2 * padY));
        ctx.clip();

        const bgA = mix(
          pal.pageL1,
          pal.accent2,
          0.07 + 0.14 * beat + 0.05 * Math.sin(ph),
        );
        const bgB = mix(
          pal.pageL2,
          pal.accent,
          0.05 + 0.11 * beat + 0.04 * Math.sin(ph2 * 1.27),
        );
        const bgM = mix(pal.pageL1, pal.pageL2, 0.48);
        const baseGrad = ctx.createLinearGradient(0, padY, w * 0.75, h - padY);
        baseGrad.addColorStop(0, rgba(bgA, 1));
        baseGrad.addColorStop(0.48, rgba(mix(bgA, bgM, 0.45), 1));
        baseGrad.addColorStop(1, rgba(bgB, 1));
        ctx.fillStyle = baseGrad;
        ctx.fillRect(0, padY, w, h - 2 * padY);

        ctx.save();
        ctx.globalCompositeOperation = "screen";

        for (let layer = 0; layer < 4; layer++) {
          const frac = (layer + 0.5) / 4;
          const e = bandAt(frac * 0.82 + 0.06);
          const cx =
            w *
            (0.18 + frac * 0.64 + 0.07 * Math.sin(ph * 1.1 + layer * 1.05));
          const cy =
            midY +
            span * (0.22 * Math.sin(ph2 * 0.85 + layer * 0.95 + e * 2.2));
          const rx = w * (0.38 + e * 0.24) * (0.55 + 0.45 * beat);
          const ry = span * (0.48 + e * 0.38);
          const col = mix(
            pal.accent,
            pal.accent2,
            0.22 + frac * 0.58 + 0.08 * Math.sin(tick * 0.009 + layer),
          );
          const rad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(rx, ry));
          const aCore = (0.11 + e * 0.5) * (0.42 + 0.58 * beat);
          rad.addColorStop(0, rgba(col, aCore));
          rad.addColorStop(
            0.48,
            rgba(mix(col, pal.accent2, 0.38), aCore * 0.32),
          );
          rad.addColorStop(1, rgba(col, 0));
          ctx.fillStyle = rad;
          ctx.beginPath();
          if (typeof ctx.ellipse === "function") {
            ctx.ellipse(cx, cy, rx, ry, layer * 0.28 + ph * 0.06, 0, TAU);
          } else {
            ctx.save();
            ctx.translate(cx, cy);
            ctx.scale(rx, Math.max(ry, 1));
            ctx.beginPath();
            ctx.arc(0, 0, 1, 0, TAU);
            ctx.fill();
            ctx.restore();
            continue;
          }
          ctx.fill();
        }

        ctx.restore();
        ctx.restore();
        return;
      }

      if (mode === "kord") {
        const padY = h * 0.04;
        const span = h - padY * 2;
        const midY = padY + span * 0.5;
        const padGrad = ctx.createLinearGradient(0, padY, 0, h - padY);
        padGrad.addColorStop(0, rgba(pal.pageL1, 1));
        padGrad.addColorStop(0.5, rgba(mix(pal.pageL1, pal.accent2, 0.06), 1));
        padGrad.addColorStop(1, rgba(pal.pageL2, 1));
        ctx.fillStyle = padGrad;
        ctx.fillRect(0, padY, w, h - 2 * padY);

        let bsum = 0;
        const bn = Math.min(48, fLen);
        for (let j = 0; j < bn; j++) bsum += fv[j]!;
        const bassRaw = Math.min(1, (bsum / (bn * 255)) * 1.38);
        kordBeatRef.current = kordBeatRef.current * 0.64 + bassRaw * 0.36;
        const bass = kordBeatRef.current;

        const pulse = ctx.createRadialGradient(
          w * 0.5,
          midY,
          0,
          w * 0.5,
          midY,
          Math.max(w, span) * 0.55,
        );
        pulse.addColorStop(0, rgba(pal.accent2, 0.05 + bass * 0.14));
        pulse.addColorStop(0.45, rgba(pal.accent, 0.04 + bass * 0.08));
        pulse.addColorStop(1, rgba(pal.pageL1, 0));
        ctx.fillStyle = pulse;
        ctx.fillRect(0, padY, w, h - 2 * padY);
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
          g2.addColorStop(0, rgba(pal.accent2, 0.52));
          g2.addColorStop(0.5, rgba(midRgb, 0.62));
          g2.addColorStop(1, rgba(pal.accent, 0.48));
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
  }, [getAnalyser, isPlaying, mode]);

  return (
    <div className="viz-wrap">
      <canvas className="viz-canvas" ref={cRef} />
      {mode === "kord" ? <KordMascotOverlay /> : null}
    </div>
  );
}
