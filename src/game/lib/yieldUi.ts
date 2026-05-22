/** Cede il main thread tra fasi pesanti (decode / analisi chart). */
export function yieldUi(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(() => resolve(), { timeout: 48 });
    } else {
      requestAnimationFrame(() => resolve());
    }
  });
}
