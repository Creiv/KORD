import { CHART_LEAD_IN_SECONDS, DIFFICULTIES, LANES } from "../config/gameConfig";
import { clamp, mean, percentile, stableHash, stddev } from "./math";
import { yieldUi } from "./yieldUi";
import type { Chart, ChartNote, ChartSet, Difficulty, NoteType, SwipeDirection } from "../types";

const HOP_SIZE = 1024;
const FRAME_SIZE = 2048;
const SECTION_SECONDS = 8;
const SNAP_SUBDIVISION = 4;
/** Motivi dedicati per Easy / Normal / Hard. */
const MOTIFS = {
  easy: [
    [0, 1, 2, 3, 2, 1, 0, 2],
    [3, 2, 1, 0, 1, 2, 3, 1],
    [0, 2, 1, 3, 1, 2, 0, 3],
    [1, 3, 2, 0, 2, 1, 3, 0],
  ],
  normal: [
    [0, 1, 3, 2, 1, 0, 2, 3],
    [3, 1, 2, 0, 2, 3, 1, 0],
    [0, 2, 3, 1, 3, 2, 0, 1],
    [2, 0, 1, 3, 0, 2, 3, 1],
  ],
  hard: [
    [0, 2, 1, 3, 2, 0, 3, 1, 2, 3, 0, 1],
    [3, 1, 2, 0, 1, 3, 0, 2, 1, 0, 3, 2],
    [0, 3, 1, 2, 3, 0, 2, 1, 0, 2, 3, 1],
    [2, 0, 3, 1, 0, 2, 1, 3, 2, 1, 0, 3],
  ],
};

interface FrameStats {
  rms: number;
  zcr: number;
}

interface OnsetCandidate {
  frame: number;
  time: number;
  strength: number;
  intensity: number;
  brightness: number;
}

interface SelectedCandidate extends OnsetCandidate {
  gridIndex: number;
}

interface BeatGrid {
  bpm: number;
  beatInterval: number;
  phaseTime: number;
  step: number;
  firstBeat: number;
  duration: number;
}

interface SectionStats {
  index: number;
  energy: number;
}

interface CleanupRules {
  minGap: number;
  sameLaneGap: number;
  holdReleaseGap: number;
  minHold: number;
  maxHold: number;
  blockAllDuringHold: boolean;
}

const CLEANUP_RULES: Record<Difficulty["id"], CleanupRules> = {
  easy: {
    minGap: 0.18,
    sameLaneGap: 0.39,
    holdReleaseGap: 0.18,
    minHold: 0.45,
    maxHold: 1.8,
    blockAllDuringHold: true,
  },
  normal: {
    minGap: 0.12,
    sameLaneGap: 0.28,
    holdReleaseGap: 0.15,
    minHold: 0.42,
    maxHold: 2.05,
    blockAllDuringHold: false,
  },
  hard: {
    minGap: 0.085,
    sameLaneGap: 0.19,
    holdReleaseGap: 0.115,
    minHold: 0.36,
    maxHold: 2.25,
    blockAllDuringHold: false,
  },
};

function fileFingerprint(file: File, duration: number): string {
  return `${file.name}:${file.size}:${Math.round(duration * 1000)}:${file.lastModified || 0}`;
}

function trackFingerprint(relPath: string, duration: number): string {
  return `rekord:${relPath}:${Math.round(duration * 1000)}`;
}

function makeMono(buffer: AudioBuffer): Float32Array {
  const length = buffer.length;
  const channelCount = buffer.numberOfChannels;
  const mono = new Float32Array(length);
  for (let channel = 0; channel < channelCount; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i += 1) mono[i] += data[i] / channelCount;
  }
  return mono;
}

function frameStats(samples: Float32Array, start: number, size: number): FrameStats {
  let energy = 0;
  let crossings = 0;
  let prev = samples[start] || 0;
  const end = Math.min(samples.length, start + size);
  for (let i = start; i < end; i += 1) {
    const sample = samples[i];
    energy += sample * sample;
    if ((sample >= 0 && prev < 0) || (sample < 0 && prev >= 0)) crossings += 1;
    prev = sample;
  }
  const count = Math.max(1, end - start);
  return {
    rms: Math.sqrt(energy / count),
    zcr: crossings / count,
  };
}

