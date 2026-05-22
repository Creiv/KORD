export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function mean(values: number[]): number {
  if (!values.length) return 0;
  let total = 0;
  for (let i = 0; i < values.length; i += 1) total += values[i];
  return total / values.length;
}

export function stddev(values: number[], avg: number): number {
  if (!values.length) return 0;
  let total = 0;
  for (let i = 0; i < values.length; i += 1) {
    const d = values[i] - avg;
    total += d * d;
  }
  return Math.sqrt(total / values.length);
}

export function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = clamp(Math.floor(sorted.length * p), 0, sorted.length - 1);
  return sorted[index];
}

export function stableHash(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
