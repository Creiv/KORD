import {
  memo,
  useLayoutEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { usePlayer } from "../context/PlayerContext";
import { useUserState } from "../context/UserStateContext";
import { useI18n } from "../i18n/useI18n";
import {
  coverUrlForAlbumRelPath,
  coverUrlForTrackRelPath,
} from "../lib/api";
import { isTrackAlbumShuffleExcluded } from "../lib/randomExclusions";
import { fmtDate, trackInfoBadges } from "../lib/metaFormat";
import { formatDurationMs } from "../lib/duration";
import { versionedUrl } from "../lib/versionedUrl";
import { initials } from "../lib/initials";
import { parseLrcLyrics } from "../lib/lrc";
import { parseTrackGenres, trackBelongsToGenreKey } from "../lib/genres";
import { parseTrackMoods, TRACK_MOOD_COLORS } from "../lib/trackMoods";
import { CoverImg } from "./CoverImg";
import { ExcludeShuffleIcon } from "./ExcludeShuffleIcon";
import { TrackMetaEditGlyph, useOpenTrackMetaEdit } from "./TrackMetaEditor";
import { TrackMoodGlyph } from "./TrackMoodGlyph";
import {
  UiAdd,
  UiFavorite,
  UiLyrics,
  UiMusicNote,
  UiPlayArrow,
  UiQueueMusic,
} from "./KordUiIcons";
import type {
  EnrichedTrack,
  LibraryAlbumIndex,
  LibraryArtistIndex,
  LibraryIndex,
  LibraryTrackIndex,
  TrackMeta,
} from "../types";

export function TrackFileMetaChip({ meta }: { meta?: TrackMeta | null }) {
  const { t } = useI18n();
  const gapWarn = !parseTrackGenres(meta?.genre).length && !meta?.releaseDate;
  const moods = parseTrackMoods(meta ?? undefined);
  const moodSummaryTitle =
    moods.length > 0
      ? t("trackMeta.moodOnTitle", {
          labels: moods.map((id) => t(`trackMeta.mood.${id}`)).join(", "),
        })
      : t("trackMeta.moodOffTitle");
  return (
    <>
      <span
        className={`lib-meta-chip lib-meta-chip--ico${
          gapWarn ? " lib-meta-chip--on" : ""
        }`}
        title={gapWarn ? t("trackMeta.gapOnTitle") : t("trackMeta.gapOffTitle")}
      >
        <UiMusicNote className="lib-meta-chip__ico" />
      </span>
      <span className="track-meta-moods-cluster" title={moodSummaryTitle}>
        {moods.length === 0 ? (
          <span className="lib-meta-chip lib-meta-chip--ico lib-meta-chip--mood-off">
            <TrackMoodGlyph
              mood={null}
              className="track-meta-mood-chip__glyph"
            />
          </span>
        ) : (
          moods.map((id) => (
            <span
              key={id}
              className="lib-meta-chip lib-meta-chip--ico lib-meta-chip--mood-tag"
              style={{ ["--mood-c"]: TRACK_MOOD_COLORS[id] } as CSSProperties}
              title={t(`trackMeta.mood.${id}`)}
            >
              <TrackMoodGlyph
                mood={id}
                className="track-meta-mood-chip__glyph"
              />
            </span>
          ))
        )}
      </span>
    </>
  );
}

export function TrackRowArt({ relPath }: { relPath: string }) {
  return (
    <CoverImg
      className="track-row__art"
      src={coverUrlForTrackRelPath(relPath)}
      alt=""
      fallbackClassName="track-row__art track-row__art--fallback"
      fallback={<UiMusicNote className="track-row__art-fallback-ic" />}
    />
  );
}

function PlayerBarTrackArtInner({
  relPath,
  version,
}: {
  relPath: string;
  version?: number | null;
}) {
  const base = coverUrlForTrackRelPath(relPath);
  const src = versionedUrl(base, version);
  return (
    <CoverImg
      priority
      className="player-bar2__art"
      src={src}
      alt=""
      fallbackClassName="player-bar2__art fallback"
      fallback={<UiMusicNote className="player-bar2__art-fallback-ic" />}
    />
  );
}

export function PlayerBarTrackArt({
  relPath,
  version,
}: {
  relPath: string;
  version?: number | null;
}) {
  const user = useUserState();
  const transitionsOn =
    user.state.settings.audioCrossfadeSec > 0;
  const cacheKey =
    version && Number.isFinite(version) ? Math.floor(version) : null;
  const remountKey = transitionsOn
    ? `${relPath}:${cacheKey ?? ""}`
    : "__player-dock-art__";
  return (
    <PlayerBarTrackArtInner
      key={remountKey}
      relPath={relPath}
      version={version}
    />
  );
}

export const TrackListRow = memo(function TrackListRow({
  track,
  active,
  onPlay,
  metaRight,
  extraActions,
  showTrackBadgeRow = false,
  listIndex,
  autoFocusActive = true,
}: {
  track: EnrichedTrack;
  /** If omitted, row is active when it matches the current track (`relPath`). Queue uses explicit index. */
  active?: boolean;
  onPlay: () => void;
  metaRight?: string;
  extraActions?: ReactNode;
  /** Terza riga (badge traccia/disco…): solo nella lista brani dell’album. */
  showTrackBadgeRow?: boolean;
  /** Posizione nella lista (1-based). */
  listIndex?: number;
  /** Disabilita lo scroll automatico della riga quando diventa quella attiva. */
  autoFocusActive?: boolean;
}) {
  const p = usePlayer();
  const user = useUserState();
  const { t } = useI18n();
  const openTrackMetaEdit = useOpenTrackMetaEdit();
  const exAlbums = useMemo(
    () => new Set(user.state.shuffleExcludedAlbumIds),
    [user.state.shuffleExcludedAlbumIds]
  );
  const excludedTracksMemo = useMemo(
    () => new Set(user.state.shuffleExcludedTrackRelPaths),
    [user.state.shuffleExcludedTrackRelPaths]
  );
  const albumShuffleExcluded = isTrackAlbumShuffleExcluded(track, exAlbums);
  const trackShuffleExcluded = excludedTracksMemo.has(track.relPath);
  const shuffleExcluded = albumShuffleExcluded || trackShuffleExcluded;
  const inQ = p.isTrackInQueue(track.relPath);
  const fav = user.isFavorite(track.relPath);
  const playCount = user.getTrackPlayCount(track.relPath);
  const lyricsRaw = String(track.meta?.lyrics || "").trim();
  const hasLyrics = lyricsRaw.length > 0;
  const hasLrcLyrics = hasLyrics && parseLrcLyrics(lyricsRaw).length > 0;
  const durationStr = formatDurationMs(track.meta?.durationMs);
  const infoLine =
    metaRight ||
    trackInfoBadges(track, {
      track: t("badges.track"),
      album: t("badges.album"),
    }).join(" · ") ||
    t("common.emDash");
  const rowActive =
    active !== undefined
      ? active
      : Boolean(p.current && p.current.relPath === track.relPath);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const prevActiveRef = useRef(false);
  useLayoutEffect(() => {
    if (!autoFocusActive || !rowActive || prevActiveRef.current) {
      prevActiveRef.current = rowActive;
      return;
    }
    prevActiveRef.current = true;
    const raf = window.requestAnimationFrame(() => {
      rowRef.current?.scrollIntoView({
        block: "center",
        inline: "nearest",
        behavior: "smooth",
      });
    });
    return () => window.cancelAnimationFrame(raf);
  }, [rowActive, autoFocusActive]);
  return (
    <div
      ref={rowRef}
      className={`track-row ${rowActive ? "is-active" : ""}`}
    >
      <span
        className={`track-row__idx-wrap ${rowActive ? "is-current" : ""}`}
        aria-hidden
      >
        <span className="track-row__idx-num">{listIndex ?? ""}</span>
        <button
          type="button"
          className="track-row__idx-play"
          onClick={onPlay}
          title={t("player.playTitle")}
          aria-label={t("player.playTitle")}
        >
          <UiPlayArrow />
        </button>
      </span>
      <TrackRowArt relPath={track.relPath} />
      <button
        type="button"
        className="track-row__main"
        onClick={onPlay}
      >
        <span className="track-row__title-row">
          <span className="track-row__title-lead">
            <span className="track-row__title">{track.title}</span>
            {durationStr ? (
              <span
                className="track-row__duration"
                aria-label={t("trackRow.duration", { d: durationStr })}
              >
                {durationStr}
              </span>
            ) : null}
            <span
              className="track-row__plays"
              aria-label={t("trackRow.playCount", { n: playCount })}
            >
              ({playCount})
            </span>
            <TrackFileMetaChip meta={track.meta} />
          </span>
        </span>
        <span className="track-row__meta">
          {track.artist} · {track.album}
          <span className="track-row__meta-sep" aria-hidden>
            {" "}
            ·{" "}
          </span>
          <span
            className={`track-row__lyrics-inline ${
              hasLrcLyrics ? "is-lrc" : hasLyrics ? "is-plain" : "is-off"
            }`}
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
        </span>
        {showTrackBadgeRow ? (
          <span className="track-row__badges">{infoLine}</span>
        ) : null}
      </button>
      <div className="track-row__actions">
        {inQ ? (
          <button
            type="button"
            className="track-row__in-coda"
            onClick={() => p.removeFromQueueByRelPath(track.relPath)}
            title={t("trackRow.removeQueueTitle")}
            aria-label={t("trackRow.removeQueueAria")}
          >
            <span className="track-row__in-coda__label track-row__in-coda__label--idle">
              {t("trackRow.inQueueIdle")}
            </span>
            <span className="track-row__in-coda__label track-row__in-coda__label--act">
              {t("trackRow.inQueueAct")}
            </span>
          </button>
        ) : (
          <button
            type="button"
            className="track-row__ic track-row__ic--queue"
            onClick={() => p.addToQueue(track)}
            title={t("trackRow.addQueueTitle")}
            aria-label={t("trackRow.addQueueAria")}
          >
            <span
              className="track-row__ic-glyph track-row__ic-glyph--svg"
              aria-hidden
            >
              <UiAdd />
            </span>
          </button>
        )}
        <button
          type="button"
          className={`track-row__ic track-row__ic--fav ${fav ? "is-on" : ""}`}
          onClick={() => user.toggleFavorite(track.relPath)}
          title={t("trackRow.favTitle")}
          aria-pressed={fav}
          aria-label={t("trackRow.favAria")}
        >
          <span
            className="track-row__ic-glyph track-row__ic-glyph--svg"
            aria-hidden
          >
            <UiFavorite />
          </span>
        </button>
        <button
          type="button"
          className="track-row__ic track-row__ic--meta"
          onClick={(ev) => {
            ev.stopPropagation();
            openTrackMetaEdit(track);
          }}
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
              : t("trackRow.excludeTitle")
          }
          onClick={() => {
            if (albumShuffleExcluded) return;
            user.toggleShuffleExcludedTrack(track.relPath);
          }}
          aria-pressed={shuffleExcluded}
          aria-label={
            albumShuffleExcluded
              ? t("trackRow.excludeLockedByAlbumAria")
              : t("trackRow.excludeTitle")
          }
        >
          <span
            className="track-row__ic-glyph track-row__ic-glyph--svg"
            aria-hidden
          >
            <ExcludeShuffleIcon />
          </span>
        </button>
        {extraActions}
      </div>
    </div>
  );
});

