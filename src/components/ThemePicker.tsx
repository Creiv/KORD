import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n/useI18n";
import { DEFAULT_CUSTOM_THEME, THEME_CATALOG } from "../lib/themeCatalog";
import type { CustomThemeSettings, ThemeMode } from "../types";

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
  customTheme = DEFAULT_CUSTOM_THEME,
  onCustomThemeChange,
}: {
  value: ThemeMode;
  onChange: (theme: ThemeMode) => void;
  customTheme?: CustomThemeSettings;
  onCustomThemeChange?: (theme: CustomThemeSettings) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const curBase = THEME_CATALOG.find((th) => th.id === value) ?? THEME_CATALOG[0];
  const cur =
    curBase.id === "custom" ? { ...curBase, ...customTheme } : curBase;

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

  const updateCustomColor = useCallback(
    (key: keyof CustomThemeSettings, next: string) => {
      onCustomThemeChange?.({ ...customTheme, [key]: next });
      if (value !== "custom") onChange("custom");
    },
    [customTheme, onChange, onCustomThemeChange, value],
  );

  const groups = [
    { id: "dual", label: t("themePicker.groupDual") },
    { id: "dark", label: t("themePicker.groupDark") },
    { id: "light", label: t("themePicker.groupLight") },
    { id: "color", label: t("themePicker.groupColor") },
    { id: "custom", label: t("themePicker.groupCustom") },
  ] as const;

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
          {groups.map((group) => {
            const entries = THEME_CATALOG.filter((entry) => entry.group === group.id);
            if (!entries.length) return null;
            return (
              <li className="theme-picker__group" key={group.id} role="none">
                <div className="theme-picker__group-label">{group.label}</div>
                <ul className="theme-picker__group-list" role="none">
                  {entries.map((entry) => {
                    const preview =
                      entry.id === "custom" ? { ...entry, ...customTheme } : entry;
                    return (
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
                            bg={preview.bg}
                            section={preview.section}
                            accent={preview.accent}
                            accent2={preview.accent2}
                            t={t}
                          />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </li>
            );
          })}
        </ul>
      ) : null}
      {value === "custom" ? (
        <div className="theme-picker__custom" aria-label={t("themePicker.customAria")}>
          {(["bg", "section", "accent", "accent2"] as const).map((key) => (
            <label className="theme-picker__color" key={key}>
              <span>{t(`themePicker.custom.${key}`)}</span>
              <input
                type="color"
                value={customTheme[key]}
                onChange={(event) => updateCustomColor(key, event.target.value)}
              />
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}
