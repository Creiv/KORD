import fs from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { buildLibraryIndex } from "./musicLibrary.mjs";
import { atomicWriteFileUtf8 } from "./rekordDataStore.mjs";

const CACHE_FILENAME = "library-index.v1.cache.json";
const SCHEMA_VERSION = 1;

const cacheEpoch = new Map();
const bgRefreshRunning = new Set();

function cacheFilePath(musicRoot) {
  return path.join(musicRoot, ".kord", CACHE_FILENAME);
}

function bumpEpoch(key) {
  cacheEpoch.set(key, (cacheEpoch.get(key) || 0) + 1);
}

function getEpoch(key) {
  return cacheEpoch.get(key) || 0;
}

function isValidIndexPayload(obj) {
  return (
    obj &&
    typeof obj === "object" &&
    typeof obj.musicRoot === "string" &&
    Array.isArray(obj.artists) &&
    Array.isArray(obj.albums) &&
    Array.isArray(obj.tracks) &&
    obj.stats &&
    typeof obj.stats === "object"
  );
}

/** @param {string} musicRoot */
export async function readLibraryIndexCache(musicRoot) {
  if (process.env.REKORD_INDEX_CACHE === "0") return null;
  const p = cacheFilePath(musicRoot);
  if (!existsSync(p)) return null;
  try {
    const raw = await fs.readFile(p, "utf8");
    const data = JSON.parse(raw);
    if (data?.schemaVersion !== SCHEMA_VERSION) return null;
    if (!isValidIndexPayload(data.index)) return null;
    if (path.resolve(String(data.index.musicRoot || "")) !== path.resolve(musicRoot)) {
      return null;
    }
    return data.index;
  } catch {
    return null;
  }
}

/** @param {string} musicRoot */
export async function writeLibraryIndexCache(musicRoot, index) {
  try {
    const dir = path.join(musicRoot, ".kord");
    await fs.mkdir(dir, { recursive: true });
    const p = cacheFilePath(musicRoot);
    const payload = JSON.stringify(
      {
        schemaVersion: SCHEMA_VERSION,
        builtAt: new Date().toISOString(),
        index,
      },
      null,
      0,
    );
    await atomicWriteFileUtf8(p, payload);
  } catch (e) {
    console.warn("[rekord] library index cache write failed:", e?.message || e);
  }
}

async function unlinkCacheFile(musicRoot) {
  const p = cacheFilePath(musicRoot);
  try {
    await fs.unlink(p);
  } catch {
    /* ok */
  }
}

/**
 * Da chiamare dopo aggiunte/rimozioni di file audio nella libreria.
 * Rimuove il file di cache e aumenta l'epoch così un eventuale refresh in background non riscrive dati vecchi.
 */
export async function invalidateLibraryIndexCache(musicRoot) {
  const key = path.resolve(musicRoot);
  bumpEpoch(key);
  bgRefreshRunning.delete(key);
  await unlinkCacheFile(musicRoot);
}

/**
 * Aggiorna un brano nella cache su disco senza riscan completa (metadati trackinfo).
 * @returns {Promise<boolean>} true se la cache esisteva ed è stata aggiornata
 */
export async function patchTrackInLibraryIndexCache(musicRoot, relPath, patch = {}) {
  if (process.env.REKORD_INDEX_CACHE === "0") return false;
  const cached = await readLibraryIndexCache(musicRoot);
  if (!cached || !relPath) return false;
  let found = false;
  const tracks = cached.tracks.map((track) => {
    if (track.relPath !== relPath) return track;
    found = true;
    const nextMeta =
      patch.meta && typeof patch.meta === "object"
        ? { ...(track.meta || {}), ...patch.meta }
        : track.meta;
    return {
      ...track,
      ...(patch.title ? { title: patch.title } : {}),
      ...(nextMeta ? { meta: nextMeta } : {}),
    };
  });
  if (!found) return false;
  await writeLibraryIndexCache(musicRoot, { ...cached, tracks });
  return true;
}