export function AlbumCover({
  album,
  compact,
}: {
  album: LibraryAlbumIndex;
  compact?: boolean;
}) {
  if (album.coverRelPath) {
    const base = coverUrlForAlbumRelPath(album.relPath);
    const src = versionedUrl(base, album.updatedAt);
    return (
      <CoverImg
        className={`album-cover ${compact ? "is-compact" : ""}`}
        src={src}
        alt=""
        fallbackClassName={`album-cover is-fallback ${
          compact ? "is-compact" : ""
        }`}
        fallback={initials(album.artist)}
      />
    );
  }
  return (
    <div className={`album-cover is-fallback ${compact ? "is-compact" : ""}`}>
      {initials(album.artist)}
    </div>
  );
}

export function LibraryArtistMetaChips({ artist }: { artist: LibraryArtistIndex }) {
  const { t } = useI18n();
  const nA = artist.albumsWithoutFileMetaCount;
  const nS = artist.tracksWithoutFileMetaCount;
  return (
    <div
      className="lib-meta-badges"
      aria-label={t("library.metaFileStatusAria")}
    >
      <span
        className={`lib-meta-chip${nA > 0 ? " lib-meta-chip--on" : ""}`}
        title={
          nA > 0
            ? t("library.albumsNoMetaChip", { n: nA })
            : t("library.albumsAllMetaChip")
        }
      >
        A{nA > 0 ? nA : ""}
      </span>
      <span
        className={`lib-meta-chip lib-meta-chip--ico${
          nS > 0 ? " lib-meta-chip--on" : ""
        }`}
        title={
          nS > 0
            ? t("library.tracksNoMetaChip", { n: nS })
            : t("library.tracksAllMetaChip")
        }
      >
        <UiMusicNote className="lib-meta-chip__ico" />
        {nS > 0 ? nS : ""}
      </span>
    </div>
  );
}

