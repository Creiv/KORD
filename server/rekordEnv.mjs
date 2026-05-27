/** Legge variabile REKORD_* con fallback legacy KORD_* / WPP_* (stesso nome suffisso). */
export function rekordEnv(suffix, fallbacks = []) {
  const keys = [`REKORD_${suffix}`, ...fallbacks]
  for (const k of keys) {
    const v = process.env[k]
    if (v !== undefined && String(v).trim() !== "") return String(v).trim()
  }
  return undefined
}
