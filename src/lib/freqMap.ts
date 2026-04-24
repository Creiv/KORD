const NYQUIST_TAIL = 0.82

function spectrumDisplayTop(fLen: number): number {
  return Math.max(1, (fLen - 1) * NYQUIST_TAIL)
}

export function logBinT(barI: number, numBars: number, fLen: number): number {
  if (fLen <= 1) return 0
  if (numBars <= 1) return 0
  const top = spectrumDisplayTop(fLen)
  if (barI <= 0) return 0
  const t = barI / (numBars - 1)
  const lo = Math.log(1)
  const hi = Math.log(top + 1)
  const v = Math.exp(lo + t * (hi - lo)) - 1
  return Math.min(top, Math.max(0, v))
}

export function logBinIndex(
  barI: number,
  numBars: number,
  fLen: number,
): number {
  return Math.floor(logBinT(barI, numBars, fLen))
}

export function sampleSpectrumLinear(
  fv: Uint8Array,
  fLen: number,
  x: number,
): number {
  if (fLen <= 0) return 0
  const xi = Math.min(fLen - 1, Math.max(0, x))
  const i0 = Math.floor(xi)
  const i1 = Math.min(i0 + 1, fLen - 1)
  const f = xi - i0
  return fv[i0]! * (1 - f) + fv[i1]! * f
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
