import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs/promises";
import { existsSync, statSync } from "fs";
import { spawn, execFile } from "child_process";
import { promisify } from "util";
import { fileURLToPath } from "url";
import net from "node:net";
import { aggregateArtworkSearch } from "./artworkSearch.mjs";
import {
  createAccount,
  deleteAccount,
  getAccountsSnapshot,
  getConfigSnapshot,
  getDefaultAccountId,
  getListenHost,
  getMusicRoot,
  getYoutubeCookiesPath,
  getYoutubeCookiesPathForYtdlp,
  findAccountById,
  getMusicRootForAccountStrict,
  setPersistedYoutubeCookiesFile,
  clearPersistedYoutubeCookiesFile,
  getCloudflareLoggedIn,
  getCloudflareTunnelEnabled,
  setCloudflareLoggedIn,
  setCloudflareTunnelEnabled,
  setPersistedMusicRoot,
  updateAccount,
  isMusicRootFromEnv,
  isLibraryRootConfigured,
  waitForInitialLayoutMigration,
} from "./musicRootConfig.mjs";
import {
  fetchReleaseMetadata,
  fetchTrackMetadata,
  fetchTrackLyricsLrcLib,
  loadAlbumJsonMetaFromDir,
  loadTrackJsonMetaMapFromDir,
  prepareTrackTitleForMeta,
  saveAlbumFetchedMeta,
  saveAlbumManualMeta,
  sanitizeTrackTitlesFullLibrary,
  sanitizeTrackTitlesInAlbumDir,
  saveTrackFetchedMeta,
  saveTrackManualMeta,
  savePlectrBestMeta,
  pruneOrphanTrackMetaInAlbumDir,
} from "./albumInfo.mjs";
import { normalizeStoredGenreString, parseTrackGenres } from "./genres.mjs";
import { getAudioFileDurationMs } from "./audioDuration.mjs";
import {
  buildCatalogFromIndex,
  filterLibraryIndexBySelection,
  mergeTrackMoodsIntoIndex,
  readLibrarySelection,
  removeAlbumsFromSelectionSets,
  sanitizeLibrarySelection,
  sanitizeRelPathForSelection,
  writeLibrarySelection,
} from "./librarySelection.mjs";
import {
  buildDashboard,
  buildLibraryIndex,
  coverCandidates,
  isAudioFile,
  toLegacyLibrary,
} from "./musicLibrary.mjs";
import { normalizeTrackMoodsList } from "./trackMoods.mjs";
import {
  mergeAndWriteUserStateWithRevision,
  mergeAndWriteUserStatePatch,
  mergeUserStateForPut,
  readUserState,
  stripClientControlledKeysFromPutPatch,
  writeUserTrackMoodsWithCAS,
} from "./userState.mjs";
import { kordApiUserAgent } from "./kordVersion.mjs";
import { resolveYtdlpPath } from "./ytdlpPath.mjs";
import {
  appendActivityLog,
  diffUserStatePlaylistsAndSettings,
  readActivityLogs,
} from "./activityLog.mjs";
import multer from "multer";
import {
  streamKordBackupZip,
  restoreKordFromZipBuffer,
} from "./backupKord.mjs";
import { fetchYoutubeMusicBrowseReleasesList } from "./youtubeMusicBrowse.mjs";
import { searchYoutubeMusicCatalog } from "./youtubeMusicSearch.mjs";
import { fetchCatalogWebDiscover } from "./youtubeMusicDiscover.mjs";
import {
  buildCatalogWebPreviewYtdlpArgs,
  createCatalogWebPreviewPlayToken,
  fetchCatalogWebReleaseTracks,
  getPreviewStreamForToken,
  normalizeCatalogWebUrl,
} from "./catalogWebPreview.mjs";
import {
  fetchYoutubeWebReleasesList,
  isYoutubeWebReleasesPageUrl,
} from "./youtubeWebReleasesInnertube.mjs";
import {
  readLibraryIndexCache,
  writeLibraryIndexCache,
  scheduleBackgroundLibraryRefresh,
  invalidateLibraryIndexCache,
  patchTrackInLibraryIndexCache,
  patchTracksInLibraryIndexCache,
  patchAlbumInLibraryIndexCache,
  getLibraryIndexCacheEpochSnapshot,
} from "./libraryIndexCache.mjs";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Evita scan disco duplicate quando più richieste parallele leggono lo stesso root (es. /api/library-index + /api/dashboard all'avvio UI). */
const libraryIndexFlight = new Map();

/** downloadId (UUID) → { child, userCancelled, killTimer } per /api/download-cancel */
const activeYtdlpDownloads = new Map();

function isUuidDownloadId(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value ?? "").trim()
  );
}

const STUDIO_DOWNLOAD_KINDS = new Set([
  "download_single",
  "download_playlist",
  "download_releases",
  "download_ytmusic",
]);

const PORT = Number(process.env.PORT) || 3001;
const DEFAULT_CLOUDFLARED_BIN = process.platform === "win32" ? "cloudflared.exe" : "cloudflared";
const CF_URL_REGEX = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

const remoteAccessState = {
  enabled: getCloudflareTunnelEnabled(),
  status: "stopped",
  provider: "cloudflare-quick",
  publicUrl: null,
  error: null,
  startedAt: null,
  cloudflaredPath: null,
  cloudflareLoggedIn: getCloudflareLoggedIn(),
};
let cloudflaredChild = null;

function resolveBundledCloudflaredPath() {
  const name = process.platform === "win32" ? "cloudflared.exe" : "cloudflared";
  return path.join(__dirname, "bin", name);
}

function resolveCloudflaredPath() {
  const configured = String(process.env.KORD_CLOUDFLARED_BIN || "").trim();
  if (configured) return configured;
  const bundled = resolveBundledCloudflaredPath();
  if (existsSync(bundled)) return bundled;
  return DEFAULT_CLOUDFLARED_BIN;
}

function remoteSnapshot() {
  return {
    enabled: remoteAccessState.enabled,
    status: remoteAccessState.status,
    provider: remoteAccessState.provider,
    publicUrl: remoteAccessState.publicUrl,
    error: remoteAccessState.error,
    startedAt: remoteAccessState.startedAt,
    cloudflaredPath: remoteAccessState.cloudflaredPath,
    cloudflareLoggedIn: remoteAccessState.cloudflareLoggedIn,
  };
}

function markRemoteError(err) {
  remoteAccessState.status = "error";
  const msg = String(err?.message || err || "cloudflared error");
  if (msg.includes("ENOENT")) {
    remoteAccessState.error =
      "Cloudflared non trovato. Reinstalla KORD oppure configura KORD_CLOUDFLARED_BIN.";
    return;
  }
  remoteAccessState.error = msg;
}

function stopRemoteAccess() {
  remoteAccessState.enabled = false;
  void setCloudflareTunnelEnabled(false);
  remoteAccessState.status = "stopped";
  remoteAccessState.publicUrl = null;
  remoteAccessState.error = null;
  remoteAccessState.startedAt = null;
  if (cloudflaredChild && !cloudflaredChild.killed) {
    try {
      cloudflaredChild.kill("SIGTERM");
    } catch {
      /* ignore */
    }
  }
  cloudflaredChild = null;
}

function startRemoteAccess() {
  if (cloudflaredChild && !cloudflaredChild.killed) return;
  remoteAccessState.enabled = true;
  void setCloudflareTunnelEnabled(true);
  remoteAccessState.status = "starting";
  remoteAccessState.publicUrl = null;
  remoteAccessState.error = null;
  remoteAccessState.startedAt = new Date().toISOString();
  const cloudflaredPath = resolveCloudflaredPath();
  remoteAccessState.cloudflaredPath = cloudflaredPath;
  const target = `http://127.0.0.1:${PORT}`;
  const args = ["tunnel", "--url", target, "--no-autoupdate"];
  const child = spawn(cloudflaredPath, args, {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    env: { ...process.env },
  });
  cloudflaredChild = child;
  const onLine = (line) => {
    const str = String(line || "");
    const match = str.match(CF_URL_REGEX);
    if (match?.[0]) {
      remoteAccessState.status = "running";
      remoteAccessState.publicUrl = match[0];
      remoteAccessState.error = null;
    }
  };
  child.stdout?.on("data", onLine);
  child.stderr?.on("data", onLine);
  child.on("error", (err) => {
    markRemoteError(err);
    cloudflaredChild = null;
  });
  child.on("exit", () => {
    if (remoteAccessState.enabled) {
      markRemoteError("Tunnel terminato");
    } else {
      remoteAccessState.status = "stopped";
    }
    cloudflaredChild = null;
  });
}
/**
 * Solo formati audio già muxati: niente merge, niente postprocessori che richiedono ffmpeg
 * (--add-metadata / -x / estrazione usano ffmpeg e non sono supportati in produzione).
 */
const YTDLP_ARGS = ["-f", "bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio"];

function ytdlpArgsBase() {
  if (process.env.KORD_YTDLP_LOSSLESS === "1") {
    console.warn(
      "[kord] KORD_YTDLP_LOSSLESS is ignored: lossless extraction requires ffmpeg, which Kord does not rely on."
    );
  }
  return YTDLP_ARGS;
}

function ytdlpJavascriptArgs() {
  const configured = String(process.env.KORD_YTDLP_JS_RUNTIME || "").trim();
  const runtime = configured || process.execPath;
  const args = runtime
    ? ["--js-runtimes", `node:${runtime}`]
    : ["--js-runtimes", "node"];
  const remote = String(process.env.KORD_YTDLP_REMOTE_COMPONENTS || "").trim();
  if (remote) args.push("--remote-components", remote);
  return args;
}

function normalizeHttpUrlForYtdlp(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return s;
  if (s.startsWith("//")) return `https:${s}`;
  return s;
}

function pickFlatPlaylistEntryUrl(e) {
  const from = [e.url, e.webpage_url, e.original_url];
  for (const v of from) {
    if (v == null) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return "";
}

/** URL assoluto per yt-dlp (path relativi da --flat-playlist, link //, ecc.). */
function coerceYtdlpUrl(raw) {
  let s = normalizeHttpUrlForYtdlp(raw);
  if (!s) return s;
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith("/")) return `https://www.youtube.com${s}`;
  if (/^(?:watch\?|playlist\?|embed\/|shorts\/)/i.test(s)) {
    return `https://www.youtube.com/${s}`;
  }
  return s;
}

/** Se l'estrattore non espone href completo, ricostruisci da id (playlist / video). */
function guessYoutubeUrlFromEntryId(id) {
  const s = String(id ?? "").trim();
  if (!s) return "";
  if (/^[a-zA-Z0-9_-]{11}$/.test(s)) {
    return `https://www.youtube.com/watch?v=${encodeURIComponent(s)}`;
  }
  if (/^(?:PL|OLAK5uy_|UU|FL|RD|WL|LL|LM)[a-zA-Z0-9_-]+$/.test(s)) {
    return `https://www.youtube.com/playlist?list=${encodeURIComponent(s)}`;
  }
  return "";
}

function ytdlpCookieArgs() {
  const cookies = getYoutubeCookiesPathForYtdlp();
  return cookies ? ["--cookies", cookies] : [];
}

function ytdlpCookiesConfigured() {
  return Boolean(getYoutubeCookiesPathForYtdlp());
}

function ytdlpCookieArgsForDisplay() {
  return ytdlpCookiesConfigured() ? ["--cookies", "<server-configured>"] : [];
}

function ytdlpChildExecOptions() {
  return { env: { ...process.env, FORCE_COLOR: "0" }, ...winHideExec() };
}
function winHideExec() {
  return process.platform === "win32" ? { windowsHide: true } : {};
}

/** Su Windows `child.kill` non ferma spesso l’albero yt-dlp (python/ffmpeg); usa taskkill /T /F. */
function forceKillStudioYtdlp(child) {
  if (!child || child.killed) return;
  if (process.platform === "win32" && child.pid != null) {
    execFile(
      "taskkill",
      ["/PID", String(child.pid), "/T", "/F"],
      { windowsHide: true },
      (err) => {
        if (err && !child.killed) {
          try {
            child.kill();
          } catch {
            /* ignore */
          }
        }
      }
    );
    return;
  }
  try {
    child.kill("SIGTERM");
  } catch {
    /* ignore */
  }
}

/** Estrae JSON da stdout di yt-dlp -J (BOM, warning occasionali in coda al buffer). */
function parseYtdlpJsonStdout(buf) {
  const s0 = String(buf ?? "").replace(/^\uFEFF/, "");
  const s = s0.trim();
  if (!s) return null;
  const tryParse = (x) => {
    try {
      return JSON.parse(x);
    } catch {
      return null;
    }
  };
  let o = tryParse(s);
  if (o) return o;
  const i = s.indexOf("{");
  if (i < 0) return null;
  o = tryParse(s.slice(i));
  return o;
}

function releaseEnrichConfig() {
  const raw = String(
    process.env.KORD_YTDLP_RELEASE_MAX_COUNT_ENRICH ?? "0"
  ).trim();
  const max =
    raw === "" || raw === "0" ? 0 : Math.max(0, Number.parseInt(raw, 10) || 0);
  const defTimeout = process.platform === "win32" ? 32_000 : 18_000;
  const tStr = process.env.KORD_YTDLP_RELEASE_COUNT_TIMEOUT_MS;
  const t =
    tStr != null && String(tStr).trim() !== ""
      ? String(tStr).trim()
      : String(defTimeout);
  const timeoutMs = Math.min(
    120_000,
    Math.max(2000, Number.parseInt(t, 10) || defTimeout)
  );
  const defConc = process.platform === "win32" ? 3 : 5;
  const cStr = process.env.KORD_YTDLP_RELEASE_COUNT_CONCURRENCY;
  const c =
    cStr != null && String(cStr).trim() !== ""
      ? String(cStr).trim()
      : String(defConc);
  const concurrency = Math.min(
    16,
    Math.max(1, Number.parseInt(c, 10) || defConc)
  );
  return { max, timeoutMs, concurrency };
}

/** Conteggio brani per URL playlist (un solo yt-dlp -J: timeout per non bloccare mai all’infinito). */
async function ytdlpPlaylistTrackCount(program, playlistUrl, timeoutMs) {
  const args = [
    "-J",
    "--flat-playlist",
    "--no-download",
    "--no-warnings",
    ...ytdlpJavascriptArgs(),
    ...ytdlpCookieArgs(),
    playlistUrl,
  ];
  try {
    const { stdout } = await execFileAsync(program, args, {
      maxBuffer: 16 * 1024 * 1024,
      encoding: "utf8",
      ...ytdlpChildExecOptions(),
      timeout: timeoutMs,
    });
    const j = parseYtdlpJsonStdout(stdout);
    if (!j || typeof j !== "object") return null;
    if (j._type === "video") return 1;
    if (typeof j.playlist_count === "number" && j.playlist_count >= 0) {
      return j.playlist_count;
    }
    if (Array.isArray(j.entries)) return j.entries.length;
    return null;
  } catch {
    return null;
  }
}

