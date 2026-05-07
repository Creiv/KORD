import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { CSSProperties, RefObject } from "react";
import { usePlayer } from "../../context/PlayerContext";
import { useUserState } from "../../context/UserStateContext";
import { useAppConfirm } from "../../context/AppConfirmContext";
import { useI18n } from "../../i18n/useI18n";
import { useLibraryCardPlayback } from "../../hooks/useLibraryCardPlayback";
import { useOpenAlbumMetaEdit } from "../../components/AlbumMetaEditor";
import { TrackMetaEditGlyph } from "../../components/TrackMetaEditor";
import { AlbumTracklistExpectedMeta } from "../../components/AlbumTracklistExpectedMeta";
import {
  AlbumCardTracksMetaLine,
  AlbumCover,
  DraggableBadgeCluster,
  LibraryAlbumExcludeChips,
  LibraryAlbumFavoriteChips,
  LibraryAlbumMetaChips,
  TrackListRow,
} from "../../components/AppSharedUi";
import { SectionHeadLead } from "../../components/SectionHeadLead";
import { ExcludeShuffleIcon } from "../../components/ExcludeShuffleIcon";
import { TrackMoodGlyph } from "../../components/TrackMoodGlyph";
import { ArtistCard } from "../../components/ArtistCard/ArtistCard";
import { GenreCard } from "../../components/GenreCard/GenreCard";
import {
  UiAdd,
  UiAlbumIcon,
  UiBarChart,
  UiChevronLeft,
  UiClose,
  UiDateRange,
  UiMusicNote,
  UiPalette,
  UiPerson,
  UiSortByAlpha,
  UiStyle,
  UiViewModule,
} from "../../components/KordUiIcons";
import {
  saveTrackInfoManual,
} from "../../lib/api";
import { isTrackAlbumShuffleExcluded } from "../../lib/randomExclusions";
import { eligibleTracksForIntelligentRandom } from "../../lib/randomExclusions";
import { buildSmartRandomQueue } from "../../lib/smartShuffle";
import {
  parseTrackGenres,
  serializeTrackGenres,
  trackBelongsToGenreKey,
} from "../../lib/genres";
import { fmtDate } from "../../lib/metaFormat";
import { buildRandomArtistCoverMap } from "../../lib/artistCover";
import { buildGenreCoverPreviewMap } from "../../lib/genreCovers";
import {
  parseTrackMoods,
  TRACK_MOOD_COLORS,
  TRACK_MOOD_IDS,
  type TrackMoodId,
} from "../../lib/trackMoods";
import type {
  LibraryAlbumIndex,
  LibraryArtistIndex,
  LibraryIndex,
  LibraryTrackIndex,
} from "../../types";
import type { RouteState } from "../../lib/routing";

interface LibraryViewProps {
  index: LibraryIndex;
  route: RouteState;
  query: string;
  libraryHomeTick: number;
  onOpenArtist: (artist: string) => void;
  onOpenAlbum: (artist: string, album: string) => void;
  search: string;
  onSearchChange: (value: string) => void;
  searchInputRef: RefObject<HTMLInputElement | null>;
  onSearchFocus: () => void;
  showSearchBar: boolean;
  onSearchBarClose: () => void;
  onRefreshLibrary: () => Promise<void>;
}

