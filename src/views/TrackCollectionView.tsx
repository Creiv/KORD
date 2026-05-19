import type { ReactNode } from "react";
import { useI18n } from "../i18n/useI18n";
import { useLibraryCardPlayback } from "../hooks/useLibraryCardPlayback";
import { SectionHeadLead } from "../components/SectionHeadLead";
import { TrackListRow } from "../components/AppSharedUi";
import type { EnrichedTrack } from "../types";

function TrackCollectionView({
  title,
  eyebrow,
  tracks,
  libraryTracks,
  playAllLabel,
  onPlayAll,
  leadIcon,
}: {
  title: string;
  eyebrow: string;
  tracks: EnrichedTrack[];
  libraryTracks?: readonly EnrichedTrack[];
  playAllLabel?: string;
  onPlayAll?: () => void;
  leadIcon?: ReactNode;
}) {
  const { t } = useI18n();
  const playFromLibraryCard = useLibraryCardPlayback(libraryTracks);
  return (
    <div className="view-page view-page--split collection-page">
      <header className="view-page__toolbar-band">
      <section className="surface-card surface-card--toolbar-only">
        <div className="section-head section-head--page-toolbar">
          <SectionHeadLead eyebrow={eyebrow} title={title} icon={leadIcon} />
          {playAllLabel && onPlayAll && tracks.length > 0 ? (
            <button
              type="button"
              className="primary-btn btn--collection-play"
              onClick={onPlayAll}
            >
              {playAllLabel}
            </button>
          ) : null}
        </div>
      </section>
      </header>
      <section className="surface-card collection-page__list view-page__body">
        {tracks.length === 0 ? (
          <p className="panel-empty">{t("collection.empty")}</p>
        ) : (
          <div className="list-stack">
            {tracks.map((track, index) => (
              <TrackListRow
                key={`${track.relPath}-${index}`}
                track={track}
                onPlay={() => playFromLibraryCard(track)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}


export default TrackCollectionView;