async function enrichReleaseEntryChunks(
  program,
  items,
  timeoutMs,
  concurrency
) {
  const out = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const chunk = items.slice(i, i + concurrency);
    const part = await Promise.all(
      chunk.map(async (item) => {
        const trackCount = await ytdlpPlaylistTrackCount(
          program,
          item.url,
          timeoutMs
        );
        return { ...item, trackCount };
      })
    );
    out.push(...part);
  }
  return out;
}

/**
 * Esegue il conteggio brani in parallelo (fino a concurrency) e invoca onEntry
 * nell’ordine originale (0, 1, 2, …) non appena ogni slot è pronto.
 * Con max: solo le prime voci hanno ytdlp; le altre hanno trackCount: null.
 */
async function enrichReleaseEntriesInOrder(
  program,
  items,
  max,
  timeoutMs,
  concurrency,
  onEntry
) {
  const n = items.length;
  if (n === 0) return;
  const out = new Array(n);
  let nextEmit = 0;
  const tryEmit = () => {
    while (nextEmit < n && out[nextEmit] != null) {
      onEntry(out[nextEmit]);
      nextEmit += 1;
    }
  };
  let nextI = 0;
  async function worker() {
    while (true) {
      const i = nextI;
      nextI += 1;
      if (i >= n) return;
      const item = items[i];
      let trackCount = null;
      if (max === 0 || i < max) {
        trackCount = await ytdlpPlaylistTrackCount(
          program,
          item.url,
          timeoutMs
        );
      }
      out[i] = { ...item, trackCount };
      tryEmit();
    }
  }
  const k = Math.min(concurrency, n);
  await Promise.all(Array.from({ length: k }, () => worker()));
}

async function enrichReleaseEntriesWithTrackCounts(program, items) {
  const { max, timeoutMs, concurrency } = releaseEnrichConfig();
  if (max > 0 && items.length > max) {
    const head = await enrichReleaseEntryChunks(
      program,
      items.slice(0, max),
      timeoutMs,
      concurrency
    );
    const tail = items
      .slice(max)
      .map((item) => ({ ...item, trackCount: null }));
    return [...head, ...tail];
  }
  return enrichReleaseEntryChunks(program, items, timeoutMs, concurrency);
}

function buildYoutubeReleasesListEntries(data) {
  const raw = Array.isArray(data.entries) ? data.entries : [];
  const entries = [];
  for (const e of raw) {
    const id = String(e.id ?? "").trim();
    const title = String(e.title ?? "").trim();
    let norm = coerceYtdlpUrl(pickFlatPlaylistEntryUrl(e));
    if (!norm || !/^https?:\/\//i.test(norm)) {
      norm = guessYoutubeUrlFromEntryId(id);
    }
    if (id && title && norm && /^https?:\/\//i.test(norm)) {
      entries.push({ id, title, url: norm });
    }
  }
  return {
    entries,
    listTitle: String(data.title ?? "").trim(),
    uploader: String(
      data.uploader ?? data.channel ?? data.uploader_id ?? ""
    ).trim(),
    channelUrl: String(data.channel_url ?? data.uploader_url ?? "").trim(),
  };
}

function writeYoutubeReleasesNdjsonLine(res, obj) {
  if (res.writableEnded) return;
  res.write(`${JSON.stringify(obj)}\n`);
}

function isProbablyPlaylistUrl(url) {
  try {
    const u = new URL(url);
    const list = u.searchParams.get("list");
    if (list && list !== "" && list.toUpperCase() !== "WL") return true;
    if (/\/playlist(\/|$|\?)/i.test(u.pathname)) return true;
    return false;
  } catch {
    return false;
  }
}

const YTDLP_NAME = "%(track,title)s";

/** playlist_index per URL da playlist; altrimenti NA su singolo video. */
function ytdlpTrackIndexFragment(url) {
  return isProbablyPlaylistUrl(url)
    ? "%(playlist_index)02d"
    : "%(autonumber)02d";
}

function relPathLooksLikeAlbumFolder(relPath) {
  return String(relPath || "")
    .split("/")
    .filter(Boolean).length >= 2;
}

function flatTracksDestKinds(downloadKind) {
  return (
    downloadKind === "download_single" ||
    downloadKind === "download_playlist" ||
    downloadKind === "download_ytmusic" ||
    downloadKind === "download_releases"
  );
}

function ytdlpOutputTemplate(url, downloadKind = "download_unknown", outputDir = "") {
  if (
    flatTracksDestKinds(downloadKind) &&
    relPathLooksLikeAlbumFolder(outputDir)
  ) {
    return `${ytdlpTrackIndexFragment(url)} - ${YTDLP_NAME}.%(ext)s`;
  }
  const n = ytdlpTrackIndexFragment(url);
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (host.endsWith("bandcamp.com")) {
      return `%(album)s/${n} - ${YTDLP_NAME}.%(ext)s`;
    }
    const pl = isProbablyPlaylistUrl(url);
    if (host.includes("music.youtube.com")) {
      if (pl) {
        return `%(album|playlist_title)s/${n} - ${YTDLP_NAME}.%(ext)s`;
      }
      return `%(album)s/${n} - ${YTDLP_NAME}.%(ext)s`;
    }
    if (pl) {
      return `%(playlist_title)s/${n} - ${YTDLP_NAME}.%(ext)s`;
    }
  } catch {
    /* ignore */
  }
  return `%(title)s/${n} - ${YTDLP_NAME}.%(ext)s`;
}

/** Argomenti yt-dlp allineati a POST /api/download (senza URL finale). */
function buildStudioDownloadYtdlpArgs(url, downloadKind, outputDirForLog) {
  const outputDir = safeRelSeg(String(outputDirForLog ?? ""));
  const outTmpl = ytdlpOutputTemplate(url, downloadKind, outputDir ?? "");
  const args = [
    ...ytdlpArgsBase(),
    ...ytdlpJavascriptArgs(),
    ...ytdlpCookieArgs(),
    "-o",
    outTmpl,
  ];
  if (outputDir != null && outputDir.length > 0) {
    const oi = args.findIndex((arg) => arg === "-o" || arg === "--output");
    if (oi >= 0 && args[oi + 1] != null) {
      const prefix = outputDir.replace(/\\/g, "/").replace(/\/+$/, "");
      args[oi + 1] = `${prefix}/${String(args[oi + 1]).replace(/^\//, "")}`;
    }
  }
  if (downloadKind === "download_single") args.push("--no-playlist");
  return args;
}

function ytdlpItemSummaryFromLog(stdout, stderr) {
  const raw = `${stderr || ""}\n${stdout || ""}`;
  const downloaded = [];
  const skippedItems = [];
  const failedItems = [];
  const seenDownloaded = new Set();
  const seenSkipped = new Set();
  const seenFailed = new Set();
  const addDownloaded = (label) => {
    const s = String(label || "").trim();
    if (!s || seenDownloaded.has(s)) return;
    seenDownloaded.add(s);
    downloaded.push(s);
  };
  const addSkipped = (label, reason) => {
    const s = String(label || "").trim();
    if (!s) return;
    const key = `${s}\0${reason}`;
    if (seenSkipped.has(key)) return;
    seenSkipped.add(key);
    skippedItems.push({ label: s, reason });
  };
  const addFailed = (label, reason) => {
    const s = String(label || "").trim();
    const r = String(reason || "download failed").trim() || "download failed";
    const key = `${s}\0${r}`;
    if (seenFailed.has(key)) return;
    seenFailed.add(key);
    failedItems.push({ label: s || "unknown item", reason: r });
  };
  for (const line0 of raw.split(/\r?\n/)) {
    const line = line0.trim();
    if (!line) continue;
    let m = line.match(/\[download\]\s+Destination:\s+(.+)$/i);
    if (m) {
      addDownloaded(m[1]);
      continue;
    }
    m = line.match(/\[download\]\s+(.+?)\s+has already been downloaded/i);
    if (m) {
      addSkipped(m[1], "already downloaded");
      continue;
    }
    if (/\[download\].*(Already downloaded|has already been recorded)/i.test(line)) {
      addSkipped(line.replace(/^\[download\]\s*/i, ""), "already downloaded");
      continue;
    }
    if (/^(ERROR|WARNING):/i.test(line) || /\b(age|sign in|private|unavailable|blocked|members-only|geoblock)\b/i.test(line)) {
      addFailed(line.replace(/^(ERROR|WARNING):\s*/i, ""), line);
    }
  }
  return { downloadedItems: downloaded, skippedItems, failedItems };
}

function ytdlpCmdDisplay() {
  const bin = resolveYtdlpPath();
  const base = ytdlpArgsBase();
  const js = ytdlpJavascriptArgs();
  const cook = ytdlpCookieArgsForDisplay();
  const note = " (m4a → webm/opus → bestaudio; no ffmpeg / no metadata embed)";
  return `${bin} ${[
    ...base,
    ...js,
    ...cook,
    "-o",
    `%(folder)s/%(autonumber)02d - ${YTDLP_NAME}.%(ext)s`,
  ]
    .map((a) => (/\s/.test(a) ? `"${a}"` : a))
    .join(" ")} + URL${note} — folder = …, nome file = track|title`;
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

const uploadKordBackup = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 512 * 1024 * 1024 },
});

const uploadYoutubeCookies = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
});

function sendOk(res, data, status = 200) {
  return res.status(status).json({ ok: true, data, error: null });
}

function sendError(res, status, error, details = null) {
  return res
    .status(status)
    .json({ ok: false, data: null, error, ...(details ? { details } : {}) });
}

function apiSkipsLibraryGate(req) {
  const sub = (req.path || "").replace(/\/+$/, "") || "/";
  if (sub === "/config") return true;
  if (sub === "/health") return true;
  if (sub === "/backup/kord-restore" && req.method === "POST") return true;
  if (sub === "/accounts" && req.method === "GET") return true;
  return false;
}

app.use("/api", (req, res, next) => {
  if (apiSkipsLibraryGate(req)) return next();
  if (!isLibraryRootConfigured()) {
    return sendError(
      res,
      428,
      "Library folder not configured. Set it in server Settings.",
      { details: { code: "LIBRARY_REQUIRED" } }
    );
  }
  next();
});

function accountIdFromReq(req) {
  return (
    String(req.query?.accountId || "").trim() ||
    String(req.headers["x-kord-account-id"] || "").trim() ||
    getDefaultAccountId()
  );
}

function isLocalRequest(req) {
  const a = String(
    req.socket?.remoteAddress || req.connection?.remoteAddress || ""
  );
  return (
    a === "127.0.0.1" ||
    a === "::1" ||
    a === "::ffff:127.0.0.1" ||
    a.endsWith("127.0.0.1")
  );
}

function buildConfigPayload(req) {
  const local = isLocalRequest(req);
  const snap = getConfigSnapshot(local);
  snap.localAccess = local;
  snap.libraryRootWritable = Boolean(local && !snap.lockedByEnv);
  snap.youtubeCookiesWritable = Boolean(local && !snap.youtubeCookiesLockedByEnv);
  if (!local && isLibraryRootConfigured()) {
    const root = getMusicRoot();
    if (root)
      snap.libraryRootLabel = path.basename(path.resolve(String(root)));
  }
  snap.remoteAccess = remoteSnapshot();
  return snap;
}

function actLog(req, entry) {
  const accountId = accountIdFromReq(req);
  return appendActivityLog({
    accountId,
    musicRoot: getMusicRoot(),
    ...entry,
  });
}

async function attachStudioDownloadToLibrarySelection(req, root, outputDirRel) {
  const prefix =
    outputDirRel != null && String(outputDirRel).trim().length > 0
      ? String(outputDirRel).replace(/\\/g, "/").replace(/\/+$/, "")
      : "";
  if (!prefix) return;
  try {
    const accountId = accountIdFromReq(req);
    let cur = await readLibrarySelection(root, accountId);
    if (!cur) {
      cur = sanitizeLibrarySelection(
        accountId === getDefaultAccountId()
          ? { includeAll: true }
          : { includeAll: false }
      );
    }
    if (cur.includeAll) return;

    const full = await getLibraryIndex(root);
    const toAddAlbums = new Set();
    const toAddArtists = new Set();
    for (const al of full.albums) {
      const rel = al.relPath;
      if (!rel) continue;
      if (rel === prefix || rel.startsWith(`${prefix}/`)) {
        toAddAlbums.add(rel);
        const id = al.artistId || al.artist;
        if (id) toAddArtists.add(id);
      }
    }
    if (!toAddAlbums.size) return;

    const albums = new Set([...cur.albums, ...toAddAlbums]);
    const artists = new Set([...cur.artists, ...toAddArtists]);
    const next = sanitizeLibrarySelection({
      includeAll: false,
      artists: [...artists],
      albums: [...albums],
      tracks: cur.tracks,
    });
    await writeLibrarySelection(root, accountId, next);
  } catch (e) {
    console.error("attachStudioDownloadToLibrarySelection", e);
  }
}

function underRoot(full, musicRoot = getMusicRoot()) {
  const root = path.resolve(musicRoot);
  const resolved = path.resolve(full);
  return resolved === root || resolved.startsWith(root + path.sep);
}

const RESERVED_MUSIC_DIR_NAMES = new Set(["kord"]);

function hasReservedPathSegment(p) {
  for (const seg of String(p || "")
    .replace(/\\/g, "/")
    .split("/")) {
    if (!seg) continue;
    if (RESERVED_MUSIC_DIR_NAMES.has(seg.toLowerCase())) return true;
  }
  return false;
}

function pathHasParentDirSegment(p) {
  for (const seg of String(p || "")
    .replace(/\\/g, "/")
    .split("/")) {
    if (seg === "..") return true;
  }
  return false;
}

function safeRelSeg(value) {
  if (value == null) return null;
  const normalized = String(value)
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
  for (const seg of normalized.split("/")) {
    if (seg === "..") return null;
    if (RESERVED_MUSIC_DIR_NAMES.has(seg.toLowerCase())) return null;
  }
  return normalized;
}

