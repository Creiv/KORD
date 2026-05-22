export type DifficultyId = "easy" | "normal" | "hard";
export type SwipeDirection = "left" | "up" | "right";
export type NoteType = "tap" | "hold" | "swipe";

export interface Difficulty {
  id: "easy" | "normal" | "hard";
  label: string;
  tag: string;
  level: number;
  onsetAdjust: number;
  cooldownBase: number;
  cooldownDrop: number;
  cooldownMin: number;
  pulseModulo: number;
  holdEvery: number;
  holdIntensity: number;
  swipeEvery: number;
  swipeIntensity: number;
}

export interface Lane {
  name: string;
  key: string;
  color: string;
  shadow: string;
}

export interface ChartNote {
  id: number;
  type: NoteType;
  direction: SwipeDirection | null;
  time: number;
  lane: number;
  endLane: number | null;
  duration: number;
  hit: boolean;
  missed: boolean;
  holding: boolean;
  completed: boolean;
}

export interface ChartStats {
  bpm: number;
  rmsAvg: number;
  density: number;
}

export interface Chart {
  songId: string;
  baseSongId: string;
  difficulty: Difficulty;
  title: string;
  duration: number;
  notes: ChartNote[];
  stats: ChartStats;
}

export type ChartMap = Record<DifficultyId, Chart>;

export interface ChartSet {
  baseSongId: string;
  title: string;
  duration: number;
  charts: ChartMap;
}

export interface GameResult {
  failed: boolean;
  score: number;
  maxCombo: number;
  hits: number;
  misses: number;
  accuracy: number;
  grade: string;
}

export interface AnalysisState {
  status: "idle" | "analyzing" | "ready" | "error";
  progress: number;
  message: string;
}
