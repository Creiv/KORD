import "@testing-library/jest-dom/vitest"
import { afterEach, beforeAll, vi } from "vitest"
import { cleanup } from "@testing-library/react"

class FakeAudioContext {
  state: "running" | "suspended" = "running"

  createMediaElementSource() {
    return {
      connect() {
        return undefined
      },
    }
  }

  createAnalyser() {
    return {
      fftSize: 256,
      smoothingTimeConstant: 0.8,
      connect() {
        return undefined
      },
      getByteFrequencyData() {
        return undefined
      },
      getByteTimeDomainData() {
        return undefined
      },
      frequencyBinCount: 256,
    }
  }

  get destination() {
    return {}
  }

  resume() {
    this.state = "running"
    return Promise.resolve()
  }

  close() {
    return Promise.resolve()
  }
}

class FakeResizeObserver {
  observe() {
    return undefined
  }

  disconnect() {
    return undefined
  }
}

beforeAll(() => {
  if (typeof window !== "undefined") {
    vi.stubGlobal("AudioContext", FakeAudioContext)
    vi.stubGlobal("ResizeObserver", FakeResizeObserver)
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => window.setTimeout(() => cb(16), 16))
    vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id))
  }

  if (typeof HTMLMediaElement !== "undefined") {
    Object.defineProperty(HTMLMediaElement.prototype, "play", {
      configurable: true,
      value: vi.fn().mockResolvedValue(undefined),
    })
    Object.defineProperty(HTMLMediaElement.prototype, "pause", {
      configurable: true,
      value: vi.fn(),
    })
    Object.defineProperty(HTMLMediaElement.prototype, "load", {
      configurable: true,
      value: vi.fn(),
    })
  }
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  if (typeof window !== "undefined") {
    window.localStorage.clear()
    window.history.pushState({}, "", "/")
  }
})