export function LibraryAlbumMetaChips({
  album,
  variant = "card",
}: {
  album: LibraryAlbumIndex;
  variant?: "card" | "hero";
}) {
  const { t } = useI18n();
  const wrap =
    variant === "hero"
      ? "lib-meta-badges lib-meta-badges--hero"
      : "lib-meta-badges lib-meta-badges--tight";
  if (album.loose) {
    const n = album.tracksWithoutFileMetaCount;
    return (
      <div className={wrap} aria-label={t("library.metaFileStatusAria")}>
        <span
          className={`lib-meta-chip lib-meta-chip--ico${
            n > 0 ? " lib-meta-chip--on" : ""
          }`}
          title={
            n > 0
              ? t("library.looseTracksChip", { n })
              : t("library.looseTracksOkChip")
          }
        >
          <UiMusicNote className="lib-meta-chip__ico" />
          {n > 0 ? n : ""}
        </span>
      </div>
    );
  }
  const hasAl = album.hasAlbumMeta;
  const nT = album.tracksWithoutFileMetaCount;
  const missTr = nT > 0;
  return (
    <div className={wrap} aria-label={t("library.metaFileStatusAria")}>
      <span
        className={`lib-meta-chip${!hasAl ? " lib-meta-chip--on" : ""}`}
        title={
          hasAl ? t("library.albumInfoPresent") : t("library.albumInfoMissing")
        }
      >
        A
      </span>
      <span
        className={`lib-meta-chip lib-meta-chip--ico${
          missTr ? " lib-meta-chip--on" : ""
        }`}
        title={
          missTr
            ? t("library.tracksPartialMeta", { n: nT })
            : t("library.tracksAllHaveMeta")
        }
      >
        <UiMusicNote className="lib-meta-chip__ico" />
        {missTr ? nT : ""}
      </span>
    </div>
  );
}

