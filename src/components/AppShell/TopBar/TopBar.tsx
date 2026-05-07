import { memo } from "react";
import { useI18n } from "../../../i18n/useI18n";
import { KordBrandLogo } from "../../KordBrandLogo";
import { AccountBadge } from "../../AccountBadge/AccountBadge";
import { UiAutorenew, UiInstallMobile, UiSearch } from "../../KordUiIcons";
import { NAV_DEF } from "../../../lib/routing";
import type { AppSection } from "../../../types";
import styles from "./TopBar.module.css";

interface TopBarProps {
  activeSection: AppSection;
  loading: boolean;
  syncTapAnim: boolean;
  toolsBusy: boolean;
  librarySearchBarOpen: boolean;
  showInstallButton: boolean;
  onSync: () => void;
  onToggleSearch: () => void;
  onInstall: () => void;
  onOpenSettings: () => void;
}

export const TopBar = memo(function TopBar({
  activeSection,
  loading,
  syncTapAnim,
  toolsBusy,
  librarySearchBarOpen,
  showInstallButton,
  onSync,
  onToggleSearch,
  onInstall,
  onOpenSettings,
}: TopBarProps) {
  const { t } = useI18n();

  const currentNavItem = NAV_DEF.find((item) => item.id === activeSection);
  const sectionTitle = currentNavItem ? t(currentNavItem.labelKey) : "KORD";

  return (
    <header className={styles.topbar} role="banner">
      {/* Screen-reader page title */}
      <h1 className={styles.srOnly}>{sectionTitle}</h1>

      <div className={styles.row}>
        {/* Start: brand (desktop) / section title (mobile) */}
        <div className={styles.start}>
          {/* Wordmark visible only when no section title shown (fallback / very small) */}
          <div className={styles.brand} aria-hidden>
            <KordBrandLogo className="kord-brand-logo kord-brand-logo--topbar" decorative />
          </div>
          <span className={styles.pageTitle} aria-hidden>
            {sectionTitle}
          </span>
        </div>

        {/* End: action buttons */}
        <div className={styles.end}>
          {toolsBusy ? (
            <span
              className="topbar2__tools-spinner"
              role="status"
              aria-label={t("topbar.toolsBusyTitle")}
            />
          ) : null}
          <button
            type="button"
            className={[
              "ghost-btn ghost-btn--toolbar topbar2__sync-btn",
              loading ? "is-loading" : "",
              syncTapAnim ? "is-tap" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            onClick={onSync}
            disabled={loading}
            title={t("topbar.refreshTitle")}
            aria-label={t("topbar.sync")}
            aria-busy={loading}
          >
            <span className="topbar2__sync-ic" aria-hidden>
              <UiAutorenew />
            </span>
          </button>

          <button
            type="button"
            className={[
              "ghost-btn ghost-btn--toolbar topbar2__search-btn",
              librarySearchBarOpen ? "is-on" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            onClick={onToggleSearch}
            title={
              librarySearchBarOpen
                ? t("topbar.closeSearch")
                : t("topbar.openSearch")
            }
            aria-label={
              librarySearchBarOpen
                ? t("topbar.closeSearch")
                : t("topbar.openSearch")
            }
            aria-controls={
              activeSection === "libreria" ? "library-search-input" : undefined
            }
          >
            <span className="topbar2__search-btn-ic" aria-hidden>
              <UiSearch />
            </span>
          </button>

          {showInstallButton ? (
            <button
              type="button"
              className="ghost-btn ghost-btn--toolbar topbar2__install-btn"
              onClick={onInstall}
              title={t("topbar.installApp")}
              aria-label={t("topbar.installApp")}
            >
              <span className="topbar2__install-ic" aria-hidden>
                <UiInstallMobile />
              </span>
              <span className="topbar2__install-label">
                {t("topbar.installApp")}
              </span>
            </button>
          ) : null}

          <AccountBadge onOpenSettings={onOpenSettings} />
        </div>
      </div>
    </header>
  );
});
