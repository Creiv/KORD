import {
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { PlayerProvider, usePlayer } from "./context/PlayerContext";
import {
  ToolsActivityProvider,
  useToolsActivity,
} from "./context/ToolsActivityContext";
import { UserStateProvider, useUserState } from "./context/UserStateContext";
import {
  coverUrlForAlbumRelPath,
  coverUrlForTrackRelPath,
  createAccount as createApiAccount,
  deleteAccount as deleteApiAccount,
  fetchAccounts,
  fetchConfig,
  fetchDashboard,
  fetchLibraryIndex,
  getSelectedAccountId,
  saveAppConfig,
  setSelectedAccountId,
} from "./lib/api";
import type { Account, AccountsResponse } from "./lib/api";
import { useDashboardUpdatedAlbumsGrid } from "./hooks/useDashboardUpdatedAlbumsGrid";
import { buildRandomArtistCoverMap } from "./lib/artistCover";
import { buildGenreCoverPreviewMap } from "./lib/genreCovers";
import { fmtDate, trackInfoBadges } from "./lib/metaFormat";
import { ExcludeShuffleIcon } from "./components/ExcludeShuffleIcon";
import {
  AlbumMetaEditProvider,
  useOpenAlbumMetaEdit,
} from "./components/AlbumMetaEditor";
import {
  TrackMetaEditGlyph,
  TrackMetaEditProvider,
  useOpenTrackMetaEdit,
} from "./components/TrackMetaEditor";
import { KordWordmarkSvg } from "./components/KordWordmarkSvg";
import { ThemePicker } from "./components/ThemePicker";
import { ToolsView } from "./components/ToolsView";
import { Visualizer } from "./components/Visualizer";
import { useI18n } from "./i18n/useI18n";
import {
  eligibleTracksForIntelligentRandom,
  getExcludedAlbums,
  getExcludedTracks,
  getTrackExclusionEpoch,
  isTrackAlbumShuffleExcluded,
  subscribeTrackExclusionEpoch,
} from "./lib/randomExclusions";
import { buildSmartRandomQueue } from "./lib/smartShuffle";
import {
  APP_LOCALES,
  type AppLocale,
  type DashboardPayload,
  type EnrichedTrack,
  type LibraryAlbumIndex,
  type LibraryArtistIndex,
  type LibraryIndex,
  type LibraryResponse,
  type LibraryTrackIndex,
  type TrackMeta,
  type UserPlaylist,
} from "./types";
import "./App.css";

type Section =
  | "dashboard"
  | "ascolta"
  | "libreria"
  | "studio"
  | "queue"
  | "playlists"
  | "favorites"
  | "recent"
  | "settings"
  | "statistics";

type RouteState = {
  section: Section;
  artist: string | null;
  album: string | null;
  playlist: string | null;
};

const NAV_DEF: {
  id: Section;
  labelKey: string;
  group: "core" | "secondary";
}[] = [
  { id: "dashboard", labelKey: "nav.dashboard", group: "core" },
  { id: "ascolta", labelKey: "nav.listen", group: "core" },
  { id: "libreria", labelKey: "nav.library", group: "core" },
  { id: "studio", labelKey: "nav.studio", group: "core" },
  { id: "queue", labelKey: "nav.queue", group: "secondary" },
  { id: "playlists", labelKey: "nav.playlists", group: "secondary" },
  { id: "favorites", labelKey: "nav.favorites", group: "secondary" },
  { id: "recent", labelKey: "nav.recent", group: "secondary" },
  { id: "statistics", labelKey: "nav.statistics", group: "secondary" },
  { id: "settings", labelKey: "nav.settings", group: "secondary" },
];

function parseRoute(): RouteState {
  const params = new URLSearchParams(window.location.search);
  const section = window.location.pathname
    .replace(/^\/+/, "")
    .split("/")[0] as Section;
  return {
    section: NAV_DEF.some((item) => item.id === section)
      ? section
      : "dashboard",
    artist: params.get("artist"),
    album: params.get("album"),
    playlist: params.get("playlist"),
  };
}

function buildHref(route: RouteState) {
  const params = new URLSearchParams();
  if (route.artist) params.set("artist", route.artist);
  if (route.album) params.set("album", route.album);
  if (route.playlist) params.set("playlist", route.playlist);
  const query = params.toString();
  const path = route.section === "dashboard" ? "/" : `/${route.section}`;
  return query ? `${path}?${query}` : path;
}

function useAppRoute() {
  const [route, setRoute] = useState<RouteState>(() => parseRoute());
  useEffect(() => {
    const onPop = () => setRoute(parseRoute());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const navigate = (next: Partial<RouteState>) => {
    startTransition(() => {
      const merged = {
        ...route,
        ...next,
        artist:
          next.section && next.section !== "libreria"
            ? null
            : next.artist !== undefined
            ? next.artist
            : route.artist,
        album:
          next.section && next.section !== "libreria"
            ? null
            : next.album !== undefined
            ? next.album
            : route.album,
        playlist:
          next.section && next.section !== "playlists"
            ? null
            : next.playlist !== undefined
            ? next.playlist
            : route.playlist,
      };
      window.history.pushState({}, "", buildHref(merged));
      setRoute(merged);
    });
  };
  return { route, navigate };
}

function initials(text: string) {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("");
}

function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function clientLegacyLibrary(
  index: LibraryIndex | null
): LibraryResponse | null {
  if (!index) return null;
  return {
    musicRoot: index.musicRoot,
    artists: index.artists.map((artist) => ({
      id: artist.id,
      name: artist.name,
      trackCount: artist.trackCount,
      albums: artist.albums
        .map((albumId) => index.albums.find((album) => album.id === albumId))
        .filter((album): album is LibraryAlbumIndex => Boolean(album))
        .map((album) => ({
          id: album.loose ? "__loose__" : album.name,
          name: album.name,
          relPath: album.relPath,
          trackCount: album.trackCount,
          hasAlbumMeta: album.hasAlbumMeta,
          tracks: album.tracks
            .map((relPath) =>
              index.tracks.find((track) => track.relPath === relPath)
            )
            .filter((track): track is LibraryTrackIndex => Boolean(track))
            .map((track) => ({
              id: track.id,
              title: track.title,
              relPath: track.relPath,
              meta: track.meta,
            })),
          ...(album.releaseDate ||
          album.label ||
          album.country ||
          album.musicbrainzReleaseId
            ? {
                meta: {
                  title: album.title,
                  releaseDate: album.releaseDate,
                  label: album.label,
                  country: album.country,
                  musicbrainzReleaseId: album.musicbrainzReleaseId,
                },
              }
            : {}),
        })),
    })),
  };
}

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

function TrackFileMetaChip({ meta }: { meta?: TrackMeta | null }) {
  const { t } = useI18n();
  const isOn = !meta?.genre && !meta?.releaseDate;
  return (
    <span
      className={`lib-meta-chip${isOn ? " lib-meta-chip--on" : ""}`}
      title={isOn ? t("trackMeta.gapOnTitle") : t("trackMeta.gapOffTitle")}
    >
      ♪
    </span>
  );
}

function TrackRowArt({ relPath }: { relPath: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="track-row__art track-row__art--fallback" aria-hidden>
        ♪
      </div>
    );
  }
  return (
    <img
      className="track-row__art"
      src={coverUrlForTrackRelPath(relPath)}
      alt=""
      onError={() => setFailed(true)}
    />
  );
}

function TrackListRow({
  track,
  active,
  onPlay,
  metaRight,
  extraActions,
}: {
  track: EnrichedTrack;
  active?: boolean;
  onPlay: () => void;
  metaRight?: string;
  extraActions?: ReactNode;
}) {
  const p = usePlayer();
  const user = useUserState();
  const { t } = useI18n();
  const openTrackMetaEdit = useOpenTrackMetaEdit();
  useSyncExternalStore(
    subscribeTrackExclusionEpoch,
    getTrackExclusionEpoch,
    getTrackExclusionEpoch
  );
  const exAlbums = getExcludedAlbums();
  const albumShuffleExcluded = isTrackAlbumShuffleExcluded(track, exAlbums);
  const trackShuffleExcluded = getExcludedTracks().has(track.relPath);
  const shuffleExcluded = albumShuffleExcluded || trackShuffleExcluded;
  const inQ = p.isTrackInQueue(track.relPath);
  const fav = user.isFavorite(track.relPath);
  const playCount = user.getTrackPlayCount(track.relPath);
  const infoLine =
    metaRight ||
    trackInfoBadges(track, {
      track: t("badges.track"),
      album: t("badges.album"),
    }).join(" · ") ||
    t("common.emDash");
  return (
    <div className={`track-row ${active ? "is-active" : ""}`}>
      <TrackRowArt relPath={track.relPath} />
      <button type="button" className="track-row__main" onClick={onPlay}>
        <span className="track-row__title-row">
          <span className="track-row__title-lead">
            <span className="track-row__title">{track.title}</span>
            <span
              className="track-row__plays"
              aria-label={t("trackRow.playCount", { n: playCount })}
            >
              ({playCount})
            </span>
            <TrackFileMetaChip meta={track.meta} />
          </span>
        </span>
        <span className="track-row__meta">
          {track.artist} · {track.album}
        </span>
        <span className="track-row__badges">{infoLine}</span>
      </button>
      <div className="track-row__actions">
        {inQ ? (
          <button
            type="button"
            className="track-row__in-coda"
            onClick={() => p.removeFromQueueByRelPath(track.relPath)}
            title={t("trackRow.removeQueueTitle")}
            aria-label={t("trackRow.removeQueueAria")}
          >
            <span className="track-row__in-coda__label track-row__in-coda__label--idle">
              {t("trackRow.inQueueIdle")}
            </span>
            <span className="track-row__in-coda__label track-row__in-coda__label--act">
              {t("trackRow.inQueueAct")}
            </span>
          </button>
        ) : (
          <button
            type="button"
            className="track-row__ic track-row__ic--queue"
            onClick={() => p.addToQueue(track)}
            title={t("trackRow.addQueueTitle")}
            aria-label={t("trackRow.addQueueAria")}
          >
            <span className="track-row__ic-glyph" aria-hidden>
              ＋
            </span>
          </button>
        )}
        <button
          type="button"
          className={`track-row__ic track-row__ic--fav ${fav ? "is-on" : ""}`}
          onClick={() => user.toggleFavorite(track.relPath)}
          title={t("trackRow.favTitle")}
          aria-pressed={fav}
          aria-label={t("trackRow.favAria")}
        >
          <span className="track-row__ic-glyph" aria-hidden>
            ♥
          </span>
        </button>
        <button
          type="button"
          className="track-row__ic track-row__ic--meta"
          onClick={(ev) => {
            ev.stopPropagation();
            openTrackMetaEdit(track);
          }}
          title={t("trackRow.editMetaTitle")}
          aria-label={t("trackRow.editMetaAria")}
        >
          <span className="track-row__ic-glyph track-row__ic-glyph--svg">
            <TrackMetaEditGlyph />
          </span>
        </button>
        <button
          type="button"
          className={`track-row__ic track-row__ic--exclude ${
            shuffleExcluded ? "is-on" : ""
          }`}
          disabled={albumShuffleExcluded}
          title={
            albumShuffleExcluded
              ? t("trackRow.excludeLockedByAlbumTitle")
              : t("trackRow.excludeTitle")
          }
          onClick={() => {
            if (albumShuffleExcluded) return;
            user.toggleShuffleExcludedTrack(track.relPath);
          }}
          aria-pressed={shuffleExcluded}
          aria-label={
            albumShuffleExcluded
              ? t("trackRow.excludeLockedByAlbumAria")
              : t("trackRow.excludeTitle")
          }
        >
          <span
            className="track-row__ic-glyph track-row__ic-glyph--svg"
            aria-hidden
          >
            <ExcludeShuffleIcon />
          </span>
        </button>
        {extraActions}
      </div>
    </div>
  );
}

function AlbumCover({
  album,
  compact,
}: {
  album: LibraryAlbumIndex;
  compact?: boolean;
}) {
  if (album.coverRelPath) {
    return (
      <img
        className={`album-cover ${compact ? "is-compact" : ""}`}
        src={coverUrlForAlbumRelPath(album.relPath)}
        alt=""
      />
    );
  }
  return (
    <div className={`album-cover is-fallback ${compact ? "is-compact" : ""}`}>
      {initials(album.artist)}
    </div>
  );
}

function LibraryArtistMetaChips({ artist }: { artist: LibraryArtistIndex }) {
  const { t } = useI18n();
  const nA = artist.albumsWithoutFileMetaCount;
  const nS = artist.tracksWithoutFileMetaCount;
  return (
    <div
      className="lib-meta-badges"
      aria-label={t("library.metaFileStatusAria")}
    >
      <span
        className={`lib-meta-chip${nA > 0 ? " lib-meta-chip--on" : ""}`}
        title={
          nA > 0
            ? t("library.albumsNoMetaChip", { n: nA })
            : t("library.albumsAllMetaChip")
        }
      >
        A{nA > 0 ? nA : ""}
      </span>
      <span
        className={`lib-meta-chip${nS > 0 ? " lib-meta-chip--on" : ""}`}
        title={
          nS > 0
            ? t("library.tracksNoMetaChip", { n: nS })
            : t("library.tracksAllMetaChip")
        }
      >
        ♪{nS > 0 ? nS : ""}
      </span>
    </div>
  );
}

function LibraryAlbumMetaChips({
  album,
  variant = "card",
}: {
  album: LibraryAlbumIndex;
  variant?: "card" | "hero";
}) {
  const { t } = useI18n();
  const wrap =
    variant === "hero"
      ? "lib-meta-badges lib-meta-badges--hero"
      : "lib-meta-badges lib-meta-badges--tight";
  if (album.loose) {
    const n = album.tracksWithoutFileMetaCount;
    return (
      <div className={wrap} aria-label={t("library.metaFileStatusAria")}>
        <span
          className={`lib-meta-chip${n > 0 ? " lib-meta-chip--on" : ""}`}
          title={
            n > 0
              ? t("library.looseTracksChip", { n })
              : t("library.looseTracksOkChip")
          }
        >
          ♪{n > 0 ? n : ""}
        </span>
      </div>
    );
  }
  const hasAl = album.hasAlbumMeta;
  const nT = album.tracksWithoutFileMetaCount;
  const missTr = nT > 0;
  return (
    <div className={wrap} aria-label={t("library.metaFileStatusAria")}>
      <span
        className={`lib-meta-chip${!hasAl ? " lib-meta-chip--on" : ""}`}
        title={
          hasAl ? t("library.albumInfoPresent") : t("library.albumInfoMissing")
        }
      >
        A
      </span>
      <span
        className={`lib-meta-chip${missTr ? " lib-meta-chip--on" : ""}`}
        title={
          missTr
            ? t("library.tracksPartialMeta", { n: nT })
            : t("library.tracksAllHaveMeta")
        }
      >
        ♪{missTr ? nT : ""}
      </span>
    </div>
  );
}

function albumExclusionKey(album: LibraryAlbumIndex) {
  return album.id;
}

function tracksInGenreByKey(
  libraryIndex: LibraryIndex,
  genreKey: string
): LibraryTrackIndex[] {
  if (genreKey === "__none__") {
    return libraryIndex.tracks.filter((t) => !t.meta?.genre?.trim());
  }
  return libraryIndex.tracks.filter(
    (t) => t.meta?.genre?.trim().toLowerCase() === genreKey
  );
}

function trackHasKordFileMeta(t: LibraryTrackIndex) {
  return Boolean(t.meta?.genre || t.meta?.releaseDate);
}

function LibraryGenreMetaChips({
  genreKey,
  index: libraryIndex,
}: {
  genreKey: string;
  index: LibraryIndex;
}) {
  const { t } = useI18n();
  const tracks = tracksInGenreByKey(libraryIndex, genreKey);
  const albumIds = new Set(tracks.map((t) => t.albumId));
  let nA = 0;
  for (const aid of albumIds) {
    const al = libraryIndex.albums.find((a) => a.id === aid);
    if (al && !al.loose && !al.hasAlbumMeta) nA += 1;
  }
  const nS = tracks.filter((t) => !trackHasKordFileMeta(t)).length;
  return (
    <div
      className="lib-meta-badges"
      aria-label={t("library.metaFileStatusAria")}
    >
      <span
        className={`lib-meta-chip${nA > 0 ? " lib-meta-chip--on" : ""}`}
        title={
          nA > 0
            ? t("library.albumsNoMetaChip", { n: nA })
            : t("library.albumsAllMetaChip")
        }
      >
        A{nA > 0 ? nA : ""}
      </span>
      <span
        className={`lib-meta-chip${nS > 0 ? " lib-meta-chip--on" : ""}`}
        title={
          nS > 0
            ? t("library.tracksNoMetaChip", { n: nS })
            : t("library.tracksAllMetaChip")
        }
      >
        ♪{nS > 0 ? nS : ""}
      </span>
    </div>
  );
}

function LibraryGenreExcludeChips({
  genreKey,
  index: libraryIndex,
}: {
  genreKey: string;
  index: LibraryIndex;
}) {
  const { t } = useI18n();
  const tracks = tracksInGenreByKey(libraryIndex, genreKey);
  const excludedAlbums = getExcludedAlbums();
  const excludedTracks = getExcludedTracks();
  const albumIds = new Set(tracks.map((t) => t.albumId));
  let nAl = 0;
  for (const aid of albumIds) {
    const al = libraryIndex.albums.find((a) => a.id === aid);
    if (al && excludedAlbums.has(albumExclusionKey(al))) nAl += 1;
  }
  const nTr = tracks.filter((t) => excludedTracks.has(t.relPath)).length;
  return (
    <div
      className="lib-meta-badges lib-meta-badges--tight"
      aria-label={t("library.randomExcludeAria")}
    >
      <span
        className={`lib-meta-chip lib-meta-chip--exclude${
          nAl > 0 ? " lib-meta-chip--on" : ""
        }`}
        title={
          nAl > 0
            ? t("library.nAlbumsExcluded", { n: nAl })
            : t("library.noAlbumsExcluded")
        }
      >
        R{nAl > 0 ? nAl : ""}
      </span>
      <span
        className={`lib-meta-chip lib-meta-chip--exclude${
          nTr > 0 ? " lib-meta-chip--on" : ""
        }`}
        title={
          nTr > 0
            ? t("library.nTracksExcluded", { n: nTr })
            : t("library.noTracksExcluded")
        }
      >
        <ExcludeShuffleIcon className="lib-meta-chip__exclude-icon" />
        {nTr > 0 ? nTr : null}
      </span>
    </div>
  );
}

function LibraryGenreFavoriteChips({
  genreKey,
  index: libraryIndex,
}: {
  genreKey: string;
  index: LibraryIndex;
}) {
  const { t } = useI18n();
  const { favorites } = useUserState();
  const n = useMemo(() => {
    let c = 0;
    for (const t of tracksInGenreByKey(libraryIndex, genreKey)) {
      if (favorites.has(t.relPath)) c += 1;
    }
    return c;
  }, [genreKey, libraryIndex, favorites]);
  return (
    <div
      className="lib-meta-badges lib-meta-badges--tight"
      aria-label={t("library.favoritesAria")}
    >
      <span
        className={`lib-meta-chip lib-meta-chip--fav${
          n > 0 ? " lib-meta-chip--on" : ""
        }`}
        title={
          n > 0
            ? n === 1
              ? t("library.oneFavTrackArtist")
              : t("library.nFavTracksArtist", { n })
            : t("library.noFavArtist")
        }
      >
        ♥{n > 0 ? n : ""}
      </span>
    </div>
  );
}

function LibraryArtistExcludeChips({
  artist,
  index,
}: {
  artist: LibraryArtistIndex;
  index: LibraryIndex;
}) {
  const { t } = useI18n();
  const excludedAlbums = getExcludedAlbums();
  const excludedTracks = getExcludedTracks();
  let nAl = 0;
  for (const aid of artist.albums) {
    const al = index.albums.find((a) => a.id === aid);
    if (al && excludedAlbums.has(albumExclusionKey(al))) nAl += 1;
  }
  let nTrackBlocked = 0;
  for (const t of index.tracks) {
    if (t.artist !== artist.name) continue;
    const al = index.albums.find((a) => a.id === t.albumId);
    if (al && excludedAlbums.has(albumExclusionKey(al))) {
      nTrackBlocked += 1;
      continue;
    }
    if (excludedTracks.has(t.relPath)) nTrackBlocked += 1;
  }
  return (
    <div
      className="lib-meta-badges lib-meta-badges--tight"
      aria-label={t("library.randomExcludeAria")}
    >
      <span
        className={`lib-meta-chip lib-meta-chip--exclude${
          nAl > 0 ? " lib-meta-chip--on" : ""
        }`}
        title={
          nAl > 0
            ? t("library.nAlbumsExcluded", { n: nAl })
            : t("library.noAlbumsExcluded")
        }
      >
        R{nAl > 0 ? nAl : ""}
      </span>
      <span
        className={`lib-meta-chip lib-meta-chip--exclude${
          nTrackBlocked > 0 ? " lib-meta-chip--on" : ""
        }`}
        title={
          nTrackBlocked > 0
            ? t("library.nTracksExcluded", { n: nTrackBlocked })
            : t("library.noTracksExcluded")
        }
      >
        <ExcludeShuffleIcon className="lib-meta-chip__exclude-icon" />
        {nTrackBlocked > 0 ? nTrackBlocked : null}
      </span>
    </div>
  );
}

function LibraryArtistFavoriteChips({
  artist,
  index: libraryIndex,
}: {
  artist: LibraryArtistIndex;
  index: LibraryIndex;
}) {
  const { t } = useI18n();
  const { favorites } = useUserState();
  const n = useMemo(() => {
    let c = 0;
    for (const t of libraryIndex.tracks) {
      if (t.artist === artist.name && favorites.has(t.relPath)) c += 1;
    }
    return c;
  }, [artist.name, libraryIndex.tracks, favorites]);
  return (
    <div
      className="lib-meta-badges lib-meta-badges--tight"
      aria-label={t("library.favoritesAria")}
    >
      <span
        className={`lib-meta-chip lib-meta-chip--fav${
          n > 0 ? " lib-meta-chip--on" : ""
        }`}
        title={
          n > 0
            ? n === 1
              ? t("library.oneFavTrackArtist")
              : t("library.nFavTracksArtist", { n })
            : t("library.noFavArtist")
        }
      >
        ♥{n > 0 ? n : ""}
      </span>
    </div>
  );
}

function LibraryAlbumFavoriteChips({
  album,
  variant = "card",
}: {
  album: LibraryAlbumIndex;
  variant?: "card" | "hero";
}) {
  const { t } = useI18n();
  const { favorites } = useUserState();
  const n = useMemo(
    () => album.tracks.filter((rel) => favorites.has(rel)).length,
    [album.tracks, favorites]
  );
  const wrap =
    variant === "hero"
      ? "lib-meta-badges lib-meta-badges--hero"
      : "lib-meta-badges lib-meta-badges--tight";
  return (
    <div className={wrap} aria-label={t("library.favoritesAria")}>
      <span
        className={`lib-meta-chip lib-meta-chip--fav${
          n > 0 ? " lib-meta-chip--on" : ""
        }`}
        title={
          n > 0
            ? n === 1
              ? t("library.oneFavTrackAlbum")
              : t("library.nFavTracksAlbum", { n })
            : t("library.noFavAlbum")
        }
      >
        ♥{n > 0 ? n : ""}
      </span>
    </div>
  );
}

function LibraryAlbumExcludeChips({
  album,
  variant = "card",
}: {
  album: LibraryAlbumIndex;
  variant?: "card" | "hero";
}) {
  const { t } = useI18n();
  const excludedAlbums = getExcludedAlbums();
  const excludedTracks = getExcludedTracks();
  const key = albumExclusionKey(album);
  const fullAl = excludedAlbums.has(key);
  const nTrIndiv = album.tracks.filter((rel) => excludedTracks.has(rel)).length;
  const nTrackBlocked = fullAl ? album.tracks.length : nTrIndiv;
  const wrap =
    variant === "hero"
      ? "lib-meta-badges lib-meta-badges--hero"
      : "lib-meta-badges lib-meta-badges--tight";
  return (
    <div className={wrap} aria-label={t("library.randomExcludeAria")}>
      <span
        className={`lib-meta-chip lib-meta-chip--exclude${
          fullAl ? " lib-meta-chip--on" : ""
        }`}
        title={
          fullAl
            ? t("library.albumExcludedFull")
            : t("library.albumNotExcludedFull")
        }
      >
        R
      </span>
      <span
        className={`lib-meta-chip lib-meta-chip--exclude${
          nTrackBlocked > 0 ? " lib-meta-chip--on" : ""
        }`}
        title={
          nTrackBlocked > 0
            ? fullAl
              ? t("library.nTracksBlockedByAlbumExclusion", {
                  n: nTrackBlocked,
                })
              : t("library.nTracksExcludedAlbum", { n: nTrIndiv })
            : t("library.noTracksExcludedAlbum")
        }
      >
        <ExcludeShuffleIcon className="lib-meta-chip__exclude-icon" />
        {nTrackBlocked > 0 ? nTrackBlocked : null}
      </span>
    </div>
  );
}

function GenreCoverSlot({ relPath }: { relPath: string | null }) {
  const [failed, setFailed] = useState(false);
  if (!relPath || failed) {
    return (
      <div className="genre-quad__slot genre-quad__slot--empty" aria-hidden />
    );
  }
  return (
    <div className="genre-quad__slot">
      <img
        src={coverUrlForAlbumRelPath(relPath)}
        alt=""
        onError={() => setFailed(true)}
      />
    </div>
  );
}

function GenreCard({
  genreKey,
  title,
  albumCount,
  trackCount,
  albumSlots,
  index: libraryIndex,
  muted,
  onOpen,
}: {
  genreKey: string;
  title: string;
  albumCount: number;
  trackCount: number;
  albumSlots: (string | null)[];
  index: LibraryIndex;
  muted?: boolean;
  onOpen: () => void;
}) {
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
        <div className="lib-badge-cluster lib-badge-cluster--card-foot">
          <LibraryGenreMetaChips genreKey={genreKey} index={libraryIndex} />
          <LibraryGenreFavoriteChips genreKey={genreKey} index={libraryIndex} />
          <LibraryGenreExcludeChips genreKey={genreKey} index={libraryIndex} />
        </div>
      </div>
    </button>
  );
}

function ArtistCard({
  artist,
  albumCount,
  coverAlbumRelPath,
  index: libraryIndex,
  onOpen,
}: {
  artist: LibraryArtistIndex;
  albumCount: number;
  coverAlbumRelPath?: string | null;
  index: LibraryIndex;
  onOpen: () => void;
}) {
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
        <img
          className="artist-card__cover"
          src={coverUrlForAlbumRelPath(coverAlbumRelPath)}
          alt=""
        />
      ) : (
        <div className="artist-card__badge">{initials(artist.name)}</div>
      )}
      <div className="artist-card__text">
        <div className="artist-card__title">{artist.name}</div>
        <div className="artist-card__meta">
          {albumCount} {aU} · {artist.trackCount} {trU}
        </div>
        <div className="lib-badge-cluster lib-badge-cluster--card-foot">
          <LibraryArtistMetaChips artist={artist} />
          <LibraryArtistFavoriteChips artist={artist} index={libraryIndex} />
          <LibraryArtistExcludeChips artist={artist} index={libraryIndex} />
        </div>
      </div>
    </button>
  );
}