export function albumExclusionKey(album: LibraryAlbumIndex) {
  return album.id;
}

export function albumHasExpectedReleaseMeta(album: LibraryAlbumIndex): boolean {
  return (
    (typeof album.expectedTrackCount === "number" &&
      album.expectedTrackCount > 0) ||
    (Array.isArray(album.expectedTracks) && album.expectedTracks.length > 0)
  );
}

export function AlbumCardTracksMetaLine({ album }: { album: LibraryAlbumIndex }) {
  const { t } = useI18n();
  return (
    <div className="album-card__meta album-card__tracks-meta">
      <UiQueueMusic
        className={
          albumHasExpectedReleaseMeta(album)
            ? "album-tracklist-expected__ic"
            : "album-tracklist-expected__ic album-tracklist-expected__ic--dim"
        }
        aria-hidden
      />
      <span>
        {t("library.tracklistHeading", { n: album.trackCount })}
        {album.releaseDate ? ` · ${fmtDate(album.releaseDate)}` : ""}
      </span>
    </div>
  );
}

function tracksInGenreByKey(
  libraryIndex: LibraryIndex,
  genreKey: string
): LibraryTrackIndex[] {
  return libraryIndex.tracks.filter((t) =>
    trackBelongsToGenreKey(t.meta?.genre, genreKey)
  );
}

function trackHasKordFileMeta(t: LibraryTrackIndex) {
  return Boolean(
    parseTrackGenres(t.meta?.genre).length > 0 || t.meta?.releaseDate
  );
}

