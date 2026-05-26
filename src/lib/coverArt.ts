import { coverUrlForAlbumRelPath, coverUrlForTrackRelPath } from "./api";
import { versionedUrl } from "./versionedUrl";

/** Larghezze allineate a `server/coverServe.mjs`. */
export const COVER_WIDTHS = {
  micro: 64,
  thumb: 96,
  tile: 128,
  card: 256,
  hero: 400,
  player: 512,
} as const;

export type CoverPreset =
  | "micro"
  | "thumb"
  | "tile"
  | "card"
  | "hero"
  | "player"
  | "listen";

type PresetDef = {
  widths: number[];
  sizes: string;
  defaultW: number;
  priority?: boolean;
};

const PRESETS: Record<CoverPreset, PresetDef> = {
  micro: {
    widths: [64, 96],
    sizes: "36px",
    defaultW: COVER_WIDTHS.micro,
  },
  thumb: {
    widths: [96, 128],
    sizes: "48px",
    defaultW: COVER_WIDTHS.thumb,
  },
  tile: {
    widths: [96, 128],
    sizes: "4.55rem",
    defaultW: COVER_WIDTHS.tile,
  },
  card: {
    widths: [128, 256],
    sizes: "4.55rem",
    defaultW: COVER_WIDTHS.card,
  },
  hero: {
    widths: [256, 400],
    sizes: "(max-width: 900px) min(30vw, 200px), 200px",
    defaultW: COVER_WIDTHS.hero,
  },
  player: {
    widths: [128, 256, 512],
    sizes: "58px",
    defaultW: COVER_WIDTHS.player,
    priority: true,
  },
  listen: {
    widths: [256, 512],
    sizes: "min(168px, 32vw)",
    defaultW: COVER_WIDTHS.player,
    priority: true,
  },
};

function coverUrlForRelPath(relPath: string, width: number) {
  return coverUrlForAlbumRelPath(relPath, width);
}

function buildSrcSet(
  relPath: string,
  widths: number[],
  version?: number | null,
) {
  return widths
    .map((w) => {
      const url = versionedUrl(coverUrlForRelPath(relPath, w), version);
      return `${url} ${w}w`;
    })
    .join(", ");
}

export type CoverImageAttrs = {
  src: string;
  srcSet?: string;
  sizes?: string;
  priority?: boolean;
  fetchPriority?: "high" | "low" | "auto";
};

/** Attributi `<img>` ottimizzati per copertine locali (`/api/cover`). */
export function coverImageAttrs(
  relPath: string,
  preset: CoverPreset,
  version?: number | null,
): CoverImageAttrs {
  const def = PRESETS[preset];
  const src = versionedUrl(
    coverUrlForRelPath(relPath, def.defaultW),
    version,
  );
  const srcSet = buildSrcSet(relPath, def.widths, version);
  const priority = Boolean(def.priority);
  return {
    src,
    srcSet,
    sizes: def.sizes,
    priority,
    fetchPriority: priority ? "high" : undefined,
  };
}

/** Come `coverImageAttrs` ma per path brano (stessa cartella album). */
export function trackCoverImageAttrs(
  relPath: string,
  preset: CoverPreset,
  version?: number | null,
): CoverImageAttrs {
  const def = PRESETS[preset];
  const src = versionedUrl(
    coverUrlForTrackRelPath(relPath, def.defaultW),
    version,
  );
  const srcSet = def.widths
    .map((w) => {
      const url = versionedUrl(coverUrlForTrackRelPath(relPath, w), version);
      return `${url} ${w}w`;
    })
    .join(", ");
  const priority = Boolean(def.priority);
  return {
    src,
    srcSet,
    sizes: def.sizes,
    priority,
    fetchPriority: priority ? "high" : undefined,
  };
}