function noteBase(id: number, type: NoteType, direction: SwipeDirection | null, time: number, lane: number, duration: number, endLane: number | null = null): ChartNote {
  return {
    id,
    type,
    direction,
    time: Number(time.toFixed(3)),
    lane,
    endLane,
    duration: Number(duration.toFixed(3)),
    hit: false,
    missed: false,
    holding: false,
    completed: false,
  };
}

function frameToTime(frame: number, sampleRate: number): number {
  return (frame * HOP_SIZE) / sampleRate;
}

function localAverage(values: Float32Array, center: number, radius: number): number {
  const start = Math.max(0, center - radius);
  const end = Math.min(values.length - 1, center + radius);
  let total = 0;
  for (let i = start; i <= end; i += 1) total += values[i];
  return total / Math.max(1, end - start + 1);
}

function buildNovelty({ flux, rms, zcr }: { flux: Float32Array; rms: Float32Array; zcr: Float32Array }): Float32Array {
  const novelty = new Float32Array(flux.length);
  const fluxValues = Array.from(flux);
  const fluxPeak = Math.max(0.0001, percentile(fluxValues, 0.96));
  const rmsPeak = Math.max(0.0001, percentile(Array.from(rms), 0.9));
  for (let frame = 1; frame < flux.length; frame += 1) {
    const local = localAverage(flux, frame, 16);
    const transient = Math.max(0, flux[frame] - local) / fluxPeak;
    const energyLift = Math.max(0, rms[frame] - rms[frame - 1]) / rmsPeak;
    const brightnessLift = Math.max(0, zcr[frame] - localAverage(zcr, frame, 10)) * 18;
    novelty[frame] = transient * 0.72 + energyLift * 0.22 + brightnessLift * 0.06;
  }
  return novelty;
}

function pickOnsetCandidates({ buffer, novelty, rms, rmsGate, sampleRate, zcr }: { buffer: AudioBuffer; novelty: Float32Array; rms: Float32Array; rmsGate: number; sampleRate: number; zcr: Float32Array }): OnsetCandidate[] {
  const values = Array.from(novelty);
  const gate = Math.max(percentile(values, 0.72), mean(values) + stddev(values, mean(values)) * 0.28);
  const strong = Math.max(0.0001, percentile(Array.from(rms), 0.92));
  const candidates: OnsetCandidate[] = [];
  for (let frame = 2; frame < novelty.length - 2; frame += 1) {
    const time = frameToTime(frame, sampleRate);
    if (time < CHART_LEAD_IN_SECONDS || time > buffer.duration - 0.25) continue;
    if (novelty[frame] < gate || rms[frame] < rmsGate * 0.72) continue;
    if (novelty[frame] < novelty[frame - 1] || novelty[frame] < novelty[frame + 1]) continue;
    candidates.push({
      frame,
      time,
      strength: novelty[frame],
      intensity: clamp((rms[frame] - rmsGate) / Math.max(0.001, strong - rmsGate), 0, 1),
      brightness: zcr[frame],
    });
  }
  return candidates;
}

function estimateBeatGrid({ candidates, duration, novelty, sampleRate }: { candidates: OnsetCandidate[]; duration: number; novelty: Float32Array; sampleRate: number }): BeatGrid {
  const minBpm = 78;
  const maxBpm = 176;
  let bestLag = Math.round((60 / 122) * sampleRate / HOP_SIZE);
  let bestScore = -Infinity;
  for (let bpm = minBpm; bpm <= maxBpm; bpm += 1) {
    const lag = Math.max(1, Math.round((60 / bpm) * sampleRate / HOP_SIZE));
    let score = 0;
    for (let frame = lag; frame < novelty.length; frame += 1) score += novelty[frame] * novelty[frame - lag];
    score /= Math.sqrt(lag);
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }

  const phaseBins = new Float32Array(bestLag);
  for (const candidate of candidates) phaseBins[candidate.frame % bestLag] += candidate.strength * (0.6 + candidate.intensity);
  let phaseFrame = 0;
  for (let phase = 1; phase < phaseBins.length; phase += 1) {
    if (phaseBins[phase] > phaseBins[phaseFrame]) phaseFrame = phase;
  }

  const beatInterval = (bestLag * HOP_SIZE) / sampleRate;
  const phaseTime = frameToTime(phaseFrame, sampleRate);
  return {
    bpm: 60 / beatInterval,
    beatInterval,
    phaseTime,
    step: beatInterval / SNAP_SUBDIVISION,
    firstBeat: phaseTime - Math.ceil(phaseTime / beatInterval) * beatInterval,
    duration,
  };
}

