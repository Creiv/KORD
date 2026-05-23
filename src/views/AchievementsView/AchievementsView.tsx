import { useMemo } from "react";
import { emitStudioPane } from "../../context/StudioNavigationContext";
import { useUserState } from "../../context/UserStateContext";
import { useI18n } from "../../i18n/useI18n";
import {
  buildAchievementsSnapshot,
  type AchievementIconKind,
} from "../../lib/achievements";
import {
  UiFavorite,
  UiGraphicEq,
  UiHistory,
  UiJoystick,
  UiNavDisc,
  UiPlayArrow,
  UiQueueMusic,
  UiShuffle,
} from "../../components/KordUiIcons";
import type { AppSection, LibraryIndex } from "../../types";

function BadgeIcon({
  kind,
  className,
}: {
  kind: AchievementIconKind;
  className?: string;
}) {
  switch (kind) {
    case "heart":
      return <UiFavorite className={className} />;
    case "list":
      return <UiQueueMusic className={className} />;
    case "artist":
      return <UiNavDisc className={className} />;
    case "genre":
      return <UiGraphicEq className={className} />;
    case "shuffle":
      return <UiShuffle className={className} />;
    case "library":
      return <UiNavDisc className={className} />;
    case "streak":
      return <UiHistory className={className} />;
    case "flame":
      return <UiHistory className={className} />;
    case "plectr":
      return <UiJoystick className={className} />;
    default:
      return <UiPlayArrow className={className} />;
  }
}

export default function AchievementsView({
  index,
  onOpenSection,
}: {
  index: LibraryIndex;
  onOpenSection: (section: AppSection) => void;
}) {
  const { t } = useI18n();
  const user = useUserState();

  const snapshot = useMemo(
    () => (user.ready ? buildAchievementsSnapshot(user.state, index) : null),
    [user.ready, user.state, index]
  );

  const unlocked =
    snapshot?.achievements.filter((a) => a.unlocked).length ?? 0;
  const loading = !user.ready || snapshot == null;

  return (
    <div className="view-page achievements-page">
      <header className="achievements-page__hero view-page__intro">
        <section className="achievements-hero surface-card">
          {/* Pillola livello */}
          <div className="achievements-hero__pills">
            <span className="achievements-hero__level-pill">
              {loading
                ? "·"
                : t("achievements.levelBadge", { n: snapshot.level.level })}
            </span>
          </div>

          {/* Titolo grado */}
          <h1 className="achievements-hero__rank">
            {loading ? "…" : snapshot.level.title}
          </h1>

          {/* Barra XP + testo contestuale */}
          <div
            className="achievements-hero__xp"
            aria-label={t("achievements.xpAria")}
            aria-busy={loading}
          >
            <div
              className="achievements-xp__track"
              role="progressbar"
              aria-valuenow={loading ? undefined : snapshot.progress.pct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={
                loading
                  ? t("achievements.xpLoadingAria")
                  : t("achievements.xpProgressAria", {
                      pct: snapshot.progress.pct,
                    })
              }
            >
              {loading ? (
                <div className="achievements-xp__fill achievements-xp__fill--shimmer" />
              ) : (
                <div
                  className="achievements-xp__fill"
                  style={{ width: `${snapshot.progress.pct}%` }}
                />
              )}
            </div>
            <p className="achievements-hero__xp-caption">
              {loading ? (
                t("achievements.xpLoadingHint")
              ) : (
                <>
                  <strong>{snapshot.totalXp}</strong>
                  {" XP · "}
                  {t("achievements.xpToNext", {
                    n: Math.max(0, snapshot.level.xpMax + 1 - snapshot.totalXp),
                  })}
                </>
              )}
            </p>
          </div>

          {/* Statistiche inline */}
          <ul
            className="achievements-hero__stats"
            aria-label={t("achievements.metricsAria")}
          >
            <li>
              <strong>{loading ? "—" : snapshot.signals.totalPlays}</strong>
              <span>{t("achievements.metricPlays")}</span>
            </li>
            <li>
              <strong>
                {loading ? "—" : snapshot.signals.artistsWithPlays}
              </strong>
              <span>{t("achievements.metricArtists")}</span>
            </li>
            <li>
              <strong>
                {loading ? "—" : snapshot.signals.favoritesCount}
              </strong>
              <span>{t("achievements.metricFavorites")}</span>
            </li>
            <li>
              <strong>
                {loading
                  ? "—"
                  : `${unlocked}/${snapshot.achievements.length}`}
              </strong>
              <span>{t("achievements.metricBadges")}</span>
            </li>
            <li
              className="achievements-hero__stat-streak"
              title={t("achievements.streakTitle")}
            >
              <strong>
                {loading ? "—" : snapshot.streak}
              </strong>
              <span>{t("achievements.streakDays")}</span>
            </li>
          </ul>

          {/* CTA */}
          <div className="achievements-hero__actions">
            <button
              type="button"
              className="primary-btn"
              onClick={() => {
                emitStudioPane("listen");
                onOpenSection("studio");
              }}
            >
              {t("achievements.ctaListen")}
            </button>
            <button
              type="button"
              className="ghost-btn"
              onClick={() => onOpenSection("statistics")}
            >
              {t("achievements.ctaStats")}
            </button>
          </div>
        </section>
      </header>

      <div className="achievements-page__main view-page__main">
        <section
          className="surface-card achievements-board"
          aria-busy={loading}
        >
          <div className="achievements-board__head">
            <h2>{t("achievements.boardTitle")}</h2>
            <p className="achievements-board__lead">
              {loading
                ? t("achievements.xpLoadingHint")
                : t("achievements.boardLead", {
                    n: unlocked,
                    total: snapshot.achievements.length,
                  })}
            </p>
          </div>
          <ul className="achievements-badge-grid">
            {(snapshot?.achievements ?? []).map(({ def, unlocked: isOn }) => (
              <li
                key={def.id}
                className={`achievements-badge${
                  isOn
                    ? " achievements-badge--unlocked"
                    : " achievements-badge--locked"
                }`}
                aria-label={
                  isOn
                    ? t("achievements.achUnlockedAria", {
                        title: t(def.titleKey),
                      })
                    : t("achievements.achLockedAria", {
                        title: t(def.titleKey),
                      })
                }
              >
                <span className="achievements-badge__icon" aria-hidden>
                  <BadgeIcon kind={def.icon} className="achievements-badge__ic" />
                </span>
                <div className="achievements-badge__body">
                  <h3>{t(def.titleKey)}</h3>
                  <p>{t(def.descKey)}</p>
                  <span className="achievements-badge__xp">+{def.xpBonus} XP</span>
                </div>
                <span
                  className={`achievements-badge__state${
                    isOn
                      ? " achievements-badge__state--unlocked"
                      : " achievements-badge__state--locked"
                  }`}
                  aria-hidden
                >
                  {isOn ? "✓" : "○"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