export function LibraryGenreMetaChips({
  genreKey,
  index: libraryIndex,
}: {
  genreKey: string;
  index: LibraryIndex;
}) {
  const { t } = useI18n();
  const tracks = tracksInGenreByKey(libraryIndex, genreKey);
  const albumIds = new Set(tracks.map((t) => t.albumId));
  let nA = 0;
  for (const aid of albumIds) {
    const al = libraryIndex.albums.find((a) => a.id === aid);
    if (al && !al.loose && !al.hasAlbumMeta) nA += 1;
  }
  const nS = tracks.filter((t) => !trackHasKordFileMeta(t)).length;
  return (
    <div
      className="lib-meta-badges"
      aria-label={t("library.metaFileStatusAria")}
    >
      <span
        className={`lib-meta-chip${nA > 0 ? " lib-meta-chip--on" : ""}`}
        title={
          nA > 0
            ? t("library.albumsNoMetaChip", { n: nA })
            : t("library.albumsAllMetaChip")
        }
      >
        A{nA > 0 ? nA : ""}
      </span>
      <span
        className={`lib-meta-chip lib-meta-chip--ico${
          nS > 0 ? " lib-meta-chip--on" : ""
        }`}
        title={
          nS > 0
            ? t("library.tracksNoMetaChip", { n: nS })
            : t("library.tracksAllMetaChip")
        }
      >
        <UiMusicNote className="lib-meta-chip__ico" />
        {nS > 0 ? nS : ""}
      </span>
    </div>
  );
}

export function LibraryGenreExcludeChips({
  genreKey,
  index: libraryIndex,
}: {
  genreKey: string;
  index: LibraryIndex;
}) {
  const { t } = useI18n();
  const user = useUserState();
  const excludedAlbums = useMemo(
    () => new Set(user.state.shuffleExcludedAlbumIds),
    [user.state.shuffleExcludedAlbumIds]
  );
  const excludedTracks = useMemo(
    () => new Set(user.state.shuffleExcludedTrackRelPaths),
    [user.state.shuffleExcludedTrackRelPaths]
  );
  const tracks = tracksInGenreByKey(libraryIndex, genreKey);
  const albumIds = new Set(tracks.map((t) => t.albumId));
  let nAl = 0;
  for (const aid of albumIds) {
    const al = libraryIndex.albums.find((a) => a.id === aid);
    if (al && excludedAlbums.has(albumExclusionKey(al))) nAl += 1;
  }
  const nTr = tracks.filter((t) => excludedTracks.has(t.relPath)).length;
  return (
    <div
      className="lib-meta-badges lib-meta-badges--tight"
      aria-label={t("library.randomExcludeAria")}
    >
      <span
        className={`lib-meta-chip lib-meta-chip--exclude${
          nAl > 0 ? " lib-meta-chip--on" : ""
        }`}
        title={
          nAl > 0
            ? t("library.nAlbumsExcluded", { n: nAl })
            : t("library.noAlbumsExcluded")
        }
      >
        R{nAl > 0 ? nAl : ""}
      </span>
      <span
        className={`lib-meta-chip lib-meta-chip--exclude${
          nTr > 0 ? " lib-meta-chip--on" : ""
        }`}
        title={
          nTr > 0
            ? t("library.nTracksExcluded", { n: nTr })
            : t("library.noTracksExcluded")
        }
      >
        <ExcludeShuffleIcon className="lib-meta-chip__exclude-icon" />
        {nTr > 0 ? nTr : null}
      </span>
    </div>
  );
}

export function LibraryGenreFavoriteChips({
  genreKey,
  index: libraryIndex,
}: {
  genreKey: string;
  index: LibraryIndex;
}) {
  const { t } = useI18n();
  const { favorites } = useUserState();
  const n = useMemo(() => {
    let c = 0;
    for (const t of tracksInGenreByKey(libraryIndex, genreKey)) {
      if (favorites.has(t.relPath)) c += 1;
    }
    return c;
  }, [genreKey, libraryIndex, favorites]);
  return (
    <div
      className="lib-meta-badges lib-meta-badges--tight"
      aria-label={t("library.favoritesAria")}
    >
      <span
        className={`lib-meta-chip lib-meta-chip--fav lib-meta-chip--ico${
          n > 0 ? " lib-meta-chip--on" : ""
        }`}
        title={
          n > 0
            ? n === 1
              ? t("library.oneFavTrackArtist")
              : t("library.nFavTracksArtist", { n })
            : t("library.noFavArtist")
        }
      >
        <UiFavorite className="lib-meta-chip__ico" />
        {n > 0 ? n : ""}
      </span>
    </div>
  );
}

