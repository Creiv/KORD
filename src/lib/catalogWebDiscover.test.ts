import { describe, expect, it } from "vitest"
import {
  parseCatalogWebSubtitle,
  partitionCatalogWebDiscover,
} from "./catalogWebDiscover"

describe("catalogWebDiscover", () => {
  it("parses YTM subtitle lines", () => {
    expect(parseCatalogWebSubtitle("Album • Artist")).toEqual({
      releaseType: "Album",
      artistName: "Artist",
    })
    expect(parseCatalogWebSubtitle("Single · Artist")).toEqual({
      releaseType: "Single",
      artistName: "Artist",
    })
    expect(parseCatalogWebSubtitle("EP - Artist")).toEqual({
      releaseType: "EP",
      artistName: "Artist",
    })
  })

  it("re-splits merged lists by release type", () => {
    const merged = [
      {
        id: "1",
        title: "A",
        subtitle: "Album • X",
        url: "u1",
        type: "album" as const,
        artistName: "",
      },
      {
        id: "2",
        title: "S",
        subtitle: "Single • Y",
        url: "u2",
        type: "album" as const,
        artistName: "",
      },
    ]
    const { albums, songs } = partitionCatalogWebDiscover(merged)
    expect(albums).toHaveLength(1)
    expect(songs).toHaveLength(1)
    expect(songs[0]?.type).toBe("song")
  })

})