function snapToGrid(time: number, beatGrid: BeatGrid, maxDistance: number): number {
  const beatIndex = Math.round((time - beatGrid.phaseTime) / beatGrid.step);
  const snapped = beatGrid.phaseTime + beatIndex * beatGrid.step;
  return Math.abs(snapped - time) <= maxDistance ? snapped : time;
}

function sectionStats({ duration, rms, sampleRate }: { duration: number; rms: Float32Array; sampleRate: number }): SectionStats[] {
  const sectionCount = Math.max(1, Math.ceil(duration / SECTION_SECONDS));
  const sections = Array.from({ length: sectionCount }, () => ({ total: 0, count: 0, energy: 0 }));
  for (let frame = 0; frame < rms.length; frame += 1) {
    const index = clamp(Math.floor(frameToTime(frame, sampleRate) / SECTION_SECONDS), 0, sectionCount - 1);
    sections[index].total += rms[frame];
    sections[index].count += 1;
  }
  const averages = sections.map((section) => section.total / Math.max(1, section.count));
  const low = percentile(averages, 0.15);
  const high = Math.max(low + 0.0001, percentile(averages, 0.9));
  return sections.map((_, index) => ({
    index,
    energy: clamp((averages[index] - low) / (high - low), 0, 1),
  }));
}

function laneForEvent({ beatGrid, candidate, difficulty, lastLane, seed }: { beatGrid: BeatGrid; candidate: SelectedCandidate; difficulty: Difficulty; lastLane: number; seed: number }): number {
  const motifs = MOTIFS[difficulty.id] || MOTIFS.normal;
  const sectionIndex = Math.floor(candidate.time / SECTION_SECONDS);
  const motif = motifs[(seed + sectionIndex) % motifs.length];
  const beatPosition = Math.max(0, Math.round((candidate.time - beatGrid.phaseTime) / beatGrid.step));
  let lane = motif[(beatPosition + sectionIndex) % motif.length];
  if (candidate.brightness > 0.07) lane = (lane + 1) % LANES.length;
  if (lane === lastLane && candidate.intensity < 0.82) lane = motif[(beatPosition + sectionIndex + 2) % motif.length];
  return clamp(lane, 0, LANES.length - 1);
}

function compareNotes<T extends { time: number; lane?: number }>(a: T, b: T): number {
  return a.time === b.time ? (a.lane ?? 0) - (b.lane ?? 0) : a.time - b.time;
}

function resequence(notes: ChartNote[]): ChartNote[] {
  notes.sort(compareNotes);
  return notes.map((note, id) => ({ ...note, id }));
}

const MAINTAINED_MIN_GAP = 0.58;
const MAINTAINED_MIN_DURATION = 0.44;
const MAINTAINED_MAX_DURATION = 1.75;

function resetAsTap(note: ChartNote, id: number): ChartNote {
  return {
    ...note,
    id,
    type: "tap",
    direction: null,
    duration: 0,
    endLane: null,
    hit: false,
    missed: false,
    holding: false,
    completed: false,
  };
}

