import { useMemo, useState } from "react";
import { useUserState } from "../context/UserStateContext";
import { useI18n } from "../i18n/useI18n";
import type { LibraryIndex, LibraryTrackIndex } from "../types";
import { parseTrackGenres } from "../lib/genres";
import { buildRandomArtistCoverMap } from "../lib/artistCover";
import { coverUrlForAlbumRelPath, coverUrlForTrackRelPath } from "../lib/api";
import { formatDurationMs } from "../lib/duration";
import { versionedUrl } from "../lib/versionedUrl";
import { CoverImg } from "../components/CoverImg";
import {
  UiBarChart,
  UiMusicNote,
} from "../components/KordUiIcons";

function initials(text: string) {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("");
}

const STATISTICS_TOP_N = 3;

type StatisticsMetricMode = "plays" | "favorites" | "blocked";

function computeStatisticsRankings(
  index: LibraryIndex,
  scoreByTrackRelPath: Record<string, number>,
  sortLocale: string
) {
  const trackRows = index.tracks
    .map((tr) => ({ tr, n: scoreByTrackRelPath[tr.relPath] ?? 0 }))
    .filter((x) => x.n > 0)
    .sort(
      (a, b) =>
        b.n - a.n ||
        a.tr.title.localeCompare(b.tr.title, sortLocale, { numeric: true }) ||
        a.tr.relPath.localeCompare(b.tr.relPath)
    );
  const artistRows = index.artists
    .map((ar) => {
      let n = 0;
      for (const tr of index.tracks) {
        if (tr.artist === ar.name) n += scoreByTrackRelPath[tr.relPath] ?? 0;
      }
      return { ar, n };
    })
    .filter((x) => x.n > 0)
    .sort(
      (a, b) =>
        b.n - a.n ||
        a.ar.name.localeCompare(b.ar.name, sortLocale, { numeric: true }) ||
        a.ar.id.localeCompare(b.ar.id)
    );
  const albumRows = index.albums
    .map((al) => {
      let n = 0;
      for (const rel of al.tracks) n += scoreByTrackRelPath[rel] ?? 0;
      return { al, n };
    })
    .filter((x) => x.n > 0)
    .sort(
      (a, b) =>
        b.n - a.n ||
        a.al.name.localeCompare(b.al.name, sortLocale, { numeric: true }) ||
        a.al.id.localeCompare(b.al.id)
    );

  const genreMap = new Map<string, { label: string; n: number }>();
  for (const tr of index.tracks) {
    const n = scoreByTrackRelPath[tr.relPath] ?? 0;
    if (n <= 0) continue;
    for (const raw of parseTrackGenres(tr.meta?.genre)) {
      const key = raw.toLowerCase();
      const prev = genreMap.get(key);
      if (prev) prev.n += n;
      else genreMap.set(key, { label: raw, n });
    }
  }
  const topGenres = [...genreMap.entries()]
    .map(([key, v]) => ({ key, label: v.label, n: v.n }))
    .sort(
      (a, b) =>
        b.n - a.n ||
        a.label.localeCompare(b.label, sortLocale, { numeric: true })
    )
    .slice(0, STATISTICS_TOP_N);

  let totalScore = 0;
  for (const tr of index.tracks) {
    totalScore += scoreByTrackRelPath[tr.relPath] ?? 0;
  }
  const touchedTracks = index.tracks.filter(
    (tr) => (scoreByTrackRelPath[tr.relPath] ?? 0) > 0
  );
  const artistsTouched = new Set(touchedTracks.map((tr) => tr.artist)).size;
  const albumsTouched = new Set(touchedTracks.map((tr) => tr.albumId)).size;

  return {
    topTracks: trackRows.slice(0, STATISTICS_TOP_N),
    topArtists: artistRows.slice(0, STATISTICS_TOP_N),
    topAlbums: albumRows.slice(0, STATISTICS_TOP_N),
    topGenres,
    overview: {
      totalScore,
      tracksWithPlays: touchedTracks.length,
      artistsTouched,
      albumsTouched,
    },
  };
}