export default function LibraryView({
  index,
  route,
  query,
  libraryHomeTick,
  onOpenArtist,
  onOpenAlbum,
  search,
  onSearchChange,
  searchInputRef,
  onSearchFocus,
  showSearchBar,
  onSearchBarClose,
  onRefreshLibrary,
}: LibraryViewProps) {
  const p = usePlayer();
  const user = useUserState();
  const playFromLibraryCard = useLibraryCardPlayback(index.tracks);
  const { t, sortLocale } = useI18n();
  const { confirm: appConfirm } = useAppConfirm();
  const openAlbumMetaEdit = useOpenAlbumMetaEdit();
  const { libBrowse, libOverviewSort, artistAlbumSort } = user.state.settings;
  const [mode, setMode] = useState<"all" | "artists" | "albums" | "tracks">(
    "all"
  );
  const excludedAlbums = useMemo(
    () => new Set(user.state.shuffleExcludedAlbumIds),
    [user.state.shuffleExcludedAlbumIds]
  );
  const excludedTracks = useMemo(
    () => new Set(user.state.shuffleExcludedTrackRelPaths),
    [user.state.shuffleExcludedTrackRelPaths]
  );
  const [selectedGenreKey, setSelectedGenreKey] = useState<string | null>(null);
  const [moodFilterIds, setMoodFilterIds] = useState<TrackMoodId[]>([]);
  const [moodMatchMode, setMoodMatchMode] = useState<"any" | "all">("any");
  const normalizedQuery = query.trim().toLowerCase();

  useEffect(() => {
    if (libraryHomeTick < 1) return;
    startTransition(() => {
      setSelectedGenreKey(null);
      setMoodFilterIds([]);
      setMoodMatchMode("any");
      setMode("all");
    });
  }, [libraryHomeTick]);

  const artist = route.artist
    ? index.artists.find((item) => item.id === route.artist) || null
    : null;

  const artistAlbums = useMemo(() => {
    if (!artist) return [];
    const counts = user.state.trackPlayCounts || {};
    const list = index.albums.filter((album) => album.artistId === artist.id);
    const next = [...list];
    if (artistAlbumSort === "date") {
      next.sort((a, b) => {
        const da = String(a.releaseDate || "");
        const db = String(b.releaseDate || "");
        if (!da && !db) {
          return a.name.localeCompare(b.name, sortLocale, { numeric: true });
        }
        if (!da) return 1;
        if (!db) return -1;
        return (
          db.localeCompare(da, undefined, { numeric: true }) ||
          a.name.localeCompare(b.name, sortLocale, { numeric: true })
        );
      });
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

  const [albumGenrePickerOpen, setAlbumGenrePickerOpen] = useState(false);
  const [albumGenreBusy, setAlbumGenreBusy] = useState(false);
  const [albumGenreErr, setAlbumGenreErr] = useState<string | null>(null);

  const albumTrackGenres = useMemo(() => {
    const byLower = new Map<string, string>();
    for (const tr of albumTracks) {
      for (const g of parseTrackGenres(tr.meta?.genre)) {
        const low = g.toLowerCase();
        if (!byLower.has(low)) byLower.set(low, g);
      }
    }
    return Array.from(byLower.values()).sort((a, b) =>
      a.localeCompare(b, sortLocale, { numeric: true })
    );
  }, [albumTracks, sortLocale]);

  const applyAlbumGenreToAllTracks = useCallback(
    async (genreToken: string, applyMode: "add" | "remove") => {
      const albumPath = album?.relPath;
      if (!albumPath || albumTracks.length === 0) return;
      const token = genreToken.trim();
      if (!token) return;
      setAlbumGenreBusy(true);
      setAlbumGenreErr(null);
      try {
        for (const tr of albumTracks) {
          const cur = parseTrackGenres(tr.meta?.genre);
          const low = token.toLowerCase();
          const next =
            applyMode === "add"
              ? cur.some((g) => g.toLowerCase() === low)
                ? cur
                : [...cur, token]
              : cur.filter((g) => g.toLowerCase() !== low);
          const nextSerialized = serializeTrackGenres(next);
          await saveTrackInfoManual(tr.relPath, {
            genre: nextSerialized || null,
          });
        }
        await onRefreshLibrary();
      } catch (e: unknown) {
        setAlbumGenreErr(e instanceof Error ? e.message : String(e));
      } finally {
        setAlbumGenreBusy(false);
      }
    },
    [album?.relPath, albumTracks, onRefreshLibrary]
  );

  const albumGenreOptions = useMemo(() => {
    const albumKeys = new Set(albumTrackGenres.map((g) => g.toLowerCase()));
    const byLower = new Map<string, string>();
    for (const tr of index.tracks) {
      for (const g of parseTrackGenres(tr.meta?.genre)) {
        const low = g.toLowerCase();
        if (!byLower.has(low)) byLower.set(low, g);
      }
    }
    return Array.from(byLower.values())
      .filter((g) => !albumKeys.has(g.toLowerCase()))
      .sort((a, b) => a.localeCompare(b, sortLocale, { numeric: true }));
  }, [albumTrackGenres, index.tracks, sortLocale]);

  const addAlbumGenreBySelection = useCallback(
    async (genreToken: string) => {
      const token = genreToken.trim();
      if (!token) return;
      await applyAlbumGenreToAllTracks(token, "add");
      setAlbumGenrePickerOpen(false);
    },
    [applyAlbumGenreToAllTracks]
  );

  const removeAlbumGenre = useCallback(
    async (genreToken: string) => {
      if (
        !(await appConfirm({
          message: t("albumMeta.removeGenreAllConfirm", { g: genreToken }),
          variant: "danger",
        }))
      ) {
        return;
      }
      await applyAlbumGenreToAllTracks(genreToken, "remove");
    },
    [appConfirm, applyAlbumGenreToAllTracks, t]
  );

  const artistShuffleEligible = useMemo(() => {
    if (!artist) return [] as LibraryTrackIndex[];
    const rels = new Set(artistAlbums.flatMap((al) => al.tracks));
    return index.tracks.filter(
      (tr) =>
        rels.has(tr.relPath) &&
        !excludedTracks.has(tr.relPath) &&
        !isTrackAlbumShuffleExcluded(tr, excludedAlbums)
    );
  }, [artist, artistAlbums, index.tracks, excludedAlbums, excludedTracks]);

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
    for (const tr of index.tracks) {
      const toks = parseTrackGenres(tr.meta?.genre);
      if (toks.length === 0) bump("__none__", tr.albumId);
      else for (const g of toks) bump(g.toLowerCase(), tr.albumId);
    }
    return m;
  }, [index.tracks]);

  const genreIndex = useMemo(() => {
    const byLower = new Map<string, { label: string; count: number }>();
    let noGenre = 0;
    for (const tr of index.tracks) {
      const toks = parseTrackGenres(tr.meta?.genre);
      if (toks.length === 0) {
        noGenre += 1;
        continue;
      }
      for (const raw of toks) {
        const low = raw.toLowerCase();
        const prev = byLower.get(low);
        if (!prev) byLower.set(low, { label: raw, count: 1 });
        else prev.count += 1;
      }
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
    return index.tracks.filter((tr) =>
      trackBelongsToGenreKey(tr.meta?.genre, selectedGenreKey)
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
    return tracksInSelectedGenre.filter(
      (tr) =>
        !excludedTracks.has(tr.relPath) &&
        !isTrackAlbumShuffleExcluded(tr, excludedAlbums)
    );
  }, [selectedGenreKey, tracksInSelectedGenre, excludedTracks, excludedAlbums]);

  const genreToolbarBulkAllExcluded = useMemo(() => {
    if (!tracksInSelectedGenre.length) return false;
    return tracksInSelectedGenre.every(
      (tr) =>
        excludedTracks.has(tr.relPath) ||
        isTrackAlbumShuffleExcluded(tr, excludedAlbums)
    );
  }, [tracksInSelectedGenre, excludedTracks, excludedAlbums]);

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
        for (const tr of index.tracks) {
          if (tr.artist === ar.name) s += counts[tr.relPath] ?? 0;
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
        for (const tr of index.tracks) {
          if (!trackBelongsToGenreKey(tr.meta?.genre, key)) continue;
          s += counts[tr.relPath] ?? 0;
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

  const moodOccurrenceCountById = useMemo(() => {
    const m = new Map<TrackMoodId, number>();
    for (const id of TRACK_MOOD_IDS) m.set(id, 0);
    for (const tr of index.tracks) {
      for (const mid of parseTrackMoods(tr.meta ?? undefined)) {
        m.set(mid, (m.get(mid) ?? 0) + 1);
      }
    }
    return m;
  }, [index.tracks]);

  const tracksMatchingMoodFilter = useMemo(() => {
    if (moodFilterIds.length === 0) return [] as LibraryTrackIndex[];
    const need = new Set(moodFilterIds);
    return index.tracks.filter((tr) => {
      const moods = parseTrackMoods(tr.meta ?? undefined);
      if (moodMatchMode === "any") {
        return moods.some((mid) => need.has(mid));
      }
      return moodFilterIds.every((mid) => moods.includes(mid));
    });
  }, [index.tracks, moodFilterIds, moodMatchMode]);

  const sortedMoodTracks = useMemo(() => {
    const base = [...tracksMatchingMoodFilter];
    base.sort(
      (a, b) =>
        a.artist.localeCompare(b.artist, sortLocale, { numeric: true }) ||
        a.album.localeCompare(b.album, sortLocale, { numeric: true }) ||
        a.title.localeCompare(b.title, sortLocale, { numeric: true })
    );
    return base;
  }, [tracksMatchingMoodFilter, sortLocale]);

  const moodShuffleEligible = useMemo(() => {
    if (moodFilterIds.length === 0) return [] as LibraryTrackIndex[];
    return tracksMatchingMoodFilter.filter(
      (tr) =>
        !excludedTracks.has(tr.relPath) &&
        !isTrackAlbumShuffleExcluded(tr, excludedAlbums)
    );
  }, [
    moodFilterIds.length,
    tracksMatchingMoodFilter,
    excludedTracks,
    excludedAlbums,
  ]);

  const moodToolbarBulkAllExcluded = useMemo(() => {
    if (!tracksMatchingMoodFilter.length) return false;
    return tracksMatchingMoodFilter.every(
      (tr) =>
        excludedTracks.has(tr.relPath) ||
        isTrackAlbumShuffleExcluded(tr, excludedAlbums)
    );
  }, [tracksMatchingMoodFilter, excludedTracks, excludedAlbums]);

  const searchResults = useMemo(() => {
    if (!normalizedQuery) return null;
    const genreOk = (relPath: string) => {
      const tr = index.tracks.find((x) => x.relPath === relPath);
      return parseTrackGenres(tr?.meta?.genre).some((g) =>
        g.toLowerCase().includes(normalizedQuery)
      );
    };
    return {
      artists: index.artists.filter((item) => {
        if (item.name.toLowerCase().includes(normalizedQuery)) return true;
        return index.tracks.some(
          (tr) =>
            tr.artist === item.name &&
            parseTrackGenres(tr.meta?.genre).some((g) =>
              g.toLowerCase().includes(normalizedQuery)
            )
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
          parseTrackGenres(item.meta?.genre).some((g) =>
            g.toLowerCase().includes(normalizedQuery)
          )
      ),
    };
  }, [index.albums, index.artists, index.tracks, normalizedQuery]);

  const runRandom = () => {
    const eligible = eligibleTracksForIntelligentRandom(
      index,
      excludedAlbums,
      excludedTracks
    );
    if (!eligible.length) return;
    const recentRelPaths = new Set(
      user.state.recent.slice(0, 48).map((tr) => tr.relPath)
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

  const playMoodShuffle = () => {
    if (!moodShuffleEligible.length) return;
    const recentRelPaths = new Set(
      user.state.recent.slice(0, 48).map((tr) => tr.relPath)
    );
    const shuffled = buildSmartRandomQueue(moodShuffleEligible, {
      currentRelPath: p.current?.relPath,
      currentArtist: p.current?.artist,
      recentRelPaths,
    });
    p.playTrack(shuffled[0], shuffled, 0, { preserveQueueOrder: true });
  };

  const playMoodResultsInOrder = () => {
    if (!sortedMoodTracks.length) return;
    const list = [...sortedMoodTracks];
    p.playTrack(list[0], list, 0, { preserveQueueOrder: true });
  };

  const playArtistShuffle = () => {
    if (!artistShuffleEligible.length) return;
    const recentRelPaths = new Set(
      user.state.recent.slice(0, 48).map((tr) => tr.relPath)
    );
    const shuffled = buildSmartRandomQueue(artistShuffleEligible, {
      currentRelPath: p.current?.relPath,
      currentArtist: p.current?.artist,
      recentRelPaths,
    });
    p.playTrack(shuffled[0], shuffled, 0, { preserveQueueOrder: true });
  };

  const openSearchArtist = (artistId: string) => {
    onSearchChange("");
    onOpenArtist(artistId);
  };

  const openSearchAlbum = (artistId: string, albumName: string) => {
    onSearchChange("");
    onOpenAlbum(artistId, albumName);
  };

  const renderLibrarySearchHero = () => (
    <section className="surface-card library-search-hero">
      <div className="library-search-bar" role="search">
        <p className="eyebrow library-search-bar__eyebrow">
          {t("library.searchEyebrow")}
        </p>
        <p className="library-search-bar__title">
          {t("library.searchHeading", {
            q: search.trim() || "—",
          })}
        </p>
        <div className="library-search-bar__field">
          <label className="library-search-bar__input-wrap">
            <span className="sr-only">{t("topbar.searchAria")}</span>
            <input
              ref={searchInputRef}
              id="library-search-input"
              className="ghost-input ghost-input--search"
              type="search"
              name="library-search"
              placeholder={t("topbar.searchPlaceholder")}
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              onFocus={onSearchFocus}
              autoComplete="off"
              role="searchbox"
              aria-label={t("topbar.searchAria")}
            />
          </label>
          <button
            type="button"
            className="text-btn library-search-bar__dismiss"
            onClick={onSearchBarClose}
            title={t("topbar.closeSearch")}
            aria-label={t("topbar.closeSearch")}
          >
            <span className="library-search-bar__dismiss-ic" aria-hidden>
              <UiClose />
            </span>
          </button>
        </div>
      </div>
    </section>
  );

  if (normalizedQuery && searchResults) {
    return (
      <div className="view-stack library-view library-view--search-results">
        {showSearchBar ? renderLibrarySearchHero() : null}
        <section className="surface-card library-search-results-card">
          <div className="library-filter-panel">
            <span className="library-filter-panel__eyebrow">
              {t("library.filterBarSearch")}
            </span>
            <div
              className="segmented segmented--filter"
              role="group"
              aria-label={t("library.filterResultsAria")}
            >
              {(
                [
                  {
                    id: "all" as const,
                    labelKey: "library.filterAll",
                    Ic: UiViewModule,
                  },
                  {
                    id: "artists" as const,
                    labelKey: "library.filterArtists",
                    Ic: UiPerson,
                  },
                  {
                    id: "albums" as const,
                    labelKey: "library.filterAlbums",
                    Ic: UiAlbumIcon,
                  },
                  {
                    id: "tracks" as const,
                    labelKey: "library.filterTracks",
                    Ic: UiMusicNote,
                  },
                ] as const
              ).map(({ id, labelKey, Ic }) => (
                <button
                  type="button"
                  key={id}
                  className={mode === id ? "is-on" : ""}
                  onClick={() => setMode(id)}
                >
                  <span className="segmented__btn-inner">
                    <Ic className="segmented__ic" aria-hidden />
                    <span>{t(labelKey)}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
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
                    onOpen={() => openSearchArtist(item.id)}
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
                    onClick={() => openSearchAlbum(item.artistId, item.name)}
                  >
                    <AlbumCover album={item} compact />
                    <div className="album-card__text">
                      <div className="album-card__title">{item.name}</div>
                      <div className="album-card__meta">{item.artist}</div>
                      <AlbumCardTracksMetaLine album={item} />
                      <DraggableBadgeCluster>
                        <LibraryAlbumMetaChips album={item} />
                        <LibraryAlbumFavoriteChips album={item} />
                        <LibraryAlbumExcludeChips album={item} />
                      </DraggableBadgeCluster>
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
                {searchResults.tracks.slice(0, 50).map((track, idx) => (
                  <TrackListRow
                    key={track.relPath}
                    track={track}
                    listIndex={idx + 1}
                    onPlay={() => playFromLibraryCard(track)}
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
                    <UiChevronLeft
                      aria-hidden
                      className="page-toolbar-back-ic__ic"
                    />
                  </button>
                  <div className="page-toolbar__textcol album-hero__toolbar-text">
                    <p className="eyebrow">{t("library.albumDetailEyebrow")}</p>
                    <div className="lib-badge-cluster lib-badge-cluster--toolbar-left">
                      <LibraryAlbumMetaChips album={album} variant="hero" />
                      <LibraryAlbumFavoriteChips album={album} variant="hero" />
                      <LibraryAlbumExcludeChips album={album} variant="hero" />
                    </div>
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
                      className="ghost-btn ghost-btn--icon-only"
                      onClick={() => openAlbumMetaEdit(album)}
                      title={t("albumMeta.editButton")}
                      aria-label={t("albumMeta.editButton")}
                    >
                      <span className="ghost-btn__meta-ic" aria-hidden>
                        <TrackMetaEditGlyph />
                      </span>
                    </button>
                    <button
                      type="button"
                      className={`ghost-btn library-toolbar-exclude-btn ${
                        excludedAlbums.has(album.id) ? "is-on" : ""
                      }`}
                      onClick={() => user.toggleShuffleExcludedAlbum(album.id)}
                      title={t("library.randomExcludeBtn")}
                      aria-label={t("library.randomExcludeAria")}
                      aria-pressed={excludedAlbums.has(album.id)}
                    >
                      <ExcludeShuffleIcon className="library-toolbar-exclude-btn__ic" />
                    </button>
                  </div>
                </div>
              </div>
              <div className="album-hero__titleblock">
                <h1 className="album-hero__h1">{album.name}</h1>
                <p className="subtle sm album-hero__title-meta">
                  {artist.name}
                  {album.releaseDate ? ` · ${fmtDate(album.releaseDate)}` : ""}
                  {album.label ? ` · ${album.label}` : ""}
                </p>
                <div className="album-track-genres-inline">
                  <div className="meta-edit-genre-chips" role="list">
                    {albumTrackGenres.map((g) => (
                      <span
                        key={g}
                        className="meta-edit-genre-chip"
                        role="listitem"
                      >
                        <span className="meta-edit-genre-chip__text">{g}</span>
                        <button
                          type="button"
                          className="meta-edit-genre-chip__x"
                          disabled={albumGenreBusy}
                          onClick={() => {
                            void removeAlbumGenre(g);
                          }}
                          aria-label={t("trackMeta.fieldGenreRemoveAria", {
                            g,
                          })}
                        >
                          <UiClose className="meta-edit-genre-chip__x-ic" />
                        </button>
                      </span>
                    ))}
                    {albumGenreOptions.length > 0 ? (
                      <div className="meta-edit-genre-add">
                        <button
                          type="button"
                          className="meta-edit-genre-chip meta-edit-genre-chip--add"
                          disabled={albumGenreBusy}
                          onClick={() => {
                            setAlbumGenrePickerOpen((prev) => !prev);
                          }}
                          aria-label={t("trackMeta.fieldGenreAdd")}
                          title={t("trackMeta.fieldGenreAdd")}
                        >
                          <UiAdd
                            className="meta-edit-genre-chip__add-ic"
                            aria-hidden
                          />
                        </button>
                        {albumGenrePickerOpen ? (
                          <div
                            className="meta-edit-genre-option-list"
                            role="listbox"
                          >
                            {albumGenreOptions.map((g) => (
                              <button
                                key={g}
                                type="button"
                                className="meta-edit-genre-option-item"
                                onClick={() => {
                                  void addAlbumGenreBySelection(g);
                                }}
                              >
                                {g}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  {albumGenreErr ? (
                    <p className="subtle sm warnline">{albumGenreErr}</p>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="surface-card">
          <div className="section-head section-head--page-toolbar section-head--album-tracklist-head">
            <div className="section-head__album-tracklist-row">
              <SectionHeadLead
                eyebrow={t("library.tracklistEyebrow")}
                title={t("library.tracklistHeading", {
                  n: albumTracks.length,
                })}
                icon={<UiMusicNote className="section-head__ic" />}
              />
              <AlbumTracklistExpectedMeta
                album={album}
                presentCount={albumTracks.length}
              />
            </div>
          </div>
          <div className="list-stack">
            {albumTracks.map((track, trIndex) => (
              <TrackListRow
                key={track.relPath}
                track={track}
                listIndex={trIndex + 1}
                showTrackBadgeRow
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
                <UiChevronLeft
                  aria-hidden
                  className="page-toolbar-back-ic__ic"
                />
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
            </div>
          </div>
        </section>
        <section className="surface-card">
          <div className="library-filter-panel library-sort-panel library-genre-tracklist-toolbar">
            <div className="section-head section-head--page-toolbar library-genre-tracklist-headrow">
              <div>
                <p className="eyebrow">{t("library.overviewEyebrow")}</p>
                <h2>
                  {artistAlbums.length}{" "}
                  {artistAlbums.length === 1
                    ? t("library.unitAlbumFound")
                    : t("library.unitAlbumFoundPlural")}
                </h2>
              </div>
              <div className="section-head__tools">
                <div
                  className="segmented segmented--joined"
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
                    <span className="segmented__btn-inner">
                      <UiDateRange className="segmented__ic" aria-hidden />
                      <span>{t("library.sortDate")}</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className={artistAlbumSort === "name" ? "is-on" : ""}
                    onClick={() =>
                      user.updateSettings({ artistAlbumSort: "name" })
                    }
                  >
                    <span className="segmented__btn-inner">
                      <UiSortByAlpha className="segmented__ic" aria-hidden />
                      <span>{t("library.sortName")}</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className={artistAlbumSort === "plays" ? "is-on" : ""}
                    onClick={() =>
                      user.updateSettings({ artistAlbumSort: "plays" })
                    }
                  >
                    <span className="segmented__btn-inner">
                      <UiBarChart className="segmented__ic" aria-hidden />
                      <span>{t("library.sortByPlays")}</span>
                    </span>
                  </button>
                </div>
              </div>
            </div>
          </div>
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
                  <AlbumCardTracksMetaLine album={item} />
                  <DraggableBadgeCluster>
                    <LibraryAlbumMetaChips album={item} />
                    <LibraryAlbumFavoriteChips album={item} />
                    <LibraryAlbumExcludeChips album={item} />
                  </DraggableBadgeCluster>
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
      {!route.artist && !route.album && showSearchBar
        ? renderLibrarySearchHero()
        : null}
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
                <UiChevronLeft
                  aria-hidden
                  className="page-toolbar-back-ic__ic"
                />
              </button>
              <div className="page-toolbar__textcol">
                <p className="eyebrow">{t("library.genreEyebrow")}</p>
                <h2>{selectedGenreLabel ?? t("common.emDash")}</h2>
              </div>
            </div>
          ) : (
            <div className="section-head__lead">
              <span className="section-head__icon-wrap" aria-hidden>
                {libBrowse === "artists" ? (
                  <UiPerson className="section-head__ic" />
                ) : libBrowse === "genres" ? (
                  <UiStyle className="section-head__ic" />
                ) : (
                  <UiPalette className="section-head__ic" />
                )}
              </span>
              <div className="section-head__text">
                <p className="eyebrow">{t("library.overviewEyebrow")}</p>
                <div
                  className="section-nav-tabs"
                  role="group"
                  aria-label={t("library.browseByArtistGenreMoodAria")}
                >
                  <button
                    type="button"
                    className={`section-nav-tab${
                      user.state.settings.libBrowse === "artists" ? " is-on" : ""
                    }`}
                    onClick={() => {
                      user.updateSettings({ libBrowse: "artists" });
                      setSelectedGenreKey(null);
                      setMoodFilterIds([]);
                    }}
                  >
                    {t("library.tabArtists")}
                  </button>
                  <button
                    type="button"
                    className={`section-nav-tab${
                      user.state.settings.libBrowse === "genres" ? " is-on" : ""
                    }`}
                    onClick={() => {
                      user.updateSettings({ libBrowse: "genres" });
                      setSelectedGenreKey(null);
                      setMoodFilterIds([]);
                    }}
                  >
                    {t("library.tabGenres")}
                  </button>
                  <button
                    type="button"
                    className={`section-nav-tab${
                      user.state.settings.libBrowse === "moods" ? " is-on" : ""
                    }`}
                    onClick={() => {
                      user.updateSettings({ libBrowse: "moods" });
                      setSelectedGenreKey(null);
                    }}
                  >
                    {t("library.tabMoods")}
                  </button>
                </div>
              </div>
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
              ) : libBrowse === "moods" && moodFilterIds.length > 0 ? (
                <>
                  <button
                    type="button"
                    className="primary-btn"
                    disabled={moodShuffleEligible.length === 0}
                    onClick={playMoodShuffle}
                  >
                    {t("library.playMoodShuffle")}
                  </button>
                  <button
                    type="button"
                    className={`ghost-btn library-toolbar-exclude-btn ${
                      moodToolbarBulkAllExcluded ? "is-on" : ""
                    }`}
                    disabled={tracksMatchingMoodFilter.length === 0}
                    title={t("library.genreRandomExcludeTitle")}
                    aria-label={t("library.genreRandomExcludeAria")}
                    onClick={() => {
                      if (!tracksMatchingMoodFilter.length) return;
                      user.setShuffleTracksExcludedBulk(
                        tracksMatchingMoodFilter.map((tr) => tr.relPath),
                        !moodToolbarBulkAllExcluded
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
          </div>
        </div>
      </section>
      <section className="surface-card">
        {selectedGenreKey ? (
          <div className="library-filter-panel library-filter-panel--tight library-sort-panel library-genre-tracklist-toolbar">
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
              <div className="section-head__tools">
                <div
                  className="segmented segmented--joined"
                  role="group"
                  aria-label={t("library.sortOverviewAria")}
                >
                  <button
                    type="button"
                    className={libOverviewSort === "name" ? "is-on" : ""}
                    onClick={() =>
                      user.updateSettings({ libOverviewSort: "name" })
                    }
                  >
                    <span className="segmented__btn-inner">
                      <UiSortByAlpha className="segmented__ic" aria-hidden />
                      <span>{t("library.sortByName")}</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className={libOverviewSort === "plays" ? "is-on" : ""}
                    onClick={() =>
                      user.updateSettings({ libOverviewSort: "plays" })
                    }
                  >
                    <span className="segmented__btn-inner">
                      <UiBarChart className="segmented__ic" aria-hidden />
                      <span>{t("library.sortByPlays")}</span>
                    </span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : libBrowse === "artists" || libBrowse === "genres" ? (
          <div
            className={`library-filter-panel library-sort-panel ${
              libBrowse === "artists" || libBrowse === "genres"
                ? "library-genre-tracklist-toolbar"
                : ""
            }`}
          >
            {libBrowse === "artists" || libBrowse === "genres" ? (
              <div className="section-head section-head--page-toolbar library-genre-tracklist-headrow">
                <div>
                  <p className="eyebrow">{t("library.overviewEyebrow")}</p>
                  <h2>
                    {libBrowse === "artists"
                      ? sortedOverviewArtists.length
                      : sortedGenreBrowseList.length}{" "}
                    {libBrowse === "artists"
                      ? sortedOverviewArtists.length === 1
                        ? t("library.unitArtist")
                        : t("library.unitArtistPlural")
                      : sortedGenreBrowseList.length === 1
                      ? t("library.unitGenre")
                      : t("library.unitGenrePlural")}
                  </h2>
                </div>
                <div className="section-head__tools">
                  <div
                    className="segmented segmented--joined"
                    role="group"
                    aria-label={t("library.sortOverviewAria")}
                  >
                    <button
                      type="button"
                      className={libOverviewSort === "name" ? "is-on" : ""}
                      onClick={() =>
                        user.updateSettings({ libOverviewSort: "name" })
                      }
                    >
                      <span className="segmented__btn-inner">
                        <UiSortByAlpha className="segmented__ic" aria-hidden />
                        <span>{t("library.sortByName")}</span>
                      </span>
                    </button>
                    <button
                      type="button"
                      className={libOverviewSort === "plays" ? "is-on" : ""}
                      onClick={() =>
                        user.updateSettings({ libOverviewSort: "plays" })
                      }
                    >
                      <span className="segmented__btn-inner">
                        <UiBarChart className="segmented__ic" aria-hidden />
                        <span>{t("library.sortByPlays")}</span>
                      </span>
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="library-filter-group">
                <div
                  className="segmented segmented--joined"
                  role="group"
                  aria-label={t("library.sortOverviewAria")}
                >
                  <button
                    type="button"
                    className={libOverviewSort === "name" ? "is-on" : ""}
                    onClick={() =>
                      user.updateSettings({ libOverviewSort: "name" })
                    }
                  >
                    <span className="segmented__btn-inner">
                      <UiSortByAlpha className="segmented__ic" aria-hidden />
                      <span>{t("library.sortByName")}</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className={libOverviewSort === "plays" ? "is-on" : ""}
                    onClick={() =>
                      user.updateSettings({ libOverviewSort: "plays" })
                    }
                  >
                    <span className="segmented__btn-inner">
                      <UiBarChart className="segmented__ic" aria-hidden />
                      <span>{t("library.sortByPlays")}</span>
                    </span>
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : null}
        {selectedGenreKey ? (
          <>
            <div className="list-stack">
              {sortedGenreTracks.map((track, idx) => (
                <TrackListRow
                  key={track.relPath}
                  track={track}
                  listIndex={idx + 1}
                  onPlay={() => playFromLibraryCard(track)}
                />
              ))}
            </div>
          </>
        ) : libBrowse === "moods" ? (
          <div className="library-mood-browse">
            <div className="library-mood-match-row">
              <span className="library-filter-panel__eyebrow">
                {t("library.moodMatchEyebrow")}
              </span>
              <div
                className="segmented segmented--joined"
                role="group"
                aria-label={t("library.moodMatchAria")}
              >
                <button
                  type="button"
                  className={moodMatchMode === "any" ? "is-on" : ""}
                  onClick={() => setMoodMatchMode("any")}
                >
                  <span className="segmented__btn-inner">
                    <span>{t("library.moodMatchAny")}</span>
                  </span>
                </button>
                <button
                  type="button"
                  className={moodMatchMode === "all" ? "is-on" : ""}
                  onClick={() => setMoodMatchMode("all")}
                >
                  <span className="segmented__btn-inner">
                    <span>{t("library.moodMatchAll")}</span>
                  </span>
                </button>
              </div>
              {moodFilterIds.length > 0 ? (
                <button
                  type="button"
                  className="text-btn library-mood-clear"
                  onClick={() => setMoodFilterIds([])}
                >
                  {t("library.moodClearFilter")}
                </button>
              ) : null}
            </div>
            <p className="subtle sm library-mood-explainer">
              {t("library.moodFilterExplainer")}
            </p>
            <div className="library-mood-filter-grid">
              {TRACK_MOOD_IDS.map((id) => {
                const count = moodOccurrenceCountById.get(id) ?? 0;
                const on = moodFilterIds.includes(id);
                const disabled = count === 0 && !on;
                return (
                  <button
                    type="button"
                    key={id}
                    disabled={disabled}
                    className={`library-mood-filter-btn${
                      on ? " library-mood-filter-btn--on" : ""
                    }`}
                    style={
                      { ["--mood-c"]: TRACK_MOOD_COLORS[id] } as CSSProperties
                    }
                    aria-pressed={on}
                    title={t(`trackMeta.mood.${id}`)}
                    onClick={() => {
                      if (disabled) return;
                      setMoodFilterIds((prev) =>
                        prev.includes(id)
                          ? prev.filter((x) => x !== id)
                          : [...prev, id]
                      );
                    }}
                  >
                    <span className="library-mood-filter-btn__glyph-row">
                      <TrackMoodGlyph mood={id} />
                      <span className="library-mood-filter-btn__count">
                        {count}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
            {moodFilterIds.length === 0 ? (
              <p className="panel-empty">{t("library.moodPickHint")}</p>
            ) : sortedMoodTracks.length === 0 ? (
              <p className="panel-empty">{t("library.moodNoTracks")}</p>
            ) : (
              <>
                <div className="section-head section-head--page-toolbar library-mood-tracklist-head">
                  <div>
                    <p className="eyebrow">{t("library.tracklistEyebrow")}</p>
                    <h2>
                      {sortedMoodTracks.length}{" "}
                      {sortedMoodTracks.length === 1
                        ? t("library.unitTrack")
                        : t("library.unitTrackPlural")}
                    </h2>
                  </div>
                  <div className="section-head__tools">
                    <button
                      type="button"
                      className="primary-btn"
                      disabled={sortedMoodTracks.length === 0}
                      title={t("library.playMoodResultsInOrderTitle")}
                      aria-label={t("library.playMoodResultsInOrderAria")}
                      onClick={playMoodResultsInOrder}
                    >
                      {t("library.playMoodResultsInOrder")}
                    </button>
                  </div>
                </div>
                <div className="list-stack">
                  {sortedMoodTracks.map((track, idx) => (
                    <TrackListRow
                      key={track.relPath}
                      track={track}
                      listIndex={idx + 1}
                      onPlay={() => playFromLibraryCard(track)}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
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
