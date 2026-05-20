import { useI18n } from "../i18n/useI18n";

/** Caricamento sezione: spinner leggero (non splash Benvenuto). */
export function KordViewLoadingFallback() {
  const { t } = useI18n();
  return (
    <div className="kord-view-loading" role="status" aria-live="polite">
      <div className="kord-view-loading__spinner" aria-hidden>
        <span className="kord-splash__ring" />
      </div>
      <p className="kord-view-loading__label">{t("loading.app")}</p>
    </div>
  );
}
