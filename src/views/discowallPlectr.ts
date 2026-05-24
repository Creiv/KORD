import type { ChartNote, SwipeDirection } from "../game/types";

const LANE_X = [0.18, 0.39, 0.61, 0.82] as const;
const BEATS_PER_TRIAD = 5;
const TAU = Math.PI * 2;

export type DiscoSceneStyle = "bloom" | "pillar" | "constellation" | "pulse";

export interface DiscoTriad {
  hues: [number, number, number];
}

export interface PlectrSample {
  field: number;
  accent: number;
  colorW: [number, number, number];
}

interface MotifInstance {
  kind: ChartNote["type"];
  x: number;
  y: number;
  xEnd: number;
  yEnd: number;
  born: number;
  until: number;
  lane: number;
  direction: SwipeDirection | null;
  strength: number;
}

const TRIAD_FAMILIES: [number, number, number][] = [
  [8, 98, 205],
  [28, 145, 268],
  [312, 42, 128],
  [175, 258, 48],
  [220, 332, 88],
  [95, 188, 305],
  [350, 165, 25],
  [130, 28, 240],
];

export function buildTriads(seed: number, bpm: number | null = null): DiscoTriad[] {
  const family = TRIAD_FAMILIES[seed % TRIAD_FAMILIES.length]!;
  const tempo = bpm ?? 120;
  const count = 10;
  return Array.from({ length: count }, (_, i) => {
    const twist = ((seed >> ((i % 5) * 5)) % 61) + tempo * 0.11 + i * 19;
    return {
      hues: [
        (family[0] + twist) % 360,
        (family[1] + twist * 1.37 + i * 31) % 360,
        (family[2] + twist * 0.91 + i * 47) % 360,
      ] as [number, number, number],
    };
  });
}

export function laneX(lane: number) {
  return LANE_X[Math.max(0, Math.min(3, lane))] ?? 0.5;
}

function clamp(v: number, lo = 0, hi = 1) {
  return Math.max(lo, Math.min(hi, v));
}

