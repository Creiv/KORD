import { useCallback, useMemo, useState, type CSSProperties } from "react";
import { usePlayer } from "../context/PlayerContext";
import { useUserState } from "../context/UserStateContext";
import { useI18n } from "../i18n/useI18n";
import { trackBelongsToGenreKey, parseTrackGenres } from "../lib/genres";
import {
  isTrackAlbumShuffleExcluded,
} from "../lib/randomExclusions";
import { buildSmartRandomQueue } from "../lib/smartShuffle";
import {
  TRACK_MOOD_COLORS,
  TRACK_MOOD_IDS,
  parseTrackMoods,
  type TrackMoodId,
} from "../lib/trackMoods";
import type { AppSection, LibraryIndex, LibraryTrackIndex } from "../types";
import { SectionHeadLead } from "./SectionHeadLead";
import { TrackMoodGlyph } from "./TrackMoodGlyph";
import { UiShuffle, UiStyle } from "./RekordUiIcons";

const DASHBOARD_MIX_TOP_GENRES = 14;

function filterTracksByMoodRules(
  tracks: readonly LibraryTrackIndex[],
  moodIds: TrackMoodId[],
  moodMatchMode: "any" | "all"
): LibraryTrackIndex[] {
  if (moodIds.length === 0) return [...tracks];
  const need = new Set(moodIds);
  return tracks.filter((tr) => {
    const moods = parseTrackMoods(tr.meta ?? undefined);
    if (moodMatchMode === "any") {
      return moods.some((mid) => need.has(mid));
    }
    return moodIds.every((mid) => moods.includes(mid));
  });
}

type DashboardMixCardProps = {
  index: LibraryIndex;
  onOpenSection: (section: AppSection) => void;
};

