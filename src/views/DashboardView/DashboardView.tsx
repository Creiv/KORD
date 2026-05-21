import { useMemo } from "react";
import { DashboardMixCard } from "../../components/DashboardMixCard";
import { useUserState } from "../../context/UserStateContext";
import { useLibraryPlayback } from "../../hooks/useLibraryPlayback";
import { useMatchMedia } from "../../hooks/useMatchMedia";
import { MOBILE_LAYOUT_MQ } from "../../lib/breakpoints";
import {
  dashboardUpdatedAlbumsVisibleCount,
  useDashboardUpdatedAlbumsGrid,
} from "../../hooks/useDashboardUpdatedAlbumsGrid";
import { useI18n } from "../../i18n/useI18n";
import { TrackListRow } from "../../components/AppSharedUi";
import { AlbumListTile } from "../../components/library";
import { SectionHeadLead } from "../../components/SectionHeadLead";
import {
  UiAutorenew,
  UiBuild,
  UiFavorite,
} from "../../components/KordUiIcons";
import type { AppSection, DashboardPayload, LibraryIndex } from "../../types";
interface DashboardViewProps {
  dashboard: DashboardPayload | null;
  index: LibraryIndex | null;
  onOpenAlbum: (artist: string, album: string) => void;
  onOpenSection: (section: AppSection) => void;
}

export default function DashboardView({
  dashboard,
  index,
  onOpenAlbum,
  onOpenSection,
}: DashboardViewProps) {
  const { t } = useI18n();
  const user = useUserState();
  const { playGlobalRadio } = useLibraryPlayback(index?.tracks);
  const isDashboardMobileLayout = useMatchMedia(MOBILE_LAYOUT_MQ);
  const {
    ref: updatedAlbumsGridRef,
    maxSlots: updatedAlbumsMaxSlots,
    columns: updatedAlbumsColumns,
  } = useDashboardUpdatedAlbumsGrid(isDashboardMobileLayout);
  const updatedAlbumsVisible = dashboardUpdatedAlbumsVisibleCount(
    dashboard?.recentlyUpdatedAlbums.length ?? 0,
    updatedAlbumsMaxSlots,
    updatedAlbumsColumns
  );
  const favoriteTracksSorted = useMemo(
    () =>
      [...(dashboard?.favoriteTracks || [])].sort(
        (a, b) =>
          (user.state.trackPlayCounts?.[b.relPath] ?? 0) -
            (user.state.trackPlayCounts?.[a.relPath] ?? 0) ||
          a.title.localeCompare(b.title, undefined, { numeric: true })
      ),
    [dashboard?.favoriteTracks, user.state.trackPlayCounts]
  );

  if (!dashboard || !index)
    return <div className="panel-empty">{t("loading.dashboard")}</div>;

  return (
    <div className="view-page dashboard-page">
      <header className="dashboard-page__intro view-page__intro">
      <section className="hero-card hero-card--compact">
        <div className="hero-card__lead">
          <p className="eyebrow">KORD</p>
          <h1 className="hero-card__title">{t("dashboard.heroTitle")}</h1>
        </div>
        <div className="hero-card__actions">
          <button
            type="button"
            className="primary-btn"
            onClick={() => onOpenSection("ascolta")}
          >
            {t("dashboard.resumeListen")}
          </button>
          <button
            type="button"
            className="ghost-btn"
            onClick={() => onOpenSection("studio")}
          >
            {t("dashboard.openStudio")}
          </button>
        </div>
      </section>

      <section className="stats-grid" aria-label={t("dashboard.heroTitle")}>
        <div className="metric-card">
          <span>{t("dashboard.metricArtists")}</span>
          <strong>{dashboard.stats.artistCount}</strong>
        </div>
        <div className="metric-card">
          <span>{t("dashboard.metricAlbums")}</span>
          <strong>{dashboard.stats.albumCount}</strong>
        </div>
        <div className="metric-card">
          <span>{t("dashboard.metricTracks")}</span>
          <strong>{dashboard.stats.trackCount}</strong>
        </div>
        <div className="metric-card">
          <span>{t("dashboard.metricQuality")}</span>
          <strong>
            {dashboard.qualityAlerts.reduce((sum, item) => sum + item.count, 0)}
          </strong>
        </div>
      </section>
      </header>

      <div className="dashboard-page__main">
        <DashboardMixCard index={index} onOpenSection={onOpenSection} />

        <section className="surface-card dashboard-page__tile dashboard-page__tile--full">
          <div className="section-head section-head--page-toolbar">
            <SectionHeadLead
              eyebrow={t("dashboard.updatedEyebrow")}
              title={t("dashboard.updatedHeading")}
              icon={<UiAutorenew className="section-head__ic" />}
            />
            <button
              type="button"
              className="text-btn"
              onClick={() => onOpenSection("libreria")}
            >
              {t("dashboard.openLibrary")}
            </button>
          </div>
          <div
            ref={updatedAlbumsGridRef}
            className="library-overview-cols library-overview-cols--dashboard"
          >
            {dashboard.recentlyUpdatedAlbums
              .slice(0, updatedAlbumsVisible)
              .map((album) => (
                <AlbumListTile
                  key={album.id}
                  album={album}
                  onOpen={() => onOpenAlbum(album.artistId, album.name)}
                />
              ))}
          </div>
        </section>

        <section className="surface-card dashboard-page__tile">
          <div className="section-head section-head--page-toolbar">
            <SectionHeadLead
              eyebrow={t("dashboard.favoritesEyebrow")}
              title={t("dashboard.favoritesHeading")}
              icon={<UiFavorite className="section-head__ic" />}
            />
            <button
              type="button"
              className="text-btn"
              onClick={() => onOpenSection("favorites")}
            >
              {t("dashboard.allFavorites")}
            </button>
          </div>
          {favoriteTracksSorted.length === 0 ? (
            <p className="panel-empty">{t("dashboard.favoritesEmpty")}</p>
          ) : (
            <div className="list-stack">
              {favoriteTracksSorted.slice(0, 5).map((track) => (
                <TrackListRow
                  key={track.relPath}
                  track={track}
                  onPlay={() => playGlobalRadio(track, true)}
                />
              ))}
            </div>
          )}
        </section>

        <section className="surface-card dashboard-page__tile">
          <div className="section-head section-head--page-toolbar">
            <SectionHeadLead
              eyebrow={t("dashboard.qualityEyebrow")}
              title={t("dashboard.qualityHeading")}
              icon={<UiBuild className="section-head__ic" />}
            />
            <button
              type="button"
              className="text-btn"
              onClick={() => onOpenSection("studio")}
            >
              {t("dashboard.goStudio")}
            </button>
          </div>
          <div className="alert-list">
            {dashboard.qualityAlerts.map((alert) => (
              <div
                key={alert.id}
                className={`alert-card severity-${alert.severity}`}
              >
                <span>{t(`dashboard.alert.${alert.id}`)}</span>
                <strong>{alert.count}</strong>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
