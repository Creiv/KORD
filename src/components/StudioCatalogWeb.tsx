import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  fetchCatalogWebDiscover,
  type CatalogWebDiscoverAlbum,
  type CatalogWebDiscoverSong,
} from "../lib/api";
import {
  enrichCatalogWebDiscoverItem,
  partitionCatalogWebDiscover,
} from "../lib/catalogWebDiscover";
import { CoverImg } from "./CoverImg";
import { UiAlbumIcon, UiMusicNote } from "./KordUiIcons";
import type { useI18n } from "../i18n/useI18n";

type TFn = ReturnType<typeof useI18n>["t"];

type Props = {
  t: TFn;
  active: boolean;
  onPickForDownload: (url: string, kind: "album" | "song") => void;
};

type EnrichedAlbum = CatalogWebDiscoverAlbum & {
  type: "album" | "song";
  releaseType: string | null;
  artistName: string;
};

type EnrichedSong = CatalogWebDiscoverSong & {
  type: "album" | "song";
  releaseType: string | null;
  artistName: string;
};

function WebDiscoverTile({
  enriched,
  pickLabel,
  onPick,
}: {
  enriched: EnrichedAlbum | EnrichedSong;
  pickLabel: string;
  onPick: () => void;
}) {
  const thumb = enriched.thumbnailUrl?.trim() || null;
  const resolvedKind = enriched.type;
  const releaseLine = (enriched.releaseType || "").trim();
  const artistLine = enriched.artistName;
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onPick();
    }
  };

  const isSingle = resolvedKind === "song";
  const KindIcon = isSingle ? UiMusicNote : UiAlbumIcon;
  const tileKindClass = isSingle ? "" : " library-list-tile--album";

  return (
    <div
      className={`library-list-tile studio-catalog-list-tile studio-catalog-web-tile${tileKindClass}`}
    >
      <button
        type="button"
        className="studio-catalog-list-tile__main studio-catalog-web-tile__pick"
        onClick={onPick}
        onKeyDown={onKeyDown}
        aria-label={pickLabel}
        data-release-type={releaseLine || undefined}
      >
        <div className="library-list-tile__media">
          {thumb ? (
            <CoverImg
              className="library-list-tile__cover"
              src={thumb}
              alt=""
              fallbackClassName="library-list-tile__badge studio-catalog-web-tile__badge"
              fallback={
                <KindIcon className="studio-catalog-web-tile__badge-ic" />
              }
            />
          ) : (
            <div className="library-list-tile__badge studio-catalog-web-tile__badge">
              <KindIcon className="studio-catalog-web-tile__badge-ic" />
            </div>
          )}
        </div>
        <div className="library-list-tile__body">
          <div className="library-list-tile__title-row">
            <KindIcon className="library-list-tile__kind-ic" aria-hidden />
            <div className="library-list-tile__title">{enriched.title}</div>
          </div>
          {releaseLine ? (
            <div className="library-list-tile__meta studio-catalog-web-tile__release">
              {releaseLine}
            </div>
          ) : null}
          {artistLine ? (
            <div className="library-list-tile__meta">{artistLine}</div>
          ) : null}
        </div>
      </button>
    </div>
  );
}

