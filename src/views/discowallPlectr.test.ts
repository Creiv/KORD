import { describe, expect, it } from "vitest";
import {
  buildPlectrFieldGrid,
  createSceneStyleWeights,
  PLECTR_FIELD_COLS,
  PLECTR_FIELD_ROWS,
  samplePlectrFieldGrid,
} from "./discowallPlectr";

describe("discowallPlectr field grid", () => {
  it("buildPlectrFieldGrid riempie la griglia interna", () => {
    const styleW = createSceneStyleWeights();
    styleW.bloom = 1;
    const grid = buildPlectrFieldGrid([], styleW, 0, []);
    expect(grid.field.length).toBe(PLECTR_FIELD_COLS * PLECTR_FIELD_ROWS);
    const mid = samplePlectrFieldGrid(grid, 0.5, 0.5);
    expect(mid.field).toBeGreaterThanOrEqual(0);
    expect(mid.field).toBeLessThanOrEqual(1);
  });
});
