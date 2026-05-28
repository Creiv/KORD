import { describe, expect, it } from "vitest";
import {
  buildLanAccessUrl,
  guessLanIPv4,
  listLanIPv4Candidates,
  scoreLanIPv4,
} from "./lanNetwork.mjs";

describe("lanNetwork", () => {
  it("scores private ranges", () => {
    expect(scoreLanIPv4("192.168.1.2")).toBe(100);
    expect(scoreLanIPv4("10.0.0.5")).toBe(80);
    expect(scoreLanIPv4("127.0.0.1")).toBe(0);
  });

  it("builds access URL", () => {
    expect(buildLanAccessUrl("192.168.0.4", 3001)).toBe(
      "http://192.168.0.4:3001",
    );
    expect(buildLanAccessUrl(null, 3001)).toBeNull();
  });

  it("lists at least one candidate on typical hosts", () => {
    const cands = listLanIPv4Candidates();
    if (cands.length) {
      expect(guessLanIPv4()).toBe(cands[0]?.addr);
    }
  });
});
