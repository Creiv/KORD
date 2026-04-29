// @vitest-environment node
import { describe, expect, it, vi } from "vitest"
import { reuseKeyedPromise } from "./asyncSingleflight.mjs"

describe("reuseKeyedPromise", () => {
  it("collapse due richieste concorrenti in un solo lavoro asincrono", async () => {
    const map = new Map()
    let workRuns = 0
    async function worker() {
      workRuns++
      await new Promise((r) => setTimeout(r, 15))
      return workRuns === 1 ? "first" : "bad"
    }
    const key = "/tmp/kord-test-lib"
    const a = reuseKeyedPromise(map, key, () => worker())
    const b = reuseKeyedPromise(map, key, () => worker())
    const [ra, rb] = await Promise.all([a, b])
    expect(ra).toBe(rb)
    expect(ra).toBe("first")
    expect(workRuns).toBe(1)
    expect(map.size).toBe(0)
  })

  it("costruisce di nuovo dopo che la prima è completata", async () => {
    const map = new Map()
    const fn = vi.fn(async () => 1)
    const k = "x"
    await reuseKeyedPromise(map, k, () => fn())
    await reuseKeyedPromise(map, k, () => fn())
    expect(fn).toHaveBeenCalledTimes(2)
  })
})
