import { memo, useState } from "react";
import { CoverImg } from "../CoverImg";
import {
  DraggableBadgeCluster,
  LibraryGenreExcludeChips,
  LibraryGenreFavoriteChips,
  LibraryGenreMetaChips,
} from "../AppSharedUi";
import { coverUrlForAlbumRelPath } from "../../lib/api";
import { useI18n } from "../../i18n/useI18n";
import type { LibraryIndex } from "../../types";
import styles from "./GenreCard.module.css";

function GenreCoverSlot({ relPath }: { relPath: string | null }) {
  const [failed, setFailed] = useState(false);
  if (!relPath || failed) {
    return (
      <div
        className={`${styles.slot} ${styles.slotEmpty}`}
        aria-hidden
      />
    );
  }
  return (
    <div className={styles.slot}>
      <CoverImg
        src={coverUrlForAlbumRelPath(relPath)}
        alt=""
        onError={() => setFailed(true)}
      />
    </div>
  );
}

interface GenreCardProps {
  genreKey: string;
  title: string;
  albumCount: number;
  trackCount: number;
  albumSlots: (string | null)[];
  index: LibraryIndex;
  muted?: boolean;
  onOpen: () => void;
}

export const GenreCard = memo(function GenreCard({
  genreKey,
  title,
  albumCount,
  trackCount,
  albumSlots,
  index: libraryIndex,
  muted,
  onOpen,
}: GenreCardProps) {
  const { t } = useI18n();
  const quad = [...albumSlots];
  while (quad.length < 4) quad.push(null);
  const slots = quad.slice(0, 4) as (string | null)[];
  const aU =
    albumCount === 1 ? t("library.unitAlbum") : t("library.unitAlbumPlural");
  const trU =
    trackCount === 1 ? t("library.unitTrack") : t("library.unitTrackPlural");

  return (
    <button
      type="button"
      className={`artist-card${muted ? " artist-card--genre-muted" : ""}`}
      onClick={onOpen}
    >
      <div className="genre-quad" aria-hidden>
        {slots.map((rel, i) => (
          <GenreCoverSlot key={`${genreKey}-${i}`} relPath={rel} />
        ))}
      </div>
      <div className="artist-card__text">
        <div className="artist-card__title">{title}</div>
        <div className="artist-card__meta">
          {albumCount} {aU} · {trackCount} {trU}
        </div>
        <DraggableBadgeCluster>
          <LibraryGenreMetaChips genreKey={genreKey} index={libraryIndex} />
          <LibraryGenreFavoriteChips genreKey={genreKey} index={libraryIndex} />
          <LibraryGenreExcludeChips genreKey={genreKey} index={libraryIndex} />
        </DraggableBadgeCluster>
      </div>
    </button>
  );
});