function hostnameBlockedForUpstreamImageFetch(hostname) {
  let h = String(hostname || "")
    .toLowerCase()
    .trim();
  if (!h || h === "localhost" || h.endsWith(".localhost")) return true;
  if (h.endsWith(".local")) return true;
  let bare = h;
  if (h.startsWith("[")) bare = h.slice(1, -1) || bare;
  if (net.isIP(bare) !== 0) return true;
  return false;
}

function stripAnsi(value) {
  return String(value || "").replace(/\x1b\[[0-9;]*m/g, "");
}

function extractLastItemProgress(text) {
  const clean = stripAnsi(String(text));
  const rows = [...clean.matchAll(/Downloading item\s+(\d+)\s+of\s+(\d+)/gi)];
  const last = rows.length ? rows[rows.length - 1] : null;
  return last ? { current: Number(last[1]), total: Number(last[2]) } : null;
}

const YTDLP_ROLL_LOG_CAP_CHARS = 64 * 1024;
const YTDLP_DONE_FIELD_MAX_CHARS = 12 * 1024;

function appendRollingCapped(acc, chunk, maxChars) {
  acc.totalChars += chunk.length;
  const next = acc.buffer + chunk;
  acc.buffer = next.length <= maxChars ? next : next.slice(-maxChars);
}

function trimLogForNdjson(acc) {
  const s = acc.buffer;
  const total = acc.totalChars;
  const truncated = total > YTDLP_DONE_FIELD_MAX_CHARS;
  if (s.length <= YTDLP_DONE_FIELD_MAX_CHARS)
    return { text: s, truncated, totalChars: total };
  const headLen = Math.floor(YTDLP_DONE_FIELD_MAX_CHARS / 2 - 48);
  const tailLen = Math.floor(YTDLP_DONE_FIELD_MAX_CHARS / 2 - 48);
  return {
    text: `${s.slice(
      0,
      Math.max(headLen, 0)
    )}\n… [truncated stdout/stderr preview] …\n${s.slice(
      -Math.max(tailLen, 0)
    )}`,
    truncated: true,
    totalChars: total,
  };
}

async function getLibraryIndex(root = getMusicRoot()) {
  if (!existsSync(root) || !underRoot(root, root)) {
    throw new Error("Music library folder is not available");
  }
  const key = path.resolve(root);
  let inflight = libraryIndexFlight.get(key);
  if (inflight) return inflight;

  const cached = await readLibraryIndexCache(root);
  if (cached) {
    scheduleBackgroundLibraryRefresh(root);
    return cached;
  }

  inflight = (async () => {
    const epochAtStart = getLibraryIndexCacheEpochSnapshot(root);
    const idx = await buildLibraryIndex(root);
    if (getLibraryIndexCacheEpochSnapshot(root) === epochAtStart) {
      await writeLibraryIndexCache(root, idx);
    }
    return idx;
  })();
  libraryIndexFlight.set(key, inflight);
  inflight.finally(() => {
    if (libraryIndexFlight.get(key) === inflight) {
      libraryIndexFlight.delete(key);
    }
  });
  return inflight;
}

async function invalidateLibraryIndex(root = getMusicRoot()) {
  libraryIndexFlight.delete(path.resolve(root));
  await invalidateLibraryIndexCache(root);
}

/** Metadati/copertina: patch cache se possibile; refresh completo solo se la patch non è andata a buon fine. */
function scheduleLibraryIndexMetaRefresh(root, cachePatched) {
  if (!cachePatched) scheduleBackgroundLibraryRefresh(root);
}

function albumDeltaFromMeta(albumPath, meta, albumNameFallback) {
  const title =
    meta?.title && String(meta.title).trim()
      ? String(meta.title).trim()
      : albumNameFallback || path.basename(albumPath);
  return {
    relPath: albumPath,
    name: title,
    title: meta?.title ?? null,
    releaseDate: meta?.releaseDate ?? null,
    genre: meta?.genre ?? null,
    label: meta?.label ?? null,
    country: meta?.country ?? null,
    musicbrainzReleaseId: meta?.musicbrainzReleaseId ?? null,
    hasAlbumMeta: true,
  };
}

async function getFilteredIndexForAccount(accountId) {
  const root = getMusicRoot();
  const [full, state, sel] = await Promise.all([
    getLibraryIndex(root),
    readUserState(root, accountId),
    readLibrarySelection(root, accountId),
  ]);
  const filt = filterLibraryIndexBySelection(full, sel, accountId);
  const merged = mergeTrackMoodsIntoIndex(filt, state.trackMoods);
  return {
    ...merged,
    indexEpoch: getLibraryIndexCacheEpochSnapshot(root),
  };
}

function libraryOverviewFromIndex(index) {
  return {
    musicRoot: index.musicRoot || "",
    artists: index.artists,
    stats: index.stats,
  };
}

function libraryArtistDetailFromIndex(index, artistId) {
  const artist = index.artists.find((a) => a.id === artistId || a.name === artistId);
  if (!artist) return null;
  const albumIds = new Set(artist.albums || []);
  const albums = index.albums.filter((album) => albumIds.has(album.id));
  const trackRelPaths = new Set(albums.flatMap((album) => album.tracks || []));
  const tracks = index.tracks.filter((track) => trackRelPaths.has(track.relPath));
  return { artist, albums, tracks };
}

function libraryAlbumDetailFromIndex(index, relPathOrId) {
  const key = String(relPathOrId || "").trim();
  const album = index.albums.find(
    (item) => item.relPath === key || item.id === key || item.name === key,
  );
  if (!album) return null;
  const rels = new Set(album.tracks || []);
  const tracks = index.tracks.filter((track) => rels.has(track.relPath));
  return { album, tracks };
}

function searchLibraryIndex(index, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return { artists: [], albums: [], tracks: [] };
  const trackGenreIncludes = (track) => String(track?.meta?.genre || "").toLowerCase().includes(q);
  const artists = index.artists
    .filter((artist) => {
      if (String(artist.name || "").toLowerCase().includes(q)) return true;
      return index.tracks.some((track) => track.artist === artist.name && trackGenreIncludes(track));
    })
    .slice(0, 50);
  const albums = index.albums
    .filter((album) => {
      if (String(album.name || "").toLowerCase().includes(q)) return true;
      if (String(album.artist || "").toLowerCase().includes(q)) return true;
      return (album.tracks || []).some((rel) => {
        const track = index.tracks.find((item) => item.relPath === rel);
        return trackGenreIncludes(track);
      });
    })
    .slice(0, 80);
  const tracks = index.tracks
    .filter((track) => {
      return (
        String(track.title || "").toLowerCase().includes(q) ||
        String(track.artist || "").toLowerCase().includes(q) ||
        String(track.album || "").toLowerCase().includes(q) ||
        trackGenreIncludes(track)
      );
    })
    .slice(0, 150);
  return { artists, albums, tracks };
}

function albumFolderFromRelPath(relPath) {
  const parts = String(relPath || "")
    .split("/")
    .filter(Boolean);
  if (parts.length < 2) return null;
  return parts.slice(0, -1).join("/");
}

app.use("/media", (req, res, next) => {
  const reqPath = req.path || "";
  if (pathHasParentDirSegment(reqPath) || hasReservedPathSegment(reqPath))
    return res.status(404).end();
  next();
});

app.use("/media", (req, res, next) => {
  if (!isLibraryRootConfigured()) return res.status(503).end();
  const root = getMusicRoot();
  if (!root) return res.status(503).end();
  express.static(root, {
    index: false,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith(".flac"))
        res.setHeader("Content-Type", "audio/flac");
      else if (filePath.endsWith(".m4a"))
        res.setHeader("Content-Type", "audio/mp4");
      else if (filePath.endsWith(".webm"))
        res.setHeader("Content-Type", "audio/webm");
    },
  })(req, res, next);
});

app.get("/api/health", async (req, res) => {
  try {
    const accountId = accountIdFromReq(req);
    if (!isLibraryRootConfigured()) {
      const payload = {
        exists: false,
        libraryRootConfigured: false,
        userStateVersion: null,
        accountId,
      };
      if (isLocalRequest(req)) payload.musicRoot = null;
      return sendOk(res, payload);
    }
    const root = getMusicRoot();
    const state = await readUserState(root, accountId);
    const payload = {
      exists: existsSync(root),
      libraryRootConfigured: true,
      userStateVersion: state.version,
      accountId,
    };
    if (isLocalRequest(req)) payload.musicRoot = root;
    return sendOk(res, payload);
  } catch (error) {
    return sendError(res, 500, String(error?.message || error));
  }
});

app.get("/api/activity-log", async (req, res) => {
  try {
    const n = Number(req.query?.limit);
    const limit =
      Number.isFinite(n) && n > 0 ? Math.min(5000, Math.floor(n)) : 500;
    const entries = await readActivityLogs(limit);
    return sendOk(res, { entries });
  } catch (error) {
    return sendError(res, 500, String(error?.message || error));
  }
});

app.get("/api/backup/kord-data", async (req, res) => {
  try {
    const name = `kord-backup-${new Date()
      .toISOString()
      .replaceAll(":", "-")}.zip`;
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
    res.setHeader("Cache-Control", "no-store, must-revalidate");
    await streamKordBackupZip(res, getAccountsSnapshot);
  } catch (error) {
    if (!res.headersSent) {
      return sendError(res, 500, String(error?.message || error));
    }
    try {
      res.end();
    } catch {
      /* ignore */
    }
  }
});

app.post(
  "/api/backup/kord-restore",
  uploadKordBackup.single("file"),
  async (req, res) => {
    try {
      if (isMusicRootFromEnv()) {
        return sendError(
          res,
          403,
          "Restore is not available when MUSIC_ROOT is set in the environment"
        );
      }
      if (!req.file?.buffer?.length) {
        return sendError(res, 400, "Missing or empty file");
      }
      const data = await restoreKordFromZipBuffer(req.file.buffer);
      await invalidateLibraryIndex(getMusicRoot());
      return sendOk(res, data);
    } catch (error) {
      if (error?.code === "ENV_LOCKED") {
        return sendError(res, 403, String(error.message || error));
      }
      if (error?.code === "BAD_BACKUP") {
        return sendError(res, 400, String(error.message || error));
      }
      return sendError(res, 500, String(error?.message || error));
    }
  }
);

app.get("/api/config", (req, res) => {
  return sendOk(res, buildConfigPayload(req));
});

app.get("/api/remote-access", (req, res) => {
  return sendOk(res, remoteSnapshot());
});

app.post("/api/remote-access/login", (req, res) => {
  if (!isLocalRequest(req)) {
    return sendError(res, 403, "Remote access settings are local-only.");
  }
  const url = "https://dash.cloudflare.com/";
  setCloudflareLoggedIn(true)
    .then((ok) => {
      remoteAccessState.cloudflareLoggedIn = ok;
      return sendOk(res, {
        loginUrl: url,
        note: "Apri Cloudflare Dashboard e completa il login.",
      });
    })
    .catch((error) => sendError(res, 500, String(error?.message || error)));
});

app.post("/api/remote-access/logout", (req, res) => {
  if (!isLocalRequest(req)) {
    return sendError(res, 403, "Remote access settings are local-only.");
  }
  setCloudflareLoggedIn(false)
    .then((ok) => {
      remoteAccessState.cloudflareLoggedIn = ok;
      return sendOk(res, remoteSnapshot());
    })
    .catch((error) => sendError(res, 500, String(error?.message || error)));
});

app.post("/api/remote-access/start", (req, res) => {
  if (!isLocalRequest(req)) {
    return sendError(res, 403, "Remote access settings are local-only.");
  }
  if (remoteAccessState.status === "running" || remoteAccessState.status === "starting") {
    return sendOk(res, remoteSnapshot());
  }
  try {
    startRemoteAccess();
    void actLog(req, {
      kind: "server",
      action: "remote-access",
      folder: null,
      detail: "start",
    });
    return sendOk(res, remoteSnapshot());
  } catch (error) {
    markRemoteError(error);
    return sendError(res, 500, String(error?.message || error));
  }
});

app.post("/api/remote-access/stop", (req, res) => {
  if (!isLocalRequest(req)) {
    return sendError(res, 403, "Remote access settings are local-only.");
  }
  stopRemoteAccess();
  void actLog(req, {
    kind: "server",
    action: "remote-access",
    folder: null,
    detail: "stop",
  });
  return sendOk(res, remoteSnapshot());
});

app.put("/api/config", async (req, res) => {
  try {
    const body = req.body || {};
    let did = false;
    if (body.musicRoot != null) {
      if (!isLocalRequest(req)) {
        return sendError(
          res,
          403,
          "Library folder can only be set from the machine running the server (local access).",
          { details: { code: "LIBRARY_ROOT_REMOTE_FORBIDDEN" } },
        );
      }
      const next = String(body.musicRoot).trim();
      if (!next) {
        return sendError(
          res,
          400,
          "Provide the absolute path to your music folder"
        );
      }
      await setPersistedMusicRoot(next);
      void actLog(req, {
        kind: "server",
        action: "config",
        folder: next,
        detail: "musicRoot",
      });
      did = true;
    }
    if (!did) {
      return sendError(res, 400, "No valid config fields in request body");
    }
    return sendOk(res, buildConfigPayload(req));
  } catch (error) {
    if (error?.code === "ENV_LOCKED") return sendError(res, 403, error.message);
    return sendError(res, 400, String(error?.message || error));
  }
});

app.post(
  "/api/config/youtube-cookies",
  uploadYoutubeCookies.single("file"),
  async (req, res) => {
    try {
      if (!isLocalRequest(req)) {
        return sendError(
          res,
          403,
          "YouTube cookies can only be configured from the machine running the server.",
          { details: { code: "YOUTUBE_COOKIES_REMOTE_FORBIDDEN" } },
        );
      }
      if (!req.file?.buffer?.length) {
        return sendError(res, 400, "Missing or empty cookie file");
      }
      await setPersistedYoutubeCookiesFile(req.file.buffer);
      void actLog(req, {
        kind: "server",
        action: "config",
        folder: null,
        detail: "youtubeCookies",
      });
      return sendOk(res, buildConfigPayload(req));
    } catch (error) {
      if (error?.code === "ENV_LOCKED") {
        return sendError(res, 403, String(error.message || error));
      }
      return sendError(res, 500, String(error?.message || error));
    }
  },
);

