/**
 * Breakpoint KORD (valori max-width in px).
 * In CSS usare gli stessi numeri; in JS importare da qui.
 */
export const BP_MOBILE_MAX = 1000;
export const BP_TABLET_MAX = 1024;
/** Griglie a colonna singola (ascolta, dashboard, toolbar compatte). */
export const BP_CONTENT_NARROW_MAX = 900;
export const BP_PHONE_MAX = 560;
export const BP_TIGHT_MAX = 400;

export const MOBILE_LAYOUT_MAX_PX = BP_MOBILE_MAX;
export const MOBILE_LAYOUT_MQ = `(max-width: ${BP_MOBILE_MAX}px)` as const;
export const PHONE_MQ = `(max-width: ${BP_PHONE_MAX}px)` as const;
export const DESKTOP_MQ = `(min-width: ${BP_MOBILE_MAX + 1}px)` as const;
export const CONTENT_NARROW_MQ = `(max-width: ${BP_CONTENT_NARROW_MAX}px)` as const;

/** Altezza riservata al player dock (CSS `--bar-h`) sotto BP_MOBILE_MAX. */
export const PLAYER_DOCK_HEIGHT_MOBILE_PX = 176;
export const PLAYER_DOCK_HEIGHT_PHONE_PX = 184;
