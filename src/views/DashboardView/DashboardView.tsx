import { useCallback, useMemo } from "react";
import { usePlayer } from "../../context/PlayerContext";
import { useUserState } from "../../context/UserStateContext";
import { useLibraryCardPlayback } from "../../hooks/useLibraryCardPlayback";
import { useMatchMedia } from "../../hooks/useMatchMedia";
import { useDashboardUpdatedAlbumsGrid } from "../../hooks/useDashboardUpdatedAlbumsGrid";
import { useDashboardSessionQueueVisibleCount } from "../../hooks/useDashboardSessionQueueVisibleCount";
import { useI18n } from "../../i18n/useI18n";
import {
  AlbumCardTracksMetaLine,
  AlbumCover,
  DraggableBadgeCluster,
  LibraryAlbumExcludeChips,
  LibraryAlbumFavoriteChips,
  LibraryAlbumMetaChips,
  TrackListRow,
} from "../../components/AppSharedUi";
import { SectionHeadLead } from "../../components/SectionHeadLead";
import {
  UiAutorenew,
  UiBuild,
  UiFavorite,
  UiPlayCircle,
} from "../../components/KordUiIcons";
import { eligibleTracksForIntelligentRandom } from "../../lib/randomExclusions";
import { buildSmartRandomQueue } from "../../lib/smartShuffle";
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
  const p = usePlayer();
  const user = useUserState();
  const playFromLibraryCard = useLibraryCardPlayback(index?.tracks);
  const exAlbumsRand = useMemo(
    () => new Set(user.state.shuffleExcludedAlbumIds),
    [user.state.shuffleExcludedAlbumIds]
  );
  const exTracksRand = useMemo(
    () => new Set(user.state.shuffleExcludedTrackRelPaths),
    [user.state.shuffleExcludedTrackRelPaths]
  );
  const {
    ref: updatedAlbumsGridRef,
    cols: updatedGridCols,
    maxItems: updatedAlbumsMax,
  } = useDashboardUpdatedAlbumsGrid();
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

  const isDashboardMobileLayout = useMatchMedia("(max-width: 900px)");
  const continueListeningList = p.queue;
  const { bodyRef: sessionBodyRef, visibleCount: sessionVisibleCount } =
    useDashboardSessionQueueVisibleCount(
      continueListeningList.length,
      isDashboardMobileLayout,
      updatedAlbumsGridRef
    );
  const sessionTracksVisible = useMemo(
    () => continueListeningList.slice(0, sessionVisibleCount),
    [continueListeningList, sessionVisibleCount]
  );

  const runRandomIntelligent = useCallback(() => {
    if (!index) return;
    const eligible = eligibleTracksForIntelligentRandom(
      index,
      exAlbumsRand,
      exTracksRand
    );
    if (!eligible.length) return;
    const recentRelPaths = new Set(
      user.state.recent.slice(0, 48).map((trk) => trk.relPath)
    );
    const shuffled = buildSmartRandomQueue(eligible, {
      currentRelPath: p.current?.relPath,
      currentArtist: p.current?.artist,
      recentRelPaths,
    });
    p.playTrack(shuffled[0], shuffled, 0, { preserveQueueOrder: true });
  }, [index, exAlbumsRand, exTracksRand, user.state.recent, p]);

  if (!dashboard || !index)
    return <div className="panel-empty">{t("loading.dashboard")}</div>;

  return (
    <div className="view-stack">
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

      <section className="stats-grid">
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

      <section className="dashboard-grid">
        <section className="surface-card dashboard-session-card">
          <div className="section-head section-head--page-toolbar">
            <SectionHeadLead
              eyebrow={t("dashboard.sessionEyebrow")}
              title={t("dashboard.sessionHeading")}
              icon={<UiPlayCircle className="section-head__ic" />}
            />
            <button
              type="button"
              className="text-btn"
              onClick={() => onOpenSection("queue")}
            >
              {t("dashboard.openQueue")}
            </button>
          </div>
          <div
            ref={sessionBodyRef}
            className={
              continueListeningList.length === 0
                ? "dashboard-session-body dashboard-session-body--empty"
                : "dashboard-session-body"
            }
          >
            {continueListeningList.length === 0 ? (
              <div className="panel-empty panel-empty--actions">
                <p>{t("listen.queueEmpty")}</p>
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={runRandomIntelligent}
                >
                  {t("listen.smartShuffle")}
                </button>
              </div>
            ) : (
              <div className="list-stack">
                {sessionTracksVisible.map((track, i) => (
                  <TrackListRow
                    key={track.relPath}
                    track={track}
                    listIndex={i + 1}
                    active={i === p.currentIndex}
                    onPlay={() => p.playTrack(track, p.queue, i)}
                  />
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="surface-card">
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
            className="album-grid compact dashboard-updated-albums"
            style={{
              gridTemplateColumns: `repeat(${updatedGridCols}, minmax(200px, 1fr))`,
            }}
          >
            {dashboard.recentlyUpdatedAlbums
              .slice(0, updatedAlbumsMax)
              .map((album) => (
                <button
                  type="button"
                  key={album.id}
                  className="album-card"
                  onClick={() => onOpenAlbum(album.artistId, album.name)}
                >
                  <AlbumCover album={album} compact />
                  <div className="album-card__text">
                    <div className="album-card__title">{album.name}</div>
                    <AlbumCardTracksMetaLine album={album} />
                    <DraggableBadgeCluster>
                      <LibraryAlbumMetaChips album={album} />
                      <LibraryAlbumFavoriteChips album={album} />
                      <LibraryAlbumExcludeChips album={album} />
                    </DraggableBadgeCluster>
                  </div>
                </button>
              ))}
          </div>
        </section>

        <section className="surface-card">
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
              {favoriteTracksSorted.slice(0, 5).map((track, idx) => (
                <TrackListRow
                  key={track.relPath}
                  track={track}
                  listIndex={idx + 1}
                  onPlay={() => playFromLibraryCard(track)}
                />
              ))}
            </div>
          )}
        </section>

        <section className="surface-card">
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
      </section>
    </div>
  );
}
