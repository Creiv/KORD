export function parseShellLine(line) {
  const s = String(line).trim()
  if (!s) return []
  const out = []
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g
  let m
  while ((m = re.exec(s))) {
    if (m[1] != null) out.push(m[1])
    else if (m[2] != null) out.push(m[2])
    else if (m[3]) out.push(m[3])
  }
  return out
}
