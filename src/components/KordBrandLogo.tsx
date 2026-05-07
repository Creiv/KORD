import { memo } from "react";

/** Asset in `public/KORDlogo.png` (stesso path in dev e dopo `vite build`). */
export const KORD_BRAND_LOGO_SRC = "/KORDlogo.png";

type KordBrandLogoProps = {
  className?: string;
  /** Se true, l'immagine è decorativa (testo alternativo vuoto). */
  decorative?: boolean;
};

export const KordBrandLogo = memo(function KordBrandLogo({
  className,
  decorative = false,
}: KordBrandLogoProps) {
  return (
    <img
      src={KORD_BRAND_LOGO_SRC}
      alt={decorative ? "" : "KORD"}
      className={className}
      decoding="async"
      draggable={false}
    />
  );
});