function addMaintainedNotes(notes: ChartNote[], difficulty: Difficulty): ChartNote[] {
  const sorted = notes.map(resetAsTap).sort(compareNotes);
  const holdEvery = difficulty.holdEvery;
  let lastHoldTime = -Infinity;
  let holdOrdinal = 0;

  const withHolds = sorted.map((raw, index) => {
    const note = { ...raw };
    const next = sorted[index + 1];
    const gapAfter = next ? next.time - note.time : Infinity;
    const gapBefore = index > 0 ? note.time - sorted[index - 1].time : Infinity;

    holdOrdinal += 1;
    const eligible =
      holdOrdinal % holdEvery === 0 &&
      note.time - lastHoldTime >= MAINTAINED_MIN_GAP &&
      gapBefore >= 0.12 &&
      gapAfter >= MAINTAINED_MIN_DURATION + 0.12;

    if (eligible) {
      const duration = clamp(
        Math.min(gapAfter * 0.78, MAINTAINED_MAX_DURATION),
        MAINTAINED_MIN_DURATION,
        MAINTAINED_MAX_DURATION,
      );
      note.type = "hold";
      note.duration = Number(duration.toFixed(3));
      note.endLane = note.lane;
      lastHoldTime = note.time;
    }

    return note;
  });

  return resequence(withHolds);
}

function noteLanes(note: Pick<ChartNote, "lane" | "endLane">): number[] {
  return note.endLane === null || note.endLane === note.lane ? [note.lane] : [note.lane, note.endLane];
}

function safeSwipeDirection(direction: SwipeDirection | null, lane: number): SwipeDirection {
  if (lane === 0 && direction === "left") return "right";
  if (lane === LANES.length - 1 && direction === "right") return "left";
  return direction ?? "up";
}

function retargetNoteLane(note: ChartNote, lane: number): ChartNote {
  if (lane === note.lane) return note.type === "swipe" ? { ...note, direction: safeSwipeDirection(note.direction, lane) } : note;
  let endLane: number | null = null;
  if (note.endLane !== null) {
    const slideDirection = note.endLane > note.lane ? 1 : -1;
    endLane = clamp(lane + slideDirection, 0, LANES.length - 1);
    if (endLane === lane) endLane = lane === 0 ? 1 : lane - 1;
  }
  return {
    ...note,
    lane,
    endLane,
    direction: note.type === "swipe" ? safeSwipeDirection(note.direction, lane) : note.direction,
  };
}

function rankedLaneOptions(preferredLane: number, lastAcceptedLane: number): number[] {
  return Array.from({ length: LANES.length }, (_, lane) => lane).sort((left, right) => {
    if (left === preferredLane) return -1;
    if (right === preferredLane) return 1;
    if (left === lastAcceptedLane) return 1;
    if (right === lastAcceptedLane) return -1;
    return Math.abs(left - preferredLane) - Math.abs(right - preferredLane);
  });
}

function laneIsPlayable(note: ChartNote, time: number, laneAvailableAt: number[], lastLaneTime: number[], sameLaneGap: number): boolean {
  return noteLanes(note).every((lane) => laneAvailableAt[lane] <= time && time - lastLaneTime[lane] >= sameLaneGap);
}

function choosePlayableLane(note: ChartNote, laneAvailableAt: number[], lastLaneTime: number[], lastAcceptedLane: number, rules: CleanupRules): number | null {
  for (const lane of rankedLaneOptions(note.lane, lastAcceptedLane)) {
    const moved = retargetNoteLane(note, lane);
    if (laneIsPlayable(moved, note.time, laneAvailableAt, lastLaneTime, rules.sameLaneGap)) return lane;
  }
  for (const lane of rankedLaneOptions(note.lane, lastAcceptedLane)) {
    const moved = retargetNoteLane(note, lane);
    if (laneIsPlayable(moved, note.time, laneAvailableAt, lastLaneTime, rules.sameLaneGap * 0.72)) return lane;
  }
  return null;
}

function nextHoldConflictTime(notes: ChartNote[], startIndex: number, note: ChartNote, rules: CleanupRules): number | null {
  const lanes = noteLanes(note);
  for (let index = startIndex + 1; index < notes.length; index += 1) {
    const future = notes[index];
    if (future.time <= note.time + 0.05) continue;
    if (future.time - note.time > rules.maxHold + rules.holdReleaseGap) break;
    if (rules.blockAllDuringHold || noteLanes(future).some((lane) => lanes.includes(lane))) return future.time;
  }
  return null;
}

