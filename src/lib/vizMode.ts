export type VizMode = "bars" | "mirror" | "osc"

const KEY = "kord-viz"
const WPP_KEY = "wpp-viz"
const RETIRED: string[] = ["radial", "line"]

export const VIZ_OPTIONS: { id: VizMode; label: string; hint: string }[] = [
  { id: "bars", label: "Barre", hint: "Spettro classico" },
  { id: "mirror", label: "Specchio", hint: "Frequenze a specchio" },
  { id: "osc", label: "Onda", hint: "Forma d'onda" },
]

export function getVizMode(): VizMode {
  try {
    const v =
      localStorage.getItem(KEY) ?? localStorage.getItem(WPP_KEY) ?? undefined
    if (v != null && RETIRED.includes(v)) {
      try {
        localStorage.setItem(KEY, "bars")
      } catch {
        /* ignore */
      }
      return "bars"
    }
    if (v != null && VIZ_OPTIONS.some((o) => o.id === v)) return v as VizMode
  } catch {
    /* ignore */
  }
  return "bars"
}

export function setVizMode(m: VizMode) {
  try {
    localStorage.setItem(KEY, m)
  } catch {
    /* ignore */
  }
}