app.delete("/api/config/youtube-cookies", async (req, res) => {
  try {
    if (!isLocalRequest(req)) {
      return sendError(
        res,
        403,
        "YouTube cookies can only be configured from the machine running the server.",
        { details: { code: "YOUTUBE_COOKIES_REMOTE_FORBIDDEN" } },
      );
    }
    await clearPersistedYoutubeCookiesFile();
    void actLog(req, {
      kind: "server",
      action: "config",
      folder: null,
      detail: "youtubeCookies:clear",
    });
    return sendOk(res, buildConfigPayload(req));
  } catch (error) {
    if (error?.code === "ENV_LOCKED") {
      return sendError(res, 403, String(error.message || error));
    }
    return sendError(res, 500, String(error?.message || error));
  }
});

app.get("/api/accounts", (_req, res) => {
  return sendOk(res, getAccountsSnapshot());
});

app.post("/api/accounts", async (req, res) => {
  try {
    const body = req.body || {};
    const created = await createAccount({
      name: body.name,
    });
    const newAcc = created.accounts.find(
      (a) => a.id === created.createdAccountId
    );
    void actLog(req, {
      kind: "server",
      action: "account_create",
      folder: null,
      detail: newAcc
        ? `${newAcc.name} (${newAcc.id})`
        : created.createdAccountId,
    });
    return sendOk(res, created, 201);
  } catch (error) {
    if (error?.code === "LIBRARY_NOT_CONFIGURED")
      return sendError(res, 400, error.message);
    if (error?.code === "ENV_LOCKED") return sendError(res, 403, error.message);
    return sendError(res, 400, String(error?.message || error));
  }
});

app.put("/api/accounts/:id", async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    const before = findAccountById(id);
    const patch = req.body || {};
    const next = await updateAccount(id, patch);
    const parts = [];
    if (patch.name != null && before && String(patch.name) !== before.name) {
      parts.push("name");
    }
    void actLog(req, {
      kind: "server",
      action: "account_update",
      folder: null,
      detail: `${id}: ${parts.length ? parts.join(",") : "account"}`,
    });
    return sendOk(res, next);
  } catch (error) {
    if (error?.code === "LIBRARY_NOT_CONFIGURED")
      return sendError(res, 400, error.message);
    if (error?.code === "ENV_LOCKED") return sendError(res, 403, error.message);
    if (error?.code === "ACCOUNT_NOT_FOUND")
      return sendError(res, 404, error.message);
    return sendError(res, 400, String(error?.message || error));
  }
});

app.delete("/api/accounts/:id", async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    const before = findAccountById(id);
    const snap = await deleteAccount(id);
    void actLog(req, {
      kind: "server",
      action: "account_delete",
      folder: null,
      detail: before ? `${before.name} (${id})` : id,
    });
    return sendOk(res, snap);
  } catch (error) {
    if (error?.code === "LIBRARY_NOT_CONFIGURED")
      return sendError(res, 400, error.message);
    if (error?.code === "ACCOUNT_NOT_FOUND")
      return sendError(res, 404, error.message);
    if (error?.code === "LAST_ACCOUNT")
      return sendError(res, 400, error.message);
    if (error?.code === "DEFAULT_ACCOUNT_LOCKED")
      return sendError(res, 400, error.message);
    return sendError(res, 400, String(error?.message || error));
  }
});

app.get("/api/library", async (req, res) => {
  try {
    const accountId = accountIdFromReq(req);
    const index = await getFilteredIndexForAccount(accountId);
    return sendOk(res, toLegacyLibrary(index));
  } catch (error) {
    console.error(error);
    return sendError(res, 500, String(error?.message || error));
  }
});

app.get("/api/library-index", async (req, res) => {
  try {
    const accountId = accountIdFromReq(req);
    const index = await getFilteredIndexForAccount(accountId);
    res.set("Cache-Control", "no-store, must-revalidate");
    return sendOk(res, index);
  } catch (error) {
    console.error(error);
    return sendError(res, 500, String(error?.message || error));
  }
});

app.get("/api/library-overview", async (req, res) => {
  try {
    const accountId = accountIdFromReq(req);
    const index = await getFilteredIndexForAccount(accountId);
    res.set("Cache-Control", "no-store, must-revalidate");
    return sendOk(res, libraryOverviewFromIndex(index));
  } catch (error) {
    console.error(error);
    return sendError(res, 500, String(error?.message || error));
  }
});

app.get("/api/library-artists/:id", async (req, res) => {
  try {
    const accountId = accountIdFromReq(req);
    const index = await getFilteredIndexForAccount(accountId);
    const id = decodeURIComponent(String(req.params.id || ""));
    const detail = libraryArtistDetailFromIndex(index, id);
    if (!detail) return sendError(res, 404, "Artist not found");
    res.set("Cache-Control", "no-store, must-revalidate");
    return sendOk(res, detail);
  } catch (error) {
    console.error(error);
    return sendError(res, 500, String(error?.message || error));
  }
});

app.get("/api/library-albums", async (req, res) => {
  try {
    const accountId = accountIdFromReq(req);
    const index = await getFilteredIndexForAccount(accountId);
    const key = String(req.query.relPath || req.query.id || req.query.album || "").trim();
    const detail = libraryAlbumDetailFromIndex(index, key);
    if (!detail) return sendError(res, 404, "Album not found");
    res.set("Cache-Control", "no-store, must-revalidate");
    return sendOk(res, detail);
  } catch (error) {
    console.error(error);
    return sendError(res, 500, String(error?.message || error));
  }
});

app.get("/api/library-search", async (req, res) => {
  try {
    const accountId = accountIdFromReq(req);
    const index = await getFilteredIndexForAccount(accountId);
    res.set("Cache-Control", "no-store, must-revalidate");
    return sendOk(res, searchLibraryIndex(index, req.query.q));
  } catch (error) {
    console.error(error);
    return sendError(res, 500, String(error?.message || error));
  }
});

app.post("/api/library/tracks/resolve", async (req, res) => {
  try {
    const accountId = accountIdFromReq(req);
    const index = await getFilteredIndexForAccount(accountId);
    const rels = Array.isArray(req.body?.relPaths)
      ? req.body.relPaths.map((item) => String(item || "")).filter(Boolean)
      : [];
    const wanted = new Set(rels);
    res.set("Cache-Control", "no-store, must-revalidate");
    return sendOk(res, { tracks: index.tracks.filter((track) => wanted.has(track.relPath)) });
  } catch (error) {
    console.error(error);
    return sendError(res, 500, String(error?.message || error));
  }
});

app.get("/api/catalog", async (req, res) => {
  try {
    const root = getMusicRoot();
    const index = await getLibraryIndex(root);
    const summary = String(req.query.summary || "") === "1";
    const artistId = String(req.query.artistId || "").trim();
    res.set("Cache-Control", "no-store, must-revalidate");
    return sendOk(res, buildCatalogFromIndex(index, { summary, artistId }));
  } catch (error) {
    console.error(error);
    return sendError(res, 500, String(error?.message || error));
  }
});

const CATALOG_WEB_DISCOVER_CACHE_TTL_MS = 8 * 60 * 1000;
/** @type {{ at: number, epoch: number, payload: object } | null} */
let catalogWebDiscoverCache = null;

app.get("/api/catalog-web-discover", async (req, res) => {
  try {
    const root = getMusicRoot();
    const force = String(req.query.force ?? "") === "1";
    const epoch = getLibraryIndexCacheEpochSnapshot(root);
    const now = Date.now();
    if (
      !force &&
      catalogWebDiscoverCache &&
      catalogWebDiscoverCache.epoch === epoch &&
      now - catalogWebDiscoverCache.at < CATALOG_WEB_DISCOVER_CACHE_TTL_MS
    ) {
      res.set("Cache-Control", "no-store, must-revalidate");
      return sendOk(res, catalogWebDiscoverCache.payload);
    }
    const index = await getLibraryIndex(root);
    const payload = await fetchCatalogWebDiscover(index);
    if (payload.error) {
      return sendError(res, 502, payload.error);
    }
    catalogWebDiscoverCache = {
      at: now,
      epoch,
      payload,
    };
    res.set("Cache-Control", "no-store, must-revalidate");
    return sendOk(res, payload);
  } catch (error) {
    console.error(error);
    return sendError(res, 500, String(error?.message || error));
  }
});

app.get("/api/catalog-web-tracks", async (req, res) => {
  const pageUrl = normalizeCatalogWebUrl(String(req.query.url ?? ""));
  if (!pageUrl) return sendError(res, 400, "Provide a valid YouTube Music URL");
  try {
    const ytdlpOff = process.env.ENABLE_YTDLP === "0";
    const program = ytdlpOff ? null : resolveYtdlpPath();
    const { timeoutMs } = releaseEnrichConfig();
    const payload = await fetchCatalogWebReleaseTracks({
      pageUrl,
      ytdlpProgram: program,
      ytdlpExtraArgs: () => [
        ...ytdlpJavascriptArgs(),
        ...ytdlpCookieArgs(),
      ],
      timeoutMs: Math.max(timeoutMs, 25_000),
    });
    return sendOk(res, {
      tracks: payload.tracks,
      title: payload.title || null,
      error: payload.error,
    });
  } catch (error) {
    console.error(error);
    return sendError(res, 500, String(error?.message || error));
  }
});

app.get("/api/catalog-web-preview/play", async (req, res) => {
  if (process.env.ENABLE_YTDLP === "0") {
    return sendError(res, 403, "Preview disabled (ENABLE_YTDLP=0)");
  }
  const watchUrl = normalizeCatalogWebUrl(String(req.query.url ?? ""));
  if (!watchUrl) return sendError(res, 400, "Provide a valid YouTube Music URL");
  let built;
  try {
    built = buildCatalogWebPreviewYtdlpArgs(watchUrl, () => [
      ...ytdlpJavascriptArgs(),
      ...ytdlpCookieArgs(),
    ]);
  } catch (error) {
    return sendError(res, 400, String(error?.message || error));
  }
  const program = resolveYtdlpPath();
  try {
    req.socket?.setNoDelay?.(true);
  } catch {
    /* ignore */
  }

  const stderrAcc = { buffer: "", totalChars: 0 };
  let bytesOut = 0;
  let streamStarted = false;
  const child = spawn(program, built.args, {
    env: { ...process.env, FORCE_COLOR: "0" },
    ...winHideExec(),
  });
  const killChild = () => forceKillStudioYtdlp(child);
  const onClientGone = () => killChild();
  req.on("aborted", onClientGone);
  res.on("close", onClientGone);
  const removeListeners = () => {
    req.removeListener("aborted", onClientGone);
    res.removeListener("close", onClientGone);
  };
  const beginStream = () => {
    if (streamStarted) return;
    streamStarted = true;
    res.status(200);
    res.setHeader("Content-Type", built.contentType);
    res.setHeader("Cache-Control", "no-store, no-transform");
    res.setHeader("Accept-Ranges", "none");
    res.setHeader("X-Accel-Buffering", "no");
    res.setHeader("Connection", "close");
    if (typeof res.flushHeaders === "function") res.flushHeaders();
  };
  child.stderr?.on("data", (chunk) => {
    const s = String(chunk);
    stderrAcc.buffer += s;
    stderrAcc.totalChars += s.length;
    if (stderrAcc.totalChars > 24_000) {
      stderrAcc.buffer = stderrAcc.buffer.slice(-12_000);
    }
  });
  child.stdout?.on("data", (chunk) => {
    bytesOut += chunk?.length ?? 0;
    beginStream();
    res.write(chunk);
  });
  child.on("error", (err) => {
    removeListeners();
    if (!res.headersSent) {
      return sendError(res, 502, String(err?.message || err));
    }
    if (!res.writableEnded) res.destroy();
  });
  child.on("close", (code) => {
    removeListeners();
    if (code !== 0 && bytesOut === 0 && !res.headersSent) {
      const detail = stderrAcc.buffer.trim().slice(-600) || `yt-dlp exit ${code}`;
      return sendError(res, 422, detail);
    }
    if (!res.writableEnded) res.end();
  });
});

app.get("/api/catalog-web-preview", async (req, res) => {
  if (process.env.ENABLE_YTDLP === "0") {
    return sendError(res, 403, "Preview disabled (ENABLE_YTDLP=0)");
  }
  const watchUrl = normalizeCatalogWebUrl(String(req.query.url ?? ""));
  if (!watchUrl) return sendError(res, 400, "Provide a valid YouTube Music URL");
  try {
    const program = resolveYtdlpPath();
    const { timeoutMs } = releaseEnrichConfig();
    const token = await createCatalogWebPreviewPlayToken({
      watchUrl,
      ytdlpProgram: program,
      ytdlpExtraArgs: () => [
        ...ytdlpJavascriptArgs(),
        ...ytdlpCookieArgs(),
      ],
      timeoutMs: Math.max(timeoutMs, 30_000),
    });
    return sendOk(res, {
      playUrl: `/api/catalog-web-preview/stream?t=${encodeURIComponent(token)}`,
    });
  } catch (error) {
    console.error(error);
    return sendError(res, 422, String(error?.message || error));
  }
});

app.get("/api/catalog-web-preview/stream", async (req, res) => {
  const token = String(req.query.t ?? "").trim();
  const streamUrl = getPreviewStreamForToken(token);
  if (!streamUrl) return sendError(res, 410, "Preview expired or invalid");
  try {
    let range = req.headers.range;
    const headers = /** @type {Record<string, string>} */ ({});
    if (range) {
      headers.Range = String(range);
    } else {
      const maxChunk = Number.parseInt(
        String(process.env.KORD_PREVIEW_INITIAL_RANGE_BYTES ?? "524288"),
        10,
      );
      if (Number.isFinite(maxChunk) && maxChunk > 0) {
        headers.Range = `bytes=0-${maxChunk - 1}`;
      }
    }
    const upstream = await fetch(streamUrl, { headers, redirect: "follow" });
    res.status(upstream.status);
    for (const h of [
      "content-type",
      "content-length",
      "accept-ranges",
      "content-range",
    ]) {
      const v = upstream.headers.get(h);
      if (v) res.setHeader(h, v);
    }
    res.setHeader("Cache-Control", "no-store, no-transform");
    if (!upstream.ok || !upstream.body) {
      res.end();
      return;
    }
    const { Readable } = await import("node:stream");
    Readable.fromWeb(upstream.body).pipe(res);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      return sendError(res, 502, String(error?.message || error));
    }
    res.end();
  }
});

app.get("/api/my-library-selection", async (req, res) => {
  try {
    const root = getMusicRoot();
    const accountId = accountIdFromReq(req);
    let cur = await readLibrarySelection(root, accountId);
    if (!cur) {
      cur = sanitizeLibrarySelection(
        accountId === getDefaultAccountId()
          ? { includeAll: true }
          : { includeAll: false }
      );
    }
    return sendOk(res, cur);
  } catch (error) {
    return sendError(res, 500, String(error?.message || error));
  }
});

