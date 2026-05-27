import type { Difficulty, SwipeDirection } from "../types";
import { REKORD_LANES } from "./rekordLanes";

export const LANES = REKORD_LANES;

/** Tre livelli RE-KORD: Easy / Normal / Hard, con Hard sulla densità più alta. */
export const DIFFICULTIES: Difficulty[] = [
  {
    id: "easy",
    label: "Easy",
    tag: "4B Lite",
    level: 7,
    onsetAdjust: -0.06,
    cooldownBase: 0.42,
    cooldownDrop: 0.21,
    cooldownMin: 0.21,
    pulseModulo: 10,
    holdEvery: 3,
    holdIntensity: 0.38,
    swipeEvery: 0,
    swipeIntensity: 1,
  },
  {
    id: "normal",
    label: "Normal",
    tag: "4B Standard",
    level: 10,
    onsetAdjust: -0.22,
    cooldownBase: 0.29,
    cooldownDrop: 0.21,
    cooldownMin: 0.145,
    pulseModulo: 6,
    holdEvery: 2,
    holdIntensity: 0.3,
    swipeEvery: 0,
    swipeIntensity: 1,
  },
  {
    id: "hard",
    label: "Hard",
    tag: "4B Maximum",
    level: 14,
    onsetAdjust: -0.45,
    cooldownBase: 0.205,
    cooldownDrop: 0.14,
    cooldownMin: 0.085,
    pulseModulo: 3,
    holdEvery: 3,
    holdIntensity: 0.21,
    swipeEvery: 0,
    swipeIntensity: 1,
  },
];

export const HIT_WINDOWS = {
  perfect: 0.06,
  good: 0.105,
  ok: 0.15,
  holdSlack: 0.19,
};

export const NOTE_SPEED = 430;
export const HIT_LINE_Y = 0.86;
/** Dock Plectr: più corsia visibile e note che scendono dall’alto. */
export const DOCK_NOTE_SPEED = 280;
/** Linea di hit dock: ~83.5% del canvas, con limiti in px dal bordo inferiore. */
export const DOCK_HIT_LINE_Y = 0.835;
export const DOCK_HIT_LINE_BOTTOM_MIN_PX = 28;
export const DOCK_HIT_LINE_BOTTOM_MAX_PX = 52;
export const HOLD_WIDTH = 18;
export const COUNTDOWN_SECONDS = 3;
export const CHART_LEAD_IN_SECONDS = 4;
export const FAIL_GRACE_SECONDS = 15;
export const SWIPE_THRESHOLD = 34;
export const SWIPE_DIRECTIONS: SwipeDirection[] = ["left", "up", "right"];
