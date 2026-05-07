import { useCallback, useEffect, useId, useState } from "react";
import type { AppSection } from "../../types";
import { useI18n } from "../../i18n/useI18n";
import { KordNavIcon, UiClose } from "../KordUiIcons";
import styles from "./MobileBottomNav.module.css";

const MORE_KEYS: { id: AppSection; labelKey: string }[] = [
  { id: "queue", labelKey: "nav.queue" },
  { id: "settings", labelKey: "nav.settings" },
  { id: "playlists", labelKey: "nav.playlists" },
  { id: "favorites", labelKey: "nav.favorites" },
  { id: "recent", labelKey: "nav.recent" },
  { id: "statistics", labelKey: "nav.statistics" },
];

const PRIMARY: { id: AppSection; labelKey: string }[] = [
  { id: "dashboard", labelKey: "nav.dashboard" },
  { id: "ascolta", labelKey: "nav.listen" },
  { id: "libreria", labelKey: "nav.library" },
  { id: "studio", labelKey: "nav.studio" },
];

interface MobileBottomNavProps {
  active: AppSection;
  onSelect: (section: AppSection) => void;
}

export function MobileBottomNav({ active, onSelect }: MobileBottomNavProps) {
  const { t } = useI18n();
  const sheetId = useId();
  const [moreOpen, setMoreOpen] = useState(false);
  const isMoreGroup = MORE_KEYS.some((x) => x.id === active);

  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMoreOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [moreOpen]);

  useEffect(() => {
    if (!moreOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [moreOpen]);

  const go = useCallback(
    (s: AppSection) => {
      onSelect(s);
    },
    [onSelect]
  );

  return (
    <>
      <nav className={styles.nav} aria-label={t("mobile.navAria")}>
        <div className={styles.navInner}>
          {PRIMARY.map((item) => {
            const isActive = active === item.id;
            return (
              <button
                key={item.id}
                type="button"
                className={`${styles.navItem}${isActive ? ` ${styles.active}` : ""}`}
                onClick={() => go(item.id)}
                aria-current={isActive ? "page" : undefined}
              >
                <KordNavIcon
                  section={item.id}
                  className={styles.navIc}
                />
                <span className={styles.navLabel}>{t(item.labelKey)}</span>
              </button>
            );
          })}
          <button
            type="button"
            className={`${styles.navItem}${
              isMoreGroup || moreOpen ? ` ${styles.active}` : ""
            }`}
            aria-expanded={moreOpen}
            aria-controls={moreOpen ? sheetId : undefined}
            onClick={() => setMoreOpen((o) => !o)}
            aria-label={t("nav.moreSheet")}
          >
            <KordNavIcon section="more" className={styles.navIc} />
            <span className={styles.navLabel}>{t("nav.more")}</span>
          </button>
        </div>
      </nav>

      {moreOpen ? (
        <div
          id={sheetId}
          className={styles.sheet}
          role="dialog"
          aria-modal="true"
          aria-label={t("nav.moreSheet")}
          onClick={(e) => {
            if (e.target === e.currentTarget) setMoreOpen(false);
          }}
        >
          <div
            className={styles.sheetPanel}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.sheetHead}>
              <h2 className={styles.sheetTitle}>{t("nav.more")}</h2>
              <button
                type="button"
                className={styles.sheetClose}
                onClick={() => setMoreOpen(false)}
                aria-label={t("trackMeta.editClose")}
              >
                <UiClose className={styles.sheetCloseIc} />
              </button>
            </div>
            <ul className={styles.sheetList}>
              {MORE_KEYS.map((item) => {
                const isActive = active === item.id;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      className={`${styles.sheetLink}${
                        isActive ? ` ${styles.active}` : ""
                      }`}
                      onClick={() => {
                        go(item.id);
                        setMoreOpen(false);
                      }}
                    >
                      <KordNavIcon
                        section={item.id}
                        className={styles.sheetLinkIc}
                      />
                      {t(item.labelKey)}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      ) : null}
    </>
  );
}
