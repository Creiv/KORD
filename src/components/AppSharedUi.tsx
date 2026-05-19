import {
  Children,
  cloneElement,
  isValidElement,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
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
import { useMatchMedia } from "../hooks/useMatchMedia";
import { MOBILE_LAYOUT_MQ } from "../lib/breakpoints";
import {
  popoverPlacementStyle,
  usePopoverLayerAnchored,
  type PopoverLayerOptions,
} from "../hooks/usePopoverLayerAnchored";
import {
  UiAdd,
  UiFavorite,
  UiLyrics,
  UiMoreVert,
  UiMusicNote,
  UiPlayArrow,
  UiQueueMusic,
  UiRemove,
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

function TrackRowArtPlay({
  relPath,
  onPlay,
}: {
  relPath: string;
  onPlay: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="track-row__art-wrap">
      <TrackRowArt relPath={relPath} />
      <button
        type="button"
        className="track-row__art-play"
        onClick={(event) => {
          event.stopPropagation();
          onPlay();
        }}
        title={t("player.playTitle")}
        aria-label={t("player.playTitle")}
      >
        <UiPlayArrow />
      </button>
    </div>
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

/** Su mobile compatto `extraActions` non sono inline; voci equivalenti nel menu ⋯ */
function trackRowExtraActionsAsOverflowItems(
  extraActions: ReactNode | undefined,
  close: () => void
): ReactNode {
  if (extraActions == null) return null;
  const els = Children.toArray(extraActions).filter(
    (
      n
    ): n is ReactElement<
      ButtonHTMLAttributes<HTMLButtonElement> & { title?: unknown }
    > => isValidElement(n)
  );
  return els.map((el, i) => {
    const p = el.props;
    const labelFromTitle =
      typeof p.title === "string" && p.title.trim().length > 0
        ? p.title.trim()
        : "";
    const labelFromAria =
      typeof p["aria-label"] === "string" &&
      p["aria-label"].trim().length > 0
        ? p["aria-label"].trim()
        : "";
    const menuLabel = labelFromTitle || labelFromAria;
    const prevClass =
      typeof p.className === "string" ? p.className.trim() : "";
    const mergedClass = `${prevClass} track-row__overflow-item`.trim();
    const origClick = p.onClick;
    return (
      <li role="presentation" key={el.key ?? `tr-ex-${i}`}>
        {cloneElement(el, {
          role: "menuitem",
          type: "button",
          className: mergedClass,
          onClick: (ev: ReactMouseEvent<HTMLButtonElement>) => {
            origClick?.(ev);
            if (!ev.defaultPrevented) close();
          },
          children: (
            <>
              <span
                className="track-row__overflow-item-glyph track-row__ic-glyph--svg"
                aria-hidden
              >
                {p.children}
              </span>
              {menuLabel ? (
                <span className="track-row__overflow-item-label">
                  {menuLabel}
                </span>
              ) : null}
            </>
          ),
        })}
      </li>
    );
  });
}

const TRACK_ROW_PLAYLIST_POPOVER_OPTS: PopoverLayerOptions = {
  alignMinWidthPx: 276,
  edgeMarginPx: 8,
};

/** Pannello playlist: toggle aggiungi / rimuovi brano per ogni playlist. */
const TrackRowPlaylistPopover = memo(function TrackRowPlaylistPopover({
  track,
  open,
  onRequestClose,
  anchorRef,
}: {
  track: EnrichedTrack;
  open: boolean;
  onRequestClose: () => void;
  anchorRef: RefObject<HTMLDivElement | null>;
}) {
  const user = useUserState();
  const { t } = useI18n();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const placement = usePopoverLayerAnchored(
    open,
    anchorRef,
    onRequestClose,
    panelRef,
    TRACK_ROW_PLAYLIST_POPOVER_OPTS
  );
  const playlists = user.state.playlists;

  if (!open) return null;

  return createPortal(
    <div
      ref={panelRef}
      className="track-row__playlist-popover popover-layer-fixed"
      style={popoverPlacementStyle(placement)}
      role="dialog"
      aria-label={t("trackRow.playlistPickerAria")}
    >
      {playlists.length === 0 ? (
        <p className="track-row__playlist-popover-empty subtle sm">
          {t("trackRow.playlistPickerEmpty")}
        </p>
      ) : (
        <ul className="track-row__playlist-popover-list">
          {playlists.map((pl) => {
            const inPl = pl.tracks.some((x) => x.relPath === track.relPath);
            return (
              <li key={pl.id}>
                <button
                  type="button"
                  className={`track-row__playlist-popover-item${
                    inPl ? " is-on" : ""
                  }`}
                  title={
                    inPl
                      ? t("trackRow.playlistRemoveHint")
                      : t("trackRow.playlistAddHint")
                  }
                  aria-label={
                    inPl
                      ? t("trackRow.playlistRemoveFrom", { name: pl.name })
                      : t("trackRow.playlistAddTo", { name: pl.name })
                  }
                  onClick={() =>
                    inPl
                      ? user.removeTrackFromPlaylist(pl.id, track.relPath)
                      : user.addTrackToPlaylist(pl.id, track)
                  }
                >
                  <span className="track-row__playlist-popover-item__name">
                    {pl.name}
                  </span>
                  <span className="track-row__playlist-popover-item__state">
                    {inPl
                      ? t("trackRow.playlistInList")
                      : t("trackRow.playlistNotInList")}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>,
    document.body
  );
});

export const TrackListRow = memo(function TrackListRow({
  track,
  active,
  onPlay,
  metaRight,
  extraActions,
  showTrackBadgeRow = false,
  autoFocusActive = true,
  trackActionsMode,
}: {
  track: EnrichedTrack;
  /** If omitted, row is active when it matches the current track (`relPath`). Queue uses explicit index. */
  active?: boolean;
  onPlay: () => void;
  metaRight?: string;
  extraActions?: ReactNode;
  /** Terza riga (badge traccia/disco…): solo nella lista brani dell’album. */
  showTrackBadgeRow?: boolean;
  /** Disabilita lo scroll automatico della riga quando diventa quella attiva. */
  autoFocusActive?: boolean;
  /**
   * `album`: coda / preferiti / modifica / blocca random come pulsanti sempre visibili.
   * Omit (default): only favorites + ⋯ menu for queue / meta / shuffle block (+ extraActions).
   */
  trackActionsMode?: "album";
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
  const albumToolbar = trackActionsMode === "album";
  const isMobileRowLayout = useMatchMedia(MOBILE_LAYOUT_MQ);
  const useOverflowActions = !albumToolbar || isMobileRowLayout;
  const showInlineAlbumActions = albumToolbar && !isMobileRowLayout;
  const favInOverflowMenu = useOverflowActions;
  const excludeOverflowMenuLabel =
    albumShuffleExcluded
      ? t("trackRow.excludeTitle")
      : shuffleExcluded
      ? t("trackRow.excludeActiveTitle")
      : t("trackRow.excludeTitle");
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
  const [overflowOpen, setOverflowOpen] = useState(false);
  const overflowRef = useRef<HTMLDivElement | null>(null);
  const overflowMenuRef = useRef<HTMLUListElement | null>(null);
  const closeOverflow = useCallback(() => setOverflowOpen(false), []);
  const overflowPlacement = usePopoverLayerAnchored(
    overflowOpen,
    overflowRef,
    closeOverflow,
    overflowMenuRef
  );

  const [playlistPickerOpen, setPlaylistPickerOpen] = useState(false);
  const playlistAnchorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setOverflowOpen(false);
    setPlaylistPickerOpen(false);
  }, [track.relPath]);

  useEffect(() => {
    if (overflowOpen) setPlaylistPickerOpen(false);
  }, [overflowOpen]);

  useEffect(() => {
    if (playlistPickerOpen) setOverflowOpen(false);
  }, [playlistPickerOpen]);

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
      className={`track-row${rowActive ? " is-active" : ""}${
        albumToolbar ? " track-row--album-list" : ""
      }`}
    >
      <TrackRowArtPlay relPath={track.relPath} onPlay={onPlay} />
      <button
        type="button"
        className="track-row__main"
        onClick={onPlay}
      >
        <span className="track-row__title-row">
          <span className="track-row__title">{track.title}</span>
          <span className="track-row__stats">
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
            <span
              className={`track-row__lyrics-inline track-row__lyrics-inline--stats ${
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
        </span>
        <span className="track-row__meta">
          <span className="track-row__meta-text">
            {track.artist} · {track.album}
          </span>
          <span className="track-row__meta-sep" aria-hidden>
            {" "}
            ·{" "}
          </span>
          <span
            className={`track-row__lyrics-inline track-row__lyrics-inline--meta ${
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
      <div
        className={`track-row__actions${
          useOverflowActions ? " track-row__actions--compact-tools" : ""
        }`}
      >
        {showInlineAlbumActions ? (
          <>
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
            <div className="track-row__playlist-anchor" ref={playlistAnchorRef}>
              <button
                type="button"
                className={`track-row__ic track-row__ic--playlist${
                  playlistPickerOpen ? " is-on" : ""
                }`}
                aria-expanded={playlistPickerOpen}
                aria-haspopup="dialog"
                title={t("trackRow.playlistTitle")}
                aria-label={t("trackRow.playlistAria")}
                onClick={(ev) => {
                  ev.stopPropagation();
                  setPlaylistPickerOpen((o) => !o);
                }}
              >
                <span
                  className="track-row__ic-glyph track-row__ic-glyph--svg"
                  aria-hidden
                >
                  <UiQueueMusic />
                </span>
              </button>
            </div>
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
          </>
        ) : (
          <>
            {!favInOverflowMenu ? (
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
            ) : null}
            <div className="track-row__overflow" ref={overflowRef}>
              <button
                type="button"
                className="track-row__ic track-row__ic--overflow"
                aria-expanded={overflowOpen}
                aria-haspopup="menu"
                title={t("trackRow.overflowMenuTitle")}
                aria-label={t("trackRow.overflowMenuAria")}
                onClick={(ev) => {
                  ev.stopPropagation();
                  setOverflowOpen((o) => !o);
                }}
              >
                <span
                  className="track-row__ic-glyph track-row__ic-glyph--svg"
                  aria-hidden
                >
                  <UiMoreVert />
                </span>
              </button>
            </div>
            {overflowOpen
              ? createPortal(
                  <ul
                    ref={overflowMenuRef}
                    className="track-row__overflow-menu popover-layer-fixed"
                    role="menu"
                    style={popoverPlacementStyle(overflowPlacement)}
                  >
                    {favInOverflowMenu ? (
                      <li role="presentation">
                        <button
                          type="button"
                          role="menuitem"
                          className={`track-row__overflow-item${fav ? " is-on" : ""}`}
                          title={t("trackRow.favTitle")}
                          aria-pressed={fav}
                          aria-label={t("trackRow.favAria")}
                          onClick={() => {
                            user.toggleFavorite(track.relPath);
                            setOverflowOpen(false);
                          }}
                        >
                          <span
                            className="track-row__overflow-item-glyph track-row__ic-glyph--svg"
                            aria-hidden
                          >
                            <UiFavorite />
                          </span>
                          <span className="track-row__overflow-item-label">
                            {t("trackRow.favTitle")}
                          </span>
                        </button>
                      </li>
                    ) : null}
                    <li role="presentation">
                      {inQ ? (
                        <button
                          type="button"
                          role="menuitem"
                          className="track-row__overflow-item is-on"
                          aria-pressed
                          aria-label={t("trackRow.removeQueueAria")}
                          title={t("trackRow.removeQueueTitle")}
                          onClick={() => {
                            p.removeFromQueueByRelPath(track.relPath);
                            setOverflowOpen(false);
                          }}
                        >
                          <span
                            className="track-row__overflow-item-glyph track-row__ic-glyph--svg"
                            aria-hidden
                          >
                            <UiRemove />
                          </span>
                          <span className="track-row__overflow-item-label">
                            {t("trackRow.removeQueueTitle")}
                          </span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          role="menuitem"
                          className="track-row__overflow-item"
                          aria-label={t("trackRow.addQueueAria")}
                          title={t("trackRow.addQueueTitle")}
                          onClick={() => {
                            p.addToQueue(track);
                            setOverflowOpen(false);
                          }}
                        >
                          <span
                            className="track-row__overflow-item-glyph track-row__ic-glyph--svg"
                            aria-hidden
                          >
                            <UiAdd />
                          </span>
                          <span className="track-row__overflow-item-label">
                            {t("trackRow.addQueueTitle")}
                          </span>
                        </button>
                      )}
                    </li>
                    <li role="presentation">
                      <button
                        type="button"
                        role="menuitem"
                        className={`track-row__overflow-item${
                          playlistPickerOpen ? " is-on" : ""
                        }`}
                        aria-expanded={playlistPickerOpen}
                        aria-haspopup="dialog"
                        title={t("trackRow.playlistTitle")}
                        aria-label={t("trackRow.playlistAria")}
                        onClick={(ev) => {
                          ev.stopPropagation();
                          setOverflowOpen(false);
                          setPlaylistPickerOpen(true);
                        }}
                      >
                        <span
                          className="track-row__overflow-item-glyph track-row__ic-glyph--svg"
                          aria-hidden
                        >
                          <UiQueueMusic />
                        </span>
                        <span className="track-row__overflow-item-label">
                          {t("trackRow.playlistTitle")}
                        </span>
                      </button>
                    </li>
                    <li role="presentation">
                      <button
                        type="button"
                        role="menuitem"
                        className="track-row__overflow-item"
                        aria-label={t("trackRow.editMetaAria")}
                        title={t("trackRow.editMetaTitle")}
                        onClick={() => {
                          openTrackMetaEdit(track);
                          setOverflowOpen(false);
                        }}
                      >
                        <span
                          className="track-row__overflow-item-glyph track-row__ic-glyph--svg"
                          aria-hidden
                        >
                          <TrackMetaEditGlyph />
                        </span>
                        <span className="track-row__overflow-item-label">
                          {t("trackRow.overflowEdit")}
                        </span>
                      </button>
                    </li>
                    <li role="presentation">
                      <button
                        type="button"
                        role="menuitem"
                        className={`track-row__overflow-item${
                          shuffleExcluded ? " is-on" : ""
                        }`}
                        disabled={albumShuffleExcluded}
                        aria-label={
                          albumShuffleExcluded
                            ? t("trackRow.excludeLockedByAlbumAria")
                            : shuffleExcluded
                            ? t("trackRow.excludeActiveTitle")
                            : t("trackRow.excludeTitle")
                        }
                        title={
                          albumShuffleExcluded
                            ? t("trackRow.excludeLockedByAlbumTitle")
                            : shuffleExcluded
                            ? t("trackRow.excludeActiveTitle")
                            : t("trackRow.excludeTitle")
                        }
                        onClick={() => {
                          if (albumShuffleExcluded) return;
                          user.toggleShuffleExcludedTrack(track.relPath);
                          setOverflowOpen(false);
                        }}
                      >
                        <span
                          className="track-row__overflow-item-glyph track-row__ic-glyph--svg"
                          aria-hidden
                        >
                          <ExcludeShuffleIcon />
                        </span>
                        <span className="track-row__overflow-item-label">
                          {excludeOverflowMenuLabel}
                        </span>
                      </button>
                    </li>
                    {trackRowExtraActionsAsOverflowItems(
                      favInOverflowMenu ? extraActions : undefined,
                      () => setOverflowOpen(false)
                    )}
                  </ul>,
                  document.body
                )
              : null}
            {favInOverflowMenu ? null : extraActions}
          </>
        )}
      </div>
      <TrackRowPlaylistPopover
        anchorRef={showInlineAlbumActions ? playlistAnchorRef : overflowRef}
        open={playlistPickerOpen}
        track={track}
        onRequestClose={() => setPlaylistPickerOpen(false)}
      />
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