function polishHoldDuration(notes: ChartNote[], index: number, note: ChartNote, rules: CleanupRules, songDuration: number): ChartNote {
  if (note.duration <= 0) return { ...note, type: note.type === "hold" ? "tap" : note.type, endLane: note.type === "hold" ? null : note.endLane, duration: 0 };
  const conflictTime = nextHoldConflictTime(notes, index, note, rules);
  const maxByConflict = conflictTime === null ? Infinity : conflictTime - note.time - rules.holdReleaseGap;
  const maxDuration = Math.min(note.duration, rules.maxHold, Math.max(0, songDuration - note.time - 0.35), maxByConflict);
  if (maxDuration < rules.minHold) {
    return { ...note, type: "tap", direction: null, duration: 0, endLane: null };
  }
  return {
    ...note,
    type: "hold",
    direction: null,
    duration: Number(maxDuration.toFixed(3)),
    endLane: note.endLane,
  };
}

function polishGeneratedNotes(notes: ChartNote[], difficulty: Difficulty, songDuration: number): ChartNote[] {
  const rules = CLEANUP_RULES[difficulty.id];
  const sorted = resequence(notes);
  const accepted: ChartNote[] = [];
  const laneAvailableAt = Array.from({ length: LANES.length }, () => CHART_LEAD_IN_SECONDS);
  const lastLaneTime = Array.from({ length: LANES.length }, () => -Infinity);
  let lastAcceptedTime = -Infinity;
  let lastAcceptedLane = -1;

  for (let index = 0; index < sorted.length; index += 1) {
    const raw = sorted[index];
    if (raw.time < CHART_LEAD_IN_SECONDS || raw.time >= songDuration - 0.25) continue;
    if (raw.time - lastAcceptedTime < rules.minGap) continue;

    const lane = choosePlayableLane(raw, laneAvailableAt, lastLaneTime, lastAcceptedLane, rules);
    if (lane === null) continue;

    const moved = retargetNoteLane(raw, lane);
    const cleaned = moved.duration > 0 ? polishHoldDuration(sorted, index, moved, rules, songDuration) : { ...moved, duration: 0, endLane: null };
    const playableLanes = noteLanes(cleaned);
    if (playableLanes.some((playableLane) => laneAvailableAt[playableLane] > cleaned.time)) continue;

    accepted.push(cleaned);
    lastAcceptedTime = cleaned.time;
    lastAcceptedLane = cleaned.lane;
    for (const playableLane of playableLanes) lastLaneTime[playableLane] = cleaned.time;

    if (cleaned.duration > 0) {
      const blockedLanes = rules.blockAllDuringHold ? LANES.map((_, blockedLane) => blockedLane) : playableLanes;
      const releaseAt = cleaned.time + cleaned.duration + rules.holdReleaseGap;
      for (const blockedLane of blockedLanes) laneAvailableAt[blockedLane] = Math.max(laneAvailableAt[blockedLane], releaseAt);
    }
  }

  return resequence(accepted);
}

function minimumNoteCount(duration: number, difficulty: Difficulty): number {
  const rate = difficulty.id === "easy" ? 0.96 : difficulty.id === "normal" ? 1.35 : 1.35;
  return Math.max(12, Math.floor(duration * rate));
}

function fillBeatGridEvents({
  beatGrid,
  buffer,
  difficulty,
  frameCount,
  rms,
  sampleRate,
  sections,
  selected,
  strengthGate,
}: {
  beatGrid: BeatGrid;
  buffer: AudioBuffer;
  difficulty: Difficulty;
  frameCount: number;
  rms: Float32Array;
  sampleRate: number;
  sections: SectionStats[];
  selected: SelectedCandidate[];
  strengthGate: number;
}): void {
  const target = minimumNoteCount(buffer.duration, difficulty);
  if (selected.length >= target) return;
  const stepMultiplier = difficulty.id === "easy" ? 0.85 : difficulty.id === "normal" ? 0.58 : 0.58;
  const fillStep = beatGrid.beatInterval * stepMultiplier;
  for (let time = Math.max(CHART_LEAD_IN_SECONDS, beatGrid.firstBeat); time < buffer.duration - 0.35 && selected.length < target; time += fillStep) {
    const snappedTime = snapToGrid(time, beatGrid, beatGrid.step / 2);
    if (selected.some((event) => Math.abs(event.time - snappedTime) < difficulty.cooldownMin * 1.15)) continue;
    const section = sections[clamp(Math.floor(snappedTime / SECTION_SECONDS), 0, sections.length - 1)];
    const frame = clamp(Math.round((snappedTime * sampleRate) / HOP_SIZE), 0, frameCount - 1);
    selected.push({
      frame,
      time: snappedTime,
      gridIndex: Math.round((snappedTime - beatGrid.phaseTime) / beatGrid.step),
      strength: strengthGate,
      intensity: clamp(section.energy * 0.55 + rms[frame] * 8 + 0.18, 0, 0.88),
      brightness: 0,
    });
  }
}

