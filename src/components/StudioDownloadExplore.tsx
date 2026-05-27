import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchYoutubeExploreSearch,
  newStudioDownloadId,
  runYtdlpDownload,
  type StudioDownloadKind,
  type YoutubeExploreResult,
} from "../lib/api";
import type { DownloadItemSummary } from "../lib/downloadLogSummary";
import { ytdlpLogDetailForUser } from "../lib/ytdlpLogFilter";
import type { useI18n } from "../i18n/useI18n";
import type { LibraryReconcileOptions } from "../lib/libraryReconcile";
import { UiAlbumIcon, UiMusicNote } from "./RekordUiIcons";
import { StudioDownloadDisclaimer } from "./StudioDownloadDisclaimer";

type TFn = ReturnType<typeof useI18n>["t"];

type Props = {
  t: TFn;
  dlPath: string;
  /** Cartella effettiva per yt-dlp (album → sottocartella sotto artista, come in classico). */
  resolveOutputDir: (dlPath: string, item: YoutubeExploreResult) => string;
  downloadKindForItem: (item: YoutubeExploreResult) => StudioDownloadKind;
  /** I singoli seguono il vincolo classico: destinazione Artista/Album. */
  singleBlockedArtistFolder: boolean;
  hasValidDownloadDest: boolean;
  dlBusy: boolean;
  onBusyChange: (busy: boolean) => void;
  onProgress: (p: { current: number; total: number } | null) => void;
  onTrackProgress: (p: { current: number; total: number } | null) => void;
  onLog: (updater: (prev: string) => string) => void;
  onReconcileLibrary: (opts?: LibraryReconcileOptions) => void | Promise<void>;
  onPrepareDownload: (item: YoutubeExploreResult) => Promise<boolean>;
  downloadSummaryLine: (r: DownloadItemSummary) => string;
  onDownloadIdChange?: (downloadId: string | null) => void;
};

function exploreItemKey(item: YoutubeExploreResult) {
  return `${item.type}-${item.id}`;
}