function DashboardView({
  dashboard,
  index,
  onOpenAlbum,
  onOpenSection,
  onPlayTrack,
}: {
  dashboard: DashboardPayload | null;
  index: LibraryIndex | null;
  onOpenAlbum: (artist: string, album: string) => void;
  onOpenSection: (section: Section) => void;
  onPlayTrack: (track: EnrichedTrack) => void;
}) {
  const { t } = useI18n();
  const user = useUserState();
  const { ref: updatedAlbumsGridRef, cols: updatedGridCols, maxItems: updatedAlbumsMax } =
    useDashboardUpdatedAlbumsGrid();
  const favoriteTracksSorted = useMemo(
    () =>
      [...(dashboard?.favoriteTracks || [])].sort(
        (a, b) =>
          (user.state.trackPlayCounts?.[b.relPath] ?? 0) -
            (user.state.trackPlayCounts?.[a.relPath] ?? 0) ||
          a.title.localeCompare(b.title, undefined, { numeric: true })
      ),
    [dashboard?.favoriteTracks, user.state.trackPlayCounts]
  );
  if (!dashboard || !index)
    return <div className="panel-empty">{t("loading.dashboard")}</div>;
  return (
    <div className="view-stack">
      <section className="hero-card hero-card--compact">
        <div className="hero-card__lead">
          <p className="eyebrow">KORD</p>
          <h1 className="hero-card__title">{t("dashboard.heroTitle")}</h1>
        </div>
        <div className="hero-card__actions">
          <button
            type="button"
            className="primary-btn"
            onClick={() => onOpenSection("ascolta")}
          >
            {t("dashboard.resumeListen")}
          </button>
          <button
            type="button"
            className="ghost-btn"
            onClick={() => onOpenSection("studio")}
          >
            {t("dashboard.openStudio")}
          </button>
        </div>
      </section>

      <section className="stats-grid">
        <div className="metric-card">
          <span>{t("dashboard.metricArtists")}</span>
          <strong>{dashboard.stats.artistCount}</strong>
        </div>
        <div className="metric-card">
          <span>{t("dashboard.metricAlbums")}</span>
          <strong>{dashboard.stats.albumCount}</strong>
        </div>
        <div className="metric-card">
          <span>{t("dashboard.metricTracks")}</span>
          <strong>{dashboard.stats.trackCount}</strong>
        </div>
        <div className="metric-card">
          <span>{t("dashboard.metricQuality")}</span>
          <strong>
            {dashboard.qualityAlerts.reduce((sum, item) => sum + item.count, 0)}
          </strong>
        </div>
      </section>

      <section className="dashboard-grid">
        <section className="surface-card">
          <div className="section-head section-head--page-toolbar">
            <div>
              <p className="eyebrow">{t("dashboard.favoritesEyebrow")}</p>
              <h2>{t("dashboard.favoritesHeading")}</h2>
            </div>
            <button
              type="button"
              className="text-btn"
              onClick={() => onOpenSection("favorites")}
            >
              {t("dashboard.allFavorites")}
            </button>
          </div>
          {favoriteTracksSorted.length === 0 ? (
            <p className="panel-empty">{t("dashboard.favoritesEmpty")}</p>
          ) : (
            <div className="list-stack">
              {favoriteTracksSorted.slice(0, 5).map((track) => (
                <TrackListRow
                  key={track.relPath}
                  track={track}
                  onPlay={() => onPlayTrack(track)}
                />
              ))}
            </div>
          )}
        </section>

        <section className="surface-card">
          <div className="section-head section-head--page-toolbar">
            <div>
              <p className="eyebrow">{t("dashboard.updatedEyebrow")}</p>
              <h2>{t("dashboard.updatedHeading")}</h2>
            </div>
            <button
              type="button"
              className="text-btn"
              onClick={() => onOpenSection("libreria")}
            >
              {t("dashboard.openLibrary")}
            </button>
          </div>
          <div
            ref={updatedAlbumsGridRef}
            className="album-grid compact dashboard-updated-albums"
            style={{
              gridTemplateColumns: `repeat(${updatedGridCols}, minmax(200px, 1fr))`,
            }}
          >
            {dashboard.recentlyUpdatedAlbums
              .slice(0, updatedAlbumsMax)
              .map((album) => (
              <button
                type="button"
                key={album.id}
                className="album-card"
                onClick={() => onOpenAlbum(album.artistId, album.name)}
              >
                <AlbumCover album={album} compact />
                <div className="album-card__text">
                  <div className="album-card__title">{album.name}</div>
                  <div className="album-card__meta">
                    {album.artist}
                    {album.releaseDate
                      ? ` · ${fmtDate(album.releaseDate)}`
                      : ""}
                  </div>
                  <div className="lib-badge-cluster lib-badge-cluster--card-foot">
                    <LibraryAlbumMetaChips album={album} />
                    <LibraryAlbumFavoriteChips album={album} />
                    <LibraryAlbumExcludeChips album={album} />
                  </div>
                </div>
              </button>
            ))}
          </div>
        </section>

        <section className="surface-card">
          <div className="section-head section-head--page-toolbar">
            <div>
              <p className="eyebrow">{t("dashboard.sessionEyebrow")}</p>
              <h2>{t("dashboard.sessionHeading")}</h2>
            </div>
            <button
              type="button"
              className="text-btn"
              onClick={() => onOpenSection("queue")}
            >
              {t("dashboard.openQueue")}
            </button>
          </div>
          {dashboard.continueListening.length === 0 ? (
            <p className="panel-empty">{t("dashboard.sessionEmpty")}</p>
          ) : (
            <div className="list-stack">
              {dashboard.continueListening.slice(0, 5).map((track) => (
                <TrackListRow
                  key={track.relPath}
                  track={track}
                  onPlay={() => onPlayTrack(track)}
                />
              ))}
            </div>
          )}
        </section>

        <section className="surface-card">
          <div className="section-head section-head--page-toolbar">
            <div>
              <p className="eyebrow">{t("dashboard.qualityEyebrow")}</p>
              <h2>{t("dashboard.qualityHeading")}</h2>
            </div>
            <button
              type="button"
              className="text-btn"
              onClick={() => onOpenSection("studio")}
            >
              {t("dashboard.goStudio")}
            </button>
          </div>
          <div className="alert-list">
            {dashboard.qualityAlerts.map((alert) => (
              <div
                key={alert.id}
                className={`alert-card severity-${alert.severity}`}
              >
                <span>{t(`dashboard.alert.${alert.id}`)}</span>
                <strong>{alert.count}</strong>
              </div>
            ))}
          </div>
        </section>
      </section>
    </div>
  );
}

