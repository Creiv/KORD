import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n/useI18n";
import { THEME_CATALOG } from "../lib/themeCatalog";
import type { ThemeMode } from "../types";

function ThemeStrip({
  bg,
  section,
  accent,
  accent2,
  t,
}: {
  bg: string;
  section: string;
  accent: string;
  accent2: string;
  t: (k: string) => string;
}) {
  return (
    <span className="theme-picker__strip" aria-hidden>
      <span className="theme-picker__strip-seg" style={{ background: bg }} title={t("themePicker.stripBg")} />
      <span className="theme-picker__strip-seg" style={{ background: section }} title={t("themePicker.stripSection")} />
      <span className="theme-picker__strip-seg" style={{ background: accent }} title={t("themePicker.stripAccent1")} />
      <span className="theme-picker__strip-seg" style={{ background: accent2 }} title={t("themePicker.stripAccent2")} />
    </span>
  );
}

export function ThemePicker({
  value,
  onChange,
}: {
  value: ThemeMode;
  onChange: (theme: ThemeMode) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const cur = THEME_CATALOG.find((th) => th.id === value) ?? THEME_CATALOG[0];

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pick = useCallback(
    (id: ThemeMode) => {
      onChange(id);
      setOpen(false);
    },
    [onChange],
  );

  return (
    <div className="theme-picker" ref={rootRef}>
      <button
        type="button"
        className="theme-picker__btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="theme-picker__label">{t(`theme.${cur.id}`)}</span>
        <ThemeStrip
          bg={cur.bg}
          section={cur.section}
          accent={cur.accent}
          accent2={cur.accent2}
          t={t}
        />
      </button>
      {open ? (
        <ul className="theme-picker__menu" role="listbox">
          {THEME_CATALOG.map((entry) => (
            <li key={entry.id} role="none">
              <button
                type="button"
                role="option"
                aria-selected={entry.id === value}
                className={
                  entry.id === value
                    ? "theme-picker__opt is-active"
                    : "theme-picker__opt"
                }
                onClick={() => pick(entry.id)}
              >
                <span className="theme-picker__name">{t(`theme.${entry.id}`)}</span>
                <ThemeStrip
                  bg={entry.bg}
                  section={entry.section}
                  accent={entry.accent}
                  accent2={entry.accent2}
                  t={t}
                />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
