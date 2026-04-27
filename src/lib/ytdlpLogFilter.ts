function isYtdlpNoiseLine(line: string): boolean {
  if (/Deprecat|UserWarning|pkg_resources|FutureWarning|Pydantic|CryptographyWarning/i.test(line))
    return true
  if (/^See https:\/\/(github|yt-dlp)/i.test(line)) return true
  if (/\[download\]\s+\d+(\.\d+)?%/i.test(line)) return true
  if (/\[download\]\s+Destination:/i.test(line)) return true
  if (/\[download\]\s+Resuming|Already downloaded|has already been recorded/i.test(line))
    return true
  if (/\[Merger\]/i.test(line) && /Merging|Deleting original|ffmpeg/i.test(line)) return true
  if (
    /^WARNING: \[(youtube:tab|youtube)\]/i.test(line) &&
    /(Extracting|Filtering)/i.test(line)
  ) {
    return true
  }
  if (/^WARNING: \[.+\]\s*Unsupported URL/i.test(line)) return true
  return false
}

function isYtdlpFileOrItemIssueLine(line: string): boolean {
  if (/\[download\]\s*Got error:/i.test(line)) return true
  if (/\[download\].*Unable to (download|open)/i.test(line)) return true
  if (/\[download\].*Did not (get any|find)/i.test(line)) return true
  if (/\[download\].*Fragment .*not found|giving up after \d+/i.test(line)) return true
  if (/\[ExtractAudio\].*(ERROR|Failed)/i.test(line)) return true
  if (/\[Postprocessor\].*Error/i.test(line)) return true
  if (/\[EmbedSubtitle\].*Error/i.test(line)) return true
  if (/\[VideoConvertor\].*Error/i.test(line)) return true
  if (/^ERROR:\s*/i.test(line) || /\bERROR: \[/.test(line)) return true
  if (/^WARNING:.*(unavailable|not available|Private video|blocked|age|Sign in|members-only|geoblock)/i.test(line))
    return true
  if (/^WARNING: \[(youtube|vimeo|soundcloud|bandcamp|spotify|generic)\].*ERROR/i.test(line)) return true
  if (/\bVideo unavailable|Private video|This (video|content) (is|may be) (unavailable|not available|blocked)\b/i.test(line))
    return true
  if (/\bHTTP Error (40[34]|41[06]|45[23])\b/.test(line) && (/\[download\]|http/i.test(line) || /fragment/i.test(line)))
    return true
  if (/\bUnable to (download|extract|open)\b.*\b(video|data|file|file fragment)\b/i.test(line)) return true
  if (/\bFailed to (download|merge|extract|write|delete)\b/i.test(line)) return true
  if (/^ERROR: (Unable|Request|The server)/i.test(line)) return true
  return false
}

export function ytdlpLogDetailForUser(r: {
  ok: boolean
  stderr: string
  stdout?: string
  error?: string
}): string {
  if (r.ok) return ""
  const raw = [r.error, r.stderr, r.stdout].filter((x) => x != null && x !== "").join("\n")
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
  const kept: string[] = []
  for (const line of lines) {
    if (isYtdlpNoiseLine(line)) continue
    if (isYtdlpFileOrItemIssueLine(line)) kept.push(line)
  }
  if (kept.length > 0) return kept.join("\n")
  if (r.error && !isYtdlpNoiseLine(r.error)) {
    return r.error.replace(/\n[\s\S]*/, "")
  }
  for (const line of lines) {
    if (isYtdlpNoiseLine(line)) continue
    if (/^ERROR:\s*/i.test(line) || /^\[.+\] ERROR:/i.test(line)) return line
  }
  return lines.length > 0
    ? lines[lines.length - 1]!.length > 220
      ? lines[lines.length - 1]!.slice(0, 217) + "…"
      : lines[lines.length - 1]!
    : ""
}