export function StudioCatalogWeb({ t, active, onPickForDownload }: Props) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [albums, setAlbums] = useState<EnrichedAlbum[]>([]);
  const [songs, setSongs] = useState<EnrichedSong[]>([]);
  const [listEpoch, setListEpoch] = useState(0);
  const loadGenRef = useRef(0);
  const discoverCacheRef = useRef<{ epoch: number; albums: EnrichedAlbum[]; songs: EnrichedSong[] } | null>(
    null,
  );

  const load = useCallback((force = false) => {
    if (!force && discoverCacheRef.current) {
      const c = discoverCacheRef.current;
      setAlbums(c.albums);
      setSongs(c.songs);
      setListEpoch(c.epoch);
      setErr(null);
      return;
    }
    const gen = ++loadGenRef.current;
    const refreshNonce = Date.now();
    setBusy(true);
    setErr(null);
    fetchCatalogWebDiscover(refreshNonce)
      .then((d) => {
        if (gen !== loadGenRef.current) return;
        const merged = [...(d.albums ?? []), ...(d.songs ?? [])];
        const { albums: nextAlbums, songs: nextSongs } =
          partitionCatalogWebDiscover(merged);
        const enrichedAlbums = nextAlbums.map((item) =>
          enrichCatalogWebDiscoverItem(item),
        ) as EnrichedAlbum[];
        const enrichedSongs = nextSongs.map((item) =>
          enrichCatalogWebDiscoverItem(item),
        ) as EnrichedSong[];
        discoverCacheRef.current = {
          epoch: refreshNonce,
          albums: enrichedAlbums,
          songs: enrichedSongs,
        };
        setAlbums(enrichedAlbums);
        setSongs(enrichedSongs);
        setListEpoch(refreshNonce);
        if (d.error && !(d.albums?.length || d.songs?.length)) {
          setErr(d.error);
        }
      })
      .catch((e: unknown) => {
        if (gen !== loadGenRef.current) return;
        setAlbums([]);
        setSongs([]);
        discoverCacheRef.current = null;
        setErr(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (gen === loadGenRef.current) setBusy(false);
      });
  }, []);

  useEffect(() => {
    if (!active) return;
    load();
  }, [active, load]);

  const reload = useCallback(() => {
    discoverCacheRef.current = null;
    load(true);
  }, [load]);

  const hasResults = albums.length > 0 || songs.length > 0;
  const albumTiles = useMemo(
    () =>
      albums.map((item) => (
        <WebDiscoverTile
          key={`album-${item.id}`}
          enriched={item}
          pickLabel={t("tools.catalogWebPickAria", { title: item.title })}
          onPick={() => onPickForDownload(item.url, "album")}
        />
      )),
    [albums, onPickForDownload, t],
  );
  const songTiles = useMemo(
    () =>
      songs.map((item) => (
        <WebDiscoverTile
          key={`song-${item.id}`}
          enriched={item}
          pickLabel={t("tools.catalogWebPickAria", { title: item.title })}
          onPick={() => onPickForDownload(item.url, "album")}
        />
      )),
    [songs, onPickForDownload, t],
  );

  return (
    <div className="studio-catalog-web">
      <div className="studio-catalog-toolbar">
        <div className="studio-catalog-toolbar__row">
          <button
            type="button"
            className="primary-btn primary-btn--sm"
            onClick={reload}
            disabled={busy}
          >
            {busy ? t("tools.catalogWebLoading") : t("tools.catalogWebReload")}
          </button>
        </div>
      </div>
      {busy ? (
        <p className="subtle sm" role="status">
          {t("tools.catalogWebLoading")}
        </p>
      ) : null}
      {err ? <p className="subtle sm warnline">{err}</p> : null}
      {!busy && !err && !hasResults ? (
        <p className="subtle sm">{t("tools.catalogWebEmpty")}</p>
      ) : null}

      {albums.length > 0 ? (
        <section
          className="studio-catalog-web__section"
          aria-label={t("tools.catalogWebAlbumsSection")}
        >
          <h4 className="studio-catalog-web__section-title">
            {t("tools.catalogWebAlbumsSection")}
            <span className="studio-catalog-web__section-count">
              {albums.length}
            </span>
          </h4>
          <div
            key={`albums-${listEpoch}`}
            className="library-overview-cols studio-catalog-web__grid"
          >
            {albumTiles}
          </div>
        </section>
      ) : null}

      {songs.length > 0 ? (
        <section
          className="studio-catalog-web__section"
          aria-label={t("tools.catalogWebSongsSection")}
        >
          <h4 className="studio-catalog-web__section-title">
            {t("tools.catalogWebSongsSection")}
            <span className="studio-catalog-web__section-count">
              {songs.length}
            </span>
          </h4>
          <div
            key={`songs-${listEpoch}`}
            className="library-overview-cols studio-catalog-web__grid"
          >
            {songTiles}
          </div>
        </section>
      ) : null}
    </div>
  );
}