/**
 * Aggiorna più brani nella cache (es. fetch metadati a batch o save album con generi).
 * @param {string} musicRoot
 * @param {Array<{ relPath: string, title?: string, meta?: Record<string, unknown> }>} patches
 */
export async function patchTracksInLibraryIndexCache(musicRoot, patches) {
  if (process.env.REKORD_INDEX_CACHE === "0" || !patches?.length) return false;
  const cached = await readLibraryIndexCache(musicRoot);
  if (!cached) return false;
  const byPath = new Map(
    patches.filter((p) => p?.relPath).map((p) => [p.relPath, p]),
  );
  if (!byPath.size) return false;
  let found = false;
  const tracks = cached.tracks.map((track) => {
    const patch = byPath.get(track.relPath);
    if (!patch) return track;
    found = true;
    const nextMeta =
      patch.meta && typeof patch.meta === "object"
        ? { ...(track.meta || {}), ...patch.meta }
        : track.meta;
    return {
      ...track,
      ...(patch.title ? { title: patch.title } : {}),
      ...(nextMeta ? { meta: nextMeta } : {}),
    };
  });
  if (!found) return false;
  await writeLibraryIndexCache(musicRoot, { ...cached, tracks });
  return true;
}

/**
 * Copertina / metadati album nella cache senza riscan.
 * @param {string} musicRoot
 * @param {string} albumRelPath
 * @param {Record<string, unknown>} patch
 */
export async function patchAlbumInLibraryIndexCache(
  musicRoot,
  albumRelPath,
  patch = {},
) {
  if (process.env.REKORD_INDEX_CACHE === "0") return false;
  const cached = await readLibraryIndexCache(musicRoot);
  if (!cached || !albumRelPath) return false;
  let found = false;
  const now = Date.now();
  const albums = cached.albums.map((album) => {
    if (album.relPath !== albumRelPath) return album;
    found = true;
    const next = { ...album, ...patch };
    if (patch.coverRelPath) {
      next.coverRelPath = patch.coverRelPath;
      next.hasCover = true;
      next.updatedAt = now;
    }
    if (patch.title && String(patch.title).trim()) {
      next.name = String(patch.title).trim();
    }
    if (patch.hasAlbumMeta === true) next.hasAlbumMeta = true;
    return next;
  });
  if (!found) return false;
  let tracks = cached.tracks;
  let artists = cached.artists;
  if (patch.coverRelPath) {
    const albumPrefix = `${albumRelPath}/`;
    tracks = tracks.map((track) =>
      track.relPath.startsWith(albumPrefix)
        ? { ...track, updatedAt: now }
        : track,
    );
    const albumRow = albums.find((a) => a.relPath === albumRelPath);
    if (albumRow?.artistId) {
      artists = artists.map((artist) =>
        artist.id === albumRow.artistId
          ? { ...artist, coverRelPath: patch.coverRelPath }
          : artist,
      );
    }
  }
  await writeLibraryIndexCache(musicRoot, { ...cached, albums, tracks, artists });
  return true;
}

/**
 * Restituisce l'epoch corrente (per decidere se scrivere dopo un build lungo).
 * @param {string} musicRoot */
export function getLibraryIndexCacheEpochSnapshot(musicRoot) {
  return getEpoch(path.resolve(musicRoot));
}

/**
 * Dopo aver servito una copia dalla cache: indicizza di nuovo in background e aggiorna il file.
 */
export function scheduleBackgroundLibraryRefresh(musicRoot) {
  if (process.env.REKORD_INDEX_CACHE === "0") return;
  const key = path.resolve(musicRoot);
  if (bgRefreshRunning.has(key)) return;
  bgRefreshRunning.add(key);
  const epochAtStart = getEpoch(key);
  queueMicrotask(async () => {
    try {
      const fresh = await buildLibraryIndex(musicRoot);
      if (getEpoch(key) !== epochAtStart) return;
      await writeLibraryIndexCache(musicRoot, fresh);
    } catch (e) {
      console.error("[rekord] background library index refresh:", e?.message || e);
    } finally {
      bgRefreshRunning.delete(key);
    }
  });
}
