import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import {
  catalogWebPreviewAudioSrc,
  fetchCatalogWebDiscover,
  fetchCatalogWebTracks,
  isBackendUnreachableError,
  type CatalogWebDiscoverAlbum,
  type CatalogWebDiscoverSong,
  type CatalogWebTrack,
} from "../lib/api";
import {
  enrichCatalogWebDiscoverItem,
  partitionCatalogWebDiscover,
} from "../lib/catalogWebDiscover";
import { CoverImg } from "./CoverImg";
import { UiAlbumIcon, UiClose, UiMusicNote } from "./RekordUiIcons";
import type { useI18n } from "../i18n/useI18n";

type TFn = ReturnType<typeof useI18n>["t"];

const CATALOG_WEB_PREVIEW_MAX_SEC = 30;

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

type PickItem = EnrichedAlbum | EnrichedSong;

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

function CatalogWebPickDialog({
  item,
  t,
  onClose,
  onDownload,
}: {
  item: PickItem;
  t: TFn;
  onClose: () => void;
  onDownload: () => void;
}) {
  const [tracks, setTracks] = useState<CatalogWebTrack[] | null>(null);
  const [tracksBusy, setTracksBusy] = useState(true);
  const [tracksErr, setTracksErr] = useState<string | null>(null);
  const [playingUrl, setPlayingUrl] = useState<string | null>(null);
  const [previewBusyUrl, setPreviewBusyUrl] = useState<string | null>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const loadGenRef = useRef(0);
  const previewTimeUpdateRef = useRef<(() => void) | null>(null);

  const stopPreview = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      const onTimeUpdate = previewTimeUpdateRef.current;
      if (onTimeUpdate) {
        audio.removeEventListener("timeupdate", onTimeUpdate);
        previewTimeUpdateRef.current = null;
      }
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    setPlayingUrl(null);
    setPreviewBusyUrl(null);
  }, []);

  useEffect(() => {
    return () => stopPreview();
  }, [stopPreview]);

  useEffect(() => {
    const gen = ++loadGenRef.current;
    const timer = window.setTimeout(() => {
      if (gen !== loadGenRef.current) return;
      setTracksBusy(true);
      setTracksErr(null);
      setTracks(null);
      stopPreview();
      setPreviewErr(null);

      if (item.type === "song") {
        setTracks([
          {
            id: item.id,
            title: item.title,
            url: item.url,
          },
        ]);
        setTracksBusy(false);
        return;
      }

      const fallbackTrack: CatalogWebTrack = {
        id: item.id,
        title: item.title,
        url: item.url,
      };
      fetchCatalogWebTracks(item.url)
        .then((data) => {
          if (gen !== loadGenRef.current) return;
          const list = data.tracks?.length ? data.tracks : [fallbackTrack];
          setTracks(list);
          if (data.error) setTracksErr(data.error);
        })
        .catch((e: unknown) => {
          if (gen !== loadGenRef.current) return;
          setTracks([fallbackTrack]);
          setTracksErr(
            isBackendUnreachableError(e)
              ? t("tools.catalogWebBackendUnreachable")
              : e instanceof Error
                ? e.message
                : String(e),
          );
        })
        .finally(() => {
          if (gen === loadGenRef.current) setTracksBusy(false);
        });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [item, stopPreview, t]);

  const playPreview = useCallback(
    async (track: CatalogWebTrack) => {
      if (previewBusyUrl) return;
      setPreviewErr(null);
      setPreviewBusyUrl(track.url);
      setPlayingUrl(null);
      const audio = audioRef.current;
      if (!audio) {
        setPreviewBusyUrl(null);
        return;
      }
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      try {
        const previewSrc = await catalogWebPreviewAudioSrc(track.url);
        await new Promise<void>((resolve, reject) => {
          const timeout = window.setTimeout(() => {
            cleanup();
            reject(new Error("Preview playback timed out"));
          }, 45_000);
          let settled = false;
          const onReady = () => {
            if (settled) return;
            settled = true;
            cleanup();
            setPlayingUrl(track.url);
            setPreviewBusyUrl(null);
            const prevTimeUpdate = previewTimeUpdateRef.current;
            if (prevTimeUpdate) {
              audio.removeEventListener("timeupdate", prevTimeUpdate);
            }
            const onTimeUpdate = () => {
              if (audio.currentTime >= CATALOG_WEB_PREVIEW_MAX_SEC) {
                audio.removeEventListener("timeupdate", onTimeUpdate);
                if (previewTimeUpdateRef.current === onTimeUpdate) {
                  previewTimeUpdateRef.current = null;
                }
                stopPreview();
              }
            };
            previewTimeUpdateRef.current = onTimeUpdate;
            audio.addEventListener("timeupdate", onTimeUpdate);
            resolve();
          };
          const onError = () => {
            if (settled) return;
            settled = true;
            cleanup();
            const code = audio.error?.code;
            const detail =
              code === 4
                ? "Unsupported audio format"
                : code != null
                  ? `Media error ${code}`
                  : "Preview playback failed";
            reject(new Error(detail));
          };
          const cleanup = () => {
            window.clearTimeout(timeout);
            audio.removeEventListener("playing", onReady);
            audio.removeEventListener("canplay", onReady);
            audio.removeEventListener("error", onError);
          };
          audio.addEventListener("playing", onReady);
          audio.addEventListener("canplay", onReady);
          audio.addEventListener("error", onError);
          audio.preload = "auto";
          audio.src = previewSrc;
          void audio.play().catch((err: unknown) => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(err instanceof Error ? err : new Error(String(err)));
          });
        });
      } catch (e: unknown) {
        setPreviewBusyUrl(null);
        setPlayingUrl(null);
        const errMsg = isBackendUnreachableError(e)
          ? t("tools.catalogWebBackendUnreachable")
          : e instanceof Error
            ? e.message
            : String(e);
        setPreviewErr(t("tools.catalogWebPreviewErr", { e: errMsg }));
      }
    },
    [previewBusyUrl, stopPreview, t],
  );

  const thumb = item.thumbnailUrl?.trim() || null;
  const isSingle = item.type === "song";
  const KindIcon = isSingle ? UiMusicNote : UiAlbumIcon;
  const showTrackList = !tracksBusy && (tracks?.length ?? 0) > 0;
  const tracksListLabel = isSingle
    ? t("tools.catalogWebSongsSection")
    : t("tools.catalogWebAlbumsSection");
  const downloadLabel = isSingle
    ? t("tools.catalogWebDownloadTrack")
    : t("tools.catalogWebDownloadAlbum");

  return createPortal(
    <div
      className="meta-edit-backdrop studio-catalog-web-pick-backdrop"
      role="presentation"
      onClick={(ev) => {
        if (ev.target === ev.currentTarget) onClose();
      }}
    >
      <div
        className="meta-edit-dialog surface-card studio-catalog-web-pick-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t("tools.catalogWebPickDialogAria")}
        onClick={(ev) => ev.stopPropagation()}
      >
        <div className="studio-catalog-web-pick-dialog__head">
          <div className="studio-catalog-web-pick-dialog__lead">
            {thumb ? (
              <CoverImg
                className="studio-catalog-web-pick-dialog__cover"
                src={thumb}
                alt=""
                fallbackClassName="studio-catalog-web-pick-dialog__cover-fallback"
                fallback={<KindIcon aria-hidden />}
              />
            ) : (
              <div
                className="studio-catalog-web-pick-dialog__cover-fallback"
                aria-hidden
              >
                <KindIcon />
              </div>
            )}
            <div className="studio-catalog-web-pick-dialog__titles">
              <p className="studio-catalog-web-pick-dialog__title">
                {item.title}
              </p>
              {item.artistName ? (
                <p className="subtle sm studio-catalog-web-pick-dialog__artist">
                  {item.artistName}
                </p>
              ) : null}
              {item.releaseType ? (
                <p className="subtle sm studio-catalog-web-pick-dialog__type">
                  {item.releaseType}
                </p>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            className="icon-btn studio-catalog-web-pick-dialog__close"
            onClick={onClose}
            aria-label={t("common.close")}
          >
            <UiClose />
          </button>
        </div>

        {tracksBusy ? (
          <p className="subtle sm" role="status">
            {t("tools.catalogWebTracksLoading")}
          </p>
        ) : null}
        {tracksErr && !tracks?.length ? (
          <p className="subtle sm warnline">{tracksErr}</p>
        ) : null}
        {!tracksBusy && tracks && tracks.length === 0 && !tracksErr ? (
          <p className="subtle sm">{t("tools.catalogWebTracksEmpty")}</p>
        ) : null}

        {showTrackList && tracks?.length ? (
          <ul
            className="list-stack studio-catalog-web-pick-dialog__tracks"
            aria-label={tracksListLabel}
          >
            {tracks.map((track) => {
              const active = playingUrl === track.url;
              const loading = previewBusyUrl === track.url;
              return (
                <li key={track.id}>
                  <button
                    type="button"
                    className={`studio-catalog-web-pick-dialog__track${
                      active ? " is-active" : ""
                    }${loading ? " is-loading" : ""}`}
                    disabled={Boolean(previewBusyUrl && !loading)}
                    aria-pressed={active}
                    aria-busy={loading}
                    onClick={() => void playPreview(track)}
                  >
                    <span className="studio-catalog-web-pick-dialog__track-title">
                      {track.title}
                    </span>
                    {loading ? (
                      <span
                        className="subtle sm studio-catalog-web-pick-dialog__track-status"
                        role="status"
                      >
                        {t("tools.catalogWebPreviewLoading")}
                      </span>
                    ) : active ? (
                      <span className="subtle sm studio-catalog-web-pick-dialog__track-status">
                        {t("tools.catalogWebPreviewPlaying")}
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}

        {previewErr ? (
          <p className="subtle sm warnline">{previewErr}</p>
        ) : null}

        <div className="studio-catalog-web-pick-dialog__actions">
          <button
            type="button"
            className="ghost-btn"
            onClick={() => {
              stopPreview();
              onClose();
            }}
          >
            {t("app.dialogCancel")}
          </button>
          <span
            className="studio-catalog-web-pick-dialog__actions-spacer"
            aria-hidden
          />
          <button
            type="button"
            className="primary-btn"
            disabled={tracksBusy || Boolean(previewBusyUrl)}
            onClick={() => {
              stopPreview();
              onDownload();
            }}
          >
            {downloadLabel}
          </button>
        </div>

        <audio ref={audioRef} className="sr-only" preload="auto" />
      </div>
    </div>,
    document.body,
  );
}

export function StudioCatalogWeb({ t, active, onPickForDownload }: Props) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [albums, setAlbums] = useState<EnrichedAlbum[]>([]);
  const [songs, setSongs] = useState<EnrichedSong[]>([]);
  const [listEpoch, setListEpoch] = useState(0);
  const [picked, setPicked] = useState<PickItem | null>(null);
  const loadGenRef = useRef(0);
  const discoverCacheRef = useRef<{
    epoch: number;
    albums: EnrichedAlbum[];
    songs: EnrichedSong[];
  } | null>(null);

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
    fetchCatalogWebDiscover({ force })
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

  const openPick = useCallback((item: PickItem) => {
    setPicked(item);
  }, []);

  const closePick = useCallback(() => {
    setPicked(null);
  }, []);

  const confirmDownload = useCallback(() => {
    if (!picked) return;
    const kind = picked.type === "song" ? "song" : "album";
    onPickForDownload(picked.url, kind);
    setPicked(null);
  }, [onPickForDownload, picked]);

  const hasResults = albums.length > 0 || songs.length > 0;
  const albumTiles = useMemo(
    () =>
      albums.map((item) => (
        <WebDiscoverTile
          key={`album-${item.id}`}
          enriched={item}
          pickLabel={t("tools.catalogWebPickAria", { title: item.title })}
          onPick={() => openPick(item)}
        />
      )),
    [albums, openPick, t],
  );
  const songTiles = useMemo(
    () =>
      songs.map((item) => (
        <WebDiscoverTile
          key={`song-${item.id}`}
          enriched={item}
          pickLabel={t("tools.catalogWebPickAria", { title: item.title })}
          onPick={() => openPick(item)}
        />
      )),
    [openPick, songs, t],
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

      {picked ? (
        <CatalogWebPickDialog
          item={picked}
          t={t}
          onClose={closePick}
          onDownload={confirmDownload}
        />
      ) : null}
    </div>
  );
}
