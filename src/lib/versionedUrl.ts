export function versionedUrl(base: string, version?: number | null) {
  if (!version || !Number.isFinite(version)) return base;
  return `${base}${base.includes("?") ? "&" : "?"}v=${Math.floor(version)}`;
}

