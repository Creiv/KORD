import { memo, useMemo } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { usePlayer } from "../../context/PlayerContext";
import { useUserState } from "../../context/UserStateContext";
import { useI18n } from "../../i18n/useI18n";
import { PlayerBarTrackArt } from "../AppSharedUi";
import { PlayerProgressTrack } from "../PlayerProgressTrack";
import { ExcludeShuffleIcon } from "../ExcludeShuffleIcon";
import {
  UiFavorite,
  UiMusicNote,
  UiPause,
  UiPlayArrow,
  UiRepeat,
  UiShuffle,
  UiSkipNext,
  UiSkipPrevious,
} from "../KordUiIcons";
import { isTrackAlbumShuffleExcluded } from "../../lib/randomExclusions";
import { formatDuration } from "../../lib/duration";
import type { LibraryTrackIndex } from "../../types";

interface PlayerDockProps {
  onGoToAscolta: () => void;
  onOpenLibraryArtist: (artist: string) => void;
  onOpenLibraryAlbum: (artist: string, album: string) => void;
}

export const PlayerDock = memo(function PlayerDock({
  onGoToAscolta,
  onOpenLibraryArtist,
  onOpenLibraryAlbum,
}: PlayerDockProps) {
  const p = usePlayer();
  const user = useUserState();
  const { t } = useI18n();
  const exAlbums = useMemo(
    () => new Set(user.state.shuffleExcludedAlbumIds),
    [user.state.shuffleExcludedAlbumIds]
  );
  const exTracksSet = useMemo(
    () => new Set(user.state.shuffleExcludedTrackRelPaths),
    [user.state.shuffleExcludedTrackRelPaths]
  );
  const percent = p.duration > 0 ? (p.currentTime / p.duration) * 100 : 0;
  const cur = p.current;
  const albumShuffleExcluded = Boolean(
    cur && isTrackAlbumShuffleExcluded(cur, exAlbums)
  );
  const trackShuffleExcluded = Boolean(cur && exTracksSet.has(cur.relPath));
  const shuffleExcluded = albumShuffleExcluded || trackShuffleExcluded;

  const openListenFromTopBar = (event: ReactMouseEvent<HTMLDivElement>) => {
    const el = event.target as HTMLElement;
    if (el.closest("button, input, .player-bar2__byline, .progress2")) {
      return;
    }
    onGoToAscolta();
  };

  if (p.queue.length === 0) return null;

  return (
    <div className="player-dock2">
      <footer className="player-bar2">
        <div
          className="player-bar2__row player-bar2__row--top player-bar2__row--open-listen"
          onClick={openListenFromTopBar}
          title={t("player.openListenTitle")}
        >
          <div className="player-bar2__identity">
            <div className="player-bar2__track">
              <div className="player-bar2__art-hit">
                {cur ? (
                  <PlayerBarTrackArt
                    relPath={cur.relPath}
                    version={(cur as LibraryTrackIndex).updatedAt}
                  />
                ) : (
                  <div className="player-bar2__art fallback">
                    <UiMusicNote className="player-bar2__art-fallback-ic" />
                  </div>
                )}
              </div>
              <div className="player-bar2__meta">
                <div className="player-bar2__title-line">
                  <strong>{cur?.title || t("player.pickTrack")}</strong>
                </div>
                {cur ? (
                  <div className="player-bar2__byline">
                    <button
                      type="button"
                      className="player-bar2__crumb"
                      title={t("player.openArtistLibTitle")}
                      onClick={() => onOpenLibraryArtist(cur.artist)}
                    >
                      {cur.artist}
                    </button>
                    <span className="player-bar2__byline-sep" aria-hidden>
                      {" "}
                      ·{" "}
                    </span>
                    <button
                      type="button"
                      className="player-bar2__crumb"
                      title={t("player.openAlbumLibTitle")}
                      onClick={() =>
                        onOpenLibraryAlbum(cur.artist, cur.album)
                      }
                    >
                      {cur.album}
                    </button>
                  </div>
                ) : (
                  <span className="player-bar2__byline player-bar2__byline--idle">
                    {t("player.playerReady")}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div
            className="player-bar2__transport"
            role="group"
            aria-label={t("player.transportAria")}
          >
            {cur ? (
              <button
                type="button"
                className={`player-bar2__fav player-bar2__rail-fav ${
                  user.isFavorite(cur.relPath) ? "is-on" : ""
                }`}
                onClick={() => user.toggleFavorite(cur.relPath)}
                title={t("trackRow.favTitle")}
                aria-pressed={user.isFavorite(cur.relPath)}
                aria-label={t("trackRow.favAria")}
              >
                <span
                  className="player-bar2__ic-glyph player-bar2__ic-glyph--svg"
                  aria-hidden
                >
                  <UiFavorite />
                </span>
              </button>
            ) : null}
            <div className="player-bar2__controls">
              <button
                type="button"
                className={`player-bar2__ic player-bar2__ic--repeat ${
                  p.repeat === "off" ? "is-dim" : "is-on"
                } ${p.repeat === "one" ? "player-bar2__ic--repeat-one" : ""}`}
                onClick={() =>
                  p.setRepeat(
                    p.repeat === "off"
                      ? "all"
                      : p.repeat === "all"
                      ? "one"
                      : "off"
                  )
                }
                title={
                  p.repeat === "off"
                    ? t("player.repeatOff")
                    : p.repeat === "all"
                    ? t("player.repeatAll")
                    : t("player.repeatOne")
                }
              >
                <span
                  className="player-bar2__ic-glyph player-bar2__ic-glyph--svg"
                  aria-hidden
                >
                  <UiRepeat />
                </span>
              </button>
              <button
                type="button"
                className="player-bar2__ic"
                onClick={() => p.prev()}
                title={t("player.prevTitle")}
              >
                <span
                  className="player-bar2__ic-glyph player-bar2__ic-glyph--svg"
                  aria-hidden
                >
                  <UiSkipPrevious />
                </span>
              </button>
              <button
                type="button"
                className="player-bar2__ic player-bar2__ic--play"
                onClick={() => p.toggle()}
                title={
                  p.isPlaying
                    ? t("player.pauseTitle")
                    : t("player.playTitle")
                }
              >
                <span
                  className="player-bar2__ic-glyph player-bar2__ic-glyph--svg"
                  aria-hidden
                >
                  {p.isPlaying ? <UiPause /> : <UiPlayArrow />}
                </span>
              </button>
              <button
                type="button"
                className="player-bar2__ic"
                onClick={() => p.next()}
                title={t("player.nextTitle")}
              >
                <span
                  className="player-bar2__ic-glyph player-bar2__ic-glyph--svg"
                  aria-hidden
                >
                  <UiSkipNext />
                </span>
              </button>
              <button
                type="button"
                className={`player-bar2__ic ${p.shuffle ? "is-on" : ""}`}
                onClick={() => p.setShuffle(!p.shuffle)}
                title={t("player.shuffleTitle")}
                aria-pressed={p.shuffle}
              >
                <span
                  className="player-bar2__ic-glyph player-bar2__ic-glyph--svg"
                  aria-hidden
                >
                  <UiShuffle />
                </span>
              </button>
            </div>
            {cur ? (
              <button
                type="button"
                className={`player-bar2__ic player-bar2__ic--exclude ${
                  shuffleExcluded ? "is-on" : ""
                }`}
                disabled={albumShuffleExcluded}
                title={
                  albumShuffleExcluded
                    ? t("trackRow.excludeLockedByAlbumTitle")
                    : t("trackRow.excludeTitle")
                }
                aria-pressed={shuffleExcluded}
                aria-label={
                  albumShuffleExcluded
                    ? t("trackRow.excludeLockedByAlbumAria")
                    : t("trackRow.excludeTitle")
                }
                onClick={() => {
                  if (!cur || albumShuffleExcluded) return;
                  user.toggleShuffleExcludedTrack(cur.relPath);
                }}
              >
                <span
                  className="player-bar2__ic-glyph player-bar2__ic-glyph--svg"
                  aria-hidden
                >
                  <ExcludeShuffleIcon />
                </span>
              </button>
            ) : null}
          </div>
        </div>
        <div className="player-bar2__row player-bar2__row--seek">
          <div className="player-bar2__timeline">
            <PlayerProgressTrack percent={percent} seekRatio={p.seekRatio} />
            <div className="player-bar2__times">
              <span>{formatDuration(p.currentTime)}</span>
              <span>{formatDuration(p.duration)}</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
});
