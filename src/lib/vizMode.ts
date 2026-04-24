export type VizMode = "bars" | "mirror" | "osc" | "signals" | "embers" | "kord"

const KEY = "kord-viz"
const WPP_KEY = "wpp-viz"
const RETIRED: string[] = ["radial", "line", "soft", "horizon"]

export const VIZ_OPTIONS: { id: VizMode; label: string; hint: string }[] = [
  { id: "bars", label: "Barre", hint: "Spettro classico" },
  { id: "mirror", label: "Specchio", hint: "Frequenze a specchio" },
  { id: "osc", label: "Onda", hint: "Forma d'onda" },
  { id: "signals", label: "Segnali", hint: "Strati fluidi dallo spettro" },
  {
    id: "embers",
    label: "Atmosfera",
    hint: "Sfondo tema e luce a ritmo",
  },
  { id: "kord", label: "KORD", hint: "Logo animato" },
]

export function getVizMode(): VizMode {
  try {
    const v =
      localStorage.getItem(KEY) ?? localStorage.getItem(WPP_KEY) ?? undefined
    if (v === "soft") {
      try {
        localStorage.setItem(KEY, "signals")
      } catch {
        /* ignore */
      }
      return "signals"
    }
    if (v === "horizon") {
      try {
        localStorage.setItem(KEY, "embers")
      } catch {
        /* ignore */
      }
      return "embers"
    }
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
