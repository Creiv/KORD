import { memo } from "react";

/** Asset in `public/REKORDlogo.png` (stesso path in dev e dopo `vite build`). */
export const REKORD_BRAND_LOGO_SRC = "/REKORDlogo.png";

type RekordBrandLogoProps = {
  className?: string;
  /** Se true, l'immagine è decorativa (testo alternativo vuoto). */
  decorative?: boolean;
};

export const RekordBrandLogo = memo(function RekordBrandLogo({
  className,
  decorative = false,
}: RekordBrandLogoProps) {
  return (
    <img
      src={REKORD_BRAND_LOGO_SRC}
      alt={decorative ? "" : "RE-KORD"}
      className={className}
      decoding="async"
      draggable={false}
    />
  );
});