app.patch("/api/my-library-selection", async (req, res) => {
  try {
    const root = getMusicRoot();
    const accountId = accountIdFromReq(req);
    const full = await getLibraryIndex(root);
    const artistSet = new Set(full.artists.map((a) => a.id));
    const albumPathSet = new Set(full.albums.map((a) => a.relPath));

    let cur = await readLibrarySelection(root, accountId);
    if (!cur) {
      cur = sanitizeLibrarySelection(
        accountId === getDefaultAccountId()
          ? { includeAll: true }
          : { includeAll: false }
      );
    }

    const body = req.body || {};
    if (body.includeAll === true) {
      cur = sanitizeLibrarySelection({
        includeAll: true,
        artists: [],
        albums: [],
        tracks: [],
      });
    } else if (body.includeAll === false) {
      cur = sanitizeLibrarySelection({ ...cur, includeAll: false });
    }

    if (!cur.includeAll) {
      const artists = new Set(cur.artists);
      const albums = new Set(cur.albums);
      const tracks = new Set(cur.tracks);

      for (const a of Array.isArray(body.addArtists) ? body.addArtists : []) {
        const id = typeof a === "string" ? a.trim() : "";
        if (id && artistSet.has(id)) artists.add(id);
      }
      for (const a of Array.isArray(body.removeArtists)
        ? body.removeArtists
        : []) {
        const id = typeof a === "string" ? a.trim() : "";
        if (id) artists.delete(id);
      }
      for (const raw of Array.isArray(body.addAlbums) ? body.addAlbums : []) {
        const rel = sanitizeRelPathForSelection(String(raw || ""));
        if (rel && albumPathSet.has(rel)) albums.add(rel);
      }
      removeAlbumsFromSelectionSets(full, artists, albums, body.removeAlbums);
      for (const raw of Array.isArray(body.addTracks) ? body.addTracks : []) {
        const rel = sanitizeRelPathForSelection(String(raw || ""));
        if (rel) tracks.add(rel);
      }
      for (const raw of Array.isArray(body.removeTracks)
        ? body.removeTracks
        : []) {
        const rel = sanitizeRelPathForSelection(String(raw || ""));
        if (rel) tracks.delete(rel);
      }

      cur = sanitizeLibrarySelection({
        includeAll: false,
        artists: [...artists],
        albums: [...albums],
        tracks: [...tracks],
      });
    }

    const saved = await writeLibrarySelection(root, accountId, cur);
    return sendOk(res, saved);
  } catch (error) {
    return sendError(res, 500, String(error?.message || error));
  }
});

app.get("/api/accounts/:id/library-index", async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id || !findAccountById(id)) {
      return sendError(res, 404, "Account not found");
    }
    getMusicRootForAccountStrict(id);
    const index = await getFilteredIndexForAccount(id);
    res.set("Cache-Control", "no-store, must-revalidate");
    return sendOk(res, index);
  } catch (error) {
    console.error(error);
    if (error?.code === "ACCOUNT_NOT_FOUND") {
      return sendError(res, 404, String(error.message || error));
    }
    return sendError(res, 500, String(error?.message || error));
  }
});

app.get("/api/dashboard", async (req, res) => {
  try {
    const accountId = accountIdFromReq(req);
    const root = getMusicRoot();
    const [index, state] = await Promise.all([
      getFilteredIndexForAccount(accountId),
      readUserState(root, accountId),
    ]);
    res.set("Cache-Control", "no-store, must-revalidate");
    return sendOk(res, buildDashboard(index, state));
  } catch (error) {
    console.error(error);
    return sendError(res, 500, String(error?.message || error));
  }
});

app.get("/api/user-state", async (req, res) => {
  try {
    const state = await readUserState(getMusicRoot(), accountIdFromReq(req));
    return sendOk(res, state);
  } catch (error) {
    return sendError(res, 500, String(error?.message || error));
  }
});

app.patch("/api/user-state", async (req, res) => {
  try {
    const accId = accountIdFromReq(req);
    const root = getMusicRoot();
    const nested = req.body?.state ?? req.body?.patch;
    let rawPatch = nested ?? req.body ?? {};
    if (
      nested == null &&
      rawPatch &&
      typeof rawPatch === "object" &&
      !Array.isArray(rawPatch)
    ) {
      const { expectedRevision: _er, ...rest } = rawPatch;
      void _er;
      rawPatch = rest;
    }
    if (
      rawPatch == null ||
      typeof rawPatch !== "object" ||
      Array.isArray(rawPatch)
    ) {
      return sendError(res, 400, "Invalid state patch: expected a JSON object");
    }
    const prevPeek = await readUserState(root, accId);
    const state = await mergeAndWriteUserStatePatch(
      root,
      accId,
      rawPatch,
    );
    for (const ev of diffUserStatePlaylistsAndSettings(prevPeek, state)) {
      void actLog(req, ev);
    }
    return sendOk(res, state);
  } catch (error) {
    console.error(error);
    return sendError(res, 500, String(error?.message || error));
  }
});

app.put("/api/user-state", async (req, res) => {
  try {
    const accId = accountIdFromReq(req);
    const root = getMusicRoot();
    const expectedRevision = Number(req.body?.expectedRevision);
    if (!Number.isFinite(expectedRevision) || expectedRevision < 1) {
      return sendError(res, 400, "expectedRevision (positive number) is required");
    }
    const nested = req.body?.state;
    let rawPatch = nested ?? req.body ?? {};
    if (
      nested == null &&
      rawPatch &&
      typeof rawPatch === "object" &&
      !Array.isArray(rawPatch)
    ) {
      const { expectedRevision: _er, ...rest } = rawPatch;
      void _er;
      rawPatch = rest;
    }
    if (
      rawPatch == null ||
      typeof rawPatch !== "object" ||
      Array.isArray(rawPatch)
    ) {
      return sendError(res, 400, "Invalid state: expected a JSON object");
    }
    const prevPeek = await readUserState(root, accId);
    const state = await mergeAndWriteUserStateWithRevision(
      root,
      accId,
      expectedRevision,
      (fresh) =>
        mergeUserStateForPut(
          fresh,
          stripClientControlledKeysFromPutPatch(rawPatch),
        ),
    );
    for (const ev of diffUserStatePlaylistsAndSettings(prevPeek, state)) {
      void actLog(req, ev);
    }
    return sendOk(res, state);
  } catch (error) {
    if (error?.code === "USER_STATE_REVISION_CONFLICT") {
      return sendError(res, 409, "USER_STATE_REVISION_CONFLICT", {
        code: "REVISION_CONFLICT",
        currentState: error.currentState,
      });
    }
    console.error(error);
    return sendError(res, 500, String(error?.message || error));
  }
});

app.patch("/api/user-state/settings", async (req, res) => {
  try {
    const accId = accountIdFromReq(req);
    const root = getMusicRoot();
    const expectedRevision = Number(req.body?.expectedRevision);
    if (!Number.isFinite(expectedRevision) || expectedRevision < 1) {
      return sendError(res, 400, "expectedRevision (positive number) is required");
    }
    const rawPatch = req.body?.settings;
    if (rawPatch == null || typeof rawPatch !== "object" || Array.isArray(rawPatch)) {
      return sendError(res, 400, "Invalid settings patch: expected settings object");
    }
    const prevPeek = await readUserState(root, accId);
    const state = await mergeAndWriteUserStateWithRevision(
      root,
      accId,
      expectedRevision,
      (fresh) => mergeUserStateForPut(fresh, { settings: rawPatch }),
    );
    for (const ev of diffUserStatePlaylistsAndSettings(prevPeek, state)) {
      void actLog(req, ev);
    }
    return sendOk(res, state);
  } catch (error) {
    if (error?.code === "USER_STATE_REVISION_CONFLICT") {
      return sendError(res, 409, "USER_STATE_REVISION_CONFLICT", {
        code: "REVISION_CONFLICT",
        currentState: error.currentState,
      });
    }
    console.error(error);
    return sendError(res, 500, String(error?.message || error));
  }
});

app.get("/api/cover", (req, res) => {
  const root = getMusicRoot();
  const relPath = String(req.query.path || "");
  if (
    !relPath ||
    pathHasParentDirSegment(relPath) ||
    hasReservedPathSegment(relPath)
  ) {
    return res.status(400).end();
  }
  const filePath = path.join(root, relPath.replaceAll("/", path.sep));
  if (!underRoot(filePath, root) || !existsSync(filePath))
    return res.status(404).end();
  const dir = statSync(filePath).isDirectory()
    ? filePath
    : path.dirname(filePath);
  for (const name of coverCandidates()) {
    const full = path.join(dir, name);
    if (existsSync(full) && underRoot(full, root)) {
      res.setHeader("Cache-Control", "private, max-age=86400, immutable");
      return res.sendFile(full);
    }
  }
  return res.status(404).end();
});

app.get("/api/track-stat", (req, res) => {
  const root = getMusicRoot();
  const relPath = safeRelSeg(String(req.query.path || ""));
  if (!relPath) return sendError(res, 400, "Missing path parameter");
  const filePath = path.join(root, relPath.replaceAll("/", path.sep));
  if (!underRoot(filePath, root) || !existsSync(filePath))
    return sendError(res, 404, "File not found");
  try {
    const st = statSync(filePath);
    return sendOk(res, { size: st.size, mtime: st.mtimeMs });
  } catch (error) {
    return sendError(res, 500, String(error?.message || error));
  }
});

function isYoutubeReleasesTabUrl(value) {
  try {
    const u = new URL(String(value).trim());
    const h = u.hostname.replace(/^www\./, "").toLowerCase();
    if (!h.endsWith("youtube.com") && !h.endsWith("music.youtube.com")) {
      return false;
    }
    return u.pathname.includes("/releases");
  } catch {
    return false;
  }
}

/** Pagina «Album» / browse su YouTube Music (elenco album per artista). */
function isYoutubeMusicBrowseUrl(value) {
  try {
    const u = new URL(String(value).trim());
    const h = u.hostname.replace(/^www\./, "").toLowerCase();
    if (!h.endsWith("music.youtube.com")) return false;
    return u.pathname.includes("/browse") || u.pathname.includes("/channel/");
  } catch {
    return false;
  }
}

function isYoutubeMultiAlbumListUrl(value) {
  return isYoutubeReleasesTabUrl(value) || isYoutubeMusicBrowseUrl(value);
}

app.post("/api/youtube-releases-list", async (req, res) => {
  if (process.env.ENABLE_YTDLP === "0") {
    return sendError(res, 403, "Download disabled (ENABLE_YTDLP=0)");
  }
  const url = coerceYtdlpUrl(String(req.body?.url ?? ""));
  if (!/^https?:\/\//i.test(url)) {
    return sendError(res, 400, "Invalid URL");
  }
  if (!isYoutubeMultiAlbumListUrl(url)) {
    return sendError(
      res,
      400,
      "URL must be a YouTube /releases tab or a YouTube Music /browse/… album list page."
    );
  }
  const program = resolveYtdlpPath();
  try {
    let data = null;
    if (isYoutubeMusicBrowseUrl(url)) {
      const ytm = await fetchYoutubeMusicBrowseReleasesList(url);
      if (ytm.error) {
        return sendError(res, 400, String(ytm.error));
      }
      if (!ytm.entries.length) {
        return sendError(
          res,
          400,
          "No releases found on this YouTube Music browse page (Innertube)."
        );
      }
      data = {
        entries: ytm.entries,
        title: ytm.title,
        uploader: ytm.uploader,
        channel_url: ytm.channel_url,
      };
    } else {
      const preferInnertube =
        String(process.env.KORD_YT_WEB_RELEASES_INNERTUBE ?? "1").trim() !==
        "0";
      if (preferInnertube && isYoutubeWebReleasesPageUrl(url)) {
        try {
          const web = await fetchYoutubeWebReleasesList(url);
          if (!web.error && web.entries.length) {
            data = {
              entries: web.entries,
              title: web.title,
              uploader: web.uploader,
              channel_url: web.channel_url,
            };
          }
        } catch {
          /* yt-dlp sotto */
        }
      }
      if (!data) {
        const args = [
          "-J",
          "--flat-playlist",
          "--no-download",
          "--no-warnings",
          ...ytdlpJavascriptArgs(),
          ...ytdlpCookieArgs(),
          url,
        ];
        let jsonText = "";
        try {
          ({ stdout: jsonText } = await execFileAsync(program, args, {
            maxBuffer: 32 * 1024 * 1024,
            encoding: "utf8",
            ...ytdlpChildExecOptions(),
          }));
        } catch {
          return sendError(res, 500, "yt-dlp failed");
        }
        data = parseYtdlpJsonStdout(jsonText);
        if (!data) {
          return sendError(res, 500, "yt-dlp returned no parseable JSON");
        }
      }
    }
    const { entries, listTitle, uploader, channelUrl } =
      buildYoutubeReleasesListEntries(data);
    if (!entries.length) {
      return sendError(
        res,
        400,
        "No releases in list (or yt-dlp could not expand this page)."
      );
    }
    const wantStream = Boolean(req.body?.stream);
    if (wantStream) {
      res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("X-Accel-Buffering", "no");
      if (typeof res.flushHeaders === "function") res.flushHeaders();
      const wantEnrichCounts = Boolean(req.body?.enrichCounts);
      const { max, timeoutMs, concurrency } = releaseEnrichConfig();
      try {
        writeYoutubeReleasesNdjsonLine(res, {
          type: "meta",
          listTitle,
          uploader,
          channelUrl,
          total: entries.length,
        });
        for (const entry of entries) {
          writeYoutubeReleasesNdjsonLine(res, {
            type: "entry",
            entry: { ...entry, trackCount: null },
          });
        }
        writeYoutubeReleasesNdjsonLine(res, { type: "list_ready" });
        if (wantEnrichCounts) {
          await enrichReleaseEntriesInOrder(
            program,
            entries,
            max,
            timeoutMs,
            concurrency,
            (entry) => {
              writeYoutubeReleasesNdjsonLine(res, { type: "entry_patch", entry });
            }
          );
        }
        writeYoutubeReleasesNdjsonLine(res, { type: "done" });
        res.end();
      } catch (err) {
        writeYoutubeReleasesNdjsonLine(res, {
          type: "error",
          message: String(err?.message ?? err).slice(0, 2_000),
        });
        res.end();
      }
      return;
    }
    const entriesWithCounts = await enrichReleaseEntriesWithTrackCounts(
      program,
      entries
    );
    return sendOk(res, {
      listTitle,
      uploader,
      channelUrl,
      entries: entriesWithCounts,
    });
  } catch (error) {
    let err = String(error?.message ?? error);
    if (error && typeof error === "object") {
      if ("stderr" in error && error.stderr) {
        const s = error.stderr;
        err = Buffer.isBuffer(s) ? s.toString("utf8") : String(s);
      } else if ("stdout" in error && error.stdout) {
        const s = error.stdout;
        err = Buffer.isBuffer(s) ? s.toString("utf8") : String(s);
      }
    }
    err = err.trim() || "yt-dlp failed";
    return sendError(
      res,
      500,
      err.length > 800 ? `${err.slice(0, 797)}…` : err
    );
  }
});

