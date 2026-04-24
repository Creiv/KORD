import { useCallback, useEffect, useRef, useState } from "react";
import { THEME_CATALOG } from "../lib/themeCatalog";
import type { ThemeMode } from "../types";

function ThemeStrip({
  bg,
  section,
  accent,
  accent2,
}: {
  bg: string;
  section: string;
  accent: string;
  accent2: string;
}) {
  return (
    <span className="theme-picker__strip" aria-hidden>
      <span className="theme-picker__strip-seg" style={{ background: bg }} title="Sfondo" />
      <span className="theme-picker__strip-seg" style={{ background: section }} title="Sezioni" />
      <span className="theme-picker__strip-seg" style={{ background: accent }} title="Accent 1" />
      <span className="theme-picker__strip-seg" style={{ background: accent2 }} title="Accent 2" />
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
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const cur = THEME_CATALOG.find((t) => t.id === value) ?? THEME_CATALOG[0];

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
        <span className="theme-picker__label">{cur.label}</span>
        <ThemeStrip
          bg={cur.bg}
          section={cur.section}
          accent={cur.accent}
          accent2={cur.accent2}
        />
      </button>
      {open ? (
        <ul className="theme-picker__menu" role="listbox">
          {THEME_CATALOG.map((t) => (
            <li key={t.id} role="none">
              <button
                type="button"
                role="option"
                aria-selected={t.id === value}
                className={
                  t.id === value
                    ? "theme-picker__opt is-active"
                    : "theme-picker__opt"
                }
                onClick={() => pick(t.id)}
              >
                <span className="theme-picker__name">{t.label}</span>
                <ThemeStrip
                  bg={t.bg}
                  section={t.section}
                  accent={t.accent}
                  accent2={t.accent2}
                />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
