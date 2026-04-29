import type { ImgHTMLAttributes } from "react";

/** Copertine da `/api/cover`: di default `loading="lazy"` così titoli e card restano leggibili subito. `priority` imposta caricamento urgente (player). */
export type CoverImgProps = ImgHTMLAttributes<HTMLImageElement> & {
  priority?: boolean;
};

export function CoverImg({
  priority = false,
  loading,
  decoding = "async",
  alt = "",
  ...rest
}: CoverImgProps) {
  const loadAttr = priority
    ? "eager"
    : loading !== undefined
      ? loading
      : "lazy";
  return <img alt={alt} {...rest} decoding={decoding} loading={loadAttr} />;
}