function ListenView({
  dashboard,
  index,
  onOpenSection,
}: {
  dashboard: DashboardPayload | null;
  index: LibraryIndex;
  onOpenSection: (section: Section) => void;
}) {
  const p = usePlayer();
  const user = useUserState();
  const { t } = useI18n();
  const runRandomIntelligent = () => {
    const eligible = eligibleTracksForIntelligentRandom(
      index,
      getExcludedAlbums(),
      getExcludedTracks()
    );
    if (!eligible.length) return;
    const recentRelPaths = new Set(
      user.state.recent.slice(0, 48).map((t) => t.relPath)
    );
    const shuffled = buildSmartRandomQueue(eligible, {
      currentRelPath: p.current?.relPath,
      currentArtist: p.current?.artist,
      recentRelPaths,
    });
    p.playTrack(shuffled[0], shuffled, 0, { preserveQueueOrder: true });
  };
  const listenQueueStart = Math.max(0, p.currentIndex - 1);
  const listenQueuePreview = p.queue.slice(
    listenQueueStart,
    listenQueueStart + 6
  );
  return (
    <div className="view-stack">
      <section className="listen-stage">
        <div className="listen-stage__meta">
          <div className="listen-stage__head">
            {p.current?.relPath ? (
              <img
                className="listen-stage__art"
                src={coverUrlForTrackRelPath(p.current.relPath)}
                alt=""
              />
            ) : (
              <div
                className="listen-stage__art listen-stage__art--empty"
                aria-hidden
              >
                ♪
              </div>
            )}
            <div className="listen-stage__text">
              <p className="eyebrow">{t("listen.currentEyebrow")}</p>
              <div className="listen-stage__title-row">
                <h1 className="listen-stage__title">
                  {p.current?.title || t("listen.noTrack")}
                </h1>
                {p.current ? (
                  <button
                    type="button"
                    className={`listen-stage__fav ${
                      user.isFavorite(p.current.relPath) ? "is-on" : ""
                    }`}
                    onClick={() => {
                      const tr = p.current;
                      if (!tr) return;
                      user.toggleFavorite(tr.relPath);
                    }}
                    title={t("trackRow.favTitle")}
                    aria-pressed={
                      p.current ? user.isFavorite(p.current.relPath) : false
                    }
                    aria-label={t("trackRow.favAria")}
                  >
                    <span aria-hidden>♥</span>
                  </button>
                ) : null}
              </div>
              <p className="listen-stage__sub">
                {p.current
                  ? `${p.current.artist} · ${p.current.album}`
                  : t("listen.openLibraryHint")}
              </p>
            </div>
          </div>
        </div>
        <div className="listen-stage__viz">
          <Visualizer mode={user.state.settings.vizMode} />
        </div>
      </section>

      <section className="dashboard-grid">
        <section className="surface-card">
          <div className="section-head section-head--page-toolbar">
            <div>
              <p className="eyebrow">{t("listen.queueEyebrow")}</p>
              <h2>{t("listen.queueHeading")}</h2>
            </div>
            <button
              type="button"
              className="text-btn"
              onClick={() => onOpenSection("queue")}
            >
              {t("listen.manageQueue")}
            </button>
          </div>
          {p.queue.length === 0 ? (
            <div className="panel-empty panel-empty--actions">
              <p>{t("listen.queueEmpty")}</p>
              <button
                type="button"
                className="ghost-btn"
                onClick={runRandomIntelligent}
              >
                {t("listen.smartShuffle")}
              </button>
            </div>
          ) : (
            <div className="list-stack">
              {listenQueuePreview.map((track, i) => {
                const index = listenQueueStart + i;
                return (
                  <TrackListRow
                    key={`${track.relPath}-${index}`}
                    track={track}
                    active={index === p.currentIndex}
                    onPlay={() => p.playTrack(track, p.queue, index)}
                  />
                );
              })}
            </div>
          )}
        </section>

        <section className="surface-card">
          <div className="section-head section-head--page-toolbar">
            <div>
              <p className="eyebrow">{t("listen.recentEyebrow")}</p>
              <h2>{t("listen.recentHeading")}</h2>
            </div>
            <button
              type="button"
              className="text-btn"
              onClick={() => onOpenSection("recent")}
            >
              {t("listen.recentSeeAll")}
            </button>
          </div>
          {dashboard?.recentTracks.length ? (
            <div className="list-stack">
              {dashboard.recentTracks.slice(0, 5).map((track) => (
                <TrackListRow
                  key={track.relPath}
                  track={track}
                  onPlay={() => p.playTrack(track, [track], 0)}
                />
              ))}
            </div>
          ) : (
            <p className="panel-empty">{t("listen.recentEmpty")}</p>
          )}
        </section>
      </section>
    </div>
  );
}

