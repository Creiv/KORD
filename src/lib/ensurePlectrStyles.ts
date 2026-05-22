let loaded = false;

/** Carica gli stili Plectr solo alla prima apertura (evita CSS globale a riposo). */
export function ensurePlectrStyles(): void {
  if (loaded) return;
  loaded = true;
  void import("../styles/rhythm-dock.css");
}