function buildChartForDifficulty({
  baseSongId,
  beatGrid,
  buffer,
  candidates,
  difficulty,
  rms,
  rmsAvg,
  sampleRate,
  sections,
  title,
}: {
  baseSongId: string;
  beatGrid: BeatGrid;
  buffer: AudioBuffer;
  candidates: OnsetCandidate[];
  difficulty: Difficulty;
  rms: Float32Array;
  rmsAvg: number;
  sampleRate: number;
  sections: SectionStats[];
  title: string;
}): Chart {
  const seed = stableHash(`${baseSongId}:${difficulty.id}`);
  const onsetStrengths = candidates.map((candidate) => candidate.strength);
  const strengthGate = Math.max(0.02, percentile(onsetStrengths, clamp(0.5 + difficulty.onsetAdjust * 0.35, 0.22, 0.82)));
  const notes: ChartNote[] = [];
  let lastTime = -10;
  let lastLane = -1;
  const frameCount = rms.length;
  const snapWindow = difficulty.id === "easy" ? 0.055 : difficulty.id === "normal" ? 0.07 : 0.07;
  const sortedCandidates = [...candidates].sort((a, b) => b.strength * (0.6 + b.intensity) - a.strength * (0.6 + a.intensity));
  const selected: SelectedCandidate[] = [];
  const occupied = new Set();

  for (const candidate of sortedCandidates) {
    if (candidate.strength < strengthGate) continue;
    const snappedTime = snapToGrid(candidate.time, beatGrid, snapWindow);
    const section = sections[clamp(Math.floor(snappedTime / SECTION_SECONDS), 0, sections.length - 1)];
    const intensity = clamp(candidate.intensity * 0.72 + section.energy * 0.28, 0, 1);
    const cooldown = clamp(difficulty.cooldownBase - intensity * difficulty.cooldownDrop, difficulty.cooldownMin, difficulty.cooldownBase);
    const gridIndex = Math.round((snappedTime - beatGrid.phaseTime) / beatGrid.step);
    const key = Math.round(snappedTime * 100);
    if (occupied.has(key)) continue;
    if (selected.some((event) => Math.abs(event.time - snappedTime) < cooldown)) continue;
    selected.push({ ...candidate, intensity, time: snappedTime, gridIndex });
    occupied.add(key);
  }

  selected.sort(compareNotes);

  for (const section of sections) {
    const sectionStart = Math.max(CHART_LEAD_IN_SECONDS, section.index * SECTION_SECONDS);
    const sectionEnd = Math.min(buffer.duration - 0.25, sectionStart + SECTION_SECONDS);
    const targetPulses = Math.floor(section.energy * (difficulty.id === "easy" ? 5 : difficulty.id === "normal" ? 8 : 8));
    for (let pulse = 0; pulse < targetPulses; pulse += 1) {
      const pulseTime = snapToGrid(sectionStart + (pulse + 1) * ((sectionEnd - sectionStart) / (targetPulses + 1)), beatGrid, beatGrid.step / 2);
      if (selected.some((event) => Math.abs(event.time - pulseTime) < difficulty.cooldownMin * 0.85)) continue;
      const frame = clamp(Math.round((pulseTime * sampleRate) / HOP_SIZE), 0, frameCount - 1);
      selected.push({
        frame,
        time: pulseTime,
        gridIndex: Math.round((pulseTime - beatGrid.phaseTime) / beatGrid.step),
        strength: strengthGate,
        intensity: clamp(section.energy * 0.75 + 0.2, 0, 1),
        brightness: 0,
      });
    }
  }

  selected.sort(compareNotes);
  fillBeatGridEvents({ beatGrid, buffer, difficulty, frameCount, rms, sampleRate, sections, selected, strengthGate });
  selected.sort(compareNotes);

  for (const candidate of selected) {
    if (candidate.time - lastTime < difficulty.cooldownMin * 0.78) continue;
    const lane = laneForEvent({ beatGrid, candidate, difficulty, lastLane, seed });

    notes.push(noteBase(notes.length, "tap", null, candidate.time, lane, 0, null));

    if (difficulty.id === "hard" && candidate.intensity > 0.62 && notes.length % 2 === seed % 3) {
      const chordLane = clamp(lane + ((seed + candidate.gridIndex) % 2 === 0 ? 1 : -1), 0, LANES.length - 1);
      if (chordLane !== lane) {
        notes.push(
          noteBase(
            notes.length,
            "tap",
            null,
            candidate.time + beatGrid.step * 0.5,
            chordLane,
            0,
            null
          )
        );
      }
    }

    lastTime = candidate.time;
    lastLane = lane;
  }

  const finalNotes = addMaintainedNotes(
    polishGeneratedNotes(notes, difficulty, buffer.duration),
    difficulty,
  );

  return {
    songId: `${baseSongId}:${difficulty.id}`,
    baseSongId,
    difficulty,
    title,
    duration: buffer.duration,
    notes: resequence(finalNotes),
    stats: {
      bpm: Number(beatGrid.bpm.toFixed(1)),
      rmsAvg,
      density: finalNotes.length / Math.max(1, buffer.duration),
    },
  };
}

