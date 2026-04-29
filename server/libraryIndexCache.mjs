import fs from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { buildLibraryIndex } from "./musicLibrary.mjs";

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
  if (process.env.KORD_INDEX_CACHE === "0") return null;
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
    const tmp = `${p}.${process.pid}.${Date.now()}.tmp`;
    const payload = JSON.stringify(
      {
        schemaVersion: SCHEMA_VERSION,
        builtAt: new Date().toISOString(),
        index,
      },
      null,
      0,
    );
    await fs.writeFile(tmp, payload, "utf8");
    await fs.rename(tmp, p);
  } catch (e) {
    console.warn("[kord] library index cache write failed:", e?.message || e);
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
 * Restituisce l'epoch corrente (per decidere se scrivere dopo un build lungo).
 * @param {string} musicRoot */
export function getLibraryIndexCacheEpochSnapshot(musicRoot) {
  return getEpoch(path.resolve(musicRoot));
}

/**
 * Dopo aver servito una copia dalla cache: indicizza di nuovo in background e aggiorna il file.
 */
export function scheduleBackgroundLibraryRefresh(musicRoot) {
  if (process.env.KORD_INDEX_CACHE === "0") return;
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
      console.error("[kord] background library index refresh:", e?.message || e);
    } finally {
      bgRefreshRunning.delete(key);
    }
  });
}
