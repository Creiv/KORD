import { useI18n } from "../i18n/useI18n";

/** Caricamento sezione: spinner leggero (non splash Benvenuto). */
export function RekordViewLoadingFallback() {
  const { t } = useI18n();
  return (
    <div className="rekord-view-loading" role="status" aria-live="polite">
      <div className="rekord-view-loading__spinner" aria-hidden>
        <span className="rekord-splash__ring" />
      </div>
      <p className="rekord-view-loading__label">{t("loading.app")}</p>
    </div>
  );
}
