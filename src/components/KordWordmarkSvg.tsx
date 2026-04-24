import { useId } from "react";

type P = {
  className?: string;
  decorative?: boolean;
};

function KordGlyphPaths() {
  return (
    <>
      <path d="M 56 18 L 76 18 L 76 38 L 94 18 L 114 18 L 82 47 L 114 76 L 94 76 L 76 54 L 76 76 L 56 76 Z" />
      <path
        fillRule="evenodd"
        d="M 128 18 H 172 Q 180 18 180 26 V 68 Q 180 76 172 76 H 128 Q 120 76 120 68 V 26 Q 120 18 128 18 Z M 138 32 H 162 Q 168 32 168 38 V 56 Q 168 62 162 62 H 138 Q 132 62 132 56 V 38 Q 132 32 138 32 Z"
      />
      <path
        fillRule="evenodd"
        d="M 186 18 H 220 Q 236 18 236 36 Q 236 50 224 52 L 242 76 H 220 L 206 56 H 200 V 76 H 186 Z M 200 32 H 214 Q 220 32 220 38 Q 220 46 214 46 H 200 Z"
      />
      <path
        fillRule="evenodd"
        d="M 242 18 H 276 Q 304 18 304 47 Q 304 76 276 76 H 242 Z M 260 32 V 62 H 274 Q 288 62 288 47 Q 288 32 274 32 Z"
      />
    </>
  );
}

export function KordWordmarkSvg({ className, decorative }: P) {
  const uid = useId().replace(/:/g, "");
  const fillId = `kord-sticker-fill-${uid}`;
  return (
    <svg
      className={className}
      viewBox="0 0 360 100"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-hidden={decorative ? true : undefined}
      aria-label={decorative ? undefined : "KORD"}
    >
      {!decorative ? <title>KORD</title> : null}
      <defs>
        <linearGradient
          id={fillId}
          x1="180"
          y1="18"
          x2="180"
          y2="76"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="var(--text, #f5f7fb)" />
          <stop offset="66%" stopColor="var(--text, #f5f7fb)" />
          <stop
            offset="66%"
            stopColor="color-mix(in srgb, color-mix(in srgb, var(--accent2, #64d4ff) 62%, var(--accent, #ff8f5c) 38%) 50%, var(--muted, #a8b8d0) 50%)"
          />
          <stop
            offset="100%"
            stopColor="color-mix(in srgb, color-mix(in srgb, var(--accent2, #64d4ff) 55%, var(--accent, #ff8f5c) 45%) 52%, var(--muted, #a8b8d0) 48%)"
          />
        </linearGradient>
      </defs>
      <g className="kord-wordmark-layer kord-wordmark-layer--halo" fill="none">
        <KordGlyphPaths />
      </g>
      <g className="kord-wordmark-layer kord-wordmark-layer--ring" fill="none">
        <KordGlyphPaths />
      </g>
      <g
        className="kord-wordmark-layer kord-wordmark-layer--face"
        fill={`url(#${fillId})`}
      >
        <KordGlyphPaths />
      </g>
    </svg>
  );
}
