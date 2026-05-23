import { describe, expect, it } from "vitest";
import { audioElementMatchesTrack } from "./mediaTrackMatch";

describe("audioElementMatchesTrack", () => {
  it("matches when pathname equals mediaUrl for relPath", () => {
    const audio = document.createElement("audio");
    audio.src = new URL("/media/foo/bar.mp3", window.location.origin).href;
    expect(audioElementMatchesTrack(audio, "foo/bar.mp3")).toBe(true);
  });

  it("rejects stale deck with different track", () => {
    const audio = document.createElement("audio");
    audio.src = new URL("/media/old.mp3", window.location.origin).href;
    expect(audioElementMatchesTrack(audio, "new.mp3")).toBe(false);
  });

  it("returns false when src is empty", () => {
    const audio = document.createElement("audio");
    expect(audioElementMatchesTrack(audio, "x.mp3")).toBe(false);
  });
});
