import { useState, type ImgHTMLAttributes, type ReactNode } from "react";

/** Copertine da `/api/cover`: di default `loading="lazy"` così titoli e card restano leggibili subito. `priority` imposta caricamento urgente (player). */
export type CoverImgProps = ImgHTMLAttributes<HTMLImageElement> & {
  priority?: boolean;
  fallback?: ReactNode;
  fallbackClassName?: string;
};

export function CoverImg({
  priority = false,
  fallback,
  fallbackClassName,
  loading,
  decoding = "async",
  alt = "",
  onError,
  src,
  className,
  ...rest
}: CoverImgProps) {
  const [failedSrc, setFailedSrc] = useState<string | undefined>();
  const failed = Boolean(src) && failedSrc === src;
  const loadAttr = priority
    ? "eager"
    : loading !== undefined
      ? loading
      : "lazy";
  if (failed && fallback != null) {
    return (
      <div className={fallbackClassName || className} aria-hidden={alt ? undefined : true}>
        {fallback}
      </div>
    );
  }
  return (
    <img
      alt={alt}
      {...rest}
      className={className}
      src={src}
      decoding={decoding}
      loading={loadAttr}
      onError={(event) => {
        setFailedSrc(src);
        onError?.(event);
      }}
    />
  );
}
