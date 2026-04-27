/* eslint-disable react-refresh/only-export-components -- hook + provider */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type FormEvent,
} from "react";
import { deleteAudioRelPaths, saveAlbumInfoManual } from "../lib/api";
import { useI18n } from "../i18n/useI18n";
import { usePlayer } from "../context/PlayerContext";
import { useUserState } from "../context/UserStateContext";
import type { LibraryAlbumIndex } from "../types";

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

function AlbumMetaEditorModal({
  album,
  onClose,
  onSaved,
}: {
  album: LibraryAlbumIndex | null;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const { t } = useI18n();
  const [title, setTitle] = useState("");
  const [releaseDate, setReleaseDate] = useState("");
  const [label, setLabel] = useState("");
  const [country, setCountry] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const p = usePlayer();
  const { stripUserStateForRelPaths } = useUserState();

  useEffect(() => {
    if (!album) return;
    window.setTimeout(() => {
      setTitle(album.title || album.name);
      setReleaseDate(toDateInputValue(album.releaseDate));
      setLabel(album.label || "");
      setCountry(album.country || "");
      setErr(null);
    }, 0);
  }, [album]);

  const submit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      if (!album || album.loose) return;
      setBusy(true);
      setErr(null);
      try {
        await saveAlbumInfoManual(album.relPath, {
          title: title.trim() === "" ? null : title.trim(),
          releaseDate: releaseDate.trim() === "" ? null : releaseDate.trim(),
          label: label.trim() === "" ? null : label.trim(),
          country: country.trim() === "" ? null : country.trim(),
        });
        await Promise.resolve(onSaved());
        onClose();
      } catch (error: unknown) {
        setErr(error instanceof Error ? error.message : String(error));
      } finally {
        setBusy(false);
      }
    },
    [album, country, label, onClose, onSaved, releaseDate, title],
  );

  const runDelete = useCallback(async () => {
    if (!album || !album.tracks.length) return;
    if (
      !window.confirm(
        t("albumMeta.deleteConfirm", { n: String(album.tracks.length) })
      )
    ) {
      return;
    }
    setDeleteBusy(true);
    setErr(null);
    try {
      const { deleted } = await deleteAudioRelPaths([...album.tracks]);
      if (!deleted.length) {
        setErr(t("albumMeta.deleteFailed"));
        return;
      }
      for (const rel of deleted) p.removeFromQueueByRelPath(rel);
      stripUserStateForRelPaths(deleted);
      await Promise.resolve(onSaved());
      onClose();
    } catch (error: unknown) {
      setErr(error instanceof Error ? error.message : String(error));
    } finally {
      setDeleteBusy(false);
    }
  }, [album, onClose, onSaved, p, stripUserStateForRelPaths, t]);

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
          <p className="subtle sm">{t("albumMeta.editHint")}</p>
          {err ? <p className="subtle sm warnline">{err}</p> : null}
          <div className="meta-edit-actions">
            <button
              type="button"
              className="ghost-btn danger"
              disabled={busy || deleteBusy || !album.tracks.length}
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
  onSaved,
}: {
  children: React.ReactNode;
  onSaved: () => void | Promise<void>;
}) {
  const [album, setAlbum] = useState<LibraryAlbumIndex | null>(null);
  const open = useCallback((item: LibraryAlbumIndex) => setAlbum(item), []);
  return (
    <AlbumMetaEditContext.Provider value={open}>
      {children}
      <AlbumMetaEditorModal
        album={album}
        onClose={() => setAlbum(null)}
        onSaved={onSaved}
      />
    </AlbumMetaEditContext.Provider>
  );
}
