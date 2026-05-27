/**
 * Breakpoint RE-KORD (valori max-width in px).
 * In CSS usare gli stessi numeri; in JS importare da qui.
 *
 * Griglie layout (CSS in page-layout.css, container `rekord-page`):
 * - 640 · 900 · 1100 · 1280 · 1600 px
 *
 * Aspect ratio (CSS in src/styles/aspect-layout.css):
 * - portrait mobile: max-aspect-ratio 9/16 o max-width BP_MOBILE_MAX
 * - 4:3 e 12:9: min-aspect-ratio 4/3 … max-aspect-ratio 14/10
 * - 16:9+: min-aspect-ratio 16/9
 * - 21:9 ultrawide: min-aspect-ratio 21/9 (+ 1600px per layout denso)
 */
export const AR_MOBILE_PORTRAIT = "9/16" as const;
export const AR_TABLET_43 = "4/3" as const;
export const AR_TABLET_129 = "12/9" as const;
export const AR_WIDESCREEN = "16/9" as const;
export const BP_MOBILE_MAX = 1000;
/** Prima colonna con sidebar fissa (TopBar nascosta in CSS). */
export const BP_DESKTOP_MIN = BP_MOBILE_MAX + 1;
export const BP_TABLET_MAX = 1024;
/** Griglie a colonna singola (ascolta, dashboard, toolbar compatte). */
export const BP_CONTENT_NARROW_MAX = 900;
export const BP_PHONE_MAX = 560;
export const BP_TIGHT_MAX = 400;
/** Card brano: icone azioni inline (sopra = menu ⋯). */
export const TRACK_ROW_INLINE_ACTIONS_MIN_PX = 651;

export const MOBILE_LAYOUT_MAX_PX = BP_MOBILE_MAX;
export const MOBILE_LAYOUT_MQ = `(max-width: ${BP_MOBILE_MAX}px)` as const;
export const PHONE_MQ = `(max-width: ${BP_PHONE_MAX}px)` as const;
export const DESKTOP_MQ = `(min-width: ${BP_MOBILE_MAX + 1}px)` as const;
export const CONTENT_NARROW_MQ = `(max-width: ${BP_CONTENT_NARROW_MAX}px)` as const;

/** Altezza riservata al player dock (CSS `--bar-h`) sotto BP_MOBILE_MAX. */
export const PLAYER_DOCK_HEIGHT_MOBILE_PX = 176;
export const PLAYER_DOCK_HEIGHT_PHONE_PX = 184;
