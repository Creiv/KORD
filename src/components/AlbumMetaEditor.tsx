/* eslint-disable react-refresh/only-export-components -- hook + provider */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { deleteAlbumFolder, saveAlbumInfoManual } from "../lib/api";
import { useI18n } from "../i18n/useI18n";
import { usePlayer } from "../context/PlayerContext";
import { useUserState } from "../context/UserStateContext";
import { useAppConfirm } from "../context/AppConfirmContext";
import {
  parseTrackGenres,
  serializeTrackGenres,
} from "../lib/genres";
import type { LibraryAlbumIndex, LibraryEntityDelta } from "../types";
import { UiClose } from "./KordUiIcons";

const AlbumMetaEditContext = createContext<(album: LibraryAlbumIndex) => void>(
  () => {},
);

export function useOpenAlbumMetaEdit() {
  return useContext(AlbumMetaEditContext);
}

function toDateInputValue(raw: string | null | undefined): string {
  if (!raw?.trim()) return "";
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return "";
}

function addGenreToken(current: string[], token: string): string[] {
  const t = token.trim();
  if (!t) return current;
  const k = t.toLowerCase();
  if (current.some((g) => g.toLowerCase() === k)) return current;
  return [...current, t];
}

function genreSignature(genres: readonly string[]): string {
  return serializeTrackGenres(genres) || "";
}

