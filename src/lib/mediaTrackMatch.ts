import { mediaUrl } from "./api";

/** True when the audio element is playing the given library track (not a stale deck). */
export function audioElementMatchesTrack(
  audio: HTMLAudioElement | null | undefined,
  relPath: string
): boolean {
  if (!audio?.src) return false;
  try {
    const expected = new URL(mediaUrl(relPath), window.location.origin).pathname;
    const actual = new URL(audio.src, window.location.origin).pathname;
    return expected === actual;
  } catch {
    return false;
  }
}
