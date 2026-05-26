import {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePlayer } from "../../context/PlayerContext";
import { useUserState } from "../../context/UserStateContext";
import { useI18n } from "../../i18n/useI18n";
import { useLibraryPlayback } from "../../hooks/useLibraryPlayback";
import { useOpenTrackMetaEdit } from "../../components/TrackMetaEditor";
import { TrackMetaEditGlyph } from "../../components/TrackMetaEditor";
import { CoverImg } from "../../components/CoverImg";
import { ExcludeShuffleIcon } from "../../components/ExcludeShuffleIcon";
import { Visualizer } from "../../components/Visualizer";

const LazyDiscoWallVisualizer = lazy(
  () => import("../../components/DiscoWallVisualizer"),
);
import { SectionHeadLead } from "../../components/SectionHeadLead";
import {
  TrackFileMetaChip,
  TrackListRow,
} from "../../components/AppSharedUi";
import {
  UiFavorite,
  UiHistory,
  UiLyrics,
  UiMusicNote,
  UiNavList,
  UiNote,
} from "../../components/KordUiIcons";
import { isTrackAlbumShuffleExcluded } from "../../lib/randomExclusions";
import { eligibleTracksForIntelligentRandom } from "../../lib/randomExclusions";
import { PlayCollectionButton } from "../../components/PlayCollectionButton";
import { formatDurationMs } from "../../lib/duration";
import { trackInfoBadges } from "../../lib/metaFormat";
import { parseLrcLyrics, currentLrcLineIndex } from "../../lib/lrc";
import type { AppSection, LibraryIndex } from "../../types";

interface ListenViewProps {
  index: LibraryIndex;
  onOpenSection: (section: AppSection) => void;
}