function StatisticsView({
  index,
  onOpenArtist,
  onOpenAlbum,
}: {
  index: LibraryIndex;
  onOpenArtist: (artistId: string) => void;
  onOpenAlbum: (artistId: string, albumName: string) => void;
}) {
  const user = useUserState();
  const { t, sortLocale } = useI18n();
  const counts = user.state.trackPlayCounts || {};
  const [metricMode, setMetricMode] = useState<StatisticsMetricMode>("plays");
  const favoritesSet = useMemo(
    () => new Set(user.state.favorites ?? []),
    [user.state.favorites]
  );
  const blockedTrackSet = useMemo(
    () => new Set(user.state.shuffleExcludedTrackRelPaths ?? []),
    [user.state.shuffleExcludedTrackRelPaths]
  );
  const blockedAlbumSet = useMemo(
    () => new Set(user.state.shuffleExcludedAlbumIds ?? []),
    [user.state.shuffleExcludedAlbumIds]
  );
  const scoreByTrackRelPath = useMemo(() => {
    const scoreMap: Record<string, number> = {};
    for (const tr of index.tracks) {
      if (metricMode === "plays") {
        scoreMap[tr.relPath] = counts[tr.relPath] ?? 0;
        continue;
      }
      if (metricMode === "favorites") {
        scoreMap[tr.relPath] = favoritesSet.has(tr.relPath) ? 1 : 0;
        continue;
      }
      scoreMap[tr.relPath] =
        blockedTrackSet.has(tr.relPath) || blockedAlbumSet.has(tr.albumId)
          ? 1
          : 0;
    }
    return scoreMap;
  }, [
    index,
    metricMode,
    counts,
    favoritesSet,
    blockedTrackSet,
    blockedAlbumSet,
  ]);
  const data = useMemo(
    () => computeStatisticsRankings(index, scoreByTrackRelPath, sortLocale),
    [index, scoreByTrackRelPath, sortLocale]
  );
  const overviewData = useMemo(
    () => computeStatisticsRankings(index, counts, sortLocale).overview,
    [index, counts, sortLocale]
  );
  const artistCoverById = useMemo(
    () => buildRandomArtistCoverMap(index),
    [index]
  );
  const totalFavorites = user.state.favorites?.length ?? 0;
  const totalShuffleBlocks = useMemo(() => {
    const tr = user.state.shuffleExcludedTrackRelPaths?.length ?? 0;
    const al = user.state.shuffleExcludedAlbumIds?.length ?? 0;
    return tr + al;
  }, [
    user.state.shuffleExcludedTrackRelPaths,
    user.state.shuffleExcludedAlbumIds,
  ]);

  const openTrackInLibrary = (tr: LibraryTrackIndex) => {
    const arId =
      index.artists.find((a) => a.name === tr.artist)?.id ?? tr.artist;
    onOpenAlbum(arId, tr.album);
  };
  const modeLabel =
    metricMode === "plays"
      ? t("statistics.modePlays")
      : metricMode === "favorites"
      ? t("statistics.modeFavorites")
      : t("statistics.modeBlocked");
  const metricTabs = [
    { id: "plays" as const, label: t("statistics.modePlays") },
    { id: "favorites" as const, label: t("statistics.modeFavorites") },
    { id: "blocked" as const, label: t("statistics.modeBlocked") },
  ];
  const formatMetricValue = (n: number) => {
    if (metricMode === "plays") return t("trackRow.playCount", { n });
    if (metricMode === "favorites") return t("statistics.favoriteCount", { n });
    return t("statistics.blockedCount", { n });
  };

  return (
    <div className="view-stack statistics-page">
      <section className="surface-card surface-card--toolbar-only">
        <div className="section-head section-head--page-toolbar">
          <div className="section-head__lead">
            <span className="section-head__icon-wrap" aria-hidden>
              <UiBarChart className="section-head__ic" />
            </span>
            <div className="section-head__text">
              <p className="eyebrow">{t("statistics.pageEyebrow")}</p>
              <div
                className="section-nav-tabs"
                role="group"
                aria-label={t("statistics.metricSwitcherAria")}
              >
                {metricTabs.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    className={`section-nav-tab${
                      metricMode === opt.id ? " is-on" : ""
                    }`}
                    onClick={() => setMetricMode(opt.id)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="statistics-page__sections">
        <section className="surface-card statistics-section">
          <div className="statistics-section__head">
            <h3>{t("statistics.sectionTracks")}</h3>
            <span className="statistics-section__mode">{modeLabel}</span>
          </div>
          {data.topTracks.length === 0 ? (
            <p className="panel-empty statistics-section__empty">
              {t("statistics.rankEmpty")}
            </p>
          ) : (
            <ol className="statistics-rank-list">
              {data.topTracks.map((row, i) => {
                const dur = formatDurationMs(row.tr.meta?.durationMs);
                return (
                  <li key={row.tr.relPath}>
                    <button
                      type="button"
                      className="statistics-rank-row"
                      aria-label={t("statistics.openInLibraryAria", {
                        label: row.tr.title,
                      })}
                      onClick={() => openTrackInLibrary(row.tr)}
                    >
                      <span className="statistics-rank-row__pos">{i + 1}</span>
                      <CoverImg
                        className="statistics-rank-row__art"
                        src={versionedUrl(
                          coverUrlForTrackRelPath(row.tr.relPath),
                          row.tr.updatedAt
                        )}
                        alt=""
                        fallbackClassName="statistics-rank-row__art statistics-rank-row__art--fallback"
                        fallback={
                          <UiMusicNote className="track-row__art-fallback-ic" />
                        }
                      />
                      <div className="statistics-rank-row__text">
                        <div className="statistics-rank-row__title">
                          {row.tr.title}
                        </div>
                        <div className="statistics-rank-row__meta">
                          {row.tr.artist} — {row.tr.album}
                        </div>
                      </div>
                      <div className="statistics-rank-row__plays">
                        {dur ? (
                          <>
                            <span
                              className="statistics-rank-row__dur"
                              aria-label={t("trackRow.duration", { d: dur })}
                            >
                              {dur}
                            </span>
                            <span
                              className="statistics-rank-row__dur-sep"
                              aria-hidden
                            >
                              ·
                            </span>
                          </>
                        ) : null}
                        {formatMetricValue(row.n)}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        <section className="surface-card statistics-section">
          <div className="statistics-section__head">
            <h3>{t("statistics.sectionArtists")}</h3>
            <span className="statistics-section__mode">{modeLabel}</span>
          </div>
          {data.topArtists.length === 0 ? (
            <p className="panel-empty statistics-section__empty">
              {t("statistics.rankEmpty")}
            </p>
          ) : (
            <ol className="statistics-rank-list">
              {data.topArtists.map((row, i) => {
                const coverRel = artistCoverById.get(row.ar.id) ?? null;
                return (
                  <li key={row.ar.id}>
                    <button
                      type="button"
                      className="statistics-rank-row"
                      aria-label={t("statistics.openInLibraryAria", {
                        label: row.ar.name,
                      })}
                      onClick={() => onOpenArtist(row.ar.id)}
                    >
                      <span className="statistics-rank-row__pos">{i + 1}</span>
                      {coverRel ? (
                        <CoverImg
                          className="statistics-rank-row__art"
                          src={coverUrlForAlbumRelPath(coverRel)}
                          alt=""
                          fallbackClassName="statistics-rank-row__art statistics-rank-row__art--fallback"
                          fallback={initials(row.ar.name)}
                        />
                      ) : (
                        <div
                          className="statistics-rank-row__art statistics-rank-row__art--fallback"
                          aria-hidden
                        >
                          {initials(row.ar.name)}
                        </div>
                      )}
                      <div className="statistics-rank-row__text">
                        <div className="statistics-rank-row__title">
                          {row.ar.name}
                        </div>
                      </div>
                      <div className="statistics-rank-row__plays">
                        {formatMetricValue(row.n)}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        <section className="surface-card statistics-section">
          <div className="statistics-section__head">
            <h3>{t("statistics.sectionAlbums")}</h3>
            <span className="statistics-section__mode">{modeLabel}</span>
          </div>
          {data.topAlbums.length === 0 ? (
            <p className="panel-empty statistics-section__empty">
              {t("statistics.rankEmpty")}
            </p>
          ) : (
            <ol className="statistics-rank-list">
              {data.topAlbums.map((row, i) => (
                <li key={row.al.id}>
                  <button
                    type="button"
                    className="statistics-rank-row"
                    aria-label={t("statistics.openInLibraryAria", {
                      label: row.al.name,
                    })}
                    onClick={() => onOpenAlbum(row.al.artistId, row.al.name)}
                  >
                    <span className="statistics-rank-row__pos">{i + 1}</span>
                    <CoverImg
                      className="statistics-rank-row__art"
                      src={coverUrlForAlbumRelPath(row.al.relPath)}
                      alt=""
                      fallbackClassName="statistics-rank-row__art statistics-rank-row__art--fallback"
                      fallback={
                        <UiMusicNote className="track-row__art-fallback-ic" />
                      }
                    />
                    <div className="statistics-rank-row__text">
                      <div className="statistics-rank-row__title">
                        {row.al.name}
                      </div>
                      <div className="statistics-rank-row__meta">
                        {row.al.artist}
                      </div>
                    </div>
                    <div className="statistics-rank-row__plays">
                      {formatMetricValue(row.n)}
                    </div>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="surface-card statistics-section statistics-section--genres">
          <div className="statistics-section__head">
            <h3>{t("statistics.sectionGenres")}</h3>
            <span className="statistics-section__mode">{modeLabel}</span>
          </div>
          {data.topGenres.length === 0 ? (
            <p className="panel-empty statistics-section__empty">
              {t("statistics.genresEmpty")}
            </p>
          ) : (
            <ol className="statistics-rank-list">
              {data.topGenres.map((row, i) => (
                <li key={row.key}>
                  <div className="statistics-rank-row statistics-rank-row--static statistics-rank-row--genre-simple">
                    <span className="statistics-rank-row__pos">{i + 1}</span>
                    <div className="statistics-rank-row__text">
                      <div className="statistics-rank-row__title">
                        {row.label}
                      </div>
                    </div>
                    <div className="statistics-rank-row__plays">
                      {formatMetricValue(row.n)}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="surface-card statistics-section statistics-section--overview">
          <div className="statistics-section__head">
            <h3>{t("statistics.sectionOverview")}</h3>
            <span className="statistics-section__mode">
              {t("statistics.modeAll")}
            </span>
          </div>
          <div className="stats-grid statistics-overview-grid">
            <div className="metric-card statistics-metric">
              <span>{t("statistics.overviewTotalPlays")}</span>
              <strong>{overviewData.totalScore}</strong>
            </div>
            <div className="metric-card statistics-metric">
              <span>{t("statistics.overviewTracksWithPlays")}</span>
              <strong>{overviewData.tracksWithPlays}</strong>
            </div>
            <div className="metric-card statistics-metric">
              <span>{t("statistics.overviewArtistsTouched")}</span>
              <strong>{overviewData.artistsTouched}</strong>
            </div>
            <div className="metric-card statistics-metric">
              <span>{t("statistics.overviewAlbumsTouched")}</span>
              <strong>{overviewData.albumsTouched}</strong>
            </div>
            <div className="metric-card statistics-metric statistics-metric--summary-wide statistics-metric--compact-row">
              <span>{t("statistics.overviewFavoritesTotal")}</span>
              <strong>{totalFavorites}</strong>
            </div>
            <div className="metric-card statistics-metric statistics-metric--summary-wide statistics-metric--compact-row">
              <span>{t("statistics.overviewBlockedTotal")}</span>
              <strong>{totalShuffleBlocks}</strong>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}


export default StatisticsView;
