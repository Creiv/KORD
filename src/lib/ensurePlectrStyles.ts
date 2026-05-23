let loaded = false;
let loadPromise: Promise<void> | null = null;

/** True dopo il primo caricamento di rhythm-dock.css. */
export function isPlectrStylesLoaded(): boolean {
  return loaded;
}

/** Carica gli stili Plectr (idempotente; riusa la stessa promise). */
export function ensurePlectrStyles(): Promise<void> {
  if (loaded) return Promise.resolve();
  if (loadPromise) return loadPromise;
  loadPromise = import("../styles/rhythm-dock.css").then(() => {
    loaded = true;
  });
  return loadPromise;
}

/** Precarica in background quando c'è un brano in coda. */
export function prefetchPlectrStyles(): void {
  void ensurePlectrStyles();
}
