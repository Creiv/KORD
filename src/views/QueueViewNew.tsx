import { useState } from "react";
import { usePlayer } from "../context/PlayerContext";
import { useUserState } from "../context/UserStateContext";
import { useI18n } from "../i18n/useI18n";
import { SectionHeadLead } from "../components/SectionHeadLead";
import { TrackListRow } from "../components/AppSharedUi";
import {
  UiKeyboardArrowDown,
  UiKeyboardArrowUp,
  UiNavList,
} from "../components/KordUiIcons";

function QueueViewNew({
  onOpenSavedPlaylist,
}: {
  onOpenSavedPlaylist: (playlistId: string) => void;
}) {
  const p = usePlayer();
  const user = useUserState();
  const { t } = useI18n();
  const [queueName, setQueueName] = useState("");
  return (
    <div className="view-stack">
      <section className="surface-card surface-card--toolbar-only">
        <div className="section-head section-head--page-toolbar">
          <SectionHeadLead
            eyebrow={t("queue.eyebrow")}
            title={t("queue.heading", { n: p.queue.length })}
            icon={<UiNavList className="section-head__ic" />}
          />
          <div className="section-head__tools">
            <div className="hero-card__actions queue-hero-actions">
              <input
                className="ghost-input queue-name-input"
                value={queueName}
                onChange={(event) => setQueueName(event.target.value)}
                placeholder={t("queue.playlistNamePh")}
              />
              <button
                type="button"
                className="primary-btn"
                disabled={!p.queue.length}
                onClick={() => {
                  const id = user.saveQueueAsPlaylist(queueName, p.queue);
                  onOpenSavedPlaylist(id);
                }}
              >
                {t("queue.savePlaylist")}
              </button>
              <button
                type="button"
                className="ghost-btn danger"
                disabled={!p.queue.length}
                onClick={() => p.clearQueue()}
              >
                {t("queue.clear")}
              </button>
            </div>
          </div>
        </div>
      </section>
      <section className="surface-card">
        {p.queue.length === 0 ? (
          <p className="panel-empty">{t("queue.empty")}</p>
        ) : (
          <div className="list-stack">
            {p.queue.map((track, index) => (
              <TrackListRow
                key={`${track.relPath}-${index}`}
                track={track}
                listIndex={index + 1}
                active={index === p.currentIndex}
                onPlay={() => p.playTrack(track, p.queue, index)}
                extraActions={
                  <>
                    <button
                      type="button"
                      className="track-row__ic"
                      onClick={() =>
                        p.moveQueueItem(index, Math.max(index - 1, 0))
                      }
                      title={t("queue.moveUpTitle")}
                      aria-label={t("queue.moveUpAria")}
                    >
                      <span
                        className="track-row__ic-glyph track-row__ic-glyph--svg"
                        aria-hidden
                      >
                        <UiKeyboardArrowUp />
                      </span>
                    </button>
                    <button
                      type="button"
                      className="track-row__ic"
                      onClick={() =>
                        p.moveQueueItem(
                          index,
                          Math.min(index + 1, p.queue.length - 1)
                        )
                      }
                      title={t("queue.moveDownTitle")}
                      aria-label={t("queue.moveDownAria")}
                    >
                      <span
                        className="track-row__ic-glyph track-row__ic-glyph--svg"
                        aria-hidden
                      >
                        <UiKeyboardArrowDown />
                      </span>
                    </button>
                  </>
                }
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}


export default QueueViewNew;
