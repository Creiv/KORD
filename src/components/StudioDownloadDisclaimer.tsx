import type { useI18n } from "../i18n/useI18n";

type TFn = ReturnType<typeof useI18n>["t"];

export function StudioDownloadDisclaimer({ t }: { t: TFn }) {
  return (
    <p className="subtle sm tools-dl-disclaimer" role="note">
      {t("tools.dlResponsibilityDisclaimer")}
    </p>
  );
}
