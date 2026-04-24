import { useCallback, useMemo } from "react";
import { useUserState } from "../context/UserStateContext";
import type { AppLocale } from "../types";
import { EN } from "./en";
import { IT } from "./it";
import { translate } from "./translate";

const TABLES: Record<AppLocale, Record<string, string>> = {
  en: EN,
  it: IT,
};

export function useI18n() {
  const { state, updateSettings } = useUserState();
  const locale = state.settings.locale;
  const table = TABLES[locale] ?? TABLES.en;
  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) =>
      translate(table, key, vars),
    [table]
  );
  const sortLocale = useMemo(
    () => (locale === "it" ? "it" : "en"),
    [locale]
  );
  return {
    t,
    locale,
    sortLocale,
    setLocale: (next: AppLocale) => updateSettings({ locale: next }),
  };
}
