import type { ThemeMode } from "../types";

export type ThemeCatalogEntry = {
  id: ThemeMode;
  label: string;
  /** --bg */
  bg: string;
  /** --surface2 (RGB da tema, opaco per anteprima) */
  section: string;
  accent: string;
  accent2: string;
};

export const THEME_CATALOG: ThemeCatalogEntry[] = [
  { id: "midnight", label: "Mezzanotte", bg: "#08111d", section: "#121f31", accent: "#ff8f5c", accent2: "#64d4ff" },
  { id: "sunset", label: "Tramonto", bg: "#141018", section: "#341e2c", accent: "#ff9b5d", accent2: "#ffd16f" },
  { id: "aurora", label: "Aurora", bg: "#071116", section: "#102830", accent: "#4fd4c4", accent2: "#78b4ff" },
  { id: "ember", label: "Braci", bg: "#120b08", section: "#3a1a12", accent: "#ff7a4a", accent2: "#ffbe5c" },
  { id: "forest", label: "Foresta", bg: "#080f0a", section: "#143024", accent: "#5ed494", accent2: "#9ee8b8" },
  { id: "neon", label: "Neon", bg: "#0a0618", section: "#30184e", accent: "#c45cff", accent2: "#3dc8ff" },
  { id: "ocean", label: "Oceano", bg: "#051a1e", section: "#0c3a44", accent: "#2dd4bf", accent2: "#38bdf8" },
  { id: "rose", label: "Rosa", bg: "#170f14", section: "#3c2030", accent: "#f472b6", accent2: "#fda4af" },
  { id: "slate", label: "Ardesia", bg: "#0b0f14", section: "#1e2838", accent: "#3b82f6", accent2: "#94a3b8" },
  { id: "aubergine", label: "Dark Ametista", bg: "#0e0e11", section: "#262630", accent: "#8b5cf6", accent2: "#c4b5fd" },
  { id: "tangerine", label: "Dark Agrumi", bg: "#0e0e11", section: "#262630", accent: "#f97316", accent2: "#fbbf24" },
  { id: "carmine", label: "Dark Forest", bg: "#0e0e11", section: "#262630", accent: "#e11d48", accent2: "#fb7185" },
];

export function themeLabel(id: ThemeMode): string {
  return THEME_CATALOG.find((t) => t.id === id)?.label ?? id;
}
