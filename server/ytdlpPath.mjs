import { existsSync } from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function bundledFilename() {
  if (process.platform === "win32") return "yt-dlp.exe"
  return "yt-dlp"
}

export function resolveYtdlpPath() {
  const fromEnv = process.env.YTDLP_PATH
  if (fromEnv != null && String(fromEnv).trim() !== "") return String(fromEnv).trim()
  const bundled = path.join(__dirname, "bin", bundledFilename())
  if (existsSync(bundled)) return bundled
  return "yt-dlp"
}
