import { memo } from "react";
import { CoverImg } from "../CoverImg";
import {
  DraggableBadgeCluster,
  LibraryArtistExcludeChips,
  LibraryArtistFavoriteChips,
  LibraryArtistMetaChips,
} from "../AppSharedUi";
import { UiPerson } from "../KordUiIcons";
import { initials } from "../../lib/initials";
import { useI18n } from "../../i18n/useI18n";
import type { LibraryArtistIndex, LibraryIndex } from "../../types";

export type ArtistListTileProps = {
  artist: LibraryArtistIndex;
  albumCount: number;
  coverAlbumRelPath?: string | null;
  index: LibraryIndex;
  onOpen: () => void;
};

export const ArtistListTile = memo(function ArtistListTile({
  artist,
  albumCount,
  coverAlbumRelPath,
  index: libraryIndex,
  onOpen,
}: ArtistListTileProps) {
  const { t } = useI18n();
  const aU =
    albumCount === 1 ? t("library.unitAlbum") : t("library.unitAlbumPlural");
  const trU =
    artist.trackCount === 1
      ? t("library.unitTrack")
      : t("library.unitTrackPlural");

  return (
    <button
      type="button"
      className="library-list-tile library-list-tile--artist"
      onClick={onOpen}
    >
      <div className="library-list-tile__media">
        {coverAlbumRelPath ? (
          <CoverImg
            className="library-list-tile__cover"
            preset="tile"
            coverPath={coverAlbumRelPath}
            alt=""
            fallbackClassName="library-list-tile__badge"
            fallback={initials(artist.name)}
          />
        ) : (
          <div className="library-list-tile__badge">{initials(artist.name)}</div>
        )}
      </div>
      <div className="library-list-tile__body">
        <div className="library-list-tile__title-row">
          <UiPerson className="library-list-tile__kind-ic" aria-hidden />
          <div className="library-list-tile__title">{artist.name}</div>
        </div>
        <div className="library-list-tile__meta">
          {albumCount} {aU} · {artist.trackCount} {trU}
        </div>
        <DraggableBadgeCluster>
          <LibraryArtistMetaChips artist={artist} />
          <LibraryArtistFavoriteChips artist={artist} index={libraryIndex} />
          <LibraryArtistExcludeChips artist={artist} index={libraryIndex} />
        </DraggableBadgeCluster>
      </div>
    </button>
  );
});
