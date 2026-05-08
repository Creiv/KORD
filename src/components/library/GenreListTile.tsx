import { memo, useState } from "react";
import {
  DraggableBadgeCluster,
  LibraryGenreExcludeChips,
  LibraryGenreFavoriteChips,
  LibraryGenreMetaChips,
} from "../AppSharedUi";
import { CoverImg } from "../CoverImg";
import { coverUrlForAlbumRelPath } from "../../lib/api";
import { useI18n } from "../../i18n/useI18n";
import type { LibraryIndex } from "../../types";

function MiniSlot({ relPath }: { relPath: string | null }) {
  const [failed, setFailed] = useState(false);
  if (!relPath || failed) {
    return (
      <div
        className="library-list-tile__genre-slot library-list-tile__genre-slot--empty"
        aria-hidden
      />
    );
  }
  return (
    <div className="library-list-tile__genre-slot">
      <CoverImg
        src={coverUrlForAlbumRelPath(relPath)}
        alt=""
        onError={() => setFailed(true)}
      />
    </div>
  );
}

export type GenreListTileProps = {
  genreKey: string;
  title: string;
  albumCount: number;
  trackCount: number;
  albumSlots: (string | null)[];
  index: LibraryIndex;
  muted?: boolean;
  onOpen: () => void;
};

export const GenreListTile = memo(function GenreListTile({
  genreKey,
  title,
  albumCount,
  trackCount,
  albumSlots,
  index: libraryIndex,
  muted,
  onOpen,
}: GenreListTileProps) {
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
      className={`library-list-tile library-list-tile--genre${
        muted ? " library-list-tile--genre-muted" : ""
      }`}
      onClick={onOpen}
    >
      <div className="library-list-tile__genre-quad" aria-hidden>
        {slots.map((rel, i) => (
          <MiniSlot key={`${genreKey}-${i}`} relPath={rel} />
        ))}
      </div>
      <div className="library-list-tile__body">
        <div className="library-list-tile__title">{title}</div>
        <div className="library-list-tile__meta">
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
