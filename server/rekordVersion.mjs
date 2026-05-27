import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")

/** Semver da package.json (es. 3.3.0). */
export const REKORD_VERSION = (() => {
  try {
    const pkg = JSON.parse(
      readFileSync(path.join(root, "package.json"), "utf8"),
    )
    const v = String(pkg?.version ?? "").trim()
    return v || "3.3.0"
  } catch {
    return "3.3.0"
  }
})()

/** Major.minor per User-Agent API (es. 3.0). */
export const REKORD_VERSION_SHORT = REKORD_VERSION.split(".").slice(0, 2).join(".")

export function rekordApiUserAgent(extra = "") {
  const base = `RE-KORD/${REKORD_VERSION_SHORT}`
  return extra ? `${base} ${extra}` : base
}

export function rekordApiUserAgentWithUrl() {
  return `${rekordApiUserAgent()} (https://github.com/local)`
}
