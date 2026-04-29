import { useEffect, useMemo, useState } from "react";
import { useI18n } from "../i18n/useI18n";

const SPLASH_TIP_COUNT = 15;
const TIP_ROTATE_MS = 4000;

function pickRandomTipIndex(exclude: number) {
  if (SPLASH_TIP_COUNT <= 1) return 0;
  const pool = Array.from({ length: SPLASH_TIP_COUNT }, (_, i) => i).filter(
    (i) => i !== exclude,
  );
  return pool[Math.floor(Math.random() * pool.length)]!;
}

export function KordSplashLoader() {
  const { t } = useI18n();
  const [tipIndex, setTipIndex] = useState(() =>
    Math.floor(Math.random() * SPLASH_TIP_COUNT),
  );

  const tipKeys = useMemo(
    () =>
      Array.from({ length: SPLASH_TIP_COUNT }, (_, i) => `loading.splashTip${i + 1}`),
    []
  );

  useEffect(() => {
    const tipId = window.setInterval(() => {
      setTipIndex((prev) => pickRandomTipIndex(prev));
    }, TIP_ROTATE_MS);
    return () => window.clearInterval(tipId);
  }, []);

  return (
    <div
      className="kord-splash"
      role="status"
      aria-label={String(t("loading.splashAria"))}
    >
      <div
        className="kord-splash__carousel"
        aria-live="polite"
        aria-atomic="true"
      >
        <p className="kord-splash__tip" key={tipIndex}>
          {String(t(tipKeys[tipIndex]))}
        </p>
      </div>
      <h1 className="kord-splash__title">{t("loading.splashTitle")}</h1>
      <p className="kord-splash__lead">{t("loading.splashLead")}</p>
      <div className="kord-splash__spinner" aria-hidden>
        <span className="kord-splash__ring" />
      </div>
    </div>
  );
}