export default function ListenView({ index, onOpenSection }: ListenViewProps) {
  const p = usePlayer();
  const user = useUserState();
  const { t } = useI18n();
  const openTrackMetaEdit = useOpenTrackMetaEdit();
  const exAlbums = useMemo(
    () => new Set(user.state.shuffleExcludedAlbumIds),
    [user.state.shuffleExcludedAlbumIds]
  );
  const exTracksSet = useMemo(
    () => new Set(user.state.shuffleExcludedTrackRelPaths),
    [user.state.shuffleExcludedTrackRelPaths]
  );
  const cur = p.current;
  const { playGlobalRadio, playPoolShuffle } = useLibraryPlayback(index.tracks);
  const albumShuffleExcluded = cur
    ? isTrackAlbumShuffleExcluded(cur, exAlbums)
    : false;
  const trackShuffleExcluded = cur ? exTracksSet.has(cur.relPath) : false;
  const shuffleExcluded = albumShuffleExcluded || trackShuffleExcluded;
  const playCount = cur ? user.getTrackPlayCount(cur.relPath) : 0;
  const listenDurationStr = cur ? formatDurationMs(cur.meta?.durationMs) : null;
  const listenInfoLine = cur
    ? trackInfoBadges(cur, {
        track: t("badges.track"),
        album: t("badges.album"),
      }).join(" · ") || t("common.emDash")
    : "";

  const runLibraryShuffle = () => {
    const eligible = eligibleTracksForIntelligentRandom(
      index,
      exAlbums,
      exTracksSet
    );
    playPoolShuffle(eligible, true);
  };

  const listenQueueStart = Math.max(0, p.currentIndex - 1);
  const listenQueuePreview = p.queue.slice(
    listenQueueStart,
    listenQueueStart + 6
  );

  const recentTracks = useMemo(() => {
    const curRel = cur?.relPath;
    return user.state.recent
      .filter((tr) => !curRel || tr.relPath !== curRel)
      .slice(0, 6);
  }, [user.state.recent, cur?.relPath]);

  const [listenRecentPanel, setListenRecentPanel] = useState<
    "recent" | "lyrics"
  >("recent");

  const currentLyricsRaw = String(cur?.meta?.lyrics || "").trim();
  const parsedLrc = useMemo(
    () => parseLrcLyrics(currentLyricsRaw),
    [currentLyricsRaw]
  );
  const currentLrcIdx = useMemo(
    () => currentLrcLineIndex(parsedLrc, p.currentTime),
    [parsedLrc, p.currentTime]
  );
  const hasLyrics = currentLyricsRaw.length > 0;
  const hasLrcLyrics = parsedLrc.length > 0;

  const trackChangeTransitionsOn =
    user.state.settings.audioCrossfadeSec > 0;

  const lrcScrollRef = useRef<HTMLDivElement>(null);
  const lrcCurrentLineRef = useRef<HTMLParagraphElement | null>(null);
  const vizScrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setListenRecentPanel(hasLyrics ? "lyrics" : "recent");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [hasLyrics, cur?.relPath]);

  useLayoutEffect(() => {
    if (!hasLrcLyrics || listenRecentPanel !== "lyrics") return;
    const wrap = lrcScrollRef.current;
    if (!wrap) return;
    if (currentLrcIdx < 0) {
      wrap.scrollTop = 0;
      return;
    }
    const line = lrcCurrentLineRef.current;
    if (!line) return;
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const lineTop = line.offsetTop;
    const lineH = line.offsetHeight;
    const half = wrap.clientHeight / 2;
    const target = lineTop + lineH / 2 - half;
    const max = Math.max(0, wrap.scrollHeight - wrap.clientHeight);
    const next = Math.max(0, Math.min(target, max));
    wrap.scrollTo({
      top: next,
      behavior:
        reduce || !trackChangeTransitionsOn ? "auto" : "smooth",
    });
  }, [
    currentLrcIdx,
    listenRecentPanel,
    hasLrcLyrics,
    parsedLrc.length,
    trackChangeTransitionsOn,
  ]);

  useLayoutEffect(() => {
    if (!cur?.relPath) return;
    if (!trackChangeTransitionsOn) return;
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    const raf = window.requestAnimationFrame(() => {
      vizScrollRef.current?.scrollIntoView({
        block: "center",
        inline: "nearest",
        behavior: "smooth",
      });
    });
    return () => window.cancelAnimationFrame(raf);
  }, [cur?.relPath, trackChangeTransitionsOn]);

  return (
    <div className="view-page view-page--listen">
      <div className="listen-page">
        <section className="listen-page__stage listen-stage">
          <div className="listen-stage__primary">
          <div className="listen-stage__meta">
            <div className="listen-stage__head">
              {p.current?.relPath ? (
                <CoverImg
                  preset="listen"
                  trackPath={p.current.relPath}
                  coverVersion={
                    typeof (p.current as unknown as { updatedAt?: unknown })
                      .updatedAt === "number"
                      ? (p.current as unknown as { updatedAt: number })
                          .updatedAt
                      : null
                  }
                  className="listen-stage__art"
                  alt=""
                  fallbackClassName="listen-stage__art listen-stage__art--empty"
                  fallback={<UiMusicNote className="listen-stage__empty-ic" />}
                />
              ) : (
                <div
                  className="listen-stage__art listen-stage__art--empty"
                  aria-hidden
                >
                  <UiMusicNote className="listen-stage__empty-ic" />
                </div>
              )}
              <div className="listen-stage__text">
                <div className="listen-stage__text-lead">
                  <div className="listen-stage__eyebrow-row">
                  <p className="eyebrow">{t("listen.currentEyebrow")}</p>
                  {cur ? (
                    <div className="listen-stage__eyebrow-actions">
                      <button
                        type="button"
                        className={`listen-stage__fav ${
                          user.isFavorite(cur.relPath) ? "is-on" : ""
                        }`}
                        onClick={() => user.toggleFavorite(cur.relPath)}
                        title={t("trackRow.favTitle")}
                        aria-pressed={user.isFavorite(cur.relPath)}
                        aria-label={t("trackRow.favAria")}
                      >
                        <span className="listen-stage__fav-ic" aria-hidden>
                          <UiFavorite />
                        </span>
                      </button>
                      <button
                        type="button"
                        className="track-row__ic track-row__ic--meta"
                        onClick={() => openTrackMetaEdit(cur)}
                        title={t("trackRow.editMetaTitle")}
                        aria-label={t("trackRow.editMetaAria")}
                      >
                        <span className="track-row__ic-glyph track-row__ic-glyph--svg">
                          <TrackMetaEditGlyph />
                        </span>
                      </button>
                      <button
                        type="button"
                        className={`track-row__ic track-row__ic--exclude ${
                          shuffleExcluded ? "is-on" : ""
                        }`}
                        disabled={albumShuffleExcluded}
                        title={
                          albumShuffleExcluded
                            ? t("trackRow.excludeLockedByAlbumTitle")
                            : shuffleExcluded
                              ? t("trackRow.unblockShuffle")
                              : t("trackRow.blockShuffle")
                        }
                        onClick={() => {
                          if (albumShuffleExcluded) return;
                          user.toggleShuffleExcludedTrack(cur.relPath);
                        }}
                        aria-pressed={shuffleExcluded}
                        aria-label={
                          albumShuffleExcluded
                            ? t("trackRow.excludeLockedByAlbumAria")
                            : shuffleExcluded
                              ? t("trackRow.unblockShuffle")
                              : t("trackRow.blockShuffle")
                        }
                      >
                        <span
                          className="track-row__ic-glyph track-row__ic-glyph--svg"
                          aria-hidden
                        >
                          <ExcludeShuffleIcon />
                        </span>
                      </button>
                    </div>
                  ) : null}
                </div>
                <h1 className="listen-stage__title">
                  {p.current?.title || t("listen.noTrack")}
                </h1>
                {!cur ? (
                  <p className="listen-stage__sub">
                    {t("listen.openLibraryHint")}
                  </p>
                ) : null}
                </div>
                {cur ? (
                  <div className="listen-stage__meta-full">
                <p className="listen-stage__sub listen-stage__sub--with-stats">
                  <span className="listen-stage__sub-lead">
                    {cur.artist} · {cur.album}
                    <span className="track-row__meta-sep" aria-hidden>
                      {" "}
                      ·{" "}
                    </span>
                    <span
                      className={`track-row__lyrics-inline ${
                        hasLrcLyrics
                          ? "is-lrc"
                          : hasLyrics
                          ? "is-plain"
                          : "is-off"
                      } listen-stage__lyrics-inline`}
                      title={
                        hasLrcLyrics
                          ? t("trackRow.lyricsLrc")
                          : hasLyrics
                          ? t("trackRow.lyricsPlain")
                          : t("trackRow.lyricsMissing")
                      }
                      aria-label={
                        hasLrcLyrics
                          ? t("trackRow.lyricsLrc")
                          : hasLyrics
                          ? t("trackRow.lyricsPlain")
                          : t("trackRow.lyricsMissing")
                      }
                    >
                      <UiLyrics />
                    </span>
                    {listenDurationStr ? ` · ${listenDurationStr}` : ""}
                  </span>
                  <span className="listen-stage__sub-sep" aria-hidden>
                    {" "}
                    ·{" "}
                  </span>
                  <span
                    className="track-row__plays listen-stage__sub-plays"
                    aria-label={t("trackRow.playCount", { n: playCount })}
                  >
                    ({playCount})
                  </span>
                  <TrackFileMetaChip meta={cur.meta} />
                </p>
                <div className="listen-stage__detail">
                  <p className="track-row__badges listen-stage__meta-badges">
                    {listenInfoLine}
                  </p>
                </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
          </div>
          <div className="listen-stage__viz" ref={vizScrollRef}>
            {user.state.settings.vizMode === "discowall" ? (
              <Suspense
                fallback={
                  <div
                    className="viz-wrap is-discowall is-discowall--dormant"
                    aria-hidden
                  />
                }
              >
                <LazyDiscoWallVisualizer />
              </Suspense>
            ) : (
              <Visualizer mode={user.state.settings.vizMode} />
            )}
          </div>
        </section>

        <div className="listen-page__panels listen-dashboard-row">
          <section className="surface-card listen-queue-panel">
            <div className="section-head section-head--page-toolbar library-genre-tracklist-headrow">
              <SectionHeadLead
                eyebrow={t("listen.queueEyebrow")}
                title={t("listen.queueHeading")}
                icon={<UiNavList className="section-head__ic" />}
              />
              <button
                type="button"
                className="text-btn"
                onClick={() => onOpenSection("queue")}
              >
                {t("listen.manageQueue")}
              </button>
            </div>
            <div className="listen-queue-panel__body">
              {p.queue.length === 0 ? (
                <div className="panel-empty panel-empty--actions">
                  <p>{t("listen.queueEmpty")}</p>
                  <PlayCollectionButton
                    label={t("playback.playLibrary")}
                    onClick={runLibraryShuffle}
                  />
                </div>
              ) : (
                <div className="list-stack listen-queue-panel__list">
                  {listenQueuePreview.map((track, i) => {
                    const queueIdx = listenQueueStart + i;
                    return (
                      <TrackListRow
                        key={`${track.relPath}-${queueIdx}`}
                        track={track}
                        autoFocusActive={false}
                        active={queueIdx === p.currentIndex}
                        onPlay={() => p.playTrack(track, p.queue, queueIdx)}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          </section>

          <section className="surface-card listen-recent-panel">
            <div className="section-head section-head--page-toolbar listen-recent-panel__head">
              <div className="section-head__lead listen-recent-panel__lead">
                <span className="section-head__icon-wrap" aria-hidden>
                  {listenRecentPanel === "recent" ? (
                    <UiHistory className="section-head__ic" />
                  ) : (
                    <UiNote className="section-head__ic" />
                  )}
                </span>
                <div className="section-head__text">
                  <p className="eyebrow">
                    {listenRecentPanel === "recent"
                      ? t("listen.recentEyebrow")
                      : t("listen.recentLyricsEyebrow")}
                  </p>
                  <div
                    className="section-nav-tabs listen-recent-panel__nav"
                    role="tablist"
                    aria-label={t("listen.recentPanelTabsAria")}
                  >
                    <button
                      type="button"
                      role="tab"
                      aria-selected={listenRecentPanel === "recent"}
                      className={
                        listenRecentPanel === "recent"
                          ? "section-nav-tab is-on"
                          : "section-nav-tab"
                      }
                      onClick={() => setListenRecentPanel("recent")}
                    >
                      {t("listen.recentTabRecent")}
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={listenRecentPanel === "lyrics"}
                      className={
                        listenRecentPanel === "lyrics"
                          ? "section-nav-tab is-on"
                          : "section-nav-tab"
                      }
                      disabled={!hasLyrics}
                      onClick={() => {
                        if (hasLyrics) setListenRecentPanel("lyrics");
                      }}
                    >
                      {t("listen.recentLyricsPlainTitle")}
                    </button>
                  </div>
                </div>
              </div>
              {listenRecentPanel === "recent" ? (
                <button
                  type="button"
                  className="text-btn"
                  onClick={() => onOpenSection("recent")}
                >
                  {t("listen.recentSeeAll")}
                </button>
              ) : (
                <span
                  className={`listen-recent-panel__lrc-state ${
                    hasLrcLyrics ? "is-on" : "is-off"
                  }`}
                  aria-label={
                    hasLrcLyrics
                      ? t("trackRow.lyricsLrc")
                      : t("trackRow.lyricsMissing")
                  }
                  title={
                    hasLrcLyrics
                      ? t("trackRow.lyricsLrc")
                      : t("trackRow.lyricsMissing")
                  }
                >
                  {hasLrcLyrics ? "✓ " : "✕ "}LRC
                </span>
              )}
            </div>
            <div className="listen-recent-panel__body">
              {listenRecentPanel === "recent" ? (
                recentTracks.length ? (
                  <div className="list-stack listen-recent-panel__list">
                    {recentTracks.map((track) => (
                      <TrackListRow
                        key={track.relPath}
                        track={track}
                        autoFocusActive={false}
                        onPlay={() => playGlobalRadio(track, true)}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="panel-empty">{t("listen.recentEmpty")}</p>
                )
              ) : hasLyrics ? (
                <div
                  className="listen-recent-lyrics"
                  role="region"
                  aria-live="polite"
                  aria-label={
                    hasLrcLyrics
                      ? t("listen.recentLyricsTitle")
                      : t("listen.recentLyricsPlainTitle")
                  }
                >
                  {hasLrcLyrics ? (
                    <div
                      ref={lrcScrollRef}
                      className="listen-recent-lyrics__lrc"
                    >
                      {parsedLrc.map((row, idx) => (
                        <p
                          key={`${row.atSec}-${idx}`}
                          ref={
                            idx === currentLrcIdx
                              ? lrcCurrentLineRef
                              : undefined
                          }
                          className={
                            idx === currentLrcIdx
                              ? "listen-recent-lyrics__line is-current"
                              : "listen-recent-lyrics__line"
                          }
                        >
                          {row.text || "…"}
                        </p>
                      ))}
                    </div>
                  ) : (
                    <pre className="listen-recent-lyrics__plain">
                      {currentLyricsRaw}
                    </pre>
                  )}
                </div>
              ) : (
                <p className="panel-empty subtle sm">
                  {t("listen.recentLyricsNone")}
                </p>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
