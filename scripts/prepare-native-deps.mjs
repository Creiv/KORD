/**
 * Prima di `electron-builder` cross-platform, installa i binding nativi corretti
 * (es. sharp). Dopo il pack, `restoreHostNativeDeps` ripristina quelli dell'host.
 */
import { execSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")

function installSharp(platform, arch) {
  execSync(`npm install --no-save --os=${platform} --cpu=${arch} sharp@0.34.5`, {
    stdio: "inherit",
    cwd: root,
  })
}

/** @returns {boolean} true se è stato eseguito un install cross-platform */
export function prepareNativeDeps(platform) {
  const host = process.platform
  if (platform === "win" && host !== "win32") {
    console.log(
      "\n[pack] Cross-build Windows: installo sharp per win32/x64 (necessario nel .exe su Windows)...\n",
    )
    installSharp("win32", "x64")
    return true
  }
  if (platform === "linux" && host !== "linux") {
    console.log(
      "\n[pack] Cross-build Linux: installo sharp per linux/x64 (necessario nell'AppImage)...\n",
    )
    installSharp("linux", "x64")
    return true
  }
  if (platform === "mac" && host !== "darwin") {
    console.log(
      "\n[pack] Cross-build macOS: installo sharp per darwin/arm64 o x64...\n",
    )
    const arch = process.arch === "arm64" ? "arm64" : "x64"
    installSharp("darwin", arch)
    return true
  }
  return false
}

export function restoreHostNativeDeps(crossPrepared) {
  if (!crossPrepared) return
  console.log("\n[pack] Ripristino binding nativi sharp per questo host...\n")
  try {
    execSync("npm rebuild sharp", { stdio: "inherit", cwd: root })
  } catch {
    console.warn(
      "[pack] npm rebuild sharp fallito; esegui `npm install` se il dev server non parte.",
    )
  }
}
