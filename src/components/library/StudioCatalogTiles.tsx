import { memo, useCallback, type KeyboardEvent } from "react";
import { CoverImg } from "../CoverImg";
import { UiAlbumIcon, UiPerson } from "../RekordUiIcons";
import { initials } from "../../lib/initials";
import { useI18n } from "../../i18n/useI18n";
import type { CatalogAlbumEntry, CatalogArtistEntry } from "../../types";

export type StudioCatalogArtistTileProps = {
  artist: CatalogArtistEntry;
  coverRelPath: string | null;
  inLibraryIndex: boolean;
  inSelection: boolean;
  catalogBusy: boolean;
  selectionIncludeAll: boolean;
  onOpen: () => void;
  onAddToLibrary: () => void;
  onRemoveFromLibrary: () => void;
  addLabel: string;
  removeLabel: string;
};

export const StudioCatalogArtistTile = memo(function StudioCatalogArtistTile({
  artist,
  coverRelPath,
  inLibraryIndex,
  inSelection,
  catalogBusy,
  selectionIncludeAll,
  onOpen,
  onAddToLibrary,
  onRemoveFromLibrary,
  addLabel,
  removeLabel,
}: StudioCatalogArtistTileProps) {
  const { t } = useI18n();
  const aU =
    artist.albumCount === 1
      ? t("library.unitAlbum")
      : t("library.unitAlbumPlural");
  const trU =
    artist.trackCount === 1
      ? t("library.unitTrack")
      : t("library.unitTrackPlural");

  const dim = !inLibraryIndex;
  const sel = inSelection;

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onOpen();
      }
    },
    [onOpen]
  );

  return (
    <div
      className={[
        "library-list-tile",
        "library-list-tile--artist",
        "studio-catalog-list-tile",
        dim && !sel ? "studio-catalog-list-tile--dim" : "",
        sel ? "studio-catalog-list-tile--selected" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div
        className="studio-catalog-list-tile__main"
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={onKeyDown}
      >
        <div className="library-list-tile__media">
          {coverRelPath ? (
            <CoverImg
              className="library-list-tile__cover"
              preset="tile"
              coverPath={coverRelPath}
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
            {artist.albumCount} {aU} · {artist.trackCount} {trU}
          </div>
        </div>
      </div>
      <div className="studio-catalog-list-tile__actions">
        {sel ? (
          <button
            type="button"
            className="ghost-btn danger ghost-btn--sm"
            disabled={catalogBusy || selectionIncludeAll}
            onClick={(event) => {
              event.stopPropagation();
              onRemoveFromLibrary();
            }}
          >
            {removeLabel}
          </button>
        ) : (
          <button
            type="button"
            className="primary-btn primary-btn--sm"
            disabled={catalogBusy || selectionIncludeAll}
            onClick={(event) => {
              event.stopPropagation();
              onAddToLibrary();
            }}
          >
            {addLabel}
          </button>
        )}
      </div>
    </div>
  );
});

export type StudioCatalogAlbumTileProps = {
  album: CatalogAlbumEntry;
  artistName: string;
  inLibraryIndex: boolean;
  inSelection: boolean;
  catalogBusy: boolean;
  selectionIncludeAll: boolean;
  onAddToLibrary: () => void;
  onRemoveFromLibrary: () => void;
  addLabel: string;
  removeLabel: string;
};

export const StudioCatalogAlbumTile = memo(function StudioCatalogAlbumTile({
  album,
  artistName,
  inLibraryIndex,
  inSelection,
  catalogBusy,
  selectionIncludeAll,
  onAddToLibrary,
  onRemoveFromLibrary,
  addLabel,
  removeLabel,
}: StudioCatalogAlbumTileProps) {
  const { t } = useI18n();
  const trU =
    album.trackCount === 1
      ? t("library.unitTrack")
      : t("library.unitTrackPlural");
  const coverPath = album.coverRelPath?.trim() || album.relPath;

  const dim = !inLibraryIndex;
  const sel = inSelection;

  return (
    <div
      className={[
        "library-list-tile",
        "library-list-tile--album",
        "studio-catalog-list-tile",
        dim && !sel ? "studio-catalog-list-tile--dim" : "",
        sel ? "studio-catalog-list-tile--selected" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="studio-catalog-list-tile__top">
        <div className="library-list-tile__album-wrap">
          <CoverImg
            className="album-cover is-compact"
            preset="card"
            coverPath={coverPath}
            alt=""
            fallbackClassName="album-cover is-fallback is-compact"
            fallback={initials(artistName)}
          />
        </div>
        <div className="library-list-tile__body">
          <div className="library-list-tile__title-row">
            <UiAlbumIcon className="library-list-tile__kind-ic" aria-hidden />
            <div className="library-list-tile__title">{album.name}</div>
          </div>
          <div className="library-list-tile__meta">
            {artistName} · {album.trackCount} {trU}
          </div>
        </div>
      </div>
      <div className="studio-catalog-list-tile__actions">
        {sel ? (
          <button
            type="button"
            className="ghost-btn danger ghost-btn--sm"
            disabled={catalogBusy || selectionIncludeAll}
            onClick={onRemoveFromLibrary}
          >
            {removeLabel}
          </button>
        ) : (
          <button
            type="button"
            className="primary-btn primary-btn--sm"
            disabled={catalogBusy || selectionIncludeAll}
            onClick={onAddToLibrary}
          >
            {addLabel}
          </button>
        )}
      </div>
    </div>
  );
});