export function LibraryArtistExcludeChips({
  artist,
  index,
}: {
  artist: LibraryArtistIndex;
  index: LibraryIndex;
}) {
  const { t } = useI18n();
  const user = useUserState();
  const excludedAlbums = useMemo(
    () => new Set(user.state.shuffleExcludedAlbumIds),
    [user.state.shuffleExcludedAlbumIds]
  );
  const excludedTracks = useMemo(
    () => new Set(user.state.shuffleExcludedTrackRelPaths),
    [user.state.shuffleExcludedTrackRelPaths]
  );
  let nAl = 0;
  for (const aid of artist.albums) {
    const al = index.albums.find((a) => a.id === aid);
    if (al && excludedAlbums.has(albumExclusionKey(al))) nAl += 1;
  }
  let nTrackBlocked = 0;
  for (const t of index.tracks) {
    if (t.artist !== artist.name) continue;
    const al = index.albums.find((a) => a.id === t.albumId);
    if (al && excludedAlbums.has(albumExclusionKey(al))) {
      nTrackBlocked += 1;
      continue;
    }
    if (excludedTracks.has(t.relPath)) nTrackBlocked += 1;
  }
  return (
    <div
      className="lib-meta-badges lib-meta-badges--tight"
      aria-label={t("library.randomExcludeAria")}
    >
      <span
        className={`lib-meta-chip lib-meta-chip--exclude${
          nAl > 0 ? " lib-meta-chip--on" : ""
        }`}
        title={
          nAl > 0
            ? t("library.nAlbumsExcluded", { n: nAl })
            : t("library.noAlbumsExcluded")
        }
      >
        R{nAl > 0 ? nAl : ""}
      </span>
      <span
        className={`lib-meta-chip lib-meta-chip--exclude${
          nTrackBlocked > 0 ? " lib-meta-chip--on" : ""
        }`}
        title={
          nTrackBlocked > 0
            ? t("library.nTracksExcluded", { n: nTrackBlocked })
            : t("library.noTracksExcluded")
        }
      >
        <ExcludeShuffleIcon className="lib-meta-chip__exclude-icon" />
        {nTrackBlocked > 0 ? nTrackBlocked : null}
      </span>
    </div>
  );
}

export function LibraryArtistFavoriteChips({
  artist,
  index: libraryIndex,
}: {
  artist: LibraryArtistIndex;
  index: LibraryIndex;
}) {
  const { t } = useI18n();
  const { favorites } = useUserState();
  const n = useMemo(() => {
    let c = 0;
    for (const t of libraryIndex.tracks) {
      if (t.artist === artist.name && favorites.has(t.relPath)) c += 1;
    }
    return c;
  }, [artist.name, libraryIndex.tracks, favorites]);
  return (
    <div
      className="lib-meta-badges lib-meta-badges--tight"
      aria-label={t("library.favoritesAria")}
    >
      <span
        className={`lib-meta-chip lib-meta-chip--fav lib-meta-chip--ico${
          n > 0 ? " lib-meta-chip--on" : ""
        }`}
        title={
          n > 0
            ? n === 1
              ? t("library.oneFavTrackArtist")
              : t("library.nFavTracksArtist", { n })
            : t("library.noFavArtist")
        }
      >
        <UiFavorite className="lib-meta-chip__ico" />
        {n > 0 ? n : ""}
      </span>
    </div>
  );
}

export function LibraryAlbumFavoriteChips({
  album,
  variant = "card",
}: {
  album: LibraryAlbumIndex;
  variant?: "card" | "hero";
}) {
  const { t } = useI18n();
  const { favorites } = useUserState();
  const n = useMemo(
    () => album.tracks.filter((rel) => favorites.has(rel)).length,
    [album.tracks, favorites]
  );
  const wrap =
    variant === "hero"
      ? "lib-meta-badges lib-meta-badges--hero"
      : "lib-meta-badges lib-meta-badges--tight";
  return (
    <div className={wrap} aria-label={t("library.favoritesAria")}>
      <span
        className={`lib-meta-chip lib-meta-chip--fav lib-meta-chip--ico${
          n > 0 ? " lib-meta-chip--on" : ""
        }`}
        title={
          n > 0
            ? n === 1
              ? t("library.oneFavTrackAlbum")
              : t("library.nFavTracksAlbum", { n })
            : t("library.noFavAlbum")
        }
      >
        <UiFavorite className="lib-meta-chip__ico" />
        {n > 0 ? n : ""}
      </span>
    </div>
  );
}

