import { memo } from "react";
import type { LibraryAlbumIndex } from "../../types";
import {
  AlbumCardTracksMetaLine,
  AlbumCover,
  DraggableBadgeCluster,
  LibraryAlbumExcludeChips,
  LibraryAlbumFavoriteChips,
  LibraryAlbumMetaChips,
} from "../AppSharedUi";
import { UiAlbumIcon } from "../RekordUiIcons";

export type AlbumListTileProps = {
  album: LibraryAlbumIndex;
  onOpen: () => void;
  showArtistLine?: boolean;
};

export const AlbumListTile = memo(function AlbumListTile({
  album,
  onOpen,
  showArtistLine = false,
}: AlbumListTileProps) {
  return (
    <button
      type="button"
      className="library-list-tile library-list-tile--album"
      onClick={onOpen}
    >
      <div className="library-list-tile__album-wrap">
        <AlbumCover album={album} compact />
      </div>
      <div className="library-list-tile__body">
        <div className="library-list-tile__title-row">
          <UiAlbumIcon className="library-list-tile__kind-ic" aria-hidden />
          <div className="library-list-tile__title">{album.name}</div>
        </div>
        {showArtistLine ? (
          <div className="library-list-tile__meta">{album.artist}</div>
        ) : null}
        <div className="library-list-tile__tracks-meta">
          <AlbumCardTracksMetaLine album={album} />
        </div>
        <DraggableBadgeCluster>
          <LibraryAlbumMetaChips album={album} />
          <LibraryAlbumFavoriteChips album={album} />
          <LibraryAlbumExcludeChips album={album} />
        </DraggableBadgeCluster>
      </div>
    </button>
  );
});
