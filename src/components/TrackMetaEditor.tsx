/* eslint-disable react-refresh/only-export-components -- hook + provider */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";
import { deleteAudioRelPaths, saveTrackInfoManual } from "../lib/api";
import { useI18n } from "../i18n/useI18n";
import { usePlayer } from "../context/PlayerContext";
import { useUserState } from "../context/UserStateContext";
import {
  parseTrackGenres,
  serializeTrackGenres,
} from "../lib/genres";
import {
  MAX_TRACK_MOODS,
  parseTrackMoods,
  TRACK_MOOD_COLORS,
  TRACK_MOOD_IDS,
  type TrackMoodId,
} from "../lib/trackMoods";
import { TrackMoodGlyph } from "./TrackMoodGlyph";
import type { EnrichedTrack } from "../types";
import { UiClose } from "./KordUiIcons";

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

function addGenreToken(
  current: string[],
  token: string,
): string[] {
  const t = token.trim();
  if (!t) return current;
  const k = t.toLowerCase();
  if (current.some((g) => g.toLowerCase() === k)) return current;
  return [...current, t];
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
  const pickId = useId();
  const [title, setTitle] = useState("");
  const [releaseDate, setReleaseDate] = useState("");
  const [genres, setGenres] = useState<string[]>([]);
  const [moods, setMoods] = useState<TrackMoodId[]>([]);
  const [newGenre, setNewGenre] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const p = usePlayer();
  const { stripUserStateForRelPaths } = useUserState();

  useEffect(() => {
    if (!track) return;
    const timer = window.setTimeout(() => {
      const m = track.meta;
      setTitle(track.title);
      setReleaseDate(toDateInputValue(m?.releaseDate ?? null));
      setGenres(parseTrackGenres(m?.genre));
      setMoods(parseTrackMoods(m ?? undefined));
      setNewGenre("");
      setErr(null);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [track]);

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

  const toggleMood = useCallback((id: TrackMoodId) => {
    setMoods((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= MAX_TRACK_MOODS) return prev;
      return [...prev, id];
    });
  }, []);

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
          genre: serializeTrackGenres(genres),
          moods: moods.length ? moods : null,
        });
        await Promise.resolve(onSaved());
        onClose();
      } catch (er: unknown) {
        setErr(er instanceof Error ? er.message : String(er));
      } finally {
        setBusy(false);
      }
    },
    [track, title, releaseDate, genres, moods, onClose, onSaved],
  );

  const runDelete = useCallback(async () => {
    if (!track) return;
    if (!window.confirm(t("trackMeta.deleteConfirm"))) return;
    setDeleteBusy(true);
    setErr(null);
    try {
      const { deleted } = await deleteAudioRelPaths([track.relPath]);
      if (!deleted.length) {
        setErr(t("trackMeta.deleteFailed"));
        return;
      }
      for (const rel of deleted) p.removeFromQueueByRelPath(rel);
      stripUserStateForRelPaths(deleted);
      await Promise.resolve(onSaved());
      onClose();
    } catch (er: unknown) {
      setErr(er instanceof Error ? er.message : String(er));
    } finally {
      setDeleteBusy(false);
    }
  }, [onClose, onSaved, p, stripUserStateForRelPaths, t, track]);

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
          <div className="meta-edit-field">
            <span>{t("trackMeta.fieldGenre")}</span>
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
                className="ghost-input w-full"
                defaultValue=""
                onChange={(ev) => {
                  const v = ev.target.value;
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
                onChange={(ev) => setNewGenre(ev.target.value)}
                onKeyDown={(ev) => {
                  if (ev.key === "Enter") {
                    ev.preventDefault();
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
          <div className="meta-edit-field">
            <span>{t("trackMeta.fieldMood")}</span>
            <p className="subtle sm meta-edit-field-hint">{t("trackMeta.moodMaxHint", { n: MAX_TRACK_MOODS })}</p>
            <div className="meta-edit-mood-grid" role="group" aria-label={t("trackMeta.fieldMood")}>
              {TRACK_MOOD_IDS.map((id) => {
                const on = moods.includes(id);
                const c = TRACK_MOOD_COLORS[id];
                return (
                  <button
                    key={id}
                    type="button"
                    className={`meta-edit-mood-btn meta-edit-mood-btn--color${
                      on ? " meta-edit-mood-btn--on" : ""
                    }`}
                    style={{ "--mood-c": c } as CSSProperties}
                    aria-pressed={on}
                    title={t(`trackMeta.mood.${id}`)}
                    onClick={() => toggleMood(id)}
                  >
                    <TrackMoodGlyph mood={id} />
                  </button>
                );
              })}
            </div>
          </div>
          {err ? <p className="subtle sm warnline">{err}</p> : null}
          <div className="meta-edit-actions">
            <button
              type="button"
              className="ghost-btn danger"
              disabled={busy || deleteBusy}
              onClick={() => {
                void runDelete();
              }}
            >
              {deleteBusy ? t("trackMeta.deleting") : t("trackMeta.deleteFile")}
            </button>
            <span className="meta-edit-actions__spacer" aria-hidden />
            <button type="button" className="ghost-btn" onClick={onClose}>
              {t("trackMeta.editCancel")}
            </button>
            <button type="submit" className="btn" disabled={busy || deleteBusy}>
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
