import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  fetchCatalogWebDiscover,
  fetchDownloadFlatCount,
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

type TrackCountState = number | null | "loading";

function WebDiscoverTile({
  item,
  pickLabel,
  trackMeta,
  onPick,
}: {
  item: CatalogWebDiscoverAlbum | CatalogWebDiscoverSong;
  pickLabel: string;
  trackMeta?: string | null;
  onPick: () => void;
}) {
  const enriched = enrichCatalogWebDiscoverItem(item);
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
          {trackMeta ? (
            <div className="library-list-tile__meta studio-catalog-web-tile__tracks">
              {trackMeta}
            </div>
          ) : null}
        </div>
      </button>
    </div>
  );
}

export function StudioCatalogWeb({ t, active, onPickForDownload }: Props) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [albums, setAlbums] = useState<CatalogWebDiscoverAlbum[]>([]);
  const [songs, setSongs] = useState<CatalogWebDiscoverSong[]>([]);
  const [listEpoch, setListEpoch] = useState(0);
  const [trackCounts, setTrackCounts] = useState<Record<string, TrackCountState>>(
    {},
  );
  const loadGenRef = useRef(0);
  const trackCountGenRef = useRef(0);

  const formatTrackCount = useCallback(
    (state: TrackCountState | undefined) => {
      if (state === "loading") return t("tools.catalogWebTrackCountLoading");
      if (state == null || !Number.isFinite(state)) return null;
      if (state === 1) return t("tools.catalogWebTrackCountOne");
      return t("tools.catalogWebTrackCount", { n: state });
    },
    [t],
  );

  const load = useCallback(() => {
    const gen = ++loadGenRef.current;
    const refreshNonce = Date.now();
    setBusy(true);
    setErr(null);
    setTrackCounts({});
    fetchCatalogWebDiscover(refreshNonce)
      .then((d) => {
        if (gen !== loadGenRef.current) return;
        const merged = [...(d.albums ?? []), ...(d.songs ?? [])];
        const { albums: nextAlbums, songs: nextSongs } =
          partitionCatalogWebDiscover(merged);
        setAlbums(nextAlbums);
        setSongs(nextSongs);
        setListEpoch(refreshNonce);
        if (d.error && !(d.albums?.length || d.songs?.length)) {
          setErr(d.error);
        }
        const initial: Record<string, TrackCountState> = {};
        for (const al of nextAlbums) {
          if (al.trackCount != null && al.trackCount > 0) {
            initial[al.id] = al.trackCount;
          }
        }
        setTrackCounts(initial);
      })
      .catch((e: unknown) => {
        if (gen !== loadGenRef.current) return;
        setAlbums([]);
        setSongs([]);
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

  useEffect(() => {
    if (!albums.length) return;
    const pending = albums.filter(
      (al) => al.trackCount == null || al.trackCount <= 0,
    );
    if (!pending.length) return;
    const gen = ++trackCountGenRef.current;
    setTrackCounts((prev) => {
      const next = { ...prev };
      for (const al of albums) {
        if (al.trackCount != null && al.trackCount > 0) {
          next[al.id] = al.trackCount;
        } else if (next[al.id] === undefined) {
          next[al.id] = "loading";
        }
      }
      return next;
    });
    let nextIdx = 0;
    const workers = Math.min(4, pending.length);
    void Promise.all(
      Array.from({ length: workers }, async () => {
        while (nextIdx < pending.length) {
          const album = pending[nextIdx++]!;
          let n: number | null = null;
          try {
            n = await fetchDownloadFlatCount(album.url);
          } catch {
            n = null;
          }
          if (gen !== trackCountGenRef.current) return;
          setTrackCounts((prev) => ({ ...prev, [album.id]: n }));
        }
      }),
    );
  }, [albums]);

  const hasResults = albums.length > 0 || songs.length > 0;

  return (
    <div className="studio-catalog-web">
      <div className="studio-catalog-toolbar">
        <div className="studio-catalog-toolbar__row">
          <button
            type="button"
            className="primary-btn primary-btn--sm"
            onClick={load}
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
            {albums.map((item) => (
              <WebDiscoverTile
                key={`album-${item.id}`}
                item={item}
                pickLabel={t("tools.catalogWebPickAria", { title: item.title })}
                trackMeta={formatTrackCount(trackCounts[item.id])}
                onPick={() => onPickForDownload(item.url, "album")}
              />
            ))}
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
            {songs.map((item) => (
              <WebDiscoverTile
                key={`song-${item.id}`}
                item={item}
                pickLabel={t("tools.catalogWebPickAria", { title: item.title })}
                onPick={() => onPickForDownload(item.url, "album")}
              />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