async function buildChartSetFromBuffer(
  buffer: AudioBuffer,
  meta: { baseSongId: string; title: string }
): Promise<ChartSet> {
  const samples = makeMono(buffer);
  const sampleRate = buffer.sampleRate;
  const frameCount = Math.max(1, Math.floor((samples.length - FRAME_SIZE) / HOP_SIZE));
  const rms = new Float32Array(frameCount);
  const flux = new Float32Array(frameCount);
  const zcr = new Float32Array(frameCount);

  let previous = 0;
  for (let frame = 0; frame < frameCount; frame += 1) {
    const stats = frameStats(samples, frame * HOP_SIZE, FRAME_SIZE);
    rms[frame] = stats.rms;
    zcr[frame] = stats.zcr;
    flux[frame] = Math.max(0, stats.rms - previous);
    previous = stats.rms;
    if (frame > 0 && frame % 384 === 0) await yieldUi();
  }
  await yieldUi();

  const rmsValues = Array.from(rms);
  const rmsAvg = mean(rmsValues);
  const rmsGate = Math.max(percentile(rmsValues, 0.55), rmsAvg * 0.75);
  const novelty = buildNovelty({ flux, rms, zcr });
  const candidates = pickOnsetCandidates({ buffer, novelty, rms, rmsGate, sampleRate, zcr });
  const beatGrid = estimateBeatGrid({ candidates, duration: buffer.duration, novelty, sampleRate });
  const sections = sectionStats({ duration: buffer.duration, rms, sampleRate });
  const charts = {} as ChartSet["charts"];

  for (const difficulty of DIFFICULTIES) {
    charts[difficulty.id] = buildChartForDifficulty({
      baseSongId: meta.baseSongId,
      beatGrid,
      buffer,
      candidates,
      difficulty,
      rms,
      rmsAvg,
      sampleRate,
      sections,
      title: meta.title,
    });
    await yieldUi();
  }

  return { baseSongId: meta.baseSongId, title: meta.title, duration: buffer.duration, charts };
}

export async function analyzeAudio(buffer: AudioBuffer, file: File): Promise<ChartSet> {
  return buildChartSetFromBuffer(buffer, {
    baseSongId: fileFingerprint(file, buffer.duration),
    title: file.name.replace(/\.(mp3|m4a|mp4|aac)$/i, ""),
  });
}

export async function analyzeLibraryBuffer(
  buffer: AudioBuffer,
  relPath: string,
  title: string
): Promise<ChartSet> {
  return buildChartSetFromBuffer(buffer, {
    baseSongId: trackFingerprint(relPath, buffer.duration),
    title,
  });
}
