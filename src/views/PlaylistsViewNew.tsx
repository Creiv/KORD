import { useMemo, useState } from "react";
import { usePlayer } from "../context/PlayerContext";
import { useUserState } from "../context/UserStateContext";
import { useAppConfirm } from "../context/AppConfirmContext";
import { useI18n } from "../i18n/useI18n";
import { SectionHeadLead } from "../components/SectionHeadLead";
import { TrackListRow } from "../components/AppSharedUi";
import { UiClose, UiQueueMusic } from "../components/KordUiIcons";
import type { EnrichedTrack, LibraryIndex, UserPlaylist } from "../types";

function enrichedFromPlaylistItem(
  tr: UserPlaylist["tracks"][number],
  byPath: Map<string, EnrichedTrack> | null
): EnrichedTrack {
  const full = byPath?.get(tr.relPath);
  if (full) return full;
  return {
    id: tr.relPath,
    relPath: tr.relPath,
    title: tr.title,
    artist: tr.artist,
    album: tr.album,
  } as EnrichedTrack;
}

function playlistToEnrichedList(
  playlist: UserPlaylist,
  byPath: Map<string, EnrichedTrack> | null
) {
  return playlist.tracks.map((tr) => enrichedFromPlaylistItem(tr, byPath));
}

function PlaylistsViewNew({
  route,
  index,
  onPickPlaylist,
}: {
  route: { playlist: string | null };
  index: LibraryIndex | null;
  onPickPlaylist: (playlist: string | null) => void;
}) {
  const p = usePlayer();
  const user = useUserState();
  const { t } = useI18n();
  const { confirm: appConfirm } = useAppConfirm();
  const [name, setName] = useState("");
  const trackByPath = useMemo(
    () =>
      index
        ? new Map(index.tracks.map((t) => [t.relPath, t as EnrichedTrack]))
        : null,
    [index]
  );
  const playlists = user.state.playlists;
  const activePlaylist =
    playlists.find(
      (item) => item.id === (route.playlist || user.selectedPlaylist || "")
    ) || null;

  return (
    <div className="view-page playlists-page">
      <header className="view-page__toolbar-band">
      <section className="surface-card surface-card--toolbar-only">
        <div className="section-head section-head--page-toolbar page-toolbar">
          <SectionHeadLead
            eyebrow={t("playlists.eyebrow")}
            title={t("playlists.heading")}
            icon={<UiQueueMusic className="section-head__ic" />}
          />
          <div className="section-head__tools page-toolbar__actions">
            <div className="hero-card__actions queue-hero-actions">
              <input
                className="ghost-input queue-name-input"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t("playlists.newPh")}
                aria-label={t("playlists.newPh")}
              />
              <button
                type="button"
                className="primary-btn"
                onClick={() => user.createPlaylist(name)}
              >
                {t("playlists.create")}
              </button>
            </div>
          </div>
        </div>
      </section>
      </header>

      <section className="playlists-page__main">
        <div className="view-stack">
          <section className="surface-card">
            <div className="list-stack">
              {playlists.map((playlist) => (
                <div
                  key={playlist.id}
                  className={`playlist-row ${
                    activePlaylist?.id === playlist.id ? "is-active" : ""
                  }`}
                >
                  <button
                    type="button"
                    className="playlist-row__main"
                    onClick={() => onPickPlaylist(playlist.id)}
                  >
                    <strong>{playlist.name}</strong>
                    <span>
                      {t("playlists.trackCount", { n: playlist.tracks.length })}
                    </span>
                  </button>
                  <div className="track-row__actions">
                    <button
                      type="button"
                      className="chip-btn"
                      disabled={!playlist.tracks.length}
                      onClick={() => {
                        const queue = playlistToEnrichedList(
                          playlist,
                          trackByPath
                        );
                        if (queue[0]) p.playTrack(queue[0], queue, 0);
                      }}
                    >
                      {t("playlists.play")}
                    </button>
                    <button
                      type="button"
                      className="chip-btn"
                      onClick={() =>
                        p.current &&
                        user.addTrackToPlaylist(playlist.id, p.current)
                      }
                    >
                      {t("playlists.addCurrent")}
                    </button>
                    <button
                      type="button"
                      className="chip-btn danger"
                      onClick={() =>
                        void (async () => {
                          const ok = await appConfirm({
                            message: t("playlists.deleteConfirm", {
                              name: playlist.name,
                            }),
                            variant: "danger",
                          });
                          if (ok) user.deletePlaylist(playlist.id);
                        })()
                      }
                    >
                      {t("playlists.delete")}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="view-stack">
          {activePlaylist ? (
            <>
              <section className="surface-card surface-card--toolbar-only">
                <div className="section-head section-head--page-toolbar">
                  <SectionHeadLead
                    eyebrow={t("playlists.detailEyebrow")}
                    title={activePlaylist.name}
                    icon={<UiQueueMusic className="section-head__ic" />}
                  />
                  <div className="section-head__tools page-toolbar__actions">
                    <input
                      key={`rename-${activePlaylist.id}-${activePlaylist.name}`}
                      className="ghost-input compact playlist-rename-input"
                      defaultValue={activePlaylist.name}
                      onBlur={(event) =>
                        user.renamePlaylist(
                          activePlaylist.id,
                          event.target.value
                        )
                      }
                      aria-label={t("playlists.renameAria")}
                    />
                  </div>
                </div>
              </section>
              <section className="surface-card">
                {activePlaylist.tracks.length === 0 ? (
                  <p className="panel-empty">{t("playlists.detailEmpty")}</p>
                ) : (
                  <div className="list-stack">
                    {activePlaylist.tracks.map((track, index) => {
                      const enriched = enrichedFromPlaylistItem(
                        track,
                        trackByPath
                      );
                      return (
                        <TrackListRow
                          key={`${track.relPath}-${index}`}
                          track={enriched}
                          onPlay={() => {
                            const queue = playlistToEnrichedList(
                              activePlaylist,
                              trackByPath
                            );
                            p.playTrack(queue[index], queue, index);
                          }}
                          extraActions={
                            <button
                              type="button"
                              className="track-row__ic track-row__ic--danger"
                              title={t("playlists.removeFromPlTitle")}
                              aria-label={t("playlists.removeFromPlAria")}
                              onClick={() =>
                                user.removeTrackFromPlaylist(
                                  activePlaylist.id,
                                  track.relPath
                                )
                              }
                            >
                              <span
                                className="track-row__ic-glyph track-row__ic-glyph--svg"
                                aria-hidden
                              >
                                <UiClose />
                              </span>
                            </button>
                          }
                        />
                      );
                    })}
                  </div>
                )}
              </section>
            </>
          ) : (
            <section className="surface-card">
              <p className="panel-empty">{t("playlists.pickOne")}</p>
            </section>
          )}
        </div>
      </section>
    </div>
  );
}


export default PlaylistsViewNew;
