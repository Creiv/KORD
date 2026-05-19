import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  fetchCatalogWebDiscover,
  type CatalogWebDiscoverAlbum,
} from "../lib/api";
import { CoverImg } from "./CoverImg";
import { UiAlbumIcon } from "./KordUiIcons";
import type { useI18n } from "../i18n/useI18n";

type TFn = ReturnType<typeof useI18n>["t"];

type Props = {
  t: TFn;
  active: boolean;
  onPickAlbumForDownload: (url: string) => void;
};

function WebDiscoverAlbumTile({
  item,
  pickLabel,
  onPick,
}: {
  item: CatalogWebDiscoverAlbum;
  pickLabel: string;
  onPick: () => void;
}) {
  const thumb = item.thumbnailUrl?.trim() || null;
  const meta = item.artistName || item.subtitle;

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onPick();
    }
  };

  return (
    <div className="library-list-tile library-list-tile--album studio-catalog-list-tile studio-catalog-web-tile">
      <button
        type="button"
        className="studio-catalog-list-tile__main studio-catalog-web-tile__pick"
        onClick={onPick}
        onKeyDown={onKeyDown}
        aria-label={pickLabel}
      >
        <div className="library-list-tile__media">
          {thumb ? (
            <CoverImg
              className="library-list-tile__cover"
              src={thumb}
              alt=""
              fallbackClassName="library-list-tile__badge studio-catalog-web-tile__badge"
              fallback={<UiAlbumIcon className="studio-catalog-web-tile__badge-ic" />}
            />
          ) : (
            <div className="library-list-tile__badge studio-catalog-web-tile__badge">
              <UiAlbumIcon className="studio-catalog-web-tile__badge-ic" />
            </div>
          )}
        </div>
        <div className="library-list-tile__body">
          <div className="library-list-tile__title-row">
            <UiAlbumIcon className="library-list-tile__kind-ic" aria-hidden />
            <div className="library-list-tile__title">{item.title}</div>
          </div>
          {meta ? <div className="library-list-tile__meta">{meta}</div> : null}
        </div>
      </button>
    </div>
  );
}

export function StudioCatalogWeb({ t, active, onPickAlbumForDownload }: Props) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [albums, setAlbums] = useState<CatalogWebDiscoverAlbum[]>([]);
  const [listEpoch, setListEpoch] = useState(0);
  const loadGenRef = useRef(0);

  const load = useCallback(() => {
    const gen = ++loadGenRef.current;
    const refreshNonce = Date.now();
    setBusy(true);
    setErr(null);
    fetchCatalogWebDiscover(refreshNonce)
      .then((d) => {
        if (gen !== loadGenRef.current) return;
        setAlbums(d.albums);
        setListEpoch(refreshNonce);
      })
      .catch((e: unknown) => {
        if (gen !== loadGenRef.current) return;
        setAlbums([]);
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
      {!busy && !err && albums.length === 0 ? (
        <p className="subtle sm">{t("tools.catalogWebEmpty")}</p>
      ) : null}
      {albums.length > 0 ? (
        <div
          key={listEpoch}
          className="library-overview-cols studio-catalog-web__grid"
        >
          {albums.map((item) => (
            <WebDiscoverAlbumTile
              key={`album-${item.id}`}
              item={item}
              pickLabel={t("tools.catalogWebPickAria", { title: item.title })}
              onPick={() => onPickAlbumForDownload(item.url)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
