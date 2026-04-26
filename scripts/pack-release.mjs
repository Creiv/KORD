/**
 * Esempio: node scripts/pack-release.mjs server linux 2.0.0
 * Da npm:   npm run pack:linux:server -- 2.0.0
 */
import { execSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")
const configPath = path.join(root, "electron-builder.kord.cjs")
const [,, flavor, platform, vArg] = process.argv
const platforms = new Set(["linux", "win", "mac"])
const flavors = new Set(["server", "client"])

if (!flavors.has(flavor) || !platforms.has(platform)) {
  console.error(
    "Uso: node scripts/pack-release.mjs <server|client> <linux|win|mac> [versione]\n" +
      "Esempio: npm run pack:linux:server -- 2.0.0",
  )
  process.exit(1)
}

let version = vArg && String(vArg).trim() ? String(vArg).trim() : "1.0.0"
const segs = version.split(".")
if (segs.length === 2) version = `${version}.0`

const platFlag = platform === "win" ? "--win" : platform === "mac" ? "--mac" : "--linux"
process.env.KORD_PACK_FLAVOR = flavor
process.env.KORD_APP_VERSION = version

if (flavor === "server") {
  execSync("npm run build", { stdio: "inherit", cwd: root })
  execSync(`node ${path.join(root, "scripts", "fetch-ytdlp.mjs")} ${platform}`, {
    stdio: "inherit",
    cwd: root,
  })
}

execSync(`npx electron-builder ${platFlag} --config ${configPath}`, {
  stdio: "inherit",
  cwd: root,
  env: { ...process.env, KORD_PACK_FLAVOR: flavor, KORD_APP_VERSION: version },
})
