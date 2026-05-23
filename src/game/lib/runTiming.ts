/** Fine run: preferisci durata audio reale (crossfade / fine brano nel player). */
export function resolveRunEndTime(
  chartDuration: number,
  audioDuration?: number,
): number {
  if (
    typeof audioDuration === "number" &&
    Number.isFinite(audioDuration) &&
    audioDuration > 0
  ) {
    return audioDuration;
  }
  return chartDuration;
}
