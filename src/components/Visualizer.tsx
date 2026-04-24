import { useEffect, useRef } from "react";
import { usePlayer } from "../context/PlayerContext";
import { binAmplitude, logBinIndex } from "../lib/freqMap";
import type { VizMode } from "../lib/vizMode";

const BARS = 64;

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
  const freq = useRef(new Uint8Array(512));
  const time = useRef(new Uint8Array(2048));
  const tRef = useRef(0);

  useEffect(() => {
    const an = getAnalyser();
    if (an) {
      an.fftSize = mode === "osc" ? 1024 : 512;
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

    const step = () => {
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
        an.fftSize = mode === "osc" ? 1024 : 512;
        const fLen0 = an.frequencyBinCount;
        if (freq.current.length < fLen0) {
          freq.current = new Uint8Array(fLen0);
        }
        if (time.current.length < an.fftSize) {
          time.current = new Uint8Array(an.fftSize);
        }
        if (mode === "osc") {
          an.getByteTimeDomainData(
            time.current.subarray(0, an.fftSize) as never
          );
        } else {
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
        const tLen = an?.fftSize ?? 256;
        ctx.beginPath();
        ctx.lineWidth = 1.4;
        for (let i = 0; i < tLen; i += 1) {
          const v = tv[i]! / 256;
          const x = (i / (tLen - 1)) * w;
          const y = (1 - v) * h * 0.9 + h * 0.05;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        const mid = mix(pal.accent, pal.accent2, 0.48);
        const gl = ctx.createLinearGradient(0, 0, w, 0);
        gl.addColorStop(0, rgba(pal.accent2, 0.42));
        gl.addColorStop(0.5, rgba(mid, 0.95));
        gl.addColorStop(1, rgba(pal.accent, 0.52));
        ctx.strokeStyle = gl;
        ctx.stroke();
        return;
      }

      if (mode === "bars") {
        const pad = 2;
        const bar = (w - pad * 2) / BARS;
        for (let i = 0; i < BARS; i++) {
          const j = logBinIndex(i, BARS, fLen);
          const amp = binAmplitude(fv[j]!);
          const hy =
            h * 0.2 +
            amp * h * 0.68 +
            (isPlaying ? 0.02 * Math.sin(tRef.current * 0.02 + i) : 0);
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
        }
        return;
      }

      if (mode === "mirror") {
        const n = 48;
        const bar = (w - 4) / n;
        const mid = h * 0.5;
        const midRgb = mix(pal.accent, pal.accent2, 0.45);
        for (let i = 0; i < n; i++) {
          const j = logBinIndex(i, n, fLen);
          const v = binAmplitude(fv[j]!);
          const he = 4 + v * (mid - 10) * 0.88;
          const x = 2 + i * bar;
          const bw = Math.max(1, bar * 0.75);
          const g2 = ctx.createLinearGradient(0, mid - he, 0, mid + he);
          g2.addColorStop(0, rgba(pal.accent2, 0.52));
          g2.addColorStop(0.5, rgba(midRgb, 0.62));
          g2.addColorStop(1, rgba(pal.accent, 0.48));
          ctx.fillStyle = g2;
          ctx.fillRect(x, mid - he, bw, he * 2);
        }
        return;
      }
    };
    step();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [getAnalyser, isPlaying, mode]);

  return <canvas className="viz-canvas" ref={cRef} />;
}