function AlbumMetaEditorModal({
  album,
  genreOptions,
  onClose,
  onSaved,
}: {
  album: LibraryAlbumIndex | null;
  genreOptions: readonly string[];
  onClose: () => void;
  onSaved: (delta?: LibraryEntityDelta) => void | Promise<void>;
}) {
  const { t } = useI18n();
  const { confirm: appConfirm } = useAppConfirm();
  const pickId = useId();
  const [title, setTitle] = useState("");
  const [releaseDate, setReleaseDate] = useState("");
  const [genres, setGenres] = useState<string[]>([]);
  const [newGenre, setNewGenre] = useState("");
  const [label, setLabel] = useState("");
  const [country, setCountry] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const initialGenresSigRef = useRef("");
  const p = usePlayer();
  const { stripUserStateForRelPaths } = useUserState();

  useEffect(() => {
    if (!album) return;
    window.setTimeout(() => {
      setTitle(album.title || album.name);
      setReleaseDate(toDateInputValue(album.releaseDate));
      const initialGenres = parseTrackGenres(album.genre);
      setGenres(initialGenres);
      setNewGenre("");
      setLabel(album.label || "");
      setCountry(album.country || "");
      initialGenresSigRef.current = genreSignature(initialGenres);
      setErr(null);
    }, 0);
  }, [album]);

  const availableFromLibrary = genreOptions.filter(
    (g) => !genres.some((s) => s.toLowerCase() === g.toLowerCase()),
  );

  const removeGenre = useCallback((i: number) => {
    setGenres((prev) => prev.filter((_, j) => j !== i));
  }, []);

  const addNewGenre = useCallback(() => {
    setGenres((prev) => addGenreToken(prev, newGenre));
    setNewGenre("");
  }, [newGenre]);

  const submit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      if (!album || album.loose) return;
      setBusy(true);
      setErr(null);
      try {
        const nextGenreSig = genreSignature(genres);
        const saved = await saveAlbumInfoManual(album.relPath, {
          title: title.trim() === "" ? null : title.trim(),
          releaseDate: releaseDate.trim() === "" ? null : releaseDate.trim(),
          ...(nextGenreSig !== initialGenresSigRef.current
            ? { genre: nextGenreSig || null }
            : {}),
          label: label.trim() === "" ? null : label.trim(),
          country: country.trim() === "" ? null : country.trim(),
        });
        await Promise.resolve(
          onSaved({
            albumPath: saved.albumPath,
            album: saved.album,
            tracks: saved.tracks,
          }),
        );
        onClose();
      } catch (error: unknown) {
        setErr(error instanceof Error ? error.message : String(error));
      } finally {
        setBusy(false);
      }
    },
    [album, country, genres, label, onClose, onSaved, releaseDate, title],
  );

  const runDelete = useCallback(async () => {
    if (!album || album.loose || !album.relPath || !album.tracks.length) return;
    if (
      !(await appConfirm({
        message: t("albumMeta.deleteConfirm", {
          n: String(album.tracks.length),
          path: album.relPath,
        }),
        variant: "danger",
      }))
    ) {
      return;
    }
    setDeleteBusy(true);
    setErr(null);
    try {
      const { deleted, deletedFolder, affectedAlbums } = await deleteAlbumFolder(album.relPath);
      if (!deleted.length) {
        setErr(t("albumMeta.deleteFailed"));
        return;
      }
      for (const rel of deleted) p.removeFromQueueByRelPath(rel);
      stripUserStateForRelPaths(deleted);
      await Promise.resolve(onSaved({ deleted, deletedFolder, affectedAlbums }));
      onClose();
    } catch (error: unknown) {
      setErr(error instanceof Error ? error.message : String(error));
    } finally {
      setDeleteBusy(false);
    }
  }, [album, onClose, onSaved, p, stripUserStateForRelPaths, t, appConfirm]);

  if (!album) return null;

  return (
    <div
      className="meta-edit-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="meta-edit-dialog surface-card"
        role="dialog"
        aria-labelledby="album-meta-edit-title"
        aria-modal="true"
      >
        <div className="section-head">
          <div>
            <p className="eyebrow">{t("albumMeta.editEyebrow")}</p>
            <h2 id="album-meta-edit-title">{t("albumMeta.editHeading")}</h2>
            <p className="subtle sm meta-edit-path">{album.relPath}</p>
          </div>
          <button type="button" className="text-btn" onClick={onClose}>
            {t("trackMeta.editClose")}
          </button>
        </div>
        <form className="meta-edit-form" onSubmit={submit}>
          <label className="meta-edit-field">
            <span>{t("albumMeta.fieldTitle")}</span>
            <input
              className="ghost-input w-full"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              autoComplete="off"
            />
          </label>
          <label className="meta-edit-field">
            <span>{t("albumMeta.fieldReleaseDate")}</span>
            <input
              className="ghost-input w-full"
              type="date"
              value={releaseDate}
              onChange={(event) => setReleaseDate(event.target.value)}
            />
          </label>
          <div className="meta-edit-field">
            <span>{t("albumMeta.fieldGenre")}</span>
            <p className="subtle sm meta-edit-field-hint">
              {t("albumMeta.fieldGenreHint")}
            </p>
            <div className="meta-edit-genre-chips" role="list">
              {genres.map((g, i) => (
                <span key={`${g}-${i}`} className="meta-edit-genre-chip" role="listitem">
                  <span className="meta-edit-genre-chip__text">{g}</span>
                  <button
                    type="button"
                    className="meta-edit-genre-chip__x"
                    onClick={() => removeGenre(i)}
                    aria-label={t("trackMeta.fieldGenreRemoveAria", { g })}
                  >
                    <UiClose className="meta-edit-genre-chip__x-ic" />
                  </button>
                </span>
              ))}
            </div>
            <div className="meta-edit-genre-add">
              <label className="sr-only" htmlFor={pickId}>
                {t("trackMeta.fieldGenrePick")}
              </label>
              <select
                key={`${genres.length}-${availableFromLibrary.length}`}
                id={pickId}
                className="ghost-input w-full meta-edit-genre-select"
                defaultValue=""
                onChange={(event) => {
                  const v = event.target.value;
                  if (v) setGenres((prev) => addGenreToken(prev, v));
                }}
              >
                <option value="">{t("trackMeta.fieldGenrePickPlaceholder")}</option>
                {availableFromLibrary.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </div>
            <div className="meta-edit-genre-custom">
              <input
                className="ghost-input"
                value={newGenre}
                onChange={(event) => setNewGenre(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addNewGenre();
                  }
                }}
                placeholder={t("trackMeta.fieldGenreNewPlaceholder")}
                autoComplete="off"
              />
              <button
                type="button"
                className="ghost-btn"
                onClick={addNewGenre}
                disabled={!newGenre.trim()}
              >
                {t("trackMeta.fieldGenreAdd")}
              </button>
            </div>
          </div>
          <label className="meta-edit-field">
            <span>{t("albumMeta.fieldLabel")}</span>
            <input
              className="ghost-input w-full"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              autoComplete="off"
            />
          </label>
          <label className="meta-edit-field">
            <span>{t("albumMeta.fieldCountry")}</span>
            <input
              className="ghost-input w-full"
              value={country}
              onChange={(event) => setCountry(event.target.value)}
              autoComplete="off"
            />
          </label>
          {err ? <p className="subtle sm warnline">{err}</p> : null}
          <div className="meta-edit-actions">
            <button
              type="button"
              className="ghost-btn danger"
              disabled={busy || deleteBusy || album.loose || !album.tracks.length}
              onClick={() => {
                void runDelete();
              }}
            >
              {deleteBusy ? t("trackMeta.deleting") : t("albumMeta.deleteAlbum")}
            </button>
            <span className="meta-edit-actions__spacer" aria-hidden />
            <button type="button" className="ghost-btn" onClick={onClose}>
              {t("trackMeta.editCancel")}
            </button>
            <button
              type="submit"
              className="btn"
              disabled={busy || deleteBusy || album.loose}
            >
              {busy ? t("trackMeta.editSaving") : t("trackMeta.editSave")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function AlbumMetaEditProvider({
  children,
  genreOptions,
  onSaved,
}: {
  children: React.ReactNode;
  genreOptions: readonly string[];
  onSaved: (delta?: LibraryEntityDelta) => void | Promise<void>;
}) {
  const [album, setAlbum] = useState<LibraryAlbumIndex | null>(null);
  const open = useCallback((item: LibraryAlbumIndex) => setAlbum(item), []);
  return (
    <AlbumMetaEditContext.Provider value={open}>
      {children}
      <AlbumMetaEditorModal
        album={album}
        genreOptions={genreOptions}
        onClose={() => setAlbum(null)}
        onSaved={onSaved}
      />
    </AlbumMetaEditContext.Provider>
  );
}
