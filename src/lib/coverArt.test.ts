import { describe, expect, it } from "vitest";
import { coverImageAttrs, trackCoverImageAttrs } from "./coverArt";

describe("coverArt", () => {
  it("genera src ridotto e srcSet per preset thumb", () => {
    const attrs = trackCoverImageAttrs("Artist/Album/track.mp3", "thumb");
    expect(attrs.src).toContain("/api/cover");
    expect(attrs.src).toContain("w=96");
    expect(attrs.srcSet).toContain("96w");
    expect(attrs.srcSet).toContain("128w");
    expect(attrs.sizes).toBe("48px");
    expect(attrs.priority).toBe(false);
  });

  it("player ha priorità alta", () => {
    const attrs = trackCoverImageAttrs("a/b/c.flac", "player", 1234);
    expect(attrs.src).toContain("w=512");
    expect(attrs.src).toContain("v=1234");
    expect(attrs.fetchPriority).toBe("high");
    expect(attrs.priority).toBe(true);
  });

  it("coverImageAttrs per tile album", () => {
    const attrs = coverImageAttrs("Artist/Album", "tile");
    expect(attrs.src).toContain("w=128");
    expect(attrs.sizes).toBe("4.55rem");
  });
});
