import { createHash } from "crypto";
import { existsSync, statSync } from "fs";
import { mkdir, rename, stat, unlink } from "fs/promises";
import path from "path";
import { reuseKeyedPromise } from "./asyncSingleflight.mjs";
import { coverCandidates } from "./musicLibrary.mjs";

/** Larghezze consentite per `/api/cover?w=` (px lato max, quadrato). */
export const COVER_THUMB_WIDTHS = [64, 96, 128, 256, 400, 512];
const WIDTH_SET = new Set(COVER_THUMB_WIDTHS);

const thumbInflight = new Map();

export function parseCoverThumbWidth(raw) {
  if (raw == null || raw === "") return null;
  const n = Number.parseInt(String(raw), 10);
  return WIDTH_SET.has(n) ? n : null;
}

/**
 * Risolve il file copertina per un path album o brano sotto la libreria.
 * @returns {string | null} path assoluto del file immagine
 */
export function findCoverFilePath(root, relPath) {
  const filePath = path.join(root, relPath.replaceAll("/", path.sep));
  if (!existsSync(filePath)) return null;
  const dir = statSync(filePath).isDirectory()
    ? filePath
    : path.dirname(filePath);
  for (const name of coverCandidates()) {
    const full = path.join(dir, name);
    if (existsSync(full)) return path.resolve(full);
  }
  return null;
}

function thumbCachePath(musicRoot, sourcePath, width) {
  const st = statSync(sourcePath);
  const key = createHash("sha256")
    .update(path.resolve(sourcePath))
    .update("\0")
    .update(String(st.mtimeMs))
    .update("\0")
    .update(String(st.size))
    .digest("hex")
    .slice(0, 24);
  return path.resolve(
    musicRoot,
    ".kord",
    "cover-thumbs",
    key,
    `${width}.webp`,
  );
}

async function isValidThumbFile(filePath) {
  try {
    const st = await stat(filePath);
    return st.isFile() && st.size > 0;
  } catch {
    return false;
  }
}

let sharpModule = null;

async function getSharp() {
  if (sharpModule === false) {
    throw new Error("sharp non disponibile (binding nativo assente o piattaforma errata)");
  }
  if (sharpModule) return sharpModule;
  try {
    sharpModule = (await import("sharp")).default;
    return sharpModule;
  } catch (err) {
    sharpModule = false;
    throw err;
  }
}

async function writeCoverThumb(sourcePath, outPath, width) {
  const absOut = path.resolve(outPath);
  await mkdir(path.dirname(absOut), { recursive: true });
  const tmpPath = `${absOut}.${process.pid}.${Date.now()}.tmp`;
  try {
    const sharp = await getSharp();
    await sharp(sourcePath)
      .rotate()
      .resize(width, width, {
        fit: "cover",
        position: "centre",
        withoutEnlargement: true,
      })
      .webp({ quality: 82, effort: 4 })
      .toFile(tmpPath);
    await rename(tmpPath, absOut);
  } catch (err) {
    try {
      await unlink(tmpPath);
    } catch {
      /* */
    }
    throw err;
  }
  if (!(await isValidThumbFile(absOut))) {
    throw new Error("thumb write produced no file");
  }
  return absOut;
}

/**
 * Genera (o riusa da cache) un WebP ridimensionato.
 */
export async function getOrCreateCoverThumb(musicRoot, sourcePath, width) {
  const absSource = path.resolve(sourcePath);
  const outPath = thumbCachePath(musicRoot, absSource, width);
  if (await isValidThumbFile(outPath)) return outPath;

  return reuseKeyedPromise(thumbInflight, outPath, async () => {
    if (await isValidThumbFile(outPath)) return outPath;
    return writeCoverThumb(absSource, outPath, width);
  });
}

const COVER_CACHE = "private, max-age=86400, immutable";

function sendFileAbsolute(res, absPath) {
  return new Promise((resolve, reject) => {
    res.sendFile(absPath, (err) => {
      if (err) reject(err);
      else resolve(undefined);
    });
  });
}

/**
 * @param {import("express").Response} res
 * @param {{ root: string, relPath: string, width: number | null, underRoot: (full: string, root: string) => boolean }} opts
 */
export async function sendCoverResponse(res, { root, relPath, width, underRoot }) {
  const coverPath = findCoverFilePath(root, relPath);
  if (!coverPath || !underRoot(coverPath, root)) {
    return res.status(404).end();
  }

  if (!width) {
    res.setHeader("Cache-Control", COVER_CACHE);
    await sendFileAbsolute(res, coverPath);
    return;
  }

  try {
    const thumbPath = await getOrCreateCoverThumb(root, coverPath, width);
    if (!underRoot(thumbPath, root) || !(await isValidThumbFile(thumbPath))) {
      throw new Error("invalid thumb cache path");
    }
    res.setHeader("Content-Type", "image/webp");
    res.setHeader("Cache-Control", COVER_CACHE);
    await sendFileAbsolute(res, thumbPath);
  } catch (err) {
    const msg = err?.message || String(err);
    // `res.sendFile()` can report "Not Found" if the cached thumb disappears between
    // our stat check and the actual send (or during dev/HMR restarts). In that case
    // we just fall back to the original without spamming the console.
    if (msg !== "Not Found" && err?.code !== "ENOENT" && err?.status !== 404) {
      console.error("[rekord] cover thumb failed, serving original:", msg);
    }
    if (!res.headersSent) {
      res.setHeader("Cache-Control", COVER_CACHE);
      await sendFileAbsolute(res, coverPath);
    }
  }
}
