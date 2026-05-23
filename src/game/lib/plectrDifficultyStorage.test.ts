import { beforeEach, describe, expect, it } from "vitest";
import {
  loadPlectrDifficulty,
  loadPlectrPlayMode,
  migratePlectrDifficulty,
  migratePlectrPlayMode,
  PLECTR_DIFFICULTY_KEY,
  savePlectrPlayMode,
} from "./plectrDifficultyStorage";

describe("plectrDifficultyStorage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe("migratePlectrPlayMode", () => {
    it("keeps current difficulty ids and extreme", () => {
      expect(migratePlectrPlayMode("easy")).toBe("easy");
      expect(migratePlectrPlayMode("normal")).toBe("normal");
      expect(migratePlectrPlayMode("hard")).toBe("hard");
      expect(migratePlectrPlayMode("extreme")).toBe("extreme");
    });

    it("defaults unknown values to easy", () => {
      expect(migratePlectrPlayMode(null)).toBe("easy");
      expect(migratePlectrPlayMode("insane")).toBe("easy");
    });
  });

  describe("migratePlectrDifficulty (legacy)", () => {
    it("maps extreme to hard for score difficulty", () => {
      expect(migratePlectrDifficulty("extreme")).toBe("hard");
    });
  });

  describe("load/save", () => {
    it("persists play mode in localStorage", () => {
      savePlectrPlayMode("extreme");
      expect(localStorage.getItem(PLECTR_DIFFICULTY_KEY)).toBe("extreme");
      expect(loadPlectrPlayMode()).toBe("extreme");
      expect(loadPlectrDifficulty()).toBe("hard");
    });
  });
});
