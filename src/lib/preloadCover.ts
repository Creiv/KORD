import { coverUrlForTrackRelPath } from "./api";
import { COVER_WIDTHS } from "./coverArt";
import { versionedUrl } from "./versionedUrl";

const warmed = new Set<string>();

/** Precarica in background la copertina di un brano (cache browser). */
export function preloadTrackCover(
  relPath: string,
  version?: number | null,
  width: number = COVER_WIDTHS.player,
): void {
  if (!relPath || typeof Image === "undefined") return;
  const url = versionedUrl(coverUrlForTrackRelPath(relPath, width), version);
  if (warmed.has(url)) return;
  warmed.add(url);
  const img = new Image();
  img.decoding = "async";
  img.src = url;
}
