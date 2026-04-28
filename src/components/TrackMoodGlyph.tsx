import type { FC } from "react";
import type { TrackMoodId } from "../lib/trackMoods";

const common = {
  xmlns: "http://www.w3.org/2000/svg",
  viewBox: "0 0 24 24",
  fill: "none" as const,
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function MoodOff() {
  return (
    <svg {...common} aria-hidden>
      <rect x="5" y="5" width="14" height="14" rx="2" strokeDasharray="3 2" />
    </svg>
  );
}

const GLYPHS: Record<TrackMoodId, FC> = {
  energy_boost: () => (
    <svg {...common} aria-hidden>
      <path d="M13 2 3 14h8l-1 8 10-12h-8l1-8z" />
    </svg>
  ),
  party_dance: () => (
    <svg {...common} aria-hidden>
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </svg>
  ),
  chill_relax: () => (
    <svg {...common} aria-hidden>
      <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z" />
      <path d="M2 21c0-4 4-8 9-8" />
    </svg>
  ),
  focus_study: () => (
    <svg {...common} aria-hidden>
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </svg>
  ),
  romantic_intimacy: () => (
    <svg {...common} aria-hidden>
      <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.51 4.04 3 5.5l7 7Z" />
    </svg>
  ),
  sad_melancholy: () => (
    <svg {...common} aria-hidden>
      <path d="M4 14.899A7 7 0 0 1 9.2 4.2 7 7 0 0 1 15.71 8h1.79a4.5 4.5 0 0 1 3.5 7.33" />
      <path d="M8 19v2" />
      <path d="M12 19v2" />
      <path d="M16 19v2" />
    </svg>
  ),
  dark_tense: () => (
    <svg {...common} aria-hidden>
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </svg>
  ),
  aggressive_heavy: () => (
    <svg {...common} strokeWidth={2.6} aria-hidden>
      <path d="M12 1.98Q1.22 13.12 9.05 21.9Q12 22.82 14.95 21.9Q22.78 13.12 12 1.98z" />
      <path d="M12 10.2Q5.85 13.95 12 18.38Q18.15 13.95 12 10.2z" />
    </svg>
  ),
  dreamy_ethereal: () => (
    <svg {...common} aria-hidden>
      <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3L12 3Z" />
    </svg>
  ),
  epic_cinematic: () => (
    <svg {...common} aria-hidden>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M7 3v18" />
      <path d="M17 3v18" />
      <path d="M3 9.5h4" />
      <path d="M3 14.5h4" />
      <path d="M17 9.5h4" />
      <path d="M17 14.5h4" />
    </svg>
  ),
  nostalgia_retro: () => (
    <svg {...common} aria-hidden>
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="2" />
    </svg>
  ),
  fun_quirky: () => (
    <svg {...common} aria-hidden>
      <circle cx="12" cy="12" r="10" />
      <path d="M8 14s1.5 2 4 2 4-2 4-2" />
      <path d="M9 9h.01" />
      <path d="M15 9h.01" />
    </svg>
  ),
  soulful_groovy: () => (
    <svg {...common} aria-hidden>
      <path d="M2 10v4" />
      <path d="M6 6v12" />
      <path d="M10 3v18" />
      <path d="M14 8v8" />
      <path d="M18 5v14" />
      <path d="M22 10v4" />
    </svg>
  ),
};

export function TrackMoodGlyph({
  mood,
  className,
}: {
  mood: TrackMoodId | null;
  className?: string;
}) {
  const Inner = mood ? GLYPHS[mood] : MoodOff;
  return (
    <span className={className ?? ""} aria-hidden>
      <Inner />
    </span>
  );
}
