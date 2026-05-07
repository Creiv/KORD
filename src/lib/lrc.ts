export type ParsedLrcLine = {
  atSec: number;
  text: string;
};

export function parseLrcLyrics(raw: string): ParsedLrcLine[] {
  const out: ParsedLrcLine[] = [];
  const rows = String(raw || "").split(/\r?\n/);
  for (const row of rows) {
    const text = row.replace(/\[[^\]]*]/g, "").trim();
    const tags = [
      ...row.matchAll(/\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g),
    ];
    for (const m of tags) {
      const mm = Number(m[1] || 0);
      const ss = Number(m[2] || 0);
      const fracRaw = String(m[3] || "");
      const frac =
        fracRaw.length === 0
          ? 0
          : fracRaw.length === 1
          ? Number(fracRaw) / 10
          : fracRaw.length === 2
          ? Number(fracRaw) / 100
          : Number(fracRaw) / 1000;
      const atSec = mm * 60 + ss + frac;
      if (Number.isFinite(atSec)) out.push({ atSec, text });
    }
  }
  out.sort((a, b) => a.atSec - b.atSec);
  return out;
}

export function currentLrcLineIndex(
  lines: ParsedLrcLine[],
  currentTime: number
): number {
  if (!lines.length) return -1;
  let idx = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (currentTime >= lines[i]!.atSec) idx = i;
    else break;
  }
  return idx;
}

