/**
 * Prima di `electron-builder --win` su Linux/mac, installa i binding nativi Windows
 * (es. sharp). Dopo il pack, `restoreHostNativeDeps` ripristina quelli dell'host.
 */
import { execSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")

/** @returns {boolean} true se è stato eseguito un install cross-platform */
export function prepareNativeDeps(platform) {
  if (platform === "win" && process.platform !== "win32") {
    console.log(
      "\n[pack] Cross-build Windows: installo sharp per win32/x64 (necessario nel .exe su Windows)...\n",
    )
    execSync("npm install --no-save --os=win32 --cpu=x64 sharp@0.34.5", {
      stdio: "inherit",
      cwd: root,
    })
    return true
  }
  return false
}

export function restoreHostNativeDeps(crossWinPrepared) {
  if (!crossWinPrepared) return
  console.log("\n[pack] Ripristino binding nativi sharp per questo host...\n")
  try {
    execSync("npm rebuild sharp", { stdio: "inherit", cwd: root })
  } catch {
    console.warn("[pack] npm rebuild sharp fallito; esegui `npm install` se il dev server non parte.")
  }
}
