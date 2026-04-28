import type { LibraryAlbumIndex } from "../types";
import { UiQueueMusic } from "./KordUiIcons";

type P = {
  album: LibraryAlbumIndex;
  presentCount: number;
};

export function AlbumTracklistExpectedMeta({ album, presentCount }: P) {
  const expY =
    album.expectedTrackCount != null && album.expectedTrackCount > 0
      ? album.expectedTrackCount
      : album.expectedTracks?.length
        ? album.expectedTracks.length
        : null;

  const showRatio = expY != null && expY > 0;
  if (!showRatio) return null;

  return (
    <div className="album-tracklist-expected">
      <UiQueueMusic className="album-tracklist-expected__ic" aria-hidden />
      <span className="album-tracklist-expected__ratio" aria-hidden>
        {presentCount}/{expY}
      </span>
    </div>
  );
}
