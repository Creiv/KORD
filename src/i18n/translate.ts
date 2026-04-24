export function translate(
  table: Record<string, string>,
  key: string,
  vars?: Record<string, string | number>
): string {
  let s = table[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replaceAll(`{{${k}}}`, String(v));
    }
  }
  return s;
}
