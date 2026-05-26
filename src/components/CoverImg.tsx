import { useState, type ImgHTMLAttributes, type ReactNode } from "react";
import {
  coverImageAttrs,
  trackCoverImageAttrs,
  type CoverPreset,
} from "../lib/coverArt";

/** Copertine da `/api/cover`: lazy di default; `priority` o preset player/listen = urgente. */
export type CoverImgProps = ImgHTMLAttributes<HTMLImageElement> & {
  priority?: boolean;
  /** Path libreria: genera `src` / `srcSet` / `sizes` ridotti (ignora `src` se impostato). */
  coverPath?: string;
  /** Preset dimensioni per `coverPath` (o `trackPath`). */
  preset?: CoverPreset;
  /** Path brano (copertina cartella album). */
  trackPath?: string;
  /** Cache-bust copertina aggiornata. */
  coverVersion?: number | null;
  fallback?: ReactNode;
  fallbackClassName?: string;
};

export function CoverImg({
  priority = false,
  preset,
  coverPath,
  trackPath,
  coverVersion,
  fallback,
  fallbackClassName,
  loading,
  decoding = "async",
  alt = "",
  onError,
  onLoad,
  src: srcProp,
  srcSet: srcSetProp,
  sizes: sizesProp,
  fetchPriority: fetchPriorityProp,
  className,
  ...rest
}: CoverImgProps) {
  const [failedSrc, setFailedSrc] = useState<string | undefined>();
  const [loaded, setLoaded] = useState(false);

  const optimized =
    preset && trackPath
      ? trackCoverImageAttrs(trackPath, preset, coverVersion)
      : preset && coverPath
        ? coverImageAttrs(coverPath, preset, coverVersion)
        : null;

  const src = optimized?.src ?? srcProp;
  const srcSet = optimized?.srcSet ?? srcSetProp;
  const sizes = optimized?.sizes ?? sizesProp;
  const isPriority = priority || Boolean(optimized?.priority);
  const fetchPriority =
    fetchPriorityProp ?? optimized?.fetchPriority ?? (isPriority ? "high" : undefined);

  const failed = Boolean(src) && failedSrc === src;
  const loadAttr = isPriority
    ? "eager"
    : loading !== undefined
      ? loading
      : "lazy";

  if (failed && fallback != null) {
    return (
      <div
        className={fallbackClassName || className}
        aria-hidden={alt ? undefined : true}
      >
        {fallback}
      </div>
    );
  }

  const imgClass = [
    className,
    src && !loaded ? "cover-img--loading" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <img
      alt={alt}
      {...rest}
      className={imgClass || undefined}
      src={src}
      srcSet={srcSet}
      sizes={sizes}
      decoding={decoding}
      loading={loadAttr}
      fetchPriority={fetchPriority}
      onLoad={(event) => {
        setLoaded(true);
        onLoad?.(event);
      }}
      onError={(event) => {
        setFailedSrc(src);
        onError?.(event);
      }}
    />
  );
}