app.post("/api/youtube-explore-search", async (req, res) => {
  if (process.env.ENABLE_YTDLP === "0") {
    return sendError(res, 403, "Download disabled (ENABLE_YTDLP=0)");
  }
  const query = String(req.body?.query ?? "").trim();
  if (!query) {
    return sendError(res, 400, "Query required");
  }
  try {
    const { results, error } = await searchYoutubeMusicCatalog(query);
    if (error) {
      return sendError(res, 400, error);
    }
    return sendOk(res, { results });
  } catch (err) {
    return sendError(
      res,
      500,
      String(err?.message ?? err).slice(0, 800) || "Search failed",
    );
  }
});

app.get("/api/download-preset", async (_req, res) => {
  try {
    return sendOk(res, {
      found: true,
      file: null,
      text: ytdlpCmdDisplay(),
      program: resolveYtdlpPath(),
      cookiesConfigured: ytdlpCookiesConfigured(),
      args: [
        ...ytdlpArgsBase(),
        ...ytdlpJavascriptArgs(),
        ...ytdlpCookieArgsForDisplay(),
        "-o",
        "%(playlist_title)s/%(playlist_index)02d - %(title)s.%(ext)s",
      ],
      exampleUrl: null,
    });
  } catch (error) {
    return sendError(res, 500, String(error?.message || error));
  }
});

app.post("/api/download-cancel", (req, res) => {
  const downloadId = String(req.body?.downloadId ?? "").trim();
  if (!isUuidDownloadId(downloadId)) {
    return sendError(res, 400, "Invalid downloadId");
  }
  const entry = activeYtdlpDownloads.get(downloadId);
  if (!entry?.child) {
    return sendError(res, 404, "No active download");
  }
  entry.userCancelled = true;
  if (process.platform === "win32") {
    forceKillStudioYtdlp(entry.child);
  } else {
    try {
      entry.child.kill("SIGTERM");
    } catch {
      /* ignore */
    }
    if (entry.killTimer) clearTimeout(entry.killTimer);
    entry.killTimer = setTimeout(() => {
      try {
        if (entry.child && !entry.child.killed) entry.child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
    }, 4500);
  }
  return sendOk(res, { ok: true });
});

app.post("/api/download-flat-count", async (req, res) => {
  if (process.env.ENABLE_YTDLP === "0") {
    return sendError(res, 403, "Download disabled (ENABLE_YTDLP=0)");
  }
  const url = coerceYtdlpUrl(String(req.body?.url ?? ""));
  if (!/^https?:\/\//i.test(url))
    return sendError(res, 400, "Provide a valid http(s) URL");
  try {
    const program = resolveYtdlpPath();
    const { timeoutMs } = releaseEnrichConfig();
    const count = await ytdlpPlaylistTrackCount(
      program,
      url,
      Math.max(timeoutMs, 60_000)
    );
    if (count == null)
      return sendError(res, 502, "Could not resolve item count (yt-dlp)");
    return sendOk(res, { count });
  } catch (e) {
    return sendError(res, 500, String(e?.message ?? e));
  }
});

app.post("/api/download", async (req, res) => {
  if (process.env.ENABLE_YTDLP === "0")
    return sendError(res, 403, "Download disabled (ENABLE_YTDLP=0)");
  let url = coerceYtdlpUrl(String(req.body?.url ?? ""));
  if (!/^https?:\/\//i.test(url))
    return sendError(res, 400, "Provide a valid http(s) URL");
  const downloadId = String(req.body?.downloadId ?? "").trim();
  if (!isUuidDownloadId(downloadId)) {
    return sendError(res, 400, "Invalid or missing downloadId (UUID)");
  }
  if (activeYtdlpDownloads.has(downloadId)) {
    return sendError(res, 409, "downloadId already in use");
  }
  let downloadKind = String(req.body?.downloadKind ?? "").trim();
  if (!STUDIO_DOWNLOAD_KINDS.has(downloadKind))
    downloadKind = "download_unknown";
  try {
    const root = getMusicRoot();
    const outputDirForLog = safeRelSeg(String(req.body?.outputDir || ""));
    const program = resolveYtdlpPath();
    const args = [...buildStudioDownloadYtdlpArgs(url, downloadKind, outputDirForLog), url];
    const stderrAcc = { buffer: "", totalChars: 0 };
    const stdoutAcc = { buffer: "", totalChars: 0 };
    let resultCode = -1;
    const command = `${program} ${args
      .map((arg) => (/\s/.test(arg) ? `"${arg}"` : arg))
      .join(" ")}`;
    const entry = {
      userCancelled: false,
      child: /** @type {import("child_process").ChildProcess | null} */ (null),
      killTimer: /** @type {ReturnType<typeof setTimeout> | null} */ (null),
    };
    activeYtdlpDownloads.set(downloadId, entry);
    res.status(200);
    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("Cache-Control", "no-store, no-transform");
    res.setHeader("X-Accel-Buffering", "no");
    res.setHeader("Connection", "close");
    try {
      req.socket?.setNoDelay?.(true);
    } catch {
      /* ignore */
    }
    let keepAliveTimer = /** @type {ReturnType<typeof setInterval> | null} */ (
      null
    );
    const clearKeepAlive = () => {
      if (keepAliveTimer != null) {
        clearInterval(keepAliveTimer);
        keepAliveTimer = null;
      }
    };
    if (typeof res.flushHeaders === "function") res.flushHeaders();
    res.write(`${JSON.stringify({ type: "started" })}\n`);
    let responded = false;
    let lastProgressEmitted = null;
    const finish = (fn) => {
      if (responded) return;
      responded = true;
      clearKeepAlive();
      fn();
    };
    const emitProgressIfNew = () => {
      if (responded) return;
      const p = extractLastItemProgress(
        `${stderrAcc.buffer}\n${stdoutAcc.buffer}`
      );
      if (
        p &&
        (lastProgressEmitted?.current !== p.current ||
          lastProgressEmitted?.total !== p.total)
      ) {
        lastProgressEmitted = p;
        res.write(`${JSON.stringify({ type: "progress", progress: p })}\n`);
      }
    };
    const child = spawn(program, args, {
      cwd: root,
      env: { ...process.env, FORCE_COLOR: "0" },
      ...winHideExec(),
    });
    entry.child = child;
    const killYtdlpOnDisconnect = () => {
      forceKillStudioYtdlp(child);
    };
    const onClientGone = () => {
      if (responded) return;
      killYtdlpOnDisconnect();
    };
    req.on("aborted", onClientGone);
    res.on("close", onClientGone);
    const removeDisconnectListeners = () => {
      req.removeListener("aborted", onClientGone);
      res.removeListener("close", onClientGone);
    };
    keepAliveTimer = setInterval(() => {
      if (responded || res.writableEnded) {
        clearKeepAlive();
        return;
      }
      try {
        res.write(`${JSON.stringify({ type: "keepalive" })}\n`);
      } catch {
        clearKeepAlive();
      }
    }, 5000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      appendRollingCapped(stdoutAcc, chunk, YTDLP_ROLL_LOG_CAP_CHARS);
      emitProgressIfNew();
    });
    child.stderr.on("data", (chunk) => {
      appendRollingCapped(stderrAcc, chunk, YTDLP_ROLL_LOG_CAP_CHARS);
      emitProgressIfNew();
    });
    child.on("close", async (code) => {
      removeDisconnectListeners();
      const reg = activeYtdlpDownloads.get(downloadId);
      const cancelled = Boolean(reg?.userCancelled);
      if (reg?.killTimer) clearTimeout(reg.killTimer);
      activeYtdlpDownloads.delete(downloadId);
      resultCode = code ?? -1;
      let postDownloadError = null;
      if (resultCode === 0) {
        const folder =
          outputDirForLog && outputDirForLog.length > 0
            ? outputDirForLog.replace(/\\/g, "/")
            : ".";
        const u = url.length > 500 ? `${url.slice(0, 497)}…` : url;
        void actLog(req, {
          kind: "studio",
          action: downloadKind,
          folder,
          detail: u,
        });
        try {
          await invalidateLibraryIndex(root);
          await attachStudioDownloadToLibrarySelection(req, root, outputDirForLog);
        } catch (error) {
          postDownloadError = error;
          console.error("[kord] post-download library refresh:", error?.message || error);
        }
      }
      const combined = `${stderrAcc.buffer}\n${stdoutAcc.buffer}`;
      const ot = trimLogForNdjson(stdoutAcc);
      const oe = trimLogForNdjson(stderrAcc);
      const progress = extractLastItemProgress(combined) ?? lastProgressEmitted;
      const itemSummary = ytdlpItemSummaryFromLog(stdoutAcc.buffer, stderrAcc.buffer);
      finish(() => {
        try {
          if (
            itemSummary.downloadedItems.length ||
            itemSummary.skippedItems.length ||
            itemSummary.failedItems.length
          ) {
            res.write(`${JSON.stringify({ type: "items", ...itemSummary })}\n`);
          }
          const line = `${JSON.stringify({
            type: "done",
            ok: resultCode === 0,
            cancelled,
            stdout: ot.text,
            stderr: oe.text,
            logTruncated: Boolean(ot.truncated || oe.truncated),
            stdoutTotalChars: ot.totalChars,
            stderrTotalChars: oe.totalChars,
            code: resultCode,
            progress,
            postDownloadError: postDownloadError
              ? String(postDownloadError?.message || postDownloadError)
              : null,
            musicRoot: root,
            command,
            ...itemSummary,
          })}\n`;
          if (!res.writableEnded) res.write(line);
          if (!res.writableEnded) res.end();
        } catch {
          /* client già disconnesso */
        }
      });
    });
    child.on("error", (error) => {
      removeDisconnectListeners();
      const reg = activeYtdlpDownloads.get(downloadId);
      if (reg?.killTimer) clearTimeout(reg.killTimer);
      activeYtdlpDownloads.delete(downloadId);
      resultCode = -1;
      appendRollingCapped(
        stderrAcc,
        `\n${error.message}`,
        YTDLP_ROLL_LOG_CAP_CHARS
      );
      const ot = trimLogForNdjson(stdoutAcc);
      const oe = trimLogForNdjson(stderrAcc);
      const itemSummary = ytdlpItemSummaryFromLog(stdoutAcc.buffer, stderrAcc.buffer);
      finish(() => {
        try {
          if (
            itemSummary.downloadedItems.length ||
            itemSummary.skippedItems.length ||
            itemSummary.failedItems.length
          ) {
            res.write(`${JSON.stringify({ type: "items", ...itemSummary })}\n`);
          }
          const line = `${JSON.stringify({
            type: "done",
            ok: false,
            cancelled: false,
            stdout: ot.text,
            stderr: oe.text,
            logTruncated: Boolean(ot.truncated || oe.truncated),
            stdoutTotalChars: ot.totalChars,
            stderrTotalChars: oe.totalChars,
            code: resultCode,
            progress: lastProgressEmitted,
            error: error.message,
            musicRoot: root,
            command,
            ...itemSummary,
          })}\n`;
          if (!res.writableEnded) res.write(line);
          if (!res.writableEnded) res.end();
        } catch {
          /* client già disconnesso */
        }
      });
    });
  } catch (error) {
    activeYtdlpDownloads.delete(downloadId);
    return sendError(res, 500, String(error?.message || error));
  }
});

app.get("/api/fs/list", async (req, res) => {
  const root = getMusicRoot();
  const relPath = safeRelSeg(String(req.query.path || ""));
  if (relPath == null) return sendError(res, 400, "Invalid path");
  try {
    const full = path.join(root, relPath.replaceAll("/", path.sep));
    if (!underRoot(full, root) || !existsSync(full))
      return sendError(
        res,
        400,
        "Path is outside the library or does not exist"
      );
    const st = statSync(full);
    if (!st.isDirectory()) return sendError(res, 400, "Not a directory");
    const entries = await fs.readdir(full, { withFileTypes: true });
    const dirs = entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .filter((entry) => entry.name !== "kord" && entry.name !== "node_modules")
      .map((entry) => ({
        name: entry.name,
        relPath: relPath ? `${relPath}/${entry.name}` : entry.name,
      }))
      .sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { numeric: true })
      );
    return res.json({
      path: relPath,
      parent: relPath.split("/").filter(Boolean).slice(0, -1).join("/") || "",
      dirs,
      musicRoot: root,
    });
  } catch (error) {
    return sendError(res, 500, String(error?.message || error));
  }
});

app.get("/api/fs/search-dirs", async (req, res) => {
  const root = getMusicRoot();
  const q = String(req.query.q || "").trim().toLowerCase();
  if (q.length < 1) return sendOk(res, { results: [] });
  if (q.length > 80) return sendError(res, 400, "Query too long");
  try {
    const results = [];
    const visit = async (dir, relPath) => {
      if (results.length >= 80) return;
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (results.length >= 80) break;
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith(".")) continue;
        if (entry.name === "kord" || entry.name === "node_modules") continue;
        const childRel = relPath ? `${relPath}/${entry.name}` : entry.name;
        const full = path.join(root, childRel.replaceAll("/", path.sep));
        if (!underRoot(full, root)) continue;
        if (childRel.toLowerCase().includes(q)) {
          results.push({ name: entry.name, relPath: childRel });
        }
        await visit(full, childRel);
      }
    };
    await visit(root, "");
    return sendOk(res, { results });
  } catch (error) {
    return sendError(res, 500, String(error?.message || error));
  }
});