function LibraryView({
  index,
  route,
  query,
  onOpenArtist,
  onOpenAlbum,
}: {
  index: LibraryIndex;
  route: RouteState;
  query: string;
  onOpenArtist: (artist: string) => void;
  onOpenAlbum: (artist: string, album: string) => void;
}) {
  const p = usePlayer();
  const user = useUserState();
  const { t, sortLocale } = useI18n();
  const openAlbumMetaEdit = useOpenAlbumMetaEdit();
  const { libBrowse, libOverviewSort, artistAlbumSort } = user.state.settings;
  const [mode, setMode] = useState<"all" | "artists" | "albums" | "tracks">(
    "all"
  );
  const excludedAlbums = useMemo(
    () => new Set(user.state.shuffleExcludedAlbumIds),
    [user.state.shuffleExcludedAlbumIds]
  );
  const trackExclusionEpoch = useSyncExternalStore(
    subscribeTrackExclusionEpoch,
    getTrackExclusionEpoch,
    getTrackExclusionEpoch
  );
  const [selectedGenreKey, setSelectedGenreKey] = useState<string | null>(null);
  const normalizedQuery = query.trim().toLowerCase();

  const artist = route.artist
    ? index.artists.find((item) => item.id === route.artist) || null
    : null;
  const artistAlbums = useMemo(() => {
    if (!artist) return [];
    const counts = user.state.trackPlayCounts || {};
    const list = index.albums.filter((album) => album.artistId === artist.id);
    const next = [...list];
    if (artistAlbumSort === "date") {
      next.sort((a, b) =>
        String(a.releaseDate || "").localeCompare(
          String(b.releaseDate || ""),
          undefined,
          { numeric: true }
        )
      );
    } else if (artistAlbumSort === "name") {
      next.sort((a, b) =>
        a.name.localeCompare(b.name, sortLocale, { numeric: true })
      );
    } else {
      const albumPlays = (al: LibraryAlbumIndex) => {
        let s = 0;
        for (const rel of al.tracks) {
          s += counts[rel] ?? 0;
        }
        return s;
      };
      next.sort(
        (a, b) =>
          albumPlays(b) - albumPlays(a) ||
          a.name.localeCompare(b.name, sortLocale, { numeric: true })
      );
    }
    return next;
  }, [
    artist,
    index.albums,
    artistAlbumSort,
    sortLocale,
    user.state.trackPlayCounts,
  ]);
  const album = route.album
    ? artistAlbums.find(
        (item) => item.name === route.album || item.id === route.album
      ) || null
    : null;
  const albumTracks = useMemo(
    () =>
      album
        ? album.tracks
            .map((relPath) =>
              index.tracks.find((track) => track.relPath === relPath)
            )
            .filter((track): track is LibraryTrackIndex => Boolean(track))
        : [],
    [album, index.tracks]
  );

  const artistShuffleEligible = useMemo(() => {
    if (!artist) return [] as LibraryTrackIndex[];
    const ex = getExcludedTracks();
    const rels = new Set(artistAlbums.flatMap((al) => al.tracks));
    return index.tracks.filter(
      (t) =>
        rels.has(t.relPath) &&
        !ex.has(t.relPath) &&
        !isTrackAlbumShuffleExcluded(t, excludedAlbums)
    );
  }, [artist, artistAlbums, index.tracks, excludedAlbums, trackExclusionEpoch]);

  const artistCoverById = useMemo(
    () => buildRandomArtistCoverMap(index),
    [index]
  );
  const genreCoverByKey = useMemo(
    () => buildGenreCoverPreviewMap(index),
    [index]
  );

  const genreAlbumTrackCounts = useMemo(() => {
    const m = new Map<string, { albums: Set<string>; tracks: number }>();
    const bump = (key: string, albumId: string) => {
      let e = m.get(key);
      if (!e) {
        e = { albums: new Set<string>(), tracks: 0 };
        m.set(key, e);
      }
      e.tracks += 1;
      if (albumId) e.albums.add(albumId);
    };
    for (const t of index.tracks) {
      const raw = t.meta?.genre?.trim();
      if (!raw) bump("__none__", t.albumId);
      else bump(raw.toLowerCase(), t.albumId);
    }
    return m;
  }, [index.tracks]);

  const genreIndex = useMemo(() => {
    const byLower = new Map<string, { label: string; count: number }>();
    let noGenre = 0;
    for (const t of index.tracks) {
      const raw = t.meta?.genre?.trim();
      if (!raw) {
        noGenre += 1;
        continue;
      }
      const low = raw.toLowerCase();
      const prev = byLower.get(low);
      if (!prev) byLower.set(low, { label: raw, count: 1 });
      else prev.count += 1;
    }
    const list = Array.from(byLower.entries())
      .map(([key, v]) => ({ key, label: v.label, count: v.count }))
      .sort((a, b) =>
        a.label.localeCompare(b.label, sortLocale, { numeric: true })
      );
    return { list, noGenreCount: noGenre };
  }, [index.tracks, sortLocale]);

  const tracksInSelectedGenre = useMemo(() => {
    if (!selectedGenreKey) return [] as LibraryTrackIndex[];
    if (selectedGenreKey === "__none__") {
      return index.tracks.filter((t) => !t.meta?.genre?.trim());
    }
    return index.tracks.filter(
      (t) => t.meta?.genre?.trim().toLowerCase() === selectedGenreKey
    );
  }, [index.tracks, selectedGenreKey]);

  const selectedGenreLabel = useMemo(() => {
    if (!selectedGenreKey) return null;
    if (selectedGenreKey === "__none__") return t("library.noGenreLabel");
    return (
      genreIndex.list.find((g) => g.key === selectedGenreKey)?.label ??
      selectedGenreKey
    );
  }, [selectedGenreKey, genreIndex.list, t]);

  const sortedGenreTracks = useMemo(() => {
    const base = [...tracksInSelectedGenre];
    const counts = user.state.trackPlayCounts || {};
    if (libOverviewSort === "plays") {
      base.sort(
        (a, b) =>
          (counts[b.relPath] ?? 0) - (counts[a.relPath] ?? 0) ||
          a.artist.localeCompare(b.artist, sortLocale, { numeric: true }) ||
          a.album.localeCompare(b.album, sortLocale, { numeric: true }) ||
          a.title.localeCompare(b.title, sortLocale, { numeric: true })
      );
    } else {
      base.sort(
        (a, b) =>
          a.artist.localeCompare(b.artist, sortLocale, { numeric: true }) ||
          a.album.localeCompare(b.album, sortLocale, { numeric: true }) ||
          a.title.localeCompare(b.title, sortLocale, { numeric: true })
      );
    }
    return base;
  }, [
    tracksInSelectedGenre,
    sortLocale,
    libOverviewSort,
    user.state.trackPlayCounts,
  ]);

  const genreShuffleEligible = useMemo(() => {
    if (!selectedGenreKey) return [] as LibraryTrackIndex[];
    const ex = getExcludedTracks();
    return tracksInSelectedGenre.filter(
      (tr) =>
        !ex.has(tr.relPath) && !isTrackAlbumShuffleExcluded(tr, excludedAlbums)
    );
  }, [
    selectedGenreKey,
    tracksInSelectedGenre,
    excludedAlbums,
    trackExclusionEpoch,
  ]);

  const genreToolbarBulkAllExcluded = useMemo(() => {
    if (!tracksInSelectedGenre.length) return false;
    const exT = getExcludedTracks();
    const exA = getExcludedAlbums();
    return tracksInSelectedGenre.every(
      (tr) => exT.has(tr.relPath) || isTrackAlbumShuffleExcluded(tr, exA)
    );
  }, [tracksInSelectedGenre, trackExclusionEpoch, excludedAlbums]);

  const selectedGenreAlbumCount =
    selectedGenreKey != null
      ? genreAlbumTrackCounts.get(selectedGenreKey)?.albums.size ?? 0
      : 0;

  const sortedOverviewArtists = useMemo(() => {
    const counts = user.state.trackPlayCounts || {};
    const list = [...index.artists];
    if (libOverviewSort === "name") {
      list.sort((a, b) =>
        a.name.localeCompare(b.name, sortLocale, { numeric: true })
      );
    } else {
      const sumPlays = (ar: LibraryArtistIndex) => {
        let s = 0;
        for (const t of index.tracks) {
          if (t.artist === ar.name) s += counts[t.relPath] ?? 0;
        }
        return s;
      };
      list.sort(
        (a, b) =>
          sumPlays(b) - sumPlays(a) ||
          a.name.localeCompare(b.name, sortLocale, { numeric: true })
      );
    }
    return list;
  }, [
    index.artists,
    index.tracks,
    libOverviewSort,
    sortLocale,
    user.state.trackPlayCounts,
  ]);

  const sortedGenreBrowseList = useMemo(() => {
    const counts = user.state.trackPlayCounts || {};
    const list = [...genreIndex.list];
    if (libOverviewSort === "name") {
      list.sort((a, b) =>
        a.label.localeCompare(b.label, sortLocale, { numeric: true })
      );
    } else {
      const playsForGenreKey = (key: string) => {
        let s = 0;
        for (const t of index.tracks) {
          const g = t.meta?.genre?.trim().toLowerCase();
          if (g === key) s += counts[t.relPath] ?? 0;
        }
        return s;
      };
      list.sort(
        (a, b) =>
          playsForGenreKey(b.key) - playsForGenreKey(a.key) ||
          a.label.localeCompare(b.label, sortLocale, { numeric: true })
      );
    }
    return list;
  }, [
    genreIndex.list,
    index.tracks,
    libOverviewSort,
    sortLocale,
    user.state.trackPlayCounts,
  ]);

  const searchResults = useMemo(() => {
    if (!normalizedQuery) return null;
    const genreOk = (relPath: string) => {
      const t = index.tracks.find((x) => x.relPath === relPath);
      const g = t?.meta?.genre?.trim().toLowerCase();
      return Boolean(g && g.includes(normalizedQuery));
    };
    return {
      artists: index.artists.filter((item) => {
        if (item.name.toLowerCase().includes(normalizedQuery)) return true;
        return index.tracks.some(
          (t) =>
            t.artist === item.name &&
            t.meta?.genre?.trim().toLowerCase().includes(normalizedQuery)
        );
      }),
      albums: index.albums.filter((item) => {
        if (
          item.name.toLowerCase().includes(normalizedQuery) ||
          item.artist.toLowerCase().includes(normalizedQuery)
        ) {
          return true;
        }
        return item.tracks.some((rel) => genreOk(rel));
      }),
      tracks: index.tracks.filter(
        (item) =>
          item.title.toLowerCase().includes(normalizedQuery) ||
          item.artist.toLowerCase().includes(normalizedQuery) ||
          item.album.toLowerCase().includes(normalizedQuery) ||
          Boolean(
            item.meta?.genre?.trim().toLowerCase().includes(normalizedQuery)
          )
      ),
    };
  }, [index.albums, index.artists, index.tracks, normalizedQuery]);

  const runRandom = () => {
    const eligible = eligibleTracksForIntelligentRandom(
      index,
      excludedAlbums,
      getExcludedTracks()
    );
    if (!eligible.length) return;
    const recentRelPaths = new Set(
      user.state.recent.slice(0, 48).map((t) => t.relPath)
    );
    const shuffled = buildSmartRandomQueue(eligible, {
      currentRelPath: p.current?.relPath,
      currentArtist: p.current?.artist,
      recentRelPaths,
    });
    p.playTrack(shuffled[0], shuffled, 0, { preserveQueueOrder: true });
  };

  const playGenreShuffle = () => {
    if (!genreShuffleEligible.length) return;
    const recentRelPaths = new Set(
      user.state.recent.slice(0, 48).map((tr) => tr.relPath)
    );
    const shuffled = buildSmartRandomQueue(genreShuffleEligible, {
      currentRelPath: p.current?.relPath,
      currentArtist: p.current?.artist,
      recentRelPaths,
    });
    p.playTrack(shuffled[0], shuffled, 0, { preserveQueueOrder: true });
  };

  const playArtistShuffle = () => {
    if (!artistShuffleEligible.length) return;
    const recentRelPaths = new Set(
      user.state.recent.slice(0, 48).map((t) => t.relPath)
    );
    const shuffled = buildSmartRandomQueue(artistShuffleEligible, {
      currentRelPath: p.current?.relPath,
      currentArtist: p.current?.artist,
      recentRelPaths,
    });
    p.playTrack(shuffled[0], shuffled, 0, { preserveQueueOrder: true });
  };

  if (normalizedQuery && searchResults) {
    return (
      <div className="view-stack library-view">
        <section className="surface-card surface-card--toolbar-only">
          <div className="section-head section-head--page-toolbar">
            <div>
              <p className="eyebrow">{t("library.searchEyebrow")}</p>
              <h2>{t("library.searchHeading", { q: query })}</h2>
            </div>
            <div className="section-head__tools">
              <div
                className="segmented"
                role="group"
                aria-label={t("library.filterResultsAria")}
              >
                {(["all", "artists", "albums", "tracks"] as const).map(
                  (item) => (
                    <button
                      type="button"
                      key={item}
                      className={mode === item ? "is-on" : ""}
                      onClick={() => setMode(item)}
                    >
                      {item === "all"
                        ? t("library.filterAll")
                        : item === "artists"
                        ? t("library.filterArtists")
                        : item === "albums"
                        ? t("library.filterAlbums")
                        : t("library.filterTracks")}
                    </button>
                  )
                )}
              </div>
            </div>
          </div>
        </section>
        <section className="surface-card">
          {(mode === "all" || mode === "artists") && (
            <div className="subsection">
              <h3>{t("library.subArtists")}</h3>
              <div className="artist-grid">
                {searchResults.artists.slice(0, 12).map((item) => (
                  <ArtistCard
                    key={item.id}
                    artist={item}
                    albumCount={item.albums.length}
                    coverAlbumRelPath={artistCoverById.get(item.id) ?? null}
                    index={index}
                    onOpen={() => onOpenArtist(item.id)}
                  />
                ))}
              </div>
            </div>
          )}
          {(mode === "all" || mode === "albums") && (
            <div className="subsection">
              <h3>{t("library.subAlbums")}</h3>
              <div className="album-grid album-grid--artist">
                {searchResults.albums.slice(0, 12).map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    className="album-card"
                    onClick={() => onOpenAlbum(item.artistId, item.name)}
                  >
                    <AlbumCover album={item} compact />
                    <div className="album-card__text">
                      <div className="album-card__title">{item.name}</div>
                      <div className="album-card__meta">{item.artist}</div>
                      <div className="lib-badge-cluster lib-badge-cluster--card-foot">
                        <LibraryAlbumMetaChips album={item} />
                        <LibraryAlbumFavoriteChips album={item} />
                        <LibraryAlbumExcludeChips album={item} />
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
          {(mode === "all" || mode === "tracks") && (
            <div className="subsection">
              <h3>{t("library.subTracks")}</h3>
              <div className="list-stack">
                {searchResults.tracks.slice(0, 50).map((track) => (
                  <TrackListRow
                    key={track.relPath}
                    track={track}
                    onPlay={() => p.playTrack(track, [track], 0)}
                  />
                ))}
              </div>
            </div>
          )}
        </section>
      </div>
    );
  }

  if (album && artist) {
    return (
      <div className="view-stack library-view">
        <section className="album-hero">
          <AlbumCover album={album} />
          <div className="album-hero__body">
            <div className="album-hero__head">
              <div className="section-head section-head--page-toolbar album-hero__toprow">
                <div className="page-toolbar__lead page-toolbar__lead--backrow">
                  <button
                    type="button"
                    className="page-toolbar-back-ic"
                    onClick={() => onOpenArtist(artist.id)}
                    aria-label={t("library.backToArtistAria", {
                      name: artist.name,
                    })}
                  >
                    <span
                      aria-hidden="true"
                      className="page-toolbar-back-ic__glyph"
                    >
                      {"<"}
                    </span>
                  </button>
                  <div className="page-toolbar__textcol album-hero__toolbar-text">
                    <p className="eyebrow">{t("library.albumDetailEyebrow")}</p>
                    <p className="subtle sm album-hero__toolbar-meta">
                      {artist.name}
                      {album.releaseDate
                        ? ` · ${fmtDate(album.releaseDate)}`
                        : ""}
                      {album.label ? ` · ${album.label}` : ""}
                    </p>
                  </div>
                </div>
                <div className="section-head__tools">
                  <div className="hero-card__actions">
                    <button
                      type="button"
                      className="primary-btn"
                      onClick={() =>
                        p.playTrack(albumTracks[0], albumTracks, 0)
                      }
                    >
                      {t("library.playAlbum")}
                    </button>
                    <button
                      type="button"
                      className="ghost-btn"
                      onClick={() => openAlbumMetaEdit(album)}
                    >
                      {t("albumMeta.editButton")}
                    </button>
                    <button
                      type="button"
                      className={`ghost-btn ${
                        excludedAlbums.has(album.id) ? "is-on" : ""
                      }`}
                      onClick={() => user.toggleShuffleExcludedAlbum(album.id)}
                    >
                      {t("library.randomExcludeBtn")}
                    </button>
                  </div>
                </div>
              </div>
              <div className="album-hero__titleblock">
                <h1 className="album-hero__h1">{album.name}</h1>
                <div className="lib-badge-cluster lib-badge-cluster--title-left">
                  <LibraryAlbumMetaChips album={album} variant="hero" />
                  <LibraryAlbumFavoriteChips album={album} variant="hero" />
                  <LibraryAlbumExcludeChips album={album} variant="hero" />
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="surface-card">
          <div className="section-head section-head--page-toolbar">
            <div>
              <p className="eyebrow">{t("library.tracklistEyebrow")}</p>
              <h2>
                {t("library.tracklistHeading", { n: albumTracks.length })}
              </h2>
            </div>
          </div>
          <div className="list-stack">
            {albumTracks.map((track, trIndex) => (
              <TrackListRow
                key={track.relPath}
                track={track}
                onPlay={() => p.playTrack(track, albumTracks, trIndex)}
              />
            ))}
          </div>
        </section>
      </div>
    );
  }

  if (artist) {
    return (
      <div className="view-stack library-view">
        <section className="surface-card surface-card--toolbar-only">
          <div className="section-head section-head--page-toolbar">
            <div className="page-toolbar__lead page-toolbar__lead--backrow">
              <button
                type="button"
                className="page-toolbar-back-ic"
                onClick={() => onOpenArtist("")}
                aria-label={t("library.backAllArtistsAria")}
              >
                <span
                  aria-hidden="true"
                  className="page-toolbar-back-ic__glyph"
                >
                  {"<"}
                </span>
              </button>
              <div className="page-toolbar__textcol">
                <p className="eyebrow">{t("library.artistEyebrow")}</p>
                <h2>{artist.name}</h2>
              </div>
            </div>
            <div className="section-head__tools">
              <div className="hero-card__actions">
                <button
                  type="button"
                  className="primary-btn"
                  disabled={artistShuffleEligible.length === 0}
                  onClick={playArtistShuffle}
                >
                  {t("library.playArtistShuffle")}
                </button>
              </div>
              <div
                className="segmented"
                role="group"
                aria-label={t("library.artistAlbumsSortAria")}
              >
                <button
                  type="button"
                  className={artistAlbumSort === "date" ? "is-on" : ""}
                  onClick={() =>
                    user.updateSettings({ artistAlbumSort: "date" })
                  }
                >
                  {t("library.sortDate")}
                </button>
                <button
                  type="button"
                  className={artistAlbumSort === "name" ? "is-on" : ""}
                  onClick={() =>
                    user.updateSettings({ artistAlbumSort: "name" })
                  }
                >
                  {t("library.sortName")}
                </button>
                <button
                  type="button"
                  className={artistAlbumSort === "plays" ? "is-on" : ""}
                  onClick={() =>
                    user.updateSettings({ artistAlbumSort: "plays" })
                  }
                >
                  {t("library.sortByPlays")}
                </button>
              </div>
            </div>
          </div>
        </section>
        <section className="surface-card">
          <div className="album-grid album-grid--artist">
            {artistAlbums.map((item) => (
              <button
                type="button"
                key={item.id}
                className="album-card"
                onClick={() => onOpenAlbum(artist.id, item.name)}
              >
                <AlbumCover album={item} compact />
                <div className="album-card__text">
                  <div className="album-card__title">{item.name}</div>
                  <div className="album-card__meta">
                    {t("library.tracklistHeading", { n: item.trackCount })}
                    {item.releaseDate ? ` · ${fmtDate(item.releaseDate)}` : ""}
                  </div>
                  <div className="lib-badge-cluster lib-badge-cluster--card-foot">
                    <LibraryAlbumMetaChips album={item} />
                    <LibraryAlbumFavoriteChips album={item} />
                    <LibraryAlbumExcludeChips album={item} />
                  </div>
                </div>
              </button>
            ))}
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="view-stack library-view">
      <section className="surface-card surface-card--toolbar-only">
        <div className="section-head section-head--page-toolbar">
          {selectedGenreKey ? (
            <div className="page-toolbar__lead page-toolbar__lead--backrow">
              <button
                type="button"
                className="page-toolbar-back-ic"
                onClick={() => setSelectedGenreKey(null)}
                aria-label={t("library.backGenresAria")}
              >
                <span
                  aria-hidden="true"
                  className="page-toolbar-back-ic__glyph"
                >
                  {"<"}
                </span>
              </button>
              <div className="page-toolbar__textcol">
                <p className="eyebrow">{t("library.genreEyebrow")}</p>
                <h2>{selectedGenreLabel ?? t("common.emDash")}</h2>
              </div>
            </div>
          ) : (
            <div>
              <p className="eyebrow">{t("library.overviewEyebrow")}</p>
              <h2>
                {libBrowse === "artists"
                  ? t("library.tabArtists")
                  : t("library.tabGenres")}
              </h2>
            </div>
          )}
          <div className="section-head__tools">
            <div className="hero-card__actions">
              {selectedGenreKey ? (
                <>
                  <button
                    type="button"
                    className="primary-btn"
                    disabled={genreShuffleEligible.length === 0}
                    onClick={playGenreShuffle}
                  >
                    {t("library.playGenreShuffle")}
                  </button>
                  <button
                    type="button"
                    className={`ghost-btn library-toolbar-exclude-btn ${
                      genreToolbarBulkAllExcluded ? "is-on" : ""
                    }`}
                    disabled={tracksInSelectedGenre.length === 0}
                    title={t("library.genreRandomExcludeTitle")}
                    aria-label={t("library.genreRandomExcludeAria")}
                    onClick={() => {
                      if (!tracksInSelectedGenre.length) return;
                      user.setShuffleTracksExcludedBulk(
                        tracksInSelectedGenre.map((tr) => tr.relPath),
                        !genreToolbarBulkAllExcluded
                      );
                    }}
                  >
                    <ExcludeShuffleIcon className="library-toolbar-exclude-btn__ic" />
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="primary-btn"
                  onClick={runRandom}
                >
                  {t("listen.smartShuffle")}
                </button>
              )}
            </div>
            <div
              className="segmented"
              role="group"
              aria-label={t("library.sortOverviewAria")}
            >
              <button
                type="button"
                className={libOverviewSort === "name" ? "is-on" : ""}
                onClick={() => user.updateSettings({ libOverviewSort: "name" })}
              >
                {t("library.sortByName")}
              </button>
              <button
                type="button"
                className={libOverviewSort === "plays" ? "is-on" : ""}
                onClick={() =>
                  user.updateSettings({ libOverviewSort: "plays" })
                }
              >
                {t("library.sortByPlays")}
              </button>
            </div>
          </div>
        </div>
      </section>
      <section className="surface-card">
        {!selectedGenreKey ? (
          <div className="library-content-head">
            <div
              className="segmented segmented--joined"
              role="group"
              aria-label={t("library.browseByArtistGenreAria")}
            >
              <button
                type="button"
                className={libBrowse === "artists" ? "is-on" : ""}
                onClick={() => {
                  user.updateSettings({ libBrowse: "artists" });
                  setSelectedGenreKey(null);
                }}
              >
                {t("library.tabArtists")}
              </button>
              <button
                type="button"
                className={libBrowse === "genres" ? "is-on" : ""}
                onClick={() => {
                  user.updateSettings({ libBrowse: "genres" });
                  setSelectedGenreKey(null);
                }}
              >
                {t("library.tabGenres")}
              </button>
            </div>
          </div>
        ) : null}
        {selectedGenreKey ? (
          <>
            <div className="section-head section-head--page-toolbar">
              <div>
                <p className="eyebrow">{t("library.tracklistEyebrow")}</p>
                <h2>
                  {selectedGenreAlbumCount}{" "}
                  {selectedGenreAlbumCount === 1
                    ? t("library.unitAlbum")
                    : t("library.unitAlbumPlural")}
                  {" · "}
                  {sortedGenreTracks.length}{" "}
                  {sortedGenreTracks.length === 1
                    ? t("library.unitTrack")
                    : t("library.unitTrackPlural")}
                </h2>
              </div>
            </div>
            <div className="list-stack">
              {sortedGenreTracks.map((track, trIndex) => (
                <TrackListRow
                  key={track.relPath}
                  track={track}
                  onPlay={() => p.playTrack(track, sortedGenreTracks, trIndex)}
                />
              ))}
            </div>
          </>
        ) : libBrowse === "artists" ? (
          <div className="artist-grid">
            {sortedOverviewArtists.map((item) => (
              <ArtistCard
                key={item.id}
                artist={item}
                albumCount={item.albums.length}
                coverAlbumRelPath={artistCoverById.get(item.id) ?? null}
                index={index}
                onOpen={() => onOpenArtist(item.id)}
              />
            ))}
          </div>
        ) : (
          <div className="genre-browse-wrap">
            <div className="artist-grid">
              {genreIndex.noGenreCount > 0 ? (
                <GenreCard
                  genreKey="__none__"
                  title={t("library.genreCardNoGenre")}
                  albumCount={
                    genreAlbumTrackCounts.get("__none__")?.albums.size ?? 0
                  }
                  trackCount={genreIndex.noGenreCount}
                  albumSlots={genreCoverByKey.get("__none__") ?? []}
                  index={index}
                  muted
                  onOpen={() => setSelectedGenreKey("__none__")}
                />
              ) : null}
              {sortedGenreBrowseList.map((g) => (
                <GenreCard
                  key={g.key}
                  genreKey={g.key}
                  title={g.label}
                  albumCount={
                    genreAlbumTrackCounts.get(g.key)?.albums.size ?? 0
                  }
                  trackCount={g.count}
                  albumSlots={genreCoverByKey.get(g.key) ?? []}
                  index={index}
                  onOpen={() => setSelectedGenreKey(g.key)}
                />
              ))}
            </div>
            {genreIndex.list.length === 0 && genreIndex.noGenreCount === 0 ? (
              <p className="panel-empty">{t("library.noGenresEmpty")}</p>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}

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
          <div>
            <p className="eyebrow">{t("queue.eyebrow")}</p>
            <h2>{t("queue.heading", { n: p.queue.length })}</h2>
          </div>
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
                      <span className="track-row__ic-glyph" aria-hidden>
                        ↑
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
                      <span className="track-row__ic-glyph" aria-hidden>
                        ↓
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

function PlaylistsViewNew({
  route,
  index,
  onPickPlaylist,
}: {
  route: RouteState;
  index: LibraryIndex | null;
  onPickPlaylist: (playlist: string | null) => void;
}) {
  const p = usePlayer();
  const user = useUserState();
  const { t } = useI18n();
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
    <div className="view-stack playlists-page">
      <section className="surface-card surface-card--toolbar-only">
        <div className="section-head section-head--page-toolbar">
          <div>
            <p className="eyebrow">{t("playlists.eyebrow")}</p>
            <h2>{t("playlists.heading")}</h2>
          </div>
          <div className="section-head__tools">
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

      <div className="dashboard-grid playlists-page__main">
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
                      onClick={() => user.deletePlaylist(playlist.id)}
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
                  <div>
                    <p className="eyebrow">{t("playlists.detailEyebrow")}</p>
                    <h2>{activePlaylist.name}</h2>
                  </div>
                  <div className="section-head__tools">
                    <input
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
                              <span className="track-row__ic-glyph" aria-hidden>
                                ×
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
      </div>
    </div>
  );
}

function TrackCollectionView({
  title,
  eyebrow,
  tracks,
}: {
  title: string;
  eyebrow: string;
  tracks: EnrichedTrack[];
}) {
  const p = usePlayer();
  const { t } = useI18n();
  return (
    <div className="view-stack">
      <section className="surface-card surface-card--toolbar-only">
        <div className="section-head section-head--page-toolbar">
          <div>
            <p className="eyebrow">{eyebrow}</p>
            <h2>{title}</h2>
          </div>
        </div>
      </section>
      <section className="surface-card">
        {tracks.length === 0 ? (
          <p className="panel-empty">{t("collection.empty")}</p>
        ) : (
          <div className="list-stack">
            {tracks.map((track, index) => (
              <TrackListRow
                key={`${track.relPath}-${index}`}
                track={track}
                onPlay={() => p.playTrack(track, [track], 0)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

const STATISTICS_TOP_N = 3;

function computeStatisticsRankings(
  index: LibraryIndex,
  counts: Record<string, number>,
  sortLocale: string
) {
  const trackRows = index.tracks
    .map((tr) => ({ tr, n: counts[tr.relPath] ?? 0 }))
    .filter((x) => x.n > 0)
    .sort(
      (a, b) =>
        b.n - a.n ||
        a.tr.title.localeCompare(b.tr.title, sortLocale, { numeric: true }) ||
        a.tr.relPath.localeCompare(b.tr.relPath)
    );
  const artistRows = index.artists
    .map((ar) => {
      let n = 0;
      for (const tr of index.tracks) {
        if (tr.artist === ar.name) n += counts[tr.relPath] ?? 0;
      }
      return { ar, n };
    })
    .filter((x) => x.n > 0)
    .sort(
      (a, b) =>
        b.n - a.n ||
        a.ar.name.localeCompare(b.ar.name, sortLocale, { numeric: true }) ||
        a.ar.id.localeCompare(b.ar.id)
    );
  const albumRows = index.albums
    .map((al) => {
      let n = 0;
      for (const rel of al.tracks) n += counts[rel] ?? 0;
      return { al, n };
    })
    .filter((x) => x.n > 0)
    .sort(
      (a, b) =>
        b.n - a.n ||
        a.al.name.localeCompare(b.al.name, sortLocale, { numeric: true }) ||
        a.al.id.localeCompare(b.al.id)
    );

  const genreMap = new Map<string, { label: string; n: number }>();
  for (const tr of index.tracks) {
    const n = counts[tr.relPath] ?? 0;
    if (n <= 0) continue;
    const raw = tr.meta?.genre?.trim();
    if (!raw) continue;
    const key = raw.toLowerCase();
    const prev = genreMap.get(key);
    if (prev) prev.n += n;
    else genreMap.set(key, { label: raw, n });
  }
  const topGenres = [...genreMap.entries()]
    .map(([key, v]) => ({ key, label: v.label, n: v.n }))
    .sort(
      (a, b) =>
        b.n - a.n ||
        a.label.localeCompare(b.label, sortLocale, { numeric: true })
    )
    .slice(0, STATISTICS_TOP_N);

  let totalPlays = 0;
  for (const tr of index.tracks) {
    totalPlays += counts[tr.relPath] ?? 0;
  }
  const touchedTracks = index.tracks.filter(
    (tr) => (counts[tr.relPath] ?? 0) > 0
  );
  const artistsTouched = new Set(touchedTracks.map((tr) => tr.artist)).size;
  const albumsTouched = new Set(touchedTracks.map((tr) => tr.albumId)).size;

  return {
    topTracks: trackRows.slice(0, STATISTICS_TOP_N),
    topArtists: artistRows.slice(0, STATISTICS_TOP_N),
    topAlbums: albumRows.slice(0, STATISTICS_TOP_N),
    topGenres,
    overview: {
      totalPlays,
      tracksWithPlays: touchedTracks.length,
      artistsTouched,
      albumsTouched,
    },
  };
}

function StatisticsView({
  index,
  onOpenArtist,
  onOpenAlbum,
}: {
  index: LibraryIndex;
  onOpenArtist: (artistId: string) => void;
  onOpenAlbum: (artistId: string, albumName: string) => void;
}) {
  const user = useUserState();
  const { t, sortLocale } = useI18n();
  const counts = user.state.trackPlayCounts || {};
  const data = useMemo(
    () => computeStatisticsRankings(index, counts, sortLocale),
    [index, counts, sortLocale]
  );
  const artistCoverById = useMemo(
    () => buildRandomArtistCoverMap(index),
    [index]
  );
  const totalFavorites = user.state.favorites?.length ?? 0;
  const totalShuffleBlocks = useMemo(() => {
    const tr = user.state.shuffleExcludedTrackRelPaths?.length ?? 0;
    const al = user.state.shuffleExcludedAlbumIds?.length ?? 0;
    return tr + al;
  }, [
    user.state.shuffleExcludedTrackRelPaths,
    user.state.shuffleExcludedAlbumIds,
  ]);

  const openTrackInLibrary = (tr: LibraryTrackIndex) => {
    const arId =
      index.artists.find((a) => a.name === tr.artist)?.id ?? tr.artist;
    onOpenAlbum(arId, tr.album);
  };

  return (
    <div className="view-stack statistics-page">
      <section className="surface-card surface-card--toolbar-only">
        <div className="section-head section-head--page-toolbar">
          <div>
            <p className="eyebrow">{t("statistics.pageEyebrow")}</p>
            <h2>{t("statistics.pageTitle")}</h2>
          </div>
        </div>
      </section>

      <div className="statistics-page__sections">
        <section className="surface-card statistics-section">
          <div className="statistics-section__head">
            <h3>{t("statistics.sectionTracks")}</h3>
          </div>
          {data.topTracks.length === 0 ? (
            <p className="panel-empty statistics-section__empty">
              {t("statistics.rankEmpty")}
            </p>
          ) : (
            <ol className="statistics-rank-list">
              {data.topTracks.map((row, i) => (
                <li key={row.tr.relPath}>
                  <button
                    type="button"
                    className="statistics-rank-row"
                    aria-label={t("statistics.openInLibraryAria", {
                      label: row.tr.title,
                    })}
                    onClick={() => openTrackInLibrary(row.tr)}
                  >
                    <span className="statistics-rank-row__pos">{i + 1}</span>
                    <img
                      className="statistics-rank-row__art"
                      src={coverUrlForTrackRelPath(row.tr.relPath)}
                      alt=""
                    />
                    <div className="statistics-rank-row__text">
                      <div className="statistics-rank-row__title">
                        {row.tr.title}
                      </div>
                      <div className="statistics-rank-row__meta">
                        {row.tr.artist} — {row.tr.album}
                      </div>
                    </div>
                    <div className="statistics-rank-row__plays">
                      {t("trackRow.playCount", { n: row.n })}
                    </div>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="surface-card statistics-section">
          <div className="statistics-section__head">
            <h3>{t("statistics.sectionArtists")}</h3>
          </div>
          {data.topArtists.length === 0 ? (
            <p className="panel-empty statistics-section__empty">
              {t("statistics.rankEmpty")}
            </p>
          ) : (
            <ol className="statistics-rank-list">
              {data.topArtists.map((row, i) => {
                const coverRel = artistCoverById.get(row.ar.id) ?? null;
                return (
                  <li key={row.ar.id}>
                    <button
                      type="button"
                      className="statistics-rank-row"
                      aria-label={t("statistics.openInLibraryAria", {
                        label: row.ar.name,
                      })}
                      onClick={() => onOpenArtist(row.ar.id)}
                    >
                      <span className="statistics-rank-row__pos">{i + 1}</span>
                      {coverRel ? (
                        <img
                          className="statistics-rank-row__art"
                          src={coverUrlForAlbumRelPath(coverRel)}
                          alt=""
                        />
                      ) : (
                        <div
                          className="statistics-rank-row__art statistics-rank-row__art--fallback"
                          aria-hidden
                        >
                          {initials(row.ar.name)}
                        </div>
                      )}
                      <div className="statistics-rank-row__text">
                        <div className="statistics-rank-row__title">
                          {row.ar.name}
                        </div>
                      </div>
                      <div className="statistics-rank-row__plays">
                        {t("trackRow.playCount", { n: row.n })}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        <section className="surface-card statistics-section">
          <div className="statistics-section__head">
            <h3>{t("statistics.sectionAlbums")}</h3>
          </div>
          {data.topAlbums.length === 0 ? (
            <p className="panel-empty statistics-section__empty">
              {t("statistics.rankEmpty")}
            </p>
          ) : (
            <ol className="statistics-rank-list">
              {data.topAlbums.map((row, i) => (
                <li key={row.al.id}>
                  <button
                    type="button"
                    className="statistics-rank-row"
                    aria-label={t("statistics.openInLibraryAria", {
                      label: row.al.name,
                    })}
                    onClick={() => onOpenAlbum(row.al.artistId, row.al.name)}
                  >
                    <span className="statistics-rank-row__pos">{i + 1}</span>
                    <div className="statistics-rank-row__art statistics-rank-row__art--album">
                      <AlbumCover album={row.al} compact />
                    </div>
                    <div className="statistics-rank-row__text">
                      <div className="statistics-rank-row__title">
                        {row.al.name}
                      </div>
                      <div className="statistics-rank-row__meta">
                        {row.al.artist}
                      </div>
                    </div>
                    <div className="statistics-rank-row__plays">
                      {t("trackRow.playCount", { n: row.n })}
                    </div>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="surface-card statistics-section statistics-section--genres">
          <div className="statistics-section__head">
            <h3>{t("statistics.sectionGenres")}</h3>
          </div>
          {data.topGenres.length === 0 ? (
            <p className="panel-empty statistics-section__empty">
              {t("statistics.genresEmpty")}
            </p>
          ) : (
            <ol className="statistics-rank-list">
              {data.topGenres.map((row, i) => (
                <li key={row.key}>
                  <div className="statistics-rank-row statistics-rank-row--static">
                    <span className="statistics-rank-row__pos">{i + 1}</span>
                    <div
                      className="statistics-rank-row__art statistics-rank-row__art--fallback statistics-rank-row__art--genre"
                      aria-hidden
                    >
                      G
                    </div>
                    <div className="statistics-rank-row__text">
                      <div className="statistics-rank-row__title">
                        {row.label}
                      </div>
                    </div>
                    <div className="statistics-rank-row__plays">
                      {t("trackRow.playCount", { n: row.n })}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="surface-card statistics-section statistics-section--overview">
          <div className="statistics-section__head">
            <h3>{t("statistics.sectionOverview")}</h3>
          </div>
          <div className="stats-grid statistics-overview-grid">
            <div className="metric-card statistics-metric">
              <span>{t("statistics.overviewTotalPlays")}</span>
              <strong>{data.overview.totalPlays}</strong>
            </div>
            <div className="metric-card statistics-metric">
              <span>{t("statistics.overviewTracksWithPlays")}</span>
              <strong>{data.overview.tracksWithPlays}</strong>
            </div>
            <div className="metric-card statistics-metric">
              <span>{t("statistics.overviewArtistsTouched")}</span>
              <strong>{data.overview.artistsTouched}</strong>
            </div>
            <div className="metric-card statistics-metric">
              <span>{t("statistics.overviewAlbumsTouched")}</span>
              <strong>{data.overview.albumsTouched}</strong>
            </div>
            <div className="metric-card statistics-metric statistics-metric--summary-wide">
              <span>{t("statistics.overviewFavoritesTotal")}</span>
              <strong>{totalFavorites}</strong>
            </div>
            <div className="metric-card statistics-metric statistics-metric--summary-wide">
              <span>{t("statistics.overviewBlockedTotal")}</span>
              <strong>{totalShuffleBlocks}</strong>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function AccountBadge({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { t } = useI18n();
  const [accounts, setAccounts] = useState<AccountsResponse | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    getSelectedAccountId()
  );

  useEffect(() => {
    fetchAccounts()
      .then((next) => {
        setAccounts(next);
        setSelectedId(getSelectedAccountId() || next.defaultAccountId);
      })
      .catch(() => setAccounts(null));
    const onChange = () => setSelectedId(getSelectedAccountId());
    window.addEventListener("kord-account-session-changed", onChange);
    return () =>
      window.removeEventListener("kord-account-session-changed", onChange);
  }, []);

  if (!accounts || accounts.accounts.length === 0) return null;

  const account =
    accounts.accounts.find((item) => item.id === selectedId) ||
    accounts.accounts[0];
  const letter = (account.name.trim()[0] || "?").toUpperCase();
  return (
    <button
      type="button"
      className="account-badge"
      title={t("accounts.openSettingsTitle", { name: account.name })}
      aria-label={t("accounts.openSettingsTitle", { name: account.name })}
      onClick={onOpenSettings}
    >
      <span aria-hidden>{letter}</span>
    </button>
  );
}

function SettingsView({
  onOpenSection,
}: {
  onOpenSection: (section: Section) => void;
}) {
  const user = useUserState();
  const { t, locale, setLocale } = useI18n();
  const [libLocked, setLibLocked] = useState(false);
  const [listenOnLan, setListenOnLan] = useState(false);
  const [serverPort, setServerPort] = useState(3001);
  const [devClientPort, setDevClientPort] = useState(5173);
  const [lanAccessUrl, setLanAccessUrl] = useState<string | null>(null);
  const [netBusy, setNetBusy] = useState(false);
  const [netErr, setNetErr] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<AccountsResponse | null>(null);
  const [selectedAccountId, setSelectedAccountIdState] = useState<
    string | null
  >(() => getSelectedAccountId());
  const [newAccountName, setNewAccountName] = useState("");
  const [newAccountPath, setNewAccountPath] = useState("");
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountErr, setAccountErr] = useState<string | null>(null);
  const [initialListenOnLan, setInitialListenOnLan] = useState<boolean | null>(
    null
  );
  const [isKordClientEmbed] = useState(() => {
    try {
      return sessionStorage.getItem("kord-embed") === "client";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    Promise.all([fetchConfig(), fetchAccounts()])
      .then(([c, a]) => {
        setLibLocked(c.lockedByEnv);
        setAccounts(a);
        const selected = getSelectedAccountId() || a.defaultAccountId;
        setSelectedAccountIdState(selected);
        const current =
          a.accounts.find((account) => account.id === selected) ||
          a.accounts[0];
        setNewAccountPath(current?.musicRoot || c.musicRoot);
        setInitialListenOnLan((prev) => prev ?? c.listenOnLan);
        setListenOnLan(c.listenOnLan);
        setServerPort(c.serverPort);
        setDevClientPort(c.devClientPort);
        setLanAccessUrl(c.lanAccessUrl);
        setNetErr(null);
        setAccountErr(null);
      })
      .catch((e: unknown) =>
        setAccountErr(e instanceof Error ? e.message : String(e))
      );
  }, []);

  const selectedAccount: Account | null =
    accounts?.accounts.find((account) => account.id === selectedAccountId) ||
    accounts?.accounts[0] ||
    null;

  const saveListenOnLan = (next: boolean) => {
    setNetErr(null);
    setNetBusy(true);
    saveAppConfig({ listenOnLan: next })
      .then((c) => {
        setListenOnLan(c.listenOnLan);
        setLanAccessUrl(c.lanAccessUrl);
        setServerPort(c.serverPort);
        setDevClientPort(c.devClientPort);
      })
      .catch((e: unknown) =>
        setNetErr(e instanceof Error ? e.message : String(e))
      )
      .finally(() => setNetBusy(false));
  };

  const createNewAccount = () => {
    setAccountErr(null);
    setAccountBusy(true);
    createApiAccount({
      name: newAccountName.trim() || t("accounts.newFallback"),
      musicRoot: newAccountPath.trim(),
    })
      .then((next) => {
        setAccounts(next);
        window.location.replace(new URL("/", window.location.href).href);
      })
      .catch((e: unknown) =>
        setAccountErr(e instanceof Error ? e.message : String(e))
      )
      .finally(() => setAccountBusy(false));
  };

  const selectSessionAccount = (id: string) => {
    if (!id || id === selectedAccountId) return;
    setSelectedAccountId(id);
    setSelectedAccountIdState(id);
    window.location.replace(new URL("/", window.location.href).href);
  };

  const removeAccount = (id: string) => {
    setAccountErr(null);
    setAccountBusy(true);
    deleteApiAccount(id)
      .then((next) => {
        setAccounts(next);
        if (getSelectedAccountId() !== selectedAccountId) {
          setSelectedAccountIdState(getSelectedAccountId());
        }
        window.location.replace(new URL("/", window.location.href).href);
      })
      .catch((e: unknown) =>
        setAccountErr(e instanceof Error ? e.message : String(e))
      )
      .finally(() => setAccountBusy(false));
  };

  return (
    <div className="dashboard-grid settings-page">
      <section className="surface-card">
        <div className="section-head section-head--page-toolbar">
          <div>
            <p className="eyebrow">{t("accounts.eyebrow")}</p>
            <h2>{t("accounts.heading")}</h2>
          </div>
        </div>
        {accountErr ? <p className="subtle sm warnline">{accountErr}</p> : null}
        {accounts ? (
          <div className="account-list">
            {accounts.accounts.map((account) => {
              const selected = account.id === selectedAccount?.id;
              return (
                <div
                  key={account.id}
                  className={`account-row${selected ? " is-selected" : ""}`}
                >
                  <button
                    type="button"
                    className="account-row__main"
                    disabled={accountBusy || selected}
                    onClick={() => selectSessionAccount(account.id)}
                  >
                    <span className="account-row__avatar" aria-hidden>
                      {(account.name.trim()[0] || "?").toUpperCase()}
                    </span>
                    <span className="account-row__text">
                      <strong>{account.name}</strong>
                      <span>{account.musicRoot}</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="btn secondary"
                    disabled={accountBusy || accounts.accounts.length <= 1}
                    onClick={() => removeAccount(account.id)}
                  >
                    {t("accounts.remove")}
                  </button>
                </div>
              );
            })}
          </div>
        ) : null}
        {!libLocked ? (
          <div className="settings-merge-block">
            <div className="section-head section-head--page-toolbar">
              <div>
                <p className="eyebrow">{t("accounts.createEyebrow")}</p>
                <h2>{t("accounts.createHeading")}</h2>
              </div>
            </div>
            <div
              className="row gap flex-wrap"
              style={{ alignItems: "flex-end" }}
            >
              <label className="flex1" style={{ minWidth: "10rem" }}>
                <span className="sr-only">{t("accounts.newNameAria")}</span>
                <input
                  type="text"
                  className="ghost-input w-full"
                  value={newAccountName}
                  onChange={(event) => setNewAccountName(event.target.value)}
                  placeholder={t("accounts.newNamePh")}
                  autoComplete="off"
                />
              </label>
              <label className="flex1" style={{ minWidth: "12rem" }}>
                <span className="sr-only">{t("accounts.newPathAria")}</span>
                <input
                  type="text"
                  className="ghost-input w-full"
                  value={newAccountPath}
                  onChange={(event) => setNewAccountPath(event.target.value)}
                  placeholder={t("settings.libPathPh")}
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
              <button
                type="button"
                className="btn"
                disabled={accountBusy || !newAccountPath.trim()}
                onClick={createNewAccount}
              >
                {accountBusy ? t("settings.saving") : t("accounts.create")}
              </button>
            </div>
          </div>
        ) : null}
      </section>
      <section className="surface-card settings-ui-section">
        <div className="section-head section-head--page-toolbar">
          <div>
            <p className="eyebrow">{t("settings.uiEyebrow")}</p>
            <h2>{t("settings.uiHeading")}</h2>
          </div>
        </div>
        <div className="settings-grid settings-ui-section__grid">
          <label className="setting-card">
            <span>{t("settings.language")}</span>
            <select
              value={locale}
              onChange={(event) => setLocale(event.target.value as AppLocale)}
            >
              {APP_LOCALES.map((loc) => (
                <option key={loc} value={loc}>
                  {loc === "en" ? t("settings.langEn") : t("settings.langIt")}
                </option>
              ))}
            </select>
          </label>
          <div className="setting-card">
            <span>{t("settings.theme")}</span>
            <ThemePicker
              value={user.state.settings.theme}
              onChange={(theme) => user.updateSettings({ theme })}
            />
          </div>
          <label className="setting-card">
            <span>{t("settings.visualizer")}</span>
            <select
              value={user.state.settings.vizMode}
              onChange={(event) =>
                user.updateSettings({
                  vizMode: event.target.value as
                    | "bars"
                    | "mirror"
                    | "osc"
                    | "signals"
                    | "embers"
                    | "kord",
                })
              }
            >
              <option value="bars">{t("settings.vizBars")}</option>
              <option value="mirror">{t("settings.vizMirror")}</option>
              <option value="osc">{t("settings.vizOsc")}</option>
              <option value="signals">{t("settings.vizSignals")}</option>
              <option value="embers">{t("settings.vizEmbers")}</option>
              <option value="kord">{t("settings.vizKord")}</option>
            </select>
          </label>
          <label className="setting-card checkbox">
            <input
              type="checkbox"
              checked={user.state.settings.restoreSession}
              onChange={(event) =>
                user.updateSettings({ restoreSession: event.target.checked })
              }
            />
            <span>{t("settings.restoreSession")}</span>
          </label>
        </div>
      </section>
      <section className="surface-card">
        <div className="settings-merge-block settings-merge-block--first">
          <div className="section-head section-head--page-toolbar">
            <div>
              <p className="eyebrow">{t("settings.shortcutsEyebrow")}</p>
              <h2>{t("settings.shortcutsHeading")}</h2>
            </div>
          </div>
          <div className="shortcut-list">
            <div className="shortcut-row">
              <span className="shortcut-keys">
                <kbd className="shortcut-kbd">/</kbd>
                <span className="shortcut-keys__sep">
                  {t("settings.shortcutOr")}
                </span>
                <kbd className="shortcut-kbd">{t("settings.kbdCtrlK")}</kbd>
              </span>
              <span className="shortcut-row__dash" aria-hidden>
                —
              </span>
              <span className="shortcut-row__desc">
                {t("settings.shortcutSearchDesc")}
              </span>
            </div>
            <div className="shortcut-row">
              <kbd className="shortcut-kbd">{t("settings.kbdSpace")}</kbd>
              <span className="shortcut-row__dash" aria-hidden>
                —
              </span>
              <span className="shortcut-row__desc">
                {t("settings.shortcutPlayDesc")}
              </span>
            </div>
            <div className="shortcut-row">
              <kbd className="shortcut-kbd">{t("settings.kbdI")}</kbd>
              <span className="shortcut-row__dash" aria-hidden>
                —
              </span>
              <span className="shortcut-row__desc">
                {t("settings.shortcutListenDesc")}
              </span>
            </div>
          </div>
          <button
            type="button"
            className="text-btn"
            onClick={() => onOpenSection("dashboard")}
          >
            {t("settings.backDashboard")}
          </button>
        </div>
      </section>
      {isKordClientEmbed ? null : (
        <section className="surface-card">
          <div className="section-head section-head--page-toolbar">
            <div>
              <p className="eyebrow">{t("settings.networkEyebrow")}</p>
              <h2>{t("settings.networkHeading")}</h2>
            </div>
          </div>
          {netErr ? <p className="subtle sm warnline">{netErr}</p> : null}
          <p className="subtle sm">
            {t("settings.networkLead", {
              port: serverPort,
              devPort: devClientPort,
            })}
          </p>
          <label className="setting-card checkbox">
            <input
              type="checkbox"
              checked={listenOnLan}
              disabled={netBusy}
              onChange={(e) => saveListenOnLan(e.target.checked)}
            />
            <span>{t("settings.networkListenOnLan")}</span>
          </label>
          {listenOnLan && lanAccessUrl ? (
            <p className="subtle sm">
              {t("settings.networkUrlHint", { url: lanAccessUrl })}
            </p>
          ) : listenOnLan ? (
            <p className="subtle sm">{t("settings.networkNoUrl")}</p>
          ) : null}
          {initialListenOnLan !== null && listenOnLan !== initialListenOnLan ? (
            <p className="subtle sm warnline">
              {t("settings.networkRestartHint")}
            </p>
          ) : null}
        </section>
      )}
    </div>
  );
}

function PlayerDock({
  onGoToAscolta,
  onOpenLibraryArtist,
  onOpenLibraryAlbum,
}: {
  onGoToAscolta: () => void;
  onOpenLibraryArtist: (artist: string) => void;
  onOpenLibraryAlbum: (artist: string, album: string) => void;
}) {
  const p = usePlayer();
  const user = useUserState();
  const { t } = useI18n();
  useSyncExternalStore(
    subscribeTrackExclusionEpoch,
    getTrackExclusionEpoch,
    getTrackExclusionEpoch
  );
  const percent = p.duration > 0 ? (p.currentTime / p.duration) * 100 : 0;
  const cur = p.current;
  const exAlb = getExcludedAlbums();
  const albumShuffleExcluded = Boolean(
    cur && isTrackAlbumShuffleExcluded(cur, exAlb)
  );
  const trackShuffleExcluded = Boolean(
    cur && getExcludedTracks().has(cur.relPath)
  );
  const shuffleExcluded = albumShuffleExcluded || trackShuffleExcluded;
  const openListenFromTopBar = (event: ReactMouseEvent<HTMLDivElement>) => {
    const el = event.target as HTMLElement;
    if (
      el.closest("button, input, .volume2, .player-bar2__byline, label.volume2")
    ) {
      return;
    }
    onGoToAscolta();
  };
  return (
    <div className="player-dock2">
      <footer className="player-bar2">
        <div
          className="player-bar2__row player-bar2__row--top player-bar2__row--open-listen"
          onClick={openListenFromTopBar}
          title={t("player.openListenTitle")}
        >
          <div className="player-bar2__track-block">
            <div className="player-bar2__track">
              <div className="player-bar2__art-hit">
                {cur ? (
                  <img
                    className="player-bar2__art"
                    src={coverUrlForTrackRelPath(cur.relPath)}
                    alt=""
                  />
                ) : (
                  <div className="player-bar2__art fallback">♪</div>
                )}
              </div>
              <div className="player-bar2__meta">
                <div className="player-bar2__title-line">
                  <strong>{cur?.title || t("player.pickTrack")}</strong>
                </div>
                {cur ? (
                  <div className="player-bar2__byline">
                    <button
                      type="button"
                      className="player-bar2__crumb"
                      title={t("player.openArtistLibTitle")}
                      onClick={() => onOpenLibraryArtist(cur.artist)}
                    >
                      {cur.artist}
                    </button>
                    <span className="player-bar2__byline-sep" aria-hidden>
                      {" "}
                      ·{" "}
                    </span>
                    <button
                      type="button"
                      className="player-bar2__crumb"
                      title={t("player.openAlbumLibTitle")}
                      onClick={() => onOpenLibraryAlbum(cur.artist, cur.album)}
                    >
                      {cur.album}
                    </button>
                  </div>
                ) : (
                  <span className="player-bar2__byline player-bar2__byline--idle">
                    {t("player.playerReady")}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div
            className="player-bar2__transport"
            role="group"
            aria-label={t("player.transportAria")}
          >
            {cur ? (
              <button
                type="button"
                className={`player-bar2__fav player-bar2__rail-fav ${
                  user.isFavorite(cur.relPath) ? "is-on" : ""
                }`}
                onClick={() => {
                  user.toggleFavorite(cur.relPath);
                }}
                title={t("trackRow.favTitle")}
                aria-pressed={user.isFavorite(cur.relPath)}
                aria-label={t("trackRow.favAria")}
              >
                <span aria-hidden>♥</span>
              </button>
            ) : null}
            <div className="player-bar2__controls">
              <button
                type="button"
                className={`player-bar2__ic ${p.shuffle ? "is-on" : ""}`}
                onClick={() => p.setShuffle(!p.shuffle)}
                title={t("player.shuffleTitle")}
                aria-pressed={p.shuffle}
              >
                <span className="player-bar2__ic-glyph" aria-hidden>
                  ⇄
                </span>
              </button>
              <button
                type="button"
                className="player-bar2__ic"
                onClick={() => p.prev()}
                title={t("player.prevTitle")}
              >
                <span className="player-bar2__ic-glyph" aria-hidden>
                  ⏮
                </span>
              </button>
              <button
                type="button"
                className="player-bar2__ic player-bar2__ic--play"
                onClick={() => p.toggle()}
                title={
                  p.isPlaying ? t("player.pauseTitle") : t("player.playTitle")
                }
              >
                <span className="player-bar2__ic-glyph" aria-hidden>
                  {p.isPlaying ? "⏸" : "▶"}
                </span>
              </button>
              <button
                type="button"
                className="player-bar2__ic"
                onClick={() => p.next()}
                title={t("player.nextTitle")}
              >
                <span className="player-bar2__ic-glyph" aria-hidden>
                  ⏭
                </span>
              </button>
              <button
                type="button"
                className={`player-bar2__ic player-bar2__ic--repeat ${
                  p.repeat === "off" ? "is-dim" : "is-on"
                } ${p.repeat === "one" ? "player-bar2__ic--repeat-one" : ""}`}
                onClick={() =>
                  p.setRepeat(
                    p.repeat === "off"
                      ? "all"
                      : p.repeat === "all"
                      ? "one"
                      : "off"
                  )
                }
                title={
                  p.repeat === "off"
                    ? t("player.repeatOff")
                    : p.repeat === "all"
                    ? t("player.repeatAll")
                    : t("player.repeatOne")
                }
              >
                <span className="player-bar2__ic-glyph" aria-hidden>
                  ↻
                </span>
              </button>
            </div>
            {cur ? (
              <button
                type="button"
                className={`player-bar2__ic player-bar2__ic--exclude ${
                  shuffleExcluded ? "is-on" : ""
                }`}
                disabled={albumShuffleExcluded}
                title={
                  albumShuffleExcluded
                    ? t("trackRow.excludeLockedByAlbumTitle")
                    : t("trackRow.excludeTitle")
                }
                aria-pressed={shuffleExcluded}
                aria-label={
                  albumShuffleExcluded
                    ? t("trackRow.excludeLockedByAlbumAria")
                    : t("trackRow.excludeTitle")
                }
                onClick={() => {
                  if (!cur || albumShuffleExcluded) return;
                  user.toggleShuffleExcludedTrack(cur.relPath);
                }}
              >
                <span
                  className="player-bar2__ic-glyph player-bar2__ic-glyph--svg"
                  aria-hidden
                >
                  <ExcludeShuffleIcon />
                </span>
              </button>
            ) : null}
          </div>
          <label className="volume2">
            <span className="sr-only">{t("player.volumeAria")}</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={p.volume}
              onChange={(event) => p.setVolume(Number(event.target.value))}
            />
          </label>
        </div>
        <div className="player-bar2__row player-bar2__row--seek">
          <div className="player-bar2__timeline">
            <div
              className="progress2"
              onClick={(event) => {
                const el = event.currentTarget as HTMLDivElement;
                const rect = el.getBoundingClientRect();
                p.seekRatio((event.clientX - rect.left) / rect.width);
              }}
            >
              <div
                className="progress2__fill"
                style={{ width: `${percent}%` }}
              />
            </div>
            <div className="player-bar2__times">
              <span>{formatDuration(p.currentTime)}</span>
              <span>{formatDuration(p.duration)}</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

function Shell() {
  const { route, navigate } = useAppRoute();
  const p = usePlayer();
  const user = useUserState();
  const { t } = useI18n();
  const toolsActivity = useToolsActivity();
  const [index, setIndex] = useState<LibraryIndex | null>(null);
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const prevSectionForSearchRef = useRef<Section | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    return Promise.all([fetchLibraryIndex(), fetchDashboard()])
      .then(([libraryData, dashboardData]) => {
        setIndex(libraryData);
        setDashboard(dashboardData);
        setError(null);
      })
      .catch((err: unknown) => setError(String(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refresh();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  useEffect(() => {
    if (!index) return;
    p.resyncTracksFromIndex(index);
    user.rehydrateTrackListsFromLibrary(index);
    user.rehydrateShuffleExclusionsFromIndex(index);
  }, [
    index,
    p.resyncTracksFromIndex,
    user.rehydrateTrackListsFromLibrary,
    user.rehydrateShuffleExclusionsFromIndex,
  ]);

  useEffect(() => {
    const prev = prevSectionForSearchRef.current;
    if (prev === "libreria" && route.section !== "libreria") {
      const id = window.requestAnimationFrame(() => setSearch(""));
      prevSectionForSearchRef.current = route.section;
      return () => window.cancelAnimationFrame(id);
    }
    prevSectionForSearchRef.current = route.section;
  }, [route.section]);

  const ensureLibrarySectionForSearch = useCallback(() => {
    if (route.section !== "libreria") {
      navigate({ section: "libreria", artist: null, album: null });
    }
  }, [navigate, route.section]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const inField =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;

      if (event.ctrlKey && event.key.toLowerCase() === "k" && !event.altKey) {
        event.preventDefault();
        ensureLibrarySectionForSearch();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }

      if (inField) return;

      if (event.key === "/" && !event.altKey) {
        event.preventDefault();
        ensureLibrarySectionForSearch();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }

      if (event.code === "Space") {
        event.preventDefault();
        p.toggle();
      } else if (event.code === "KeyI") {
        event.preventDefault();
        navigate({ section: "ascolta" });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [p, navigate, ensureLibrarySectionForSearch]);

  const legacyLibrary = useMemo(() => clientLegacyLibrary(index), [index]);
  const favoriteTracks = useMemo(() => {
    if (!index) return [];
    return user.state.favorites
      .map((relPath) => index.tracks.find((track) => track.relPath === relPath))
      .filter((track): track is LibraryTrackIndex => Boolean(track))
      .sort(
        (a, b) =>
          (user.state.trackPlayCounts?.[b.relPath] ?? 0) -
            (user.state.trackPlayCounts?.[a.relPath] ?? 0) ||
          a.title.localeCompare(b.title, undefined, { numeric: true })
      );
  }, [index, user.state.favorites, user.state.trackPlayCounts]);

  const libraryGenreOptions = useMemo(() => {
    if (!index) return [];
    const s = new Set<string>();
    for (const tr of index.tracks) {
      const g = tr.meta?.genre?.trim();
      if (g) s.add(g);
    }
    return [...s].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" })
    );
  }, [index]);

  const currentView = (() => {
    if (loading && !index)
      return <div className="panel-empty">{t("loading.app")}</div>;
    if (error && !index)
      return <div className="panel-empty danger">{error}</div>;
    if (!index) return <div className="panel-empty">{t("empty.noData")}</div>;
    switch (route.section) {
      case "dashboard":
        return (
          <DashboardView
            dashboard={dashboard}
            index={index}
            onOpenAlbum={(artist, album) =>
              navigate({ section: "libreria", artist, album })
            }
            onOpenSection={(section) => navigate({ section })}
            onPlayTrack={(track) => p.playTrack(track, [track], 0)}
          />
        );
      case "ascolta":
        return (
          <ListenView
            dashboard={dashboard}
            index={index}
            onOpenSection={(section) => navigate({ section })}
          />
        );
      case "libreria":
        return (
          <LibraryView
            index={index}
            route={route}
            query={deferredSearch}
            onOpenArtist={(artist) =>
              navigate({
                section: "libreria",
                artist: artist || null,
                album: null,
              })
            }
            onOpenAlbum={(artist, album) =>
              navigate({ section: "libreria", artist, album })
            }
          />
        );
      case "studio":
        return (
          <div className="view-stack">
            <ToolsView library={legacyLibrary} onRefreshLibrary={refresh} />
          </div>
        );
      case "queue":
        return (
          <QueueViewNew
            onOpenSavedPlaylist={(id) =>
              navigate({ section: "playlists", playlist: id })
            }
          />
        );
      case "playlists":
        return (
          <PlaylistsViewNew
            route={route}
            index={index}
            onPickPlaylist={(playlist) =>
              navigate({ section: "playlists", playlist })
            }
          />
        );
      case "favorites":
        return (
          <TrackCollectionView
            title={t("collection.favoritesTitle")}
            eyebrow={t("collection.favoritesEyebrow")}
            tracks={favoriteTracks}
          />
        );
      case "recent":
        return (
          <TrackCollectionView
            title={t("collection.recentTitle")}
            eyebrow={t("collection.recentEyebrow")}
            tracks={user.state.recent}
          />
        );
      case "settings":
        return (
          <SettingsView onOpenSection={(section) => navigate({ section })} />
        );
      case "statistics":
        return (
          <StatisticsView
            index={index}
            onOpenArtist={(artistId) =>
              navigate({
                section: "libreria",
                artist: artistId,
                album: null,
              })
            }
            onOpenAlbum={(artistId, album) =>
              navigate({ section: "libreria", artist: artistId, album })
            }
          />
        );
      default:
        return null;
    }
  })();

  return (
    <TrackMetaEditProvider genreOptions={libraryGenreOptions} onSaved={refresh}>
      <AlbumMetaEditProvider onSaved={refresh}>
        <div className="app-shell">
          <div className="main-shell">
            <header className="topbar2 topbar2--toolbar" role="banner">
              <h1 className="sr-only">
                {t(
                  NAV_DEF.find((item) => item.id === route.section)?.labelKey ||
                    "nav.dashboard"
                )}
              </h1>
              <div className="topbar2__row">
                <div className="topbar2__start">
                  <div className="topbar2__brand">
                    <KordWordmarkSvg className="kord-wordmark-svg kord-wordmark-svg--topbar" />
                  </div>
                  <nav className="topbar-nav" aria-label={t("topbar.navAria")}>
                    <div className="topbar-nav__group">
                      {NAV_DEF.filter((item) => item.group === "core").map(
                        (item) => (
                          <button
                            type="button"
                            key={item.id}
                            className={`topbar-nav__btn ${
                              route.section === item.id ? "is-active" : ""
                            }`}
                            onClick={() => navigate({ section: item.id })}
                          >
                            {t(item.labelKey)}
                          </button>
                        )
                      )}
                    </div>
                    <span className="topbar-nav__sep" aria-hidden />
                    <div className="topbar-nav__group">
                      {NAV_DEF.filter((item) => item.group === "secondary").map(
                        (item) => (
                          <button
                            type="button"
                            key={item.id}
                            className={`topbar-nav__btn ${
                              route.section === item.id ? "is-active" : ""
                            }`}
                            onClick={() => navigate({ section: item.id })}
                          >
                            {t(item.labelKey)}
                          </button>
                        )
                      )}
                    </div>
                  </nav>
                </div>
                <div className="topbar2__end">
                  {index ? (
                    <p className="topbar2__kpi">
                      {t("topbar.kpi", {
                        art: index.stats.artistCount,
                        alb: index.stats.albumCount,
                        state: user.saving
                          ? t("topbar.saving")
                          : t("topbar.saved"),
                      })}
                    </p>
                  ) : null}
                  <label className="topbar2__search">
                    <span className="sr-only">{t("topbar.searchAria")}</span>
                    <input
                      ref={searchInputRef}
                      className="ghost-input ghost-input--search ghost-input--topbar"
                      type="search"
                      name="library-search"
                      placeholder={t("topbar.searchPlaceholder")}
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      onFocus={ensureLibrarySectionForSearch}
                      autoComplete="off"
                      role="searchbox"
                      aria-label={t("topbar.searchAria")}
                    />
                  </label>
                  <div className="topbar2__refresh-wrap">
                    {toolsActivity.toolsAnyBusy ? (
                      <span
                        className="topbar2__tools-spinner"
                        role="status"
                        aria-label={t("topbar.toolsBusyTitle")}
                      />
                    ) : null}
                    <button
                      type="button"
                      className="ghost-btn ghost-btn--toolbar"
                      onClick={refresh}
                      title={t("topbar.refreshTitle")}
                    >
                      {t("topbar.refresh")}
                    </button>
                  </div>
                  <AccountBadge
                    onOpenSettings={() => navigate({ section: "settings" })}
                  />
                </div>
              </div>
            </header>

            {error && index ? (
              <div className="inline-banner">{error}</div>
            ) : null}
            {user.error ? (
              <div className="inline-banner">
                {t("persist.banner")} {user.error}
              </div>
            ) : null}

            <main className="content-shell">{currentView}</main>
          </div>

          <PlayerDock
            onGoToAscolta={() => navigate({ section: "ascolta" })}
            onOpenLibraryArtist={(artist) =>
              navigate({ section: "libreria", artist, album: null })
            }
            onOpenLibraryAlbum={(artist, album) =>
              navigate({ section: "libreria", artist, album })
            }
          />
        </div>
      </AlbumMetaEditProvider>
    </TrackMetaEditProvider>
  );
}

export default function App() {
  return (
    <UserStateProvider>
      <PlayerProvider>
        <ToolsActivityProvider>
          <Shell />
        </ToolsActivityProvider>
      </PlayerProvider>
    </UserStateProvider>
  );
}
