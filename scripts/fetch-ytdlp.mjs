/**
 * Scarica l'eseguibile yt-dlp (release ufficiale GitHub) in server/bin/ per la piattaforma target.
 * Uso: node scripts/fetch-ytdlp.mjs <win|linux|mac> [versione]
 * Senza argomenti: deduce la piattaforma dall'OS corrente.
 */
import { createWriteStream } from "node:fs"
import { mkdir, chmod, stat } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { pipeline } from "node:stream/promises"
import { Readable } from "node:stream"

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")
const outDir = path.join(root, "server", "bin")

const argPlat = process.argv[2]
const releaseTag = process.argv[3] && String(process.argv[3]).trim() !== "" ? String(process.argv[3]).trim() : null

const platform = argPlat
  ? String(argPlat).toLowerCase()
  : process.platform === "win32"
    ? "win"
    : process.platform === "darwin"
      ? "mac"
      : "linux"

if (!new Set(["win", "linux", "mac"]).has(platform)) {
  console.error("Uso: node scripts/fetch-ytdlp.mjs <win|linux|mac> [versione-optional]")
  process.exit(1)
}

const envLinux = process.env.REKORD_YTDLP_LINUX_ASSET
let assetName
if (platform === "win") assetName = "yt-dlp.exe"
else if (platform === "mac") assetName = "yt-dlp_macos"
else {
  if (envLinux) assetName = envLinux
  else if (process.arch === "arm64") assetName = "yt-dlp_linux_aarch64"
  else assetName = "yt-dlp_linux"
}

const destName = platform === "win" ? "yt-dlp.exe" : "yt-dlp"

async function githubApi(url) {
  const r = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "rekord-ytdlp-fetch",
    },
  })
  if (!r.ok) throw new Error(`GitHub API: ${r.status} ${r.statusText}`)
  return r.json()
}

function pickAsset(assets, name) {
  const a = assets.find((x) => x && x.name === name)
  if (a) return a
  throw new Error(`Nessun asset "${name}" nella release (disponibili: ${assets.map((x) => x.name).join(", ")})`)
}

const FETCH_TIMEOUT_MS = 10 * 60 * 1000
const MIN_BYTES = 1_000_000

async function existingBinaryOk(dest) {
  try {
    const st = await stat(dest)
    return st.isFile() && st.size >= MIN_BYTES
  } catch {
    return false
  }
}

async function downloadToFile(url, dest) {
  const r = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!r.ok) throw new Error(`Download fallito: ${r.status} ${r.statusText}`)
  if (!r.body) throw new Error("Download senza body")
  const tmp = `${dest}.download`
  await pipeline(Readable.fromWeb(r.body), createWriteStream(tmp))
  const st = await stat(tmp)
  if (st.size < MIN_BYTES) {
    throw new Error(`File scaricato sospettosamente piccolo (${st.size} byte); controlla l'URL.`)
  }
  const { rename } = await import("node:fs/promises")
  await rename(tmp, dest)
}

async function main() {
  if (process.env.REKORD_SKIP_YTDLP_FETCH === "1") {
    const dest = path.join(outDir, destName)
    if (await existingBinaryOk(dest)) {
      console.log(`Skip fetch (REKORD_SKIP_YTDLP_FETCH): ${path.relative(root, dest)} già presente`)
      return
    }
    console.warn("REKORD_SKIP_YTDLP_FETCH=1 ma il binario manca o è troppo piccolo; continuo il download.")
  }

  await mkdir(outDir, { recursive: true })
  const dest = path.join(outDir, destName)
  if (await existingBinaryOk(dest)) {
    console.log(`Già presente, skip: ${path.relative(root, dest)}`)
    return
  }

  const relUrl = releaseTag
    ? `https://api.github.com/repos/yt-dlp/yt-dlp/releases/tags/${releaseTag}`
    : "https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest"
  const data = await githubApi(relUrl)
  const assets = data.assets || []
  const asset = pickAsset(assets, assetName)
  console.log(`Scarico ${asset.name} → ${path.relative(root, dest)} (può richiedere alcuni minuti)`)
  await downloadToFile(asset.browser_download_url, dest)
  if (platform !== "win") {
    await chmod(dest, 0o755)
  }
  console.log("OK")
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