export function LibraryAlbumExcludeChips({
  album,
  variant = "card",
}: {
  album: LibraryAlbumIndex;
  variant?: "card" | "hero";
}) {
  const { t } = useI18n();
  const user = useUserState();
  const excludedAlbums = useMemo(
    () => new Set(user.state.shuffleExcludedAlbumIds),
    [user.state.shuffleExcludedAlbumIds]
  );
  const excludedTracks = useMemo(
    () => new Set(user.state.shuffleExcludedTrackRelPaths),
    [user.state.shuffleExcludedTrackRelPaths]
  );
  const key = albumExclusionKey(album);
  const fullAl = excludedAlbums.has(key);
  const nTrIndiv = album.tracks.filter((rel) => excludedTracks.has(rel)).length;
  const nTrackBlocked = fullAl ? album.tracks.length : nTrIndiv;
  const wrap =
    variant === "hero"
      ? "lib-meta-badges lib-meta-badges--hero"
      : "lib-meta-badges lib-meta-badges--tight";
  return (
    <div className={wrap} aria-label={t("library.randomExcludeAria")}>
      <span
        className={`lib-meta-chip lib-meta-chip--exclude${
          fullAl ? " lib-meta-chip--on" : ""
        }`}
        title={
          fullAl
            ? t("library.albumExcludedFull")
            : t("library.albumNotExcludedFull")
        }
      >
        R
      </span>
      <span
        className={`lib-meta-chip lib-meta-chip--exclude${
          nTrackBlocked > 0 ? " lib-meta-chip--on" : ""
        }`}
        title={
          nTrackBlocked > 0
            ? fullAl
              ? t("library.nTracksBlockedByAlbumExclusion", {
                  n: nTrackBlocked,
                })
              : t("library.nTracksExcludedAlbum", { n: nTrIndiv })
            : t("library.noTracksExcludedAlbum")
        }
      >
        <ExcludeShuffleIcon className="lib-meta-chip__exclude-icon" />
        {nTrackBlocked > 0 ? nTrackBlocked : null}
      </span>
    </div>
  );
}

export function DraggableBadgeCluster({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const dragRef = useRef({
    active: false,
    pointerId: -1,
    startX: 0,
    scrollLeft: 0,
    moved: false,
  });

  const finishDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    const drag = dragRef.current;
    if (el && drag.active) {
      try {
        el.releasePointerCapture(drag.pointerId);
      } catch {
        /* pointer already released */
      }
      el.classList.remove("is-dragging");
    }
    dragRef.current = { ...drag, active: false, pointerId: -1 };
    event.stopPropagation();
  };

  return (
    <div
      ref={ref}
      className="lib-badge-cluster lib-badge-cluster--card-foot"
      onClickCapture={(event) => {
        if (!dragRef.current.moved) return;
        dragRef.current.moved = false;
        event.preventDefault();
        event.stopPropagation();
      }}
      onPointerDown={(event) => {
        const el = ref.current;
        if (!el || el.scrollWidth <= el.clientWidth) return;
        if (event.pointerType === "mouse" && event.button !== 0) return;
        dragRef.current = {
          active: true,
          pointerId: event.pointerId,
          startX: event.clientX,
          scrollLeft: el.scrollLeft,
          moved: false,
        };
        el.setPointerCapture(event.pointerId);
        el.classList.add("is-dragging");
        event.stopPropagation();
      }}
      onPointerMove={(event) => {
        const el = ref.current;
        const drag = dragRef.current;
        if (!el || !drag.active || drag.pointerId !== event.pointerId) return;
        const delta = event.clientX - drag.startX;
        if (Math.abs(delta) > 3) drag.moved = true;
        el.scrollLeft = drag.scrollLeft - delta;
        if (drag.moved) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      onLostPointerCapture={() => {
        const el = ref.current;
        el?.classList.remove("is-dragging");
        dragRef.current = {
          ...dragRef.current,
          active: false,
          pointerId: -1,
        };
      }}
    >
      {children}
    </div>
  );
}
