import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const userDir = process.env.KORD_USER_CONFIG_DIR || process.env.WPP_USER_CONFIG_DIR;
export const CONFIG_FILE = userDir
  ? path.join(path.resolve(String(userDir).trim()), "music-root.config.json")
  : path.join(__dirname, "music-root.config.json");
const DEFAULT_PATH = "/";

const state = {
  path: null,
  fromEnv: false,
};

function readEnv() {
  const e = process.env.MUSIC_ROOT;
  if (e && String(e).trim()) {
    return { path: path.resolve(e), fromEnv: true };
  }
  return null;
}

function readFileConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const j = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
      if (j?.musicRoot && typeof j.musicRoot === "string") {
        return path.resolve(j.musicRoot);
      }
    }
  } catch {
    /* keep default */
  }
  return null;
}

function init() {
  const fromEnv = readEnv();
  if (fromEnv) {
    state.path = fromEnv.path;
    state.fromEnv = true;
    return;
  }
  state.path = readFileConfig() || path.resolve(DEFAULT_PATH);
  state.fromEnv = false;
}

init();

export function getMusicRoot() {
  return state.path;
}

export function isMusicRootFromEnv() {
  return state.fromEnv;
}

export function getConfigSnapshot() {
  return { musicRoot: state.path, lockedByEnv: state.fromEnv };
}

export async function setPersistedMusicRoot(absolute) {
  if (state.fromEnv) {
    const err = new Error(
      "MUSIC_ROOT is set in the environment: unset the variable to use the in-app option."
    );
    err.code = "ENV_LOCKED";
    throw err;
  }
  const resolved = path.resolve(String(absolute || "").trim() || "/");
  if (!fs.existsSync(resolved)) {
    const err = new Error("Folder does not exist");
    err.code = "NOT_FOUND";
    throw err;
  }
  if (!fs.statSync(resolved).isDirectory()) {
    const err = new Error("Path is not a directory");
    err.code = "NOT_DIR";
    throw err;
  }
  await fsp.writeFile(
    CONFIG_FILE,
    JSON.stringify({ musicRoot: resolved }, null, 2),
    "utf8"
  );
  state.path = resolved;
  state.fromEnv = false;
}
