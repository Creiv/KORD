import { useCallback, useEffect, useId, useState } from "react";
import type { AppSection } from "../types";
import { useI18n } from "../i18n/useI18n";
import "./mobile-bottom-nav.css";
import { KordNavIcon, UiClose } from "./KordUiIcons";

const MORE_KEYS: { id: AppSection; labelKey: string }[] = [
  { id: "settings", labelKey: "nav.settings" },
  { id: "studio", labelKey: "nav.studio" },
  { id: "playlists", labelKey: "nav.playlists" },
  { id: "favorites", labelKey: "nav.favorites" },
  { id: "recent", labelKey: "nav.recent" },
  { id: "statistics", labelKey: "nav.statistics" },
];

const PRIMARY: { id: AppSection; labelKey: string }[] = [
  { id: "dashboard", labelKey: "nav.dashboard" },
  { id: "ascolta", labelKey: "nav.listen" },
  { id: "libreria", labelKey: "nav.library" },
  { id: "queue", labelKey: "nav.queue" },
];

export function MobileBottomNav({
  active,
  onSelect,
}: {
  active: AppSection;
  onSelect: (section: AppSection) => void;
}) {
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
      <nav
        className="mobile-bottom-nav"
        aria-label={t("mobile.navAria")}
      >
        <div className="mobile-bottom-nav__inner">
          {PRIMARY.map((item) => {
            const is = active === item.id;
            return (
              <button
                key={item.id}
                type="button"
                className={`mobile-bottom-nav__item${is ? " is-active" : ""}`}
                onClick={() => go(item.id)}
                aria-current={is ? "page" : undefined}
              >
                <KordNavIcon
                  section={item.id}
                  className="mobile-bottom-nav__ic"
                />
                <span className="mobile-bottom-nav__label">
                  {t(item.labelKey)}
                </span>
              </button>
            );
          })}
          <button
            type="button"
            className={`mobile-bottom-nav__item${
              isMoreGroup || moreOpen ? " is-active" : ""
            }`}
            aria-expanded={moreOpen}
            aria-controls={moreOpen ? sheetId : undefined}
            onClick={() => setMoreOpen((o) => !o)}
            aria-label={t("nav.moreSheet")}
          >
            <KordNavIcon section="more" className="mobile-bottom-nav__ic" />
            <span className="mobile-bottom-nav__label">
              {t("nav.more")}
            </span>
          </button>
        </div>
      </nav>

      {moreOpen ? (
        <div
          id={sheetId}
          className="mobile-nav-sheet"
          role="dialog"
          aria-modal="true"
          aria-label={t("nav.moreSheet")}
          onClick={(e) => {
            if (e.target === e.currentTarget) setMoreOpen(false);
          }}
        >
          <div
            className="mobile-nav-sheet__panel"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mobile-nav-sheet__head">
              <h2 className="mobile-nav-sheet__title">{t("nav.more")}</h2>
              <button
                type="button"
                className="mobile-nav-sheet__close"
                onClick={() => setMoreOpen(false)}
                aria-label={t("trackMeta.editClose")}
              >
                <UiClose className="mobile-nav-sheet__close-ic" />
              </button>
            </div>
            <ul className="mobile-nav-sheet__list">
              {MORE_KEYS.map((item) => {
                const is = active === item.id;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      className={`mobile-nav-sheet__link${
                        is ? " is-active" : ""
                      }`}
                      onClick={() => {
                        go(item.id);
                        setMoreOpen(false);
                      }}
                    >
                      <KordNavIcon
                        section={item.id}
                        className="mobile-nav-sheet__ic"
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
