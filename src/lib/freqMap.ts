export function logBinIndex(
  barI: number,
  numBars: number,
  fLen: number,
): number {
  if (fLen <= 1) return 0
  if (numBars <= 1) return 0
  if (barI <= 0) return 0
  if (barI >= numBars - 1) return fLen - 1
  const t = barI / (numBars - 1)
  const lo = Math.log(1)
  const hi = Math.log(fLen)
  const v = Math.exp(lo + t * (hi - lo))
  return Math.min(fLen - 1, Math.max(0, Math.floor(v) - 1))
}

export function binAmplitude(
  u8: number,
  opts?: { gamma?: number; floor?: number },
): number {
  const n = u8 / 255
  const g = opts?.gamma ?? 0.72
  const f = opts?.floor ?? 0.04
  return f + (1 - f) * Math.pow(Math.max(0, n), g)
}