app.post("/api/fs/mkdir", async (req, res) => {
  const root = getMusicRoot();
  const parentRaw = req.body?.parent;
  const parent = safeRelSeg(String(parentRaw == null ? "" : parentRaw));
  if (parent == null && parentRaw != null && String(parentRaw) !== "") {
    return sendError(res, 400, "Invalid parent path");
  }
  if (relPathLooksLikeAlbumFolder(parent ?? "")) {
    return sendError(
      res,
      400,
      "Cannot create a folder inside an album path (use an artist folder)",
    );
  }
  const name = String(req.body?.name || "").trim();
  if (name.length < 1 || name.length > 200)
    return sendError(res, 400, "Name too short or too long");
  if (
    name.includes("/") ||
    name === ".." ||
    name === "." ||
    name === "kord" ||
    name === "node_modules"
  ) {
    return sendError(res, 400, "Invalid name");
  }
  try {
    const relPath = parent ? `${parent}/${name}` : name;
    const full = path.join(root, relPath.replaceAll("/", path.sep));
    if (!underRoot(full, root)) return sendError(res, 400, "Invalid path");
    if (existsSync(full)) return sendError(res, 400, "Folder already exists");
    await fs.mkdir(full, { recursive: false });
    await invalidateLibraryIndex(root);
    return res.json({ ok: true, relPath: relPath.replaceAll(path.sep, "/") });
  } catch (error) {
    return sendError(res, 500, String(error?.message || error));
  }
});

app.post("/api/fs/clear-dl-dest", async (req, res) => {
  const root = getMusicRoot();
  const relPath = safeRelSeg(String(req.body?.path ?? ""));
  if (relPath == null) return sendError(res, 400, "Invalid path");
  if (String(req.body?.path ?? "").trim() === "" || !relPath) {
    return sendError(
      res,
      400,
      "Use a subfolder under Music, not the library root"
    );
  }
  try {
    const full = path.join(root, relPath.replaceAll("/", path.sep));
    if (!underRoot(full, root) || !existsSync(full))
      return sendError(
        res,
        400,
        "Path is outside the library or does not exist"
      );
    const st = statSync(full);
    if (!st.isDirectory()) return sendError(res, 400, "Not a directory");
    const deleted = [];
    const baseRel = relPath.replaceAll(path.sep, "/");
    const walk = async (dir, relFromRoot) => {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const e of entries) {
        if (e.name.startsWith(".")) continue;
        const p = path.join(dir, e.name);
        const rel = relFromRoot ? `${relFromRoot}/${e.name}` : e.name;
        const relNorm = rel.replaceAll(path.sep, "/");
        if (e.isDirectory()) {
          if (e.name === "kord" || e.name === "node_modules") continue;
          await walk(p, relNorm);
        } else if (e.isFile() && isAudioFile(e.name)) {
          await fs.unlink(p);
          deleted.push(relNorm);
        }
      }
    };
    await walk(full, baseRel);
    await invalidateLibraryIndex(root);
    return sendOk(res, { deleted });
  } catch (error) {
    return sendError(res, 500, String(error?.message || error));
  }
});

app.post("/api/fs/delete-audio-relpaths", async (req, res) => {
  const root = getMusicRoot();
  const list = Array.isArray(req.body?.relPaths) ? req.body.relPaths : [];
  const deleted = [];
  try {
    for (const item of list) {
      const rel = safeRelSeg(String(item));
      if (rel == null || !String(rel).trim()) continue;
      const full = path.join(root, rel.replaceAll("/", path.sep));
      if (!underRoot(full, root) || !existsSync(full)) continue;
      const st0 = statSync(full);
      if (!st0.isFile()) continue;
      const base = path.basename(full);
      if (!isAudioFile(base)) continue;
      await fs.unlink(full);
      deleted.push(rel.replaceAll(path.sep, "/"));
    }
    await invalidateLibraryIndex(root);
    return sendOk(res, {
      deleted,
      affectedAlbums: [...new Set(deleted.map((rel) => albumFolderFromRelPath(rel)).filter(Boolean))],
    });
  } catch (error) {
    return sendError(res, 500, String(error?.message || error));
  }
});

app.post("/api/fs/delete-album-folder", async (req, res) => {
  const root = getMusicRoot();
  const albumPath = safeRelSeg(String(req.body?.albumPath || ""));
  if (albumPath == null || !albumPath)
    return sendError(res, 400, "albumPath is required");
  if (albumPath.split("/").filter(Boolean).length < 2) {
    return sendError(
      res,
      400,
      "albumPath must be an album folder under an artist"
    );
  }
  try {
    const full = path.join(root, albumPath.replaceAll("/", path.sep));
    if (!underRoot(full, root) || !existsSync(full)) {
      return sendError(res, 404, "Album folder not found");
    }
    const st = statSync(full);
    if (!st.isDirectory()) return sendError(res, 400, "Not a directory");
    const deleted = [];
    const collectAudio = async (dir, relFromRoot) => {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const e of entries) {
        const child = path.join(dir, e.name);
        const rel = `${relFromRoot}/${e.name}`.replaceAll(path.sep, "/");
        if (e.isDirectory()) {
          await collectAudio(child, rel);
        } else if (e.isFile() && isAudioFile(e.name)) {
          deleted.push(rel);
        }
      }
    };
    await collectAudio(full, albumPath.replaceAll(path.sep, "/"));
    if (!deleted.length)
      return sendError(res, 400, "No audio files in album folder");
    await fs.rm(full, { recursive: true, force: false });
    await invalidateLibraryIndex(root);
    return sendOk(res, {
      deleted,
      deletedFolder: albumPath.replaceAll(path.sep, "/"),
      affectedAlbums: [albumPath.replaceAll(path.sep, "/")],
    });
  } catch (error) {
    return sendError(res, 500, String(error?.message || error));
  }
});

app.get("/api/artwork/search", async (req, res) => {
  const q = String(req.query.q || req.query.term || "").trim();
  const artist = String(req.query.artist || "").trim();
  const album = String(req.query.album || "").trim();
  const terms = [];
  if (q) terms.push(q);
  else {
    const both = [artist, album].filter(Boolean).join(" ");
    if (both) terms.push(both);
    if (artist) terms.push(artist);
    if (album) terms.push(album);
  }
  const unique = [
    ...new Set(
      terms.map((term) => term.trim()).filter((term) => term.length > 1)
    ),
  ];
  if (!unique.length) return sendOk(res, { results: [] });
  try {
    const results = await aggregateArtworkSearch(unique);
    return sendOk(res, { results });
  } catch (error) {
    return sendError(res, 500, String(error?.message || error));
  }
});

app.post("/api/artwork/apply", async (req, res) => {
  const root = getMusicRoot();
  const albumPath = safeRelSeg(String(req.body?.albumPath || ""));
  const imageUrl = String(req.body?.imageUrl || "").trim();
  if (!albumPath)
    return sendError(
      res,
      400,
      "albumPath: relative folder (e.g. Artist/Album)"
    );
  if (!/^https?:\/\//i.test(imageUrl))
    return sendError(res, 400, "Provide a valid http(s) image URL");
  try {
    let parsedImg;
    try {
      parsedImg = new URL(imageUrl);
    } catch {
      return sendError(res, 400, "Invalid image URL");
    }
    if (hostnameBlockedForUpstreamImageFetch(parsedImg.hostname))
      return sendError(res, 400, "Image hostname not allowed");

    const full = path.join(root, albumPath.replaceAll("/", path.sep));
    if (!underRoot(full, root) || !existsSync(full))
      return sendError(res, 400, "Folder does not exist");
    if (!statSync(full).isDirectory())
      return sendError(res, 400, "Not a directory");
    const response = await fetch(imageUrl, {
      headers: { "User-Agent": kordApiUserAgent() },
    });
    if (!response.ok) return sendError(res, 400, "Image download failed");
    const type = (response.headers.get("content-type") || "").toLowerCase();
    if (!type.startsWith("image/"))
      return sendError(res, 400, "URL is not an image");
    const ext = type.includes("png") ? "png" : "jpg";
    const dest = path.join(full, `cover.${ext}`);
    const data = await response.arrayBuffer();
    await fs.writeFile(dest, Buffer.from(data));
    void actLog(req, {
      kind: "studio",
      action: "cover_save",
      folder: albumPath,
      detail: path.basename(dest),
    });
    const coverRelPath = `${albumPath}/${path.basename(dest)}`.replaceAll(
      path.sep,
      "/",
    );
    const cachePatched = await patchAlbumInLibraryIndexCache(root, albumPath, {
      coverRelPath,
    });
    scheduleLibraryIndexMetaRefresh(root, cachePatched);
    return sendOk(res, {
      saved: path.basename(dest),
      albumPath,
      abs: dest,
      coverRelPath,
      coverVersion: Date.now(),
    });
  } catch (error) {
    return sendError(res, 500, String(error?.message || error));
  }
});

app.post("/api/album-info/fetch", async (req, res) => {
  const root = getMusicRoot();
  const albumPath = safeRelSeg(String(req.body?.albumPath || ""));
  const artist = String(req.body?.artist || "").trim();
  const albumTitle = String(req.body?.album || "").trim();
  if (!albumPath) return sendError(res, 400, "albumPath is required");
  try {
    const full = path.join(root, albumPath.replaceAll("/", path.sep));
    if (!underRoot(full, root) || !existsSync(full))
      return sendError(res, 400, "Folder does not exist");
    if (!statSync(full).isDirectory())
      return sendError(res, 400, "Not a directory");
    const meta = await fetchReleaseMetadata(artist, albumTitle);
    if (meta.error) return sendError(res, 404, meta.error);
    const payload = { ...meta, fetchedAt: new Date().toISOString() };
    delete payload.error;
    const savedMeta = await saveAlbumFetchedMeta(full, payload);
    void actLog(req, {
      kind: "library",
      action: "album_metadata_fetch",
      folder: albumPath,
      detail: "MusicBrainz / release metadata",
    });
    const albumDelta = albumDeltaFromMeta(albumPath, savedMeta, albumTitle);
    const cachePatched = await patchAlbumInLibraryIndexCache(
      root,
      albumPath,
      albumDelta,
    );
    scheduleLibraryIndexMetaRefresh(root, cachePatched);
    return res.json({ ok: true, albumPath, meta: savedMeta, album: albumDelta });
  } catch (error) {
    return sendError(res, 500, String(error?.message || error));
  }
});

app.post("/api/album-info/save", async (req, res) => {
  const root = getMusicRoot();
  const albumPath = safeRelSeg(String(req.body?.albumPath || ""));
  const patch = req.body?.patch;
  if (!albumPath) return sendError(res, 400, "albumPath is required");
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    return sendError(res, 400, "patch object is required");
  }
  try {
    const full = path.join(root, albumPath.replaceAll("/", path.sep));
    if (!underRoot(full, root) || !existsSync(full))
      return sendError(res, 400, "Folder does not exist");
    if (!statSync(full).isDirectory())
      return sendError(res, 400, "Not a directory");
    const allowed = [
      "title",
      "releaseDate",
      "genre",
      "label",
      "country",
      "musicbrainzReleaseId",
    ];
    const safe = {};
    for (const k of allowed) {
      if (Object.prototype.hasOwnProperty.call(patch, k)) safe[k] = patch[k];
    }
    if (!Object.keys(safe).length)
      return sendError(res, 400, "No valid fields in patch");
    const genreTouched = Object.prototype.hasOwnProperty.call(safe, "genre");
    const prevAlbumGenre = genreTouched
      ? normalizeStoredGenreString((await loadAlbumJsonMetaFromDir(full))?.genre) || null
      : null;
    const meta = await saveAlbumManualMeta(full, safe);
    const touchedTracks = [];
    if (genreTouched) {
      const prevAlbumGenres = new Set(
        parseTrackGenres(prevAlbumGenre).map((g) => g.toLowerCase())
      );
      const nextAlbumGenres = parseTrackGenres(meta?.genre);
      const trackMetaMap = await loadTrackJsonMetaMapFromDir(full);
      const entries = await fs.readdir(full, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile() || !isAudioFile(entry.name)) continue;
        const existingGenres = parseTrackGenres(trackMetaMap?.[entry.name]?.genre);
        const mergedGenres = existingGenres.filter(
          (g) => !prevAlbumGenres.has(g.toLowerCase())
        );
        for (const g of nextAlbumGenres) {
          if (!mergedGenres.some((x) => x.toLowerCase() === g.toLowerCase())) {
            mergedGenres.push(g);
          }
        }
        const relPath = `${albumPath}/${entry.name}`.replaceAll(path.sep, "/");
        const row = await saveTrackManualMeta(full, entry.name, {
          genre: normalizeStoredGenreString(mergedGenres.join("; ")) || null,
        });
        touchedTracks.push({
          relPath,
          meta: row,
        });
      }
    }
    void actLog(req, {
      kind: "library",
      action: "album_metadata_save",
      folder: albumPath,
      detail: Object.keys(safe).join(", "),
    });
    const album = {
      relPath: albumPath,
      name:
        meta?.title && String(meta.title).trim()
          ? String(meta.title).trim()
          : path.basename(albumPath),
      title: meta?.title ?? null,
      releaseDate: meta?.releaseDate ?? null,
      genre: meta?.genre ?? null,
      label: meta?.label ?? null,
      country: meta?.country ?? null,
      musicbrainzReleaseId: meta?.musicbrainzReleaseId ?? null,
      expectedTrackCount:
        typeof meta?.expectedTrackCount === "number"
          ? meta.expectedTrackCount
          : null,
      expectedTracks: Array.isArray(meta?.expectedTracks)
        ? meta.expectedTracks
        : null,
      hasAlbumMeta: true,
    };
    const trackPatches = touchedTracks.map((row) => ({
      relPath: row.relPath,
      meta: row.meta,
    }));
    const cachePatched =
      (await patchAlbumInLibraryIndexCache(root, albumPath, album)) ||
      (trackPatches.length
        ? await patchTracksInLibraryIndexCache(root, trackPatches)
        : false);
    scheduleLibraryIndexMetaRefresh(root, cachePatched);
    return sendOk(res, {
      albumPath,
      meta,
      album,
      tracks: touchedTracks,
    });
  } catch (error) {
    return sendError(res, 500, String(error?.message || error));
  }
});

