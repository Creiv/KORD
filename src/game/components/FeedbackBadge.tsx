export type FeedbackTone =
  | "neutral"
  | "pause"
  | "perfect"
  | "good"
  | "timing"
  | "miss";

interface FeedbackPresentation {
  kicker: string;
  label: string;
  tone: FeedbackTone;
}

interface FeedbackBadgeProps {
  feedback: string;
  combo: number;
  pulse: number;
  paused?: boolean;
  /** Solo testo centrato, senza box (dock RE-KORD). */
  compact?: boolean;
}

const FEEDBACK_PRESENTATIONS: Record<string, FeedbackPresentation> = {
  Ready: { kicker: "Stand by", label: "Ready", tone: "neutral" },
  Paused: { kicker: "Hold", label: "Paused", tone: "pause" },
  "Tap Start again": { kicker: "Audio unlock", label: "Tap again", tone: "pause" },
  "Stay on track": { kicker: "Focus", label: "Stay locked", tone: "neutral" },
  Perfect: { kicker: "Dead center", label: "Perfect!", tone: "perfect" },
  Good: { kicker: "Locked", label: "Nice!", tone: "good" },
  Early: { kicker: "Rushed", label: "Early", tone: "timing" },
  Late: { kicker: "Behind", label: "Late", tone: "timing" },
  Flick: { kicker: "Sharp move", label: "Flick!", tone: "perfect" },
  Swipe: { kicker: "Clean trace", label: "Swipe!", tone: "good" },
  Slide: { kicker: "Cross lane", label: "Slide!", tone: "good" },
  Miss: { kicker: "Break", label: "Miss", tone: "miss" },
  Dropped: { kicker: "Hold lost", label: "Dropped", tone: "miss" },
  "Slide Miss": { kicker: "Wrong lane", label: "Slide miss", tone: "miss" },
  "Hold Miss": { kicker: "Too soon", label: "Hold miss", tone: "miss" },
};

export function FeedbackBadge({ feedback, combo, pulse, paused = false, compact = false }: FeedbackBadgeProps) {
  const displayFeedback = paused ? "Paused" : feedback;
  const feedbackView = feedbackPresentation(displayFeedback, combo);

  return (
    <div
      key={`${displayFeedback}-${pulse}-${paused ? "paused" : "playing"}`}
      className={[
        "feedback",
        `feedback-${feedbackView.tone}`,
        compact ? "feedback--compact" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {compact ? null : <span>{feedbackView.kicker}</span>}
      <strong>{feedbackView.label}</strong>
    </div>
  );
}

function feedbackPresentation(feedback: string, combo: number): FeedbackPresentation {
  const base = FEEDBACK_PRESENTATIONS[feedback] ?? { kicker: "Update", label: feedback, tone: "neutral" };
  if ((base.tone === "perfect" || base.tone === "good") && combo >= 48) return { ...base, kicker: `${combo} chain` };
  if ((base.tone === "perfect" || base.tone === "good") && combo >= 16) return { ...base, kicker: "Combo rising" };
  return base;
}
