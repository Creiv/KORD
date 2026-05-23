import { describe, expect, it } from "vitest";
import { resolveRunEndTime } from "../lib/runTiming";

describe("resolveRunEndTime", () => {
  it("uses audio duration when available", () => {
    expect(resolveRunEndTime(240, 238.5)).toBe(238.5);
  });

  it("falls back to chart duration", () => {
    expect(resolveRunEndTime(240, undefined)).toBe(240);
    expect(resolveRunEndTime(240, NaN)).toBe(240);
  });
});
