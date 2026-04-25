/* eslint-disable react-refresh/only-export-components -- hook + provider */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useState,
  type FormEvent,
} from "react";
import { saveTrackInfoManual } from "../lib/api";
import { useI18n } from "../i18n/useI18n";
import type { EnrichedTrack } from "../types";

const TrackMetaEditContext = createContext<(track: EnrichedTrack) => void>(
  () => {},
);

export function useOpenTrackMetaEdit() {
  return useContext(TrackMetaEditContext);
}

function toDateInputValue(raw: string | null | undefined): string {
  if (!raw?.trim()) return "";
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return "";
}

export function TrackMetaEditGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"
      />
    </svg>
  );
}

function TrackMetaEditorModal({
  track,
  genreOptions,
  onClose,
  onSaved,
}: {
  track: EnrichedTrack | null;
  genreOptions: readonly string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const genreListId = useId();
  const [title, setTitle] = useState("");
  const [releaseDate, setReleaseDate] = useState("");
  const [genre, setGenre] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!track) return;
    const timer = window.setTimeout(() => {
      const m = track.meta;
      setTitle(track.title);
      setReleaseDate(toDateInputValue(m?.releaseDate ?? null));
      setGenre(m?.genre?.trim() ?? "");
      setErr(null);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [track]);

  const submit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!track) return;
      setBusy(true);
      setErr(null);
      try {
        await saveTrackInfoManual(track.relPath, {
          title: title.trim() === "" ? null : title.trim(),
          releaseDate: releaseDate.trim() === "" ? null : releaseDate.trim(),
          genre: genre.trim() === "" ? null : genre.trim(),
        });
        await Promise.resolve(onSaved());
        onClose();
      } catch (er: unknown) {
        setErr(er instanceof Error ? er.message : String(er));
      } finally {
        setBusy(false);
      }
    },
    [track, title, releaseDate, genre, onClose, onSaved],
  );

  if (!track) return null;

  return (
    <div
      className="meta-edit-backdrop"
      role="presentation"
      onClick={(ev) => {
        if (ev.target === ev.currentTarget) onClose();
      }}
    >
      <div
        className="meta-edit-dialog surface-card"
        role="dialog"
        aria-labelledby="meta-edit-title"
        aria-modal="true"
      >
        <div className="section-head">
          <div>
            <p className="eyebrow">{t("trackMeta.editEyebrow")}</p>
            <h2 id="meta-edit-title">{t("trackMeta.editHeading")}</h2>
            <p className="subtle sm meta-edit-path">{track.relPath}</p>
          </div>
          <button type="button" className="text-btn" onClick={onClose}>
            {t("trackMeta.editClose")}
          </button>
        </div>
        <form className="meta-edit-form" onSubmit={submit}>
          <label className="meta-edit-field">
            <span>{t("trackMeta.fieldTitle")}</span>
            <input
              className="ghost-input w-full"
              value={title}
              onChange={(ev) => setTitle(ev.target.value)}
              autoComplete="off"
            />
          </label>
          <label className="meta-edit-field">
            <span>{t("trackMeta.fieldReleaseDate")}</span>
            <input
              className="ghost-input w-full"
              type="date"
              value={releaseDate}
              onChange={(ev) => setReleaseDate(ev.target.value)}
            />
          </label>
          <label className="meta-edit-field">
            <span>{t("trackMeta.fieldGenre")}</span>
            <input
              className="ghost-input w-full"
              list={genreListId}
              value={genre}
              onChange={(ev) => setGenre(ev.target.value)}
              autoComplete="off"
            />
            <datalist id={genreListId}>
              {genreOptions.map((g) => (
                <option key={g} value={g} />
              ))}
            </datalist>
            <span className="subtle sm meta-edit-field-hint">
              {t("trackMeta.fieldGenreHint")}
            </span>
          </label>
          <p className="subtle sm">{t("trackMeta.editHint")}</p>
          {err ? <p className="subtle sm warnline">{err}</p> : null}
          <div className="meta-edit-actions">
            <button type="button" className="ghost-btn" onClick={onClose}>
              {t("trackMeta.editCancel")}
            </button>
            <button type="submit" className="btn" disabled={busy}>
              {busy ? t("trackMeta.editSaving") : t("trackMeta.editSave")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function TrackMetaEditProvider({
  children,
  genreOptions,
  onSaved,
}: {
  children: React.ReactNode;
  genreOptions: readonly string[];
  onSaved: () => void | Promise<void>;
}) {
  const [track, setTrack] = useState<EnrichedTrack | null>(null);
  const open = useCallback((tr: EnrichedTrack) => setTrack(tr), []);
  return (
    <TrackMetaEditContext.Provider value={open}>
      {children}
      <TrackMetaEditorModal
        track={track}
        genreOptions={genreOptions}
        onClose={() => setTrack(null)}
        onSaved={onSaved}
      />
    </TrackMetaEditContext.Provider>
  );
}
