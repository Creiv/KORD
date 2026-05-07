import { memo } from "react";
import { CoverImg } from "../CoverImg";
import {
  DraggableBadgeCluster,
  LibraryArtistExcludeChips,
  LibraryArtistFavoriteChips,
  LibraryArtistMetaChips,
} from "../AppSharedUi";
import { coverUrlForAlbumRelPath } from "../../lib/api";
import { initials } from "../../lib/initials";
import { useI18n } from "../../i18n/useI18n";
import type { LibraryArtistIndex, LibraryIndex } from "../../types";

interface ArtistCardProps {
  artist: LibraryArtistIndex;
  albumCount: number;
  coverAlbumRelPath?: string | null;
  index: LibraryIndex;
  onOpen: () => void;
}

export const ArtistCard = memo(function ArtistCard({
  artist,
  albumCount,
  coverAlbumRelPath,
  index: libraryIndex,
  onOpen,
}: ArtistCardProps) {
  const { t } = useI18n();
  const aU =
    albumCount === 1 ? t("library.unitAlbum") : t("library.unitAlbumPlural");
  const trU =
    artist.trackCount === 1
      ? t("library.unitTrack")
      : t("library.unitTrackPlural");

  return (
    <button type="button" className="artist-card" onClick={onOpen}>
      {coverAlbumRelPath ? (
        <CoverImg
          className="artist-card__cover"
          src={coverUrlForAlbumRelPath(coverAlbumRelPath)}
          alt=""
          fallbackClassName="artist-card__badge"
          fallback={initials(artist.name)}
        />
      ) : (
        <div className="artist-card__badge">{initials(artist.name)}</div>
      )}
      <div className="artist-card__text">
        <div className="artist-card__title">{artist.name}</div>
        <div className="artist-card__meta">
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