app.post("/api/track-info/fetch", async (req, res) => {
  const root = getMusicRoot();
  const relPath = safeRelSeg(String(req.body?.relPath || ""));
  if (!relPath) return sendError(res, 400, "relPath is required");
  try {
    const fullTrackPath = path.join(root, relPath.replaceAll("/", path.sep));
    if (
      !underRoot(fullTrackPath, root) ||
      !existsSync(fullTrackPath) ||
      !isAudioFile(fullTrackPath)
    ) {
      return sendError(res, 404, "Track not found");
    }
    const parts = relPath.split("/").filter(Boolean);
    const fileName = parts[parts.length - 1];
    const artist = parts[0] || "";
    const album = parts.length >= 3 ? parts[1] : "";
    const albumRel = albumFolderFromRelPath(relPath);
    if (!albumRel) return sendError(res, 400, "Invalid track path");
    const albumDir = path.join(root, albumRel.replaceAll("/", path.sep));
    if (!underRoot(albumDir, root) || !existsSync(albumDir))
      return sendError(res, 404, "Album folder not found");
    const titleRaw =
      String(fileName)
        .replace(/\.(mp3|flac|m4a|ogg|opus|wav|aac|webm)$/i, "")
        .trim() || fileName;
    const fpKord = path.join(albumDir, "kord-trackinfo.json");
    const fpWpp = path.join(albumDir, "wpp-trackinfo.json");
    const fpRead = existsSync(fpKord)
      ? fpKord
      : existsSync(fpWpp)
      ? fpWpp
      : null;
    let json = {};
    if (fpRead) {
      try {
        json = JSON.parse(await fs.readFile(fpRead, "utf8")) || {};
      } catch {
        json = {};
      }
    }
    const existingTr = json[fileName];
    const artistFromTrackInfo =
      existingTr &&
      typeof existingTr === "object" &&
      typeof existingTr.artist === "string"
        ? String(existingTr.artist).trim()
        : "";
    const artistForTitle = artistFromTrackInfo || artist;
    const title =
      prepareTrackTitleForMeta(artistForTitle, titleRaw) || titleRaw;
    const meta = await fetchTrackMetadata(
      artistForTitle,
      title,
      album,
      titleRaw
    );
    if (meta.error) return sendError(res, 404, meta.error);
    const row = await saveTrackFetchedMeta(albumDir, fileName, {
      ...meta,
      fetchedAt: new Date().toISOString(),
    });
    void actLog(req, {
      kind: "library",
      action: "track_metadata_fetch",
      folder: albumRel,
      detail: fileName,
    });
    const fileMs = await getAudioFileDurationMs(fullTrackPath);
    const metaOut = {
      ...row,
      durationMs: Number.isFinite(fileMs) ? fileMs : null,
    };
    const resolvedTitle =
      metaOut?.title && String(metaOut.title).trim()
        ? String(metaOut.title).trim()
        : null;
    const trackDelta = {
      relPath,
      ...(resolvedTitle ? { title: resolvedTitle } : {}),
      meta: metaOut,
    };
    const cachePatched = await patchTrackInLibraryIndexCache(
      root,
      relPath,
      trackDelta,
    );
    scheduleLibraryIndexMetaRefresh(root, cachePatched);
    return res.json({ ok: true, relPath, meta: metaOut, track: trackDelta });
  } catch (error) {
    return sendError(res, 500, String(error?.message || error));
  }
});

app.post("/api/track-lyrics/fetch", async (req, res) => {
  const root = getMusicRoot();
  const relPath = safeRelSeg(String(req.body?.relPath || ""));
  if (!relPath) return sendError(res, 400, "relPath is required");
  try {
    const fullTrackPath = path.join(root, relPath.replaceAll("/", path.sep));
    if (
      !underRoot(fullTrackPath, root) ||
      !existsSync(fullTrackPath) ||
      !isAudioFile(fullTrackPath)
    ) {
      return sendError(res, 404, "Track not found");
    }
    const parts = relPath.split("/").filter(Boolean);
    const fileName = parts[parts.length - 1];
    const artistFolder = parts[0] || "";
    const albumFolder = parts.length >= 3 ? parts[1] : "";
    const albumRel = albumFolderFromRelPath(relPath);
    if (!albumRel) return sendError(res, 400, "Invalid track path");
    const albumDir = path.join(root, albumRel.replaceAll("/", path.sep));
    if (!underRoot(albumDir, root) || !existsSync(albumDir))
      return sendError(res, 404, "Album folder not found");
    const titleRaw =
      String(fileName)
        .replace(/\.(mp3|flac|m4a|ogg|opus|wav|aac|webm)$/i, "")
        .trim() || fileName;
    const fpKord = path.join(albumDir, "kord-trackinfo.json");
    const fpWpp = path.join(albumDir, "wpp-trackinfo.json");
    const fpRead = existsSync(fpKord) ? fpKord : existsSync(fpWpp) ? fpWpp : null;
    let json = {};
    if (fpRead) {
      try {
        json = JSON.parse(await fs.readFile(fpRead, "utf8")) || {};
      } catch {
        json = {};
      }
    }
    const existingTr = json[fileName];
    const artistFromTrackInfo =
      existingTr &&
      typeof existingTr === "object" &&
      typeof existingTr.artist === "string"
        ? String(existingTr.artist).trim()
        : "";
    const artist = artistFromTrackInfo || artistFolder;
    const title = prepareTrackTitleForMeta(artist, titleRaw) || titleRaw;
    const durMs = await getAudioFileDurationMs(fullTrackPath);
    const lyric = await fetchTrackLyricsLrcLib(
      artist,
      title,
      albumFolder,
      Number.isFinite(durMs) ? durMs : null,
    );
    if (lyric?.error) return sendError(res, 404, lyric.error);
    const synced = lyric?.syncedLyrics || null;
    const plain = lyric?.plainLyrics || null;
    void actLog(req, {
      kind: "library",
      action: "track_lyrics_fetch",
      folder: albumRel,
      detail: fileName,
    });
    return sendOk(res, {
      relPath,
      syncedLyrics: synced,
      plainLyrics: plain,
    });
  } catch (error) {
    return sendError(res, 500, String(error?.message || error));
  }
});

app.post("/api/track-info/save", async (req, res) => {
  const root = getMusicRoot();
  const relPath = safeRelSeg(String(req.body?.relPath || ""));
  const patch = req.body?.patch;
  if (!relPath) return sendError(res, 400, "relPath is required");
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    return sendError(res, 400, "patch object is required");
  }
  try {
    const fullTrackPath = path.join(root, relPath.replaceAll("/", path.sep));
    if (
      !underRoot(fullTrackPath, root) ||
      !existsSync(fullTrackPath) ||
      !isAudioFile(fullTrackPath)
    ) {
      return sendError(res, 404, "Track not found");
    }
    const parts = relPath.split("/").filter(Boolean);
    const fileName = parts[parts.length - 1];
    const albumRel = albumFolderFromRelPath(relPath);
    if (!albumRel) return sendError(res, 400, "Invalid track path");
    const albumDir = path.join(root, albumRel.replaceAll("/", path.sep));
    if (!underRoot(albumDir, root) || !existsSync(albumDir))
      return sendError(res, 404, "Album folder not found");
    const allowed = [
      "title",
      "releaseDate",
      "genre",
      "lyrics",
      "trackNumber",
      "discNumber",
      "source",
      "url",
    ];
    const safe = {};
    for (const k of allowed) {
      if (Object.prototype.hasOwnProperty.call(patch, k)) safe[k] = patch[k];
    }
    const hasMood =
      Object.prototype.hasOwnProperty.call(patch, "moods") ||
      Object.prototype.hasOwnProperty.call(patch, "mood");
    if (!Object.keys(safe).length && !hasMood) {
      return sendError(res, 400, "No valid fields in patch");
    }
    const accId = accountIdFromReq(req);
    let meta = {};
    if (Object.keys(safe).length) {
      meta = await saveTrackManualMeta(albumDir, fileName, safe);
    }
    let moods = [];
    if (hasMood) {
      const list = normalizeTrackMoodsList(
        Object.prototype.hasOwnProperty.call(patch, "moods")
          ? patch.moods
          : null,
        Object.prototype.hasOwnProperty.call(patch, "mood") ? patch.mood : null
      );
      const merged = await writeUserTrackMoodsWithCAS(root, accId, relPath, list);
      moods = merged.trackMoods?.[relPath] ?? [];
    }
    void actLog(req, {
      kind: "library",
      action: "track_metadata_save",
      folder: albumRel,
      detail: `${fileName}: ${Object.keys(safe).join(", ")}${
        hasMood ? ", moods" : ""
      }`,
    });
    const title =
      meta?.title && String(meta.title).trim()
        ? String(meta.title).trim()
        : patch?.title && String(patch.title).trim()
          ? String(patch.title).trim()
          : null;
    const metaOut = hasMood ? { ...meta, moods } : meta;
    const trackDelta = {
      relPath,
      ...(title ? { title } : {}),
      meta: metaOut,
    };
    const cachePatched = await patchTrackInLibraryIndexCache(
      root,
      relPath,
      trackDelta,
    );
    scheduleLibraryIndexMetaRefresh(root, cachePatched);
    return res.json({
      ok: true,
      relPath,
      meta: metaOut,
      track: trackDelta,
      album: { relPath: albumRel },
    });
  } catch (error) {
    return sendError(res, 500, String(error?.message || error));
  }
});

app.post("/api/plectr/save-best", async (req, res) => {
  const root = getMusicRoot();
  const relPath = safeRelSeg(String(req.body?.relPath || ""));
  const result = req.body?.result;
  if (!relPath) return sendError(res, 400, "relPath is required");
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return sendError(res, 400, "result object is required");
  }
  try {
    const fullTrackPath = path.join(root, relPath.replaceAll("/", path.sep));
    if (
      !underRoot(fullTrackPath, root) ||
      !existsSync(fullTrackPath) ||
      !isAudioFile(fullTrackPath)
    ) {
      return sendError(res, 404, "Track not found");
    }
    const parts = relPath.split("/").filter(Boolean);
    const fileName = parts[parts.length - 1];
    const albumRel = albumFolderFromRelPath(relPath);
    if (!albumRel) return sendError(res, 400, "Invalid track path");
    const albumDir = path.join(root, albumRel.replaceAll("/", path.sep));
    if (!underRoot(albumDir, root) || !existsSync(albumDir)) {
      return sendError(res, 404, "Album folder not found");
    }
    const meta = await savePlectrBestMeta(albumDir, fileName, result);
    void actLog(req, {
      kind: "library",
      action: "plectr_best_save",
      folder: albumRel,
      detail: `${fileName}: ${meta?.plectrBest?.score ?? result.score}`,
    });
    const trackDelta = {
      relPath,
      meta: { plectrBest: meta?.plectrBest ?? null },
    };
    const cachePatched = await patchTrackInLibraryIndexCache(
      root,
      relPath,
      trackDelta,
    );
    scheduleLibraryIndexMetaRefresh(root, cachePatched);
    return res.json({ ok: true, relPath, meta, track: trackDelta });
  } catch (error) {
    return sendError(res, 500, String(error?.message || error));
  }
});

app.post("/api/track-info/prune-orphans", async (req, res) => {
  const root = getMusicRoot();
  const albumPath = safeRelSeg(String(req.body?.albumPath || ""));
  if (!albumPath) return sendError(res, 400, "albumPath is required");
  try {
    const full = path.join(root, albumPath.replaceAll("/", path.sep));
    if (!underRoot(full, root) || !existsSync(full)) {
      return sendError(res, 400, "Folder does not exist");
    }
    if (!statSync(full).isDirectory())
      return sendError(res, 400, "Not a directory");
    const r = await pruneOrphanTrackMetaInAlbumDir(full);
    if (r.removed.length) {
      void actLog(req, {
        kind: "library",
        action: "track_metadata_prune_orphans",
        folder: albumPath,
        detail: `${r.removed.length} key(s): ${r.removed
          .slice(0, 12)
          .join(", ")}${r.removed.length > 12 ? "…" : ""}`,
      });
      await invalidateLibraryIndex(root);
    }
    return sendOk(res, { albumPath, removed: r.removed, written: r.written });
  } catch (error) {
    return sendError(res, 500, String(error?.message || error));
  }
});

app.post("/api/studio/sanitize-track-titles", async (req, res) => {
  const scope = String(req.body?.scope || "album");
  const dryRun = Boolean(req.body?.dryRun);
  const albumPath = safeRelSeg(String(req.body?.albumPath || ""));
  try {
    const root = getMusicRoot();
    if (scope === "all") {
      const data = await sanitizeTrackTitlesFullLibrary(root, dryRun);
      if (!dryRun && data.changes.length > 0) {
        const n = data.changes.length;
        void actLog(req, {
          kind: "studio",
          action: "sanitize_titles_library",
          folder: null,
          detail: `library (${n} file${n === 1 ? "" : "s"})`,
        });
        await invalidateLibraryIndex(root);
      }
      return sendOk(res, data);
    }
    if (!albumPath) {
      return sendError(res, 400, "albumPath is required for album scope");
    }
    const full = path.join(root, albumPath.replaceAll("/", path.sep));
    if (
      !underRoot(full, root) ||
      !existsSync(full) ||
      !statSync(full).isDirectory()
    ) {
      return sendError(res, 400, "Invalid album folder");
    }
    const r = await sanitizeTrackTitlesInAlbumDir(full, dryRun);
    if (!dryRun && r.changes.length > 0) {
      const n = r.changes.length;
      void actLog(req, {
        kind: "studio",
        action: "sanitize_titles_album",
        folder: albumPath,
        detail: `album (${n} file${n === 1 ? "" : "s"})`,
      });
      await invalidateLibraryIndex(root);
    }
    return sendOk(res, { ...r, albumPath });
  } catch (error) {
    return sendError(res, 500, String(error?.message || error));
  }
});

const distPath = path.join(
  __dirname,
  "..",
  "dist"
);
if (existsSync(path.join(distPath, "index.html"))) {
  app.use(express.static(distPath));
  app.use((req, res, next) => {
    if (req.path.startsWith("/api") || req.path.startsWith("/media"))
      return next();
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    return res.sendFile(path.join(distPath, "index.html"), (error) => {
      if (error) res.status(500).end();
    });
  });
}

app.use((error, _req, res, _next) => {
  console.error(error);
  return sendError(res, 500, "Internal server error");
});

async function startListening() {
  await waitForInitialLayoutMigration();

  const LISTEN_HOST = getListenHost();
  const httpServer = app.listen(PORT, LISTEN_HOST, () => {
    console.log(
      `[music-server] http://${LISTEN_HOST}:${PORT} -> ${getMusicRoot()}`
    );
    if (remoteAccessState.enabled) {
      try {
        startRemoteAccess();
      } catch (error) {
        markRemoteError(error);
      }
    }
  });
  httpServer.on("error", (err) => {
    console.error("[music-server] listen", err);
    process.exit(1);
  });
}

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    stopRemoteAccess();
    process.exit(0);
  });
}

startListening().catch((err) => {
  console.error("[music-server] startup", err);
  process.exit(1);
});