function clamp01(v: number) {
  return clamp(v, 0.06, 0.94);
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function smoothstep(t: number) {
  const x = clamp(t);
  return x * x * (3 - 2 * x);
}

function smootherstep(t: number) {
  const x = clamp(t);
  return x * x * x * (x * (x * 6 - 15) + 10);
}

function lifeEnvelope(age: number) {
  const a = clamp(age);
  const fadeIn = smoothstep(a / 0.22);
  const fadeOut = 1 - smoothstep((a - 0.72) / 0.28);
  const peak = Math.sin(a * Math.PI);
  return fadeIn * fadeOut * peak;
}

function triadAt(triads: DiscoTriad[], index: number): DiscoTriad {
  return triads[((index % triads.length) + triads.length) % triads.length]!;
}

function noteHash(note: ChartNote, trackSeed: number) {
  let h = trackSeed ^ Math.imul(note.id + 1, 0x9e3779b1);
  h ^= Math.imul(note.lane + 1, 0x85ebca6b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

/**
 * Percorso nota in [0,1]² (yn=0 alto, yn=1 basso).
 * Quadranti: 0 alto-destra, 1 alto-sinistra, 2 basso-destra, 3 basso-sinistra.
 */
function noteMotionPath(note: ChartNote, trackSeed: number) {
  const h = noteHash(note, trackSeed);
  const reach = 0.26 + h * 0.14;
  const ax = laneX(note.lane);
  const ay = 0.14 + (note.lane / 3) * 0.72;

  if (note.type === "hold" && note.endLane != null && note.endLane !== note.lane) {
    return {
      x: clamp01(laneX(note.lane)),
      y: clamp01(0.14 + (note.lane / 3) * 0.72),
      xEnd: clamp01(laneX(note.endLane)),
      yEnd: clamp01(0.14 + (note.endLane / 3) * 0.72),
    };
  }

  if (note.type === "swipe") {
    if (note.direction === "left") {
      return {
        x: clamp01(ax + reach * 0.35),
        y: clamp01(ay - reach * 0.15),
        xEnd: clamp01(ax - reach * 1.05),
        yEnd: clamp01(ay + reach * 0.95),
      };
    }
    if (note.direction === "right") {
      return {
        x: clamp01(ax - reach * 0.35),
        y: clamp01(ay - reach * 0.1),
        xEnd: clamp01(ax + reach * 1.05),
        yEnd: clamp01(ay + reach * 0.9),
      };
    }
    const upRight = note.lane >= 2;
    return {
      x: clamp01(ax + (upRight ? -0.2 : 0.2) * reach),
      y: clamp01(ay + reach * 0.55),
      xEnd: clamp01(ax + (upRight ? 0.85 : -0.85) * reach),
      yEnd: clamp01(ay - reach * 1.05),
    };
  }

  const q = Math.floor(h * 4) % 4;
  switch (q) {
    case 0:
      return {
        x: clamp01(ax - reach * 0.55),
        y: clamp01(ay + reach * 0.5),
        xEnd: clamp01(ax + reach * 1),
        yEnd: clamp01(ay - reach * 0.95),
      };
    case 1:
      return {
        x: clamp01(ax + reach * 0.5),
        y: clamp01(ay + reach * 0.45),
        xEnd: clamp01(ax - reach * 1),
        yEnd: clamp01(ay - reach * 0.9),
      };
    case 2:
      return {
        x: clamp01(ax - reach * 0.45),
        y: clamp01(ay - reach * 0.25),
        xEnd: clamp01(ax + reach * 1),
        yEnd: clamp01(ay + reach * 0.95),
      };
    default:
      return {
        x: clamp01(ax + reach * 0.5),
        y: clamp01(ay - reach * 0.2),
        xEnd: clamp01(ax - reach * 1),
        yEnd: clamp01(ay + reach * 0.9),
      };
  }
}

export function burstPoint(note: ChartNote, trackSeed: number) {
  const path = noteMotionPath(note, trackSeed);
  return { x: path.xEnd, y: path.yEnd };
}

export function seededNoise(seed: number, i: number) {
  let x = seed ^ Math.imul(i + 1, 0x9e3779b1);
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967295;
}

/** Hue che scorre su beat, tempo di brano e nudge sulle note. */
export function hueSlotAt(
  triads: DiscoTriad[],
  beatIndex: number,
  slot: 0 | 1 | 2,
  liveTime: number,
  colorNudge = 0,
): number {
  const phase =
    beatIndex / BEATS_PER_TRIAD + slot * 0.39 + liveTime * 0.048 + colorNudge * 0.85;
  const idx = Math.floor(phase) % triads.length;
  const local = phase - Math.floor(phase);
  const blend = smootherstep(local);
  const a = triadAt(triads, idx).hues[slot];
  const b = triadAt(triads, idx + 1).hues[slot];
  const drift = liveTime * (2.8 + slot * 0.9) + colorNudge * 22;
  return (a + (b - a) * blend + drift) % 360;
}

/** Fase matematica per pixel (noise + beat + energia locale), senza mappe per zona. */
export function pixelMathPhase(
  seed: number,
  i: number,
  beatIndex: number,
  field: number,
  accent: number,
) {
  const n = seededNoise(seed, i);
  return n * TAU * 2.4 + beatIndex * 0.58 + field * 4.8 + accent * 2.6;
}

export type FrameHues = [number, number, number];

/** Tre hue del frame — una volta per frame, non per pixel. */
export function frameHues(
  triads: DiscoTriad[],
  beatIndex: number,
  liveTime: number,
  colorNudge = 0,
): FrameHues {
  return [
    hueSlotAt(triads, beatIndex, 0, liveTime, colorNudge),
    hueSlotAt(triads, beatIndex, 1, liveTime, colorNudge),
    hueSlotAt(triads, beatIndex, 2, liveTime, colorNudge),
  ];
}

/**
 * Colore: ciclo matematico tra 3 toni + mix solo dove gli eventi Plectr si sovrappongono.
 */
export function mathPixelHue(
  hues: FrameHues,
  colorW: [number, number, number],
  pixelPhase: number,
  accent = 0,
): number {
  const h0 = hues[0];
  const h1 = hues[1];
  const h2 = hues[2];

  const wave =
    Math.sin(pixelPhase) * 0.5 +
    Math.sin(pixelPhase * 1.71 + 0.9) * 0.32 +
    Math.sin(pixelPhase * 0.43 + 2.1) * 0.18;
  const u = clamp(wave * 0.5 + 0.5);
  const seg = u * 3;
  const slot = Math.floor(seg) % 3;
  const frac = seg - slot;
  const slotHues = [h0, h1, h2];
  const mathHue = lerp(slotHues[slot]!, slotHues[(slot + 1) % 3]!, smootherstep(frac));

  const animSum = colorW[0] + colorW[1] + colorW[2];
  if (animSum > 0.07) {
    const animHue =
      (h0 * colorW[0] + h1 * colorW[1] + h2 * colorW[2]) / animSum;
    return animHue * 0.62 + mathHue * 0.38 + accent * 3;
  }
  return mathHue + accent * 3;
}

export type SceneStyleWeights = Record<DiscoSceneStyle, number>;

export function createSceneStyleWeights(): SceneStyleWeights {
  return { bloom: 0.48, pillar: 0.42, constellation: 0.36, pulse: 0 };
}

/** Scrive i pesi nello stesso oggetto (evita allocazioni per frame). */
export function writeSceneStyleWeights(
  out: SceneStyleWeights,
  beatIndex: number,
  seed: number,
): void {
  const styles: DiscoSceneStyle[] = ["bloom", "pillar", "constellation", "pulse"];
  const t = (beatIndex / 8 + seed * 0.0007) % styles.length;
  const i = Math.floor(t);
  const f = smootherstep(t - i);
  out.bloom = 0.48;
  out.pillar = 0.42;
  out.constellation = 0.36;
  out.pulse = 0;
  const a = styles[i % styles.length]!;
  const b = styles[(i + 1) % styles.length]!;
  out[a] += (1 - f) * 0.45;
  out[b] += f * 0.45;
}

/** Pesi per mescolare più stili senza tagli a ogni battuta. */
export function sceneStyleWeights(beatIndex: number, seed: number): SceneStyleWeights {
  const out = createSceneStyleWeights();
  writeSceneStyleWeights(out, beatIndex, seed);
  return out;
}

function noteStrength(note: ChartNote) {
  if (note.type === "hold") return 1;
  if (note.type === "swipe") return 0.88;
  return 0.92;
}

export function collectMotifs(
  notes: ChartNote[],
  time: number,
  trackSeed: number,
  lookAhead = 0.14,
): MotifInstance[] {
  const motifs: MotifInstance[] = [];
  const windowStart = time - 1.45;
  const windowEnd = time + lookAhead;

  for (const note of notes) {
    if (note.time > windowEnd) break;
    if (note.time + Math.max(note.duration, 0.4) < windowStart) continue;

    const path = noteMotionPath(note, trackSeed);
    const strength = noteStrength(note);

    if (note.type === "hold" && time >= note.time && time <= note.time + note.duration + 0.14) {
      motifs.push({
        kind: "hold",
        x: path.x,
        y: path.y,
        xEnd: path.xEnd,
        yEnd: path.yEnd,
        born: note.time,
        until: note.time + note.duration + 0.18,
        lane: note.lane,
        direction: null,
        strength,
      });
      continue;
    }

    if (note.time < windowStart || note.time > time + 0.08) continue;

    motifs.push({
      kind: note.type,
      x: path.x,
      y: path.y,
      xEnd: path.xEnd,
      yEnd: path.yEnd,
      born: note.time,
      until:
        note.time +
        (note.type === "swipe" ? 0.62 : note.type === "hold" ? note.duration : 0.62),
      lane: note.lane,
      direction: note.direction,
      strength,
    });
  }

  return motifs.slice(-32);
}

function softBlob(dx: number, dy: number, spreadX: number, spreadY: number) {
  return Math.exp(-(dx * dx * spreadX + dy * dy * spreadY));
}

function nearestOnSegment(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  xn: number,
  yn: number,
) {
  const abx = x1 - x0;
  const aby = y1 - y0;
  const len2 = abx * abx + aby * aby + 0.0001;
  const t = clamp(((xn - x0) * abx + (yn - y0) * aby) / len2);
  return {
    px: x0 + abx * t,
    py: y0 + aby * t,
    t,
    perp2: (xn - (x0 + abx * t)) ** 2 + (yn - (y0 + aby * t)) ** 2,
  };
}

function tapInfluence(m: MotifInstance, xn: number, yn: number, time: number) {
  const life = Math.max(0.001, m.until - m.born);
  const age = clamp((time - m.born) / life);
  const t = smootherstep(age);
  const swell = lifeEnvelope(age);
  const px = lerp(m.x, m.xEnd, t);
  const py = lerp(m.y, m.yEnd, t);
  const spread = 8 + swell * 3;
  const v = softBlob(xn - px, yn - py, spread, spread * 1.08) * swell * m.strength;
  return { v, cw: [v, 0, 0] as [number, number, number] };
}

function holdInfluence(m: MotifInstance, xn: number, yn: number, time: number) {
  const life = Math.max(0.001, m.until - m.born);
  const age = clamp((time - m.born) / life);
  const t = smootherstep(age);
  const { px, py, t: segT, perp2 } = nearestOnSegment(m.x, m.y, m.xEnd, m.yEnd, xn, yn);
  const onSeg = segT >= -0.08 && segT <= 1.08 ? 1 : 0.4;
  const sweepPx = lerp(m.x, m.xEnd, t);
  const sweepPy = lerp(m.y, m.yEnd, t);
  const along = softBlob(xn - px, yn - py, 14, 14) * onSeg;
  const sweep = softBlob(xn - sweepPx, yn - sweepPy, 11, 11) * 0.7;
  const env = smoothstep(age / 0.12) * (1 - smoothstep((age - 0.88) / 0.12));
  const v = (along * 0.5 + sweep * 0.5) * Math.exp(-perp2 * 32) * env * m.strength;
  return { v, cw: [0, v, 0] as [number, number, number] };
}

function swipeInfluence(m: MotifInstance, xn: number, yn: number, time: number) {
  const life = Math.max(0.001, m.until - m.born);
  const age = clamp((time - m.born) / life);
  const t = smootherstep(age);
  const fade = lifeEnvelope(age);
  const px = lerp(m.x, m.xEnd, t);
  const py = lerp(m.y, m.yEnd, t);
  const v = softBlob(xn - px, yn - py, 12, 15) * fade * m.strength;
  return { v, cw: [0, 0, v] as [number, number, number] };
}

export function prepareConstellationTaps(motifs: MotifInstance[], time: number) {
  return motifs.filter((m) => m.kind === "tap" && time - m.born < 1.35).slice(-6);
}

function constellationInfluenceFromTaps(
  taps: MotifInstance[],
  xn: number,
  yn: number,
  time: number,
) {
  if (taps.length < 2) return { v: 0, cw: [0, 0, 0] as [number, number, number] };

  let sum = 0;
  const cw: [number, number, number] = [0, 0, 0];
  for (let i = 1; i < taps.length; i += 1) {
    const a = taps[i - 1]!;
    const b = taps[i]!;
    const age = smoothstep(1 - (time - b.born) / 1.5);
    const { px, py } = nearestOnSegment(a.xEnd, a.yEnd, b.xEnd, b.yEnd, xn, yn);
    const seg = softBlob(xn - px, yn - py, 16, 20) * age * 0.75;
    sum += seg;
    const share = seg / taps.length;
    cw[0] += share * 0.34;
    cw[1] += share * 0.33;
    cw[2] += share * 0.33;
  }
  return { v: sum, cw };
}

export function samplePlectrField(
  motifs: MotifInstance[],
  styleW: Record<DiscoSceneStyle, number>,
  xn: number,
  yn: number,
  time: number,
  constellationTaps: MotifInstance[],
): PlectrSample {
  let field = 0;
  let accent = 0;
  const colorW: [number, number, number] = [0, 0, 0];

  const add = (v: number, cw: [number, number, number], boost = 1) => {
    field += v * boost;
    accent = Math.max(accent, v);
    colorW[0] += cw[0];
    colorW[1] += cw[1];
    colorW[2] += cw[2];
  };

  const bloomW = styleW.bloom;
  const pillarW = styleW.pillar;
  const constellationW = styleW.constellation;

  for (let mi = 0; mi < motifs.length; mi += 1) {
    const m = motifs[mi]!;
    if (m.kind === "tap") {
      const { v, cw } = tapInfluence(m, xn, yn, time);
      add(v, cw, bloomW * 1.1);
    } else if (m.kind === "hold") {
      const { v, cw } = holdInfluence(m, xn, yn, time);
      add(v, cw, pillarW * 1.15 + bloomW * 0.25);
    } else if (m.kind === "swipe") {
      const { v, cw } = swipeInfluence(m, xn, yn, time);
      add(v, cw, bloomW * 0.5 + 0.65);
    }
  }

  if (constellationW > 0.01) {
    const { v, cw } = constellationInfluenceFromTaps(constellationTaps, xn, yn, time);
    add(v, cw, constellationW * 1.05 + 0.28);
  }

  return { field: clamp(field), accent: clamp(accent), colorW };
}