export function StudioDownloadExplore({
  t,
  dlPath,
  resolveOutputDir,
  downloadKindForItem,
  singleBlockedArtistFolder,
  hasValidDownloadDest,
  dlBusy,
  onBusyChange,
  onProgress,
  onTrackProgress,
  onLog,
  onReconcileLibrary,
  onPrepareDownload,
  downloadSummaryLine,
  onDownloadIdChange,
}: Props) {
  const [query, setQuery] = useState("");
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchErr, setSearchErr] = useState<string | null>(null);
  const [results, setResults] = useState<YoutubeExploreResult[]>([]);
  const [preparingKey, setPreparingKey] = useState<string | null>(null);
  const runLatch = useRef(false);
  const searchGen = useRef(0);

  const runSearch = useCallback((raw: string) => {
    const q = raw.trim();
    if (q.length < 2) {
      setResults([]);
      setSearchErr(null);
      return;
    }
    const gen = ++searchGen.current;
    setSearchErr(null);
    setSearchBusy(true);
    fetchYoutubeExploreSearch(q)
      .then((d) => {
        if (gen !== searchGen.current) return;
        setResults(d.results);
      })
      .catch((e: unknown) => {
        if (gen !== searchGen.current) return;
        setResults([]);
        setSearchErr(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (gen === searchGen.current) setSearchBusy(false);
      });
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setSearchErr(null);
      return;
    }
    const timer = window.setTimeout(() => runSearch(q), 420);
    return () => window.clearTimeout(timer);
  }, [query, runSearch]);

  const { albums, songs } = useMemo(() => {
    const a: YoutubeExploreResult[] = [];
    const s: YoutubeExploreResult[] = [];
    for (const item of results) {
      if (item.type === "album") a.push(item);
      else if (item.type === "song") s.push(item);
    }
    return { albums: a, songs: s };
  }, [results]);

  const downloadItem = useCallback(
    async (item: YoutubeExploreResult) => {
      const itemKey = exploreItemKey(item);
      setPreparingKey(itemKey);
      let proceed: boolean;
      try {
        if (!hasValidDownloadDest) {
          onLog((x) => x + t("tools.dlPickFolder"));
          return;
        }
        proceed = await onPrepareDownload(item);
      } finally {
        setPreparingKey((prev) => (prev === itemKey ? null : prev));
      }
      if (!proceed) return;
      if (runLatch.current || dlBusy) return;
      runLatch.current = true;
      onBusyChange(true);
      onProgress(null);
      onTrackProgress(null);
      const outputDir = resolveOutputDir(dlPath, item);
      const dlId = newStudioDownloadId();
      onDownloadIdChange?.(dlId);
      onLog(
        (x) =>
          x +
          t("tools.exploreDlStart", { title: item.title, path: outputDir }) +
          "\n",
      );
      try {
        const r = await runYtdlpDownload(
          item.url,
          outputDir,
          (p) => onTrackProgress({ current: p.current, total: p.total }),
          { downloadId: dlId, downloadKind: downloadKindForItem(item) },
        );
        if (r.progress && r.progress.total > 0) {
          onTrackProgress({
            current: r.progress.current,
            total: r.progress.total,
          });
        }
        const detail = ytdlpLogDetailForUser(r);
        onLog((x) => {
          if (r.cancelled) return x + t("tools.dlStoppedByUser") + "\n";
          return (
            x +
            (r.ok
              ? t("tools.dlResultOk")
              : t("tools.dlResultErr", { code: r.code }) +
                (detail ? t("tools.dlErrDetail", { detail }) : "")) +
            downloadSummaryLine(r)
          );
        });
        await onReconcileLibrary({ mode: "now" });
      } catch (e) {
        onLog(
          (x) =>
            x +
            t("tools.dlFail", {
              e: String((e as Error)?.message || e),
            }),
        );
      } finally {
        onDownloadIdChange?.(null);
        onBusyChange(false);
        runLatch.current = false;
      }
    },
    [
      hasValidDownloadDest,
      dlBusy,
      dlPath,
      resolveOutputDir,
      downloadKindForItem,
      onBusyChange,
      onProgress,
      onTrackProgress,
      onLog,
      onReconcileLibrary,
      onPrepareDownload,
      downloadSummaryLine,
      onDownloadIdChange,
      t,
    ],
  );

  const renderRow = (item: YoutubeExploreResult) => {
    const key = exploreItemKey(item);
    const isPreparing = preparingKey === key;
    const isAlbum = item.type === "album";
    const blockedSingle = !isAlbum && singleBlockedArtistFolder;
    const rowBusy = dlBusy || preparingKey != null || blockedSingle;

    return (
      <li key={key}>
        <button
          type="button"
          className={`tools-dl-explore__item${
            isPreparing ? " tools-dl-explore__item--preparing" : ""
          }`}
          disabled={rowBusy}
          aria-busy={isPreparing}
          aria-label={isPreparing ? t("tools.explorePreparingConfirm") : undefined}
          onClick={() => void downloadItem(item)}
        >
          <span
            className={`tools-dl-explore__thumb tools-dl-explore__thumb--fallback${
              isAlbum ? " tools-dl-explore__thumb--album" : ""
            }`}
            aria-hidden
          >
            {isAlbum ? (
              <UiAlbumIcon className="tools-dl-explore__thumb-fallback-ic" />
            ) : (
              <UiMusicNote className="tools-dl-explore__thumb-fallback-ic" />
            )}
          </span>
          <span className="tools-dl-explore__item-body">
            <span className="tools-dl-explore__item-title">{item.title}</span>
            {item.subtitle ? (
              <span className="tools-dl-explore__item-meta">{item.subtitle}</span>
            ) : null}
          </span>
          {isPreparing ? (
            <span className="tools-dl-explore__sk-overlay" aria-hidden>
              <span className="tools-dl-explore__thumb tools-dl-explore__thumb--sk" />
              <span className="tools-dl-explore__item-body tools-dl-explore__item-body--sk">
                <span className="tools-dl-explore__skeleton-bar" />
                {item.subtitle ? (
                  <span className="tools-dl-explore__skeleton-bar tools-dl-explore__skeleton-bar--sub" />
                ) : null}
              </span>
            </span>
          ) : null}
        </button>
      </li>
    );
  };

  return (
    <div className="tools-dl-explore">
      <p className="subtle sm tools-dl-explore__lead">{t("tools.exploreLead")}</p>
      <StudioDownloadDisclaimer t={t} />

      <input
        type="search"
        className="w-full tools-dl-explore__search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t("tools.exploreSearchPh")}
        aria-label={t("tools.exploreSearchAria")}
        autoComplete="off"
      />

      {searchBusy ? (
        <p className="subtle sm" role="status">
          {t("tools.searching")}
        </p>
      ) : null}
      {searchErr ? <p className="subtle sm warnline">{searchErr}</p> : null}

      {query.trim().length >= 2 &&
      !searchBusy &&
      !searchErr &&
      albums.length === 0 &&
      songs.length === 0 ? (
        <p className="subtle sm">{t("tools.exploreEmpty")}</p>
      ) : null}

      {albums.length > 0 ? (
        <section className="tools-dl-explore__group" aria-label={t("tools.exploreAlbumsSection")}>
          <h5 className="tools-dl-explore__group-title">
            {t("tools.exploreAlbumsSection")}
          </h5>
          <ul className="tools-dl-explore__list">{albums.map(renderRow)}</ul>
        </section>
      ) : null}

      {songs.length > 0 ? (
        <section className="tools-dl-explore__group" aria-label={t("tools.exploreSongsSection")}>
          <h5 className="tools-dl-explore__group-title">
            {t("tools.exploreSongsSection")}
          </h5>
          <ul className="tools-dl-explore__list">{songs.map(renderRow)}</ul>
        </section>
      ) : null}

      {dlBusy ? (
        <p className="subtle sm" role="status">
          {t("tools.exploreDownloading")}
        </p>
      ) : null}
    </div>
  );
}
