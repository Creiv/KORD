import type { CustomThemeSettings, ThemeMode } from "../types";

export type ThemeCatalogEntry = {
  id: ThemeMode;
  label: string;
  group: "dual" | "dark" | "color" | "light" | "custom";
  /** --bg */
  bg: string;
  /** --surface2 (theme RGB, opaque for preview strip) */
  section: string;
  accent: string;
  accent2: string;
};

export const DEFAULT_CUSTOM_THEME: CustomThemeSettings = {
  bg: "#08111d",
  section: "#121f31",
  accent: "#ff8f5c",
  accent2: "#64d4ff",
};

export const THEME_CATALOG: ThemeCatalogEntry[] = [
  { id: "midnight", label: "Midnight", group: "dual", bg: "#08111d", section: "#121f31", accent: "#ff8f5c", accent2: "#64d4ff" },
  { id: "sunset", label: "Sunset", group: "color", bg: "#141018", section: "#341e2c", accent: "#ff9b5d", accent2: "#ffd16f" },
  { id: "aurora", label: "Aurora", group: "color", bg: "#071116", section: "#102830", accent: "#4fd4c4", accent2: "#78b4ff" },
  { id: "ember", label: "Embers", group: "color", bg: "#120b08", section: "#3a1a12", accent: "#ff7a4a", accent2: "#ffbe5c" },
  { id: "forest", label: "Forest", group: "color", bg: "#080f0a", section: "#143024", accent: "#5ed494", accent2: "#9ee8b8" },
  { id: "neon", label: "Neon", group: "dual", bg: "#0a0618", section: "#30184e", accent: "#c45cff", accent2: "#3dc8ff" },
  { id: "ocean", label: "Ocean", group: "color", bg: "#051a1e", section: "#0c3a44", accent: "#2dd4bf", accent2: "#38bdf8" },
  { id: "rose", label: "Rose", group: "color", bg: "#170f14", section: "#3c2030", accent: "#f472b6", accent2: "#fda4af" },
  { id: "slate", label: "Slate", group: "dark", bg: "#0b0f14", section: "#1e2838", accent: "#3b82f6", accent2: "#94a3b8" },
  { id: "aubergine", label: "Dark Amethyst", group: "dark", bg: "#0e0e11", section: "#262630", accent: "#8b5cf6", accent2: "#c4b5fd" },
  { id: "tangerine", label: "Dark Citrus", group: "dark", bg: "#0e0e11", section: "#262630", accent: "#f97316", accent2: "#fbbf24" },
  { id: "carmine", label: "Dark Carmine", group: "dark", bg: "#0e0e11", section: "#262630", accent: "#e11d48", accent2: "#fb7185" },
  { id: "prism", label: "Prism Engine", group: "dual", bg: "#07090b", section: "#162022", accent: "#a3ff3f", accent2: "#ff4fd8" },
  { id: "slate-light", label: "Slate", group: "light", bg: "#f4f6f9", section: "#e4e9f2", accent: "#3b82f6", accent2: "#94a3b8" },
  { id: "aubergine-light", label: "Amethyst", group: "light", bg: "#f7f5fc", section: "#ebe6f7", accent: "#8b5cf6", accent2: "#c4b5fd" },
  { id: "tangerine-light", label: "Citrus", group: "light", bg: "#fdfaf5", section: "#f7ede0", accent: "#f97316", accent2: "#fbbf24" },
  { id: "carmine-light", label: "Carmine", group: "light", bg: "#fdf5f6", section: "#f8e5e9", accent: "#e11d48", accent2: "#fb7185" },
  { id: "custom", label: "Custom", group: "custom", ...DEFAULT_CUSTOM_THEME },
];
