import { describe, expect, it } from "vitest"
import {
  formatTrackGenresForDisplay,
  parseTrackGenres,
  serializeTrackGenres,
} from "./genres"

describe("parseTrackGenres", () => {
  it("splits slash compound", () => {
    expect(parseTrackGenres("hip hop/rap")).toEqual(["hip hop", "rap"])
  })
  it("splits semicolon and dedupes", () => {
    expect(parseTrackGenres("Hip hop; rap; hip hop")).toEqual(["Hip hop", "rap"])
  })
  it("splits comma", () => {
    expect(parseTrackGenres("a, b")).toEqual(["a", "b"])
  })
  it("empty", () => {
    expect(parseTrackGenres("")).toEqual([])
    expect(parseTrackGenres(null)).toEqual([])
  })
})

describe("serializeTrackGenres", () => {
  it("round-trips", () => {
    expect(serializeTrackGenres(["Hip hop", "rap"])).toBe("Hip hop; rap")
  })
  it("null for empty", () => {
    expect(serializeTrackGenres([])).toBeNull()
  })
})

describe("formatTrackGenresForDisplay", () => {
  it("joins for ui", () => {
    expect(formatTrackGenresForDisplay("a/b")).toBe("a · b")
  })
})