export function DashboardMixCard({
  index,
  onOpenSection,
}: DashboardMixCardProps) {
  const { t, sortLocale } = useI18n();
  const p = usePlayer();
  const user = useUserState();
  const [genreKey, setGenreKey] = useState<string | null>(null);
  const [moodFilterIds, setMoodFilterIds] = useState<TrackMoodId[]>([]);
  const [moodMatchMode, setMoodMatchMode] = useState<"any" | "all">("any");

  const exAlbums = useMemo(
    () => new Set(user.state.shuffleExcludedAlbumIds),
    [user.state.shuffleExcludedAlbumIds]
  );
  const exTracks = useMemo(
    () => new Set(user.state.shuffleExcludedTrackRelPaths),
    [user.state.shuffleExcludedTrackRelPaths]
  );

  const genreIndex = useMemo(() => {
    const byLower = new Map<string, { label: string; count: number }>();
    for (const tr of index.tracks) {
      const toks = parseTrackGenres(tr.meta?.genre);
      if (toks.length === 0) continue;
      for (const raw of toks) {
        const low = raw.toLowerCase();
        const prev = byLower.get(low);
        if (!prev) byLower.set(low, { label: raw, count: 1 });
        else prev.count += 1;
      }
    }
    const list = Array.from(byLower.entries())
      .map(([key, v]) => ({ key, label: v.label, count: v.count }))
      .sort((a, b) =>
        a.label.localeCompare(b.label, sortLocale, { numeric: true })
      );
    return { list };
  }, [index.tracks, sortLocale]);

  const topGenresByPlays = useMemo(() => {
    const counts = user.state.trackPlayCounts || {};
    const scoreForKey = (key: string) => {
      let s = 0;
      for (const tr of index.tracks) {
        if (!trackBelongsToGenreKey(tr.meta?.genre, key)) continue;
        s += counts[tr.relPath] ?? 0;
      }
      return s;
    };
    return [...genreIndex.list]
      .map((g) => ({ ...g, playsScore: scoreForKey(g.key) }))
      .sort(
        (a, b) =>
          b.playsScore - a.playsScore ||
          b.count - a.count ||
          a.label.localeCompare(b.label, sortLocale, { numeric: true })
      )
      .slice(0, DASHBOARD_MIX_TOP_GENRES);
  }, [genreIndex.list, index.tracks, sortLocale, user.state.trackPlayCounts]);

  const moodOccurrenceCountById = useMemo(() => {
    const m = new Map<TrackMoodId, number>();
    for (const id of TRACK_MOOD_IDS) m.set(id, 0);
    for (const tr of index.tracks) {
      for (const mid of parseTrackMoods(tr.meta ?? undefined)) {
        m.set(mid, (m.get(mid) ?? 0) + 1);
      }
    }
    return m;
  }, [index.tracks]);

  const hasFilter =
    genreKey != null ||
    moodFilterIds.length > 0;

  const shuffleEligible = useMemo(() => {
    if (!hasFilter) return [] as LibraryTrackIndex[];
    let base: readonly LibraryTrackIndex[] = index.tracks;
    if (genreKey != null) {
      base = base.filter((tr) =>
        trackBelongsToGenreKey(tr.meta?.genre, genreKey)
      );
    }
    const moodFiltered = filterTracksByMoodRules(
      base,
      moodFilterIds,
      moodMatchMode
    );
    return moodFiltered.filter(
      (tr) =>
        !exTracks.has(tr.relPath) &&
        !isTrackAlbumShuffleExcluded(tr, exAlbums)
    );
  }, [
    genreKey,
    hasFilter,
    index.tracks,
    moodFilterIds,
    moodMatchMode,
    exTracks,
    exAlbums,
  ]);

  const playMixShuffle = useCallback(() => {
    if (!shuffleEligible.length) return;
    const recentRelPaths = new Set(
      user.state.recent.slice(0, 48).map((tr) => tr.relPath)
    );
    const shuffled = buildSmartRandomQueue(shuffleEligible, {
      currentRelPath: p.current?.relPath,
      currentArtist: p.current?.artist,
      recentRelPaths,
    });
    p.playTrack(shuffled[0], shuffled, 0, { preserveQueueOrder: true });
  }, [shuffleEligible, user.state.recent, p]);

  const selectedGenreLabel =
    genreKey != null
      ? (genreIndex.list.find((g) => g.key === genreKey)?.label ?? genreKey)
      : null;

  return (
    <section className="surface-card dashboard-session-card dashboard-mix-card dashboard-page__mix">
      <div className="section-head section-head--page-toolbar">
        <SectionHeadLead
          eyebrow={t("dashboard.mixEyebrow")}
          title={t("dashboard.mixHeading")}
          icon={<UiShuffle className="section-head__ic" />}
        />
        <button
          type="button"
          className="text-btn"
          onClick={() => onOpenSection("libreria")}
        >
          {t("dashboard.mixOpenLibrary")}
        </button>
      </div>
      <div className="dashboard-session-body dashboard-mix-body">
        <div className="dashboard-mix-scroll">
          <div className="dashboard-mix-block">
            <div className="dashboard-mix-block__head">
              <span className="library-filter-panel__eyebrow">
                {t("dashboard.mixGenresEyebrow")}
              </span>
              {genreKey != null ? (
                <button
                  type="button"
                  className="text-btn library-mood-clear"
                  onClick={() => setGenreKey(null)}
                >
                  {t("dashboard.mixClearGenre")}
                </button>
              ) : null}
            </div>
            {topGenresByPlays.length === 0 ? (
              <p className="panel-empty">{t("dashboard.mixNoGenresHint")}</p>
            ) : (
              <>
                <div className="dashboard-mix-genre-chips">
                  {topGenresByPlays.map((g) => {
                    const on = genreKey === g.key;
                    return (
                      <button
                        key={g.key}
                        type="button"
                        className={`dashboard-mix-genre-chip${on ? " is-on" : ""}`}
                        aria-pressed={on}
                        title={g.label}
                        onClick={() =>
                          setGenreKey((prev) => (prev === g.key ? null : g.key))
                        }
                      >
                        <UiStyle
                          className="dashboard-mix-genre-chip__ic"
                          aria-hidden
                        />
                        <span className="dashboard-mix-genre-chip__label">
                          {g.label}
                        </span>
                        <span className="dashboard-mix-genre-chip__count">
                          {g.count}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {selectedGenreLabel ? (
                  <p className="subtle sm dashboard-mix-selection-note">
                    {t("dashboard.mixGenreActive", {
                      name: selectedGenreLabel,
                    })}
                  </p>
                ) : null}
              </>
            )}
          </div>

          <div className="dashboard-mix-block">
            <div className="library-mood-match-row">
              <span className="library-filter-panel__eyebrow">
                {t("library.moodMatchEyebrow")}
              </span>
              <div
                className="segmented segmented--joined"
                role="group"
                aria-label={t("library.moodMatchAria")}
              >
                <button
                  type="button"
                  className={moodMatchMode === "any" ? "is-on" : ""}
                  onClick={() => setMoodMatchMode("any")}
                >
                  <span className="segmented__btn-inner">
                    <span>{t("library.moodMatchAny")}</span>
                  </span>
                </button>
                <button
                  type="button"
                  className={moodMatchMode === "all" ? "is-on" : ""}
                  onClick={() => setMoodMatchMode("all")}
                >
                  <span className="segmented__btn-inner">
                    <span>{t("library.moodMatchAll")}</span>
                  </span>
                </button>
              </div>
              {moodFilterIds.length > 0 ? (
                <button
                  type="button"
                  className="text-btn library-mood-clear"
                  onClick={() => setMoodFilterIds([])}
                >
                  {t("library.moodClearFilter")}
                </button>
              ) : null}
            </div>
            <div className="library-mood-filter-grid">
              {TRACK_MOOD_IDS.map((id) => {
                const count = moodOccurrenceCountById.get(id) ?? 0;
                const on = moodFilterIds.includes(id);
                const disabled = count === 0 && !on;
                return (
                  <button
                    type="button"
                    key={id}
                    disabled={disabled}
                    className={`library-mood-filter-btn${
                      on ? " library-mood-filter-btn--on" : ""
                    }`}
                    style={
                      { ["--mood-c"]: TRACK_MOOD_COLORS[id] } as CSSProperties
                    }
                    aria-pressed={on}
                    title={t(`trackMeta.mood.${id}`)}
                    onClick={() => {
                      if (disabled) return;
                      setMoodFilterIds((prev) =>
                        prev.includes(id)
                          ? prev.filter((x) => x !== id)
                          : [...prev, id]
                      );
                    }}
                  >
                    <span className="library-mood-filter-btn__glyph-row">
                      <TrackMoodGlyph mood={id} />
                      <span className="library-mood-filter-btn__count">
                        {count}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {hasFilter && shuffleEligible.length === 0 ? (
            <p className="panel-empty">{t("library.moodNoTracks")}</p>
          ) : null}
        </div>

        <div className="dashboard-mix-footer">
          <p
            className={`subtle sm${
              hasFilter ? " dashboard-mix-footer__count" : ""
            }`}
          >
            {hasFilter
              ? t("dashboard.mixNTracks", { n: shuffleEligible.length })
              : t("dashboard.mixFallbackHint")}
          </p>
          <button
            type="button"
            className="primary-btn"
            disabled={shuffleEligible.length === 0}
            onClick={playMixShuffle}
          >
            {t("nav.listen")}
          </button>
        </div>
      </div>
    </section>
  );
}
