// @vitest-environment node
import { describe, expect, it } from "vitest"
import { sanitizeLocalTrackTitleDisplay } from "./albumInfo.mjs"

describe("sanitizeLocalTrackTitleDisplay", () => {
  it("rimuove […] e numerazione", () => {
    expect(
      sanitizeLocalTrackTitleDisplay("01 - Foo [2024] Bar"),
    ).toBe("Foo Bar")
  })

  it("rimuove suffisso (Official Video) e simili", () => {
    expect(
      sanitizeLocalTrackTitleDisplay("Song (Official Music Video)"),
    ).toBe("Song")
    expect(
      sanitizeLocalTrackTitleDisplay("Track (lyrics)"),
    ).toBe("Track")
  })

  it("toglie - Topic in coda e Artista - se combacia con la cartella", () => {
    expect(
      sanitizeLocalTrackTitleDisplay("Luna (Official Audio) - Topic", {
        artistFolder: "NotUsed",
      }),
    ).toBe("Luna")
    expect(
      sanitizeLocalTrackTitleDisplay("Måneskin - Zitti e buoni (Official Video)", {
        artistFolder: "Måneskin",
      }),
    ).toBe("Zitti e buoni")
  })

  it("lascia invariato se il prefisso non è l'artista della cartella", () => {
    const s = "Altra banda - Un brano"
    expect(
      sanitizeLocalTrackTitleDisplay(s, { artistFolder: "Måneskin" }),
    ).toBe(s)
  })

  it("rimuove l'artista in coda dopo trattino (stile YouTube) e mantiene (feat. …)", () => {
    const base =
      "02 - Good Goodbye [Official Music Video] - Linkin Park (feat. Pusha T and Stormzy)"
    expect(
      sanitizeLocalTrackTitleDisplay(base, { artistFolder: "Linkin Park" }),
    ).toBe("Good Goodbye (feat. Pusha T and Stormzy)")
  })

  it("rimuove trattino + artista in coda dopo (Official Audio) nel mezzo", () => {
    const base = "01 - Nobody Can Save Me (Official Audio) - Linkin Park"
    expect(
      sanitizeLocalTrackTitleDisplay(base, { artistFolder: "Linkin Park" }),
    ).toBe("Nobody Can Save Me")
  })

  it("rimuove parentesi con original / remaster e simili, ma conserva (feat. …)", () => {
    expect(
      sanitizeLocalTrackTitleDisplay("Brano (Original Mix) (2017 remaster)"),
    ).toBe("Brano")
    expect(
      sanitizeLocalTrackTitleDisplay("X (official audio) (feat. Y)"),
    ).toBe("X (feat. Y)")
  })
})
