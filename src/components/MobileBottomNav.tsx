import { useCallback, useEffect, useId, useState } from "react";
import type { AppSection } from "../types";
import { useI18n } from "../i18n/useI18n";
import "./mobile-bottom-nav.css";

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

function IcHome({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 10.5L12 4l8 6.5V20a1 1 0 01-1 1h-5v-6H10v6H5a1 1 0 01-1-1v-9.5z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IcHeadphones({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M3 14v3a3 3 0 003 3h1v-8H5a2 2 0 00-2 2zm18-2a2 2 0 00-2-2h-2v8h1a3 3 0 003-3v-3"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M6 12a6 6 0 1112 0"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IcDisc({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle
        cx="12"
        cy="12"
        r="7"
        stroke="currentColor"
        strokeWidth="1.75"
      />
      <circle cx="12" cy="12" r="2" fill="currentColor" />
    </svg>
  );
}

function IcList({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IcMore({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <circle cx="6" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="18" cy="12" r="1.8" />
    </svg>
  );
}

function iconFor(
  id: (typeof PRIMARY)[number]["id"] | "more",
  className: string | undefined
) {
  const p = { className };
  switch (id) {
    case "dashboard":
      return <IcHome {...p} />;
    case "ascolta":
      return <IcHeadphones {...p} />;
    case "libreria":
      return <IcDisc {...p} />;
    case "queue":
      return <IcList {...p} />;
    default:
      return <IcMore {...p} />;
  }
}

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
                {iconFor(item.id, "mobile-bottom-nav__ic")}
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
            {iconFor("more", "mobile-bottom-nav__ic")}
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
                ×
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
