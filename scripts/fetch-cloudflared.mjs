import { chmod, mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")
const outDir = path.join(root, "server", "bin")

const argPlat = process.argv[2]
const releaseTag =
  process.argv[3] && String(process.argv[3]).trim() !== ""
    ? String(process.argv[3]).trim()
    : null

const platform = argPlat
  ? String(argPlat).toLowerCase()
  : process.platform === "win32"
    ? "win"
    : process.platform === "darwin"
      ? "mac"
      : "linux"

if (!new Set(["win", "linux", "mac"]).has(platform)) {
  console.error("Uso: node scripts/fetch-cloudflared.mjs <win|linux|mac> [versione-optional]")
  process.exit(1)
}

const assetName =
  platform === "win"
    ? "cloudflared-windows-amd64.exe"
    : platform === "mac"
      ? process.arch === "arm64"
        ? "cloudflared-darwin-arm64.tgz"
        : "cloudflared-darwin-amd64.tgz"
      : process.arch === "arm64"
        ? "cloudflared-linux-arm64"
        : "cloudflared-linux-amd64"

const destName = platform === "win" ? "cloudflared.exe" : "cloudflared"

async function githubApi(url) {
  const r = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "rekord-cloudflared-fetch",
    },
  })
  if (!r.ok) throw new Error(`GitHub API: ${r.status} ${r.statusText}`)
  return r.json()
}

function pickAsset(assets, name) {
  const a = assets.find((x) => x && x.name === name)
  if (a) return a
  throw new Error(`Nessun asset "${name}" nella release`)
}

async function downloadToFile(url, dest) {
  const r = await fetch(url, { redirect: "follow" })
  if (!r.ok) throw new Error(`Download fallito: ${r.status} ${r.statusText}`)
  const ab = await r.arrayBuffer()
  const buf = Buffer.from(ab)
  if (buf.length < 1_000_000) {
    throw new Error(`File scaricato sospettosamente piccolo (${buf.length} byte).`)
  }
  await writeFile(dest, buf)
}

async function main() {
  if (platform === "mac") {
    throw new Error("Asset cloudflared mac in formato .tgz non supportato da questo script.")
  }
  const relUrl = releaseTag
    ? `https://api.github.com/repos/cloudflare/cloudflared/releases/tags/${releaseTag}`
    : "https://api.github.com/repos/cloudflare/cloudflared/releases/latest"
  const data = await githubApi(relUrl)
  const assets = data.assets || []
  const asset = pickAsset(assets, assetName)
  await mkdir(outDir, { recursive: true })
  const dest = path.join(outDir, destName)
  console.log(`Scarico ${asset.name} -> ${path.relative(root, dest)}`)
  await downloadToFile(asset.browser_download_url, dest)
  if (platform !== "win") await chmod(dest, 0o755)
  console.log("OK")
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
