import { memo, useCallback } from "react";
import { useI18n } from "../../../i18n/useI18n";
import { KordNavIcon } from "../../KordUiIcons";
import { KordWordmarkSvg } from "../../KordWordmarkSvg";
import { KordLogoMarkSvg } from "../../KordWordmarkSvg";
import { AccountBadge } from "../../AccountBadge/AccountBadge";
import { NAV_DEF } from "../../../lib/routing";
import type { AppSection } from "../../../types";
import styles from "./SideBar.module.css";

interface SideBarProps {
  activeSection: AppSection;
  loading: boolean;
  syncTapAnim: boolean;
  toolsBusy: boolean;
  collapsed: boolean;
  onNavigate: (section: AppSection) => void;
  onSync: () => void;
  onLibraryHome: () => void;
  onToggleCollapse: () => void;
}

export const SideBar = memo(function SideBar({
  activeSection,
  loading,
  syncTapAnim,
  toolsBusy,
  collapsed,
  onNavigate,
  onSync,
  onLibraryHome,
  onToggleCollapse,
}: SideBarProps) {
  const { t } = useI18n();

  const handleNavClick = useCallback(
    (id: AppSection) => {
      if (id === "libreria") {
        onLibraryHome();
      } else {
        onNavigate(id);
      }
    },
    [onNavigate, onLibraryHome]
  );

  const coreItems = NAV_DEF.filter((item) => item.group === "core");
  const secondaryItems = NAV_DEF.filter((item) => item.group === "secondary");

  return (
    <aside
      className={`${styles.sidebar}${collapsed ? ` ${styles.collapsed}` : ""}`}
      aria-label={t("topbar.navAria")}
      data-collapsed={collapsed ? "true" : "false"}
    >
      {/* Header: logo + toggle */}
      <div className={styles.header}>
        {collapsed ? (
          <KordLogoMarkSvg
            className={`kord-wordmark-svg ${styles.logoMark}`}
            decorative
          />
        ) : (
          <KordWordmarkSvg
            className={`kord-wordmark-svg kord-wordmark-svg--topbar ${styles.wordmark}`}
            decorative
          />
        )}
        <button
          type="button"
          className={styles.toggleBtn}
          onClick={onToggleCollapse}
          title={collapsed ? t("sidebar.expand") : t("sidebar.collapse")}
          aria-label={collapsed ? t("sidebar.expand") : t("sidebar.collapse")}
          aria-expanded={!collapsed}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`${styles.toggleIc}${collapsed ? ` ${styles.toggleIcFlipped}` : ""}`}
            aria-hidden
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
      </div>

      {/* Navigation */}
      <nav className={styles.nav}>
        <div className={styles.navSection}>
          {coreItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`${styles.navItem}${
                activeSection === item.id ? ` ${styles.active}` : ""
              }`}
              aria-label={t(item.labelKey)}
              aria-current={activeSection === item.id ? "page" : undefined}
              title={collapsed ? t(item.labelKey) : undefined}
              onClick={() => handleNavClick(item.id)}
            >
              <KordNavIcon section={item.id} className={styles.navIc} />
              {!collapsed && (
                <span className={styles.navLabel}>{t(item.labelKey)}</span>
              )}
            </button>
          ))}
        </div>

        <hr className={styles.navSep} aria-hidden />

        <div className={styles.navSection}>
          {secondaryItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`${styles.navItem}${
                activeSection === item.id ? ` ${styles.active}` : ""
              }`}
              aria-label={t(item.labelKey)}
              aria-current={activeSection === item.id ? "page" : undefined}
              title={collapsed ? t(item.labelKey) : undefined}
              onClick={() => handleNavClick(item.id)}
            >
              <KordNavIcon section={item.id} className={styles.navIc} />
              {!collapsed && (
                <span className={styles.navLabel}>{t(item.labelKey)}</span>
              )}
            </button>
          ))}
        </div>
      </nav>

      {/* Footer */}
      <div className={styles.footer}>
        {toolsBusy && !collapsed ? (
          <span
            className="topbar2__tools-spinner"
            role="status"
            aria-label={t("topbar.toolsBusyTitle")}
          />
        ) : null}
        <div className={styles.footerActions}>
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
              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z" />
              </svg>
            </span>
          </button>
          {!collapsed && (
            <AccountBadge onOpenSettings={() => onNavigate("settings")} />
          )}
        </div>
      </div>
    </aside>
  );
});
