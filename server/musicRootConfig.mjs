import fs from "fs";
import fsp from "fs/promises";
import os from "os";
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
  listenOnLan: false,
};

function readEnv() {
  const e = process.env.MUSIC_ROOT;
  if (e && String(e).trim()) {
    return { path: path.resolve(e), fromEnv: true };
  }
  return null;
}

function readFileObject() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")) || {};
    }
  } catch {
    /* ignore */
  }
  return {};
}

function init() {
  const file = readFileObject();
  state.listenOnLan = Boolean(file.listenOnLan);
  const fromEnv = readEnv();
  if (fromEnv) {
    state.path = fromEnv.path;
    state.fromEnv = true;
    return;
  }
  if (file.musicRoot && typeof file.musicRoot === "string") {
    state.path = path.resolve(file.musicRoot);
  } else {
    state.path = path.resolve(DEFAULT_PATH);
  }
  state.fromEnv = false;
}

init();

function guessLanIPv4() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === "IPv4" && !net.internal) return net.address;
    }
  }
  return null;
}

export function getMusicRoot() {
  return state.path;
}

export function isMusicRootFromEnv() {
  return state.fromEnv;
}

export function getListenHost() {
  return state.listenOnLan ? "0.0.0.0" : "127.0.0.1";
}

export function getConfigSnapshot() {
  const serverPort = Number(process.env.PORT) || 3001;
  const ip = guessLanIPv4();
  const lanAccessUrl =
    state.listenOnLan && ip ? `http://${ip}:${serverPort}` : null;
  return {
    musicRoot: state.path,
    lockedByEnv: state.fromEnv,
    listenOnLan: state.listenOnLan,
    serverPort,
    devClientPort: 5173,
    lanAccessUrl,
  };
}

async function writeMergedConfig() {
  await fsp.writeFile(
    CONFIG_FILE,
    JSON.stringify(
      {
        musicRoot: state.path,
        listenOnLan: state.listenOnLan,
      },
      null,
      2
    ),
    "utf8"
  );
}

export async function setListenOnLan(value) {
  state.listenOnLan = Boolean(value);
  await writeMergedConfig();
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
  state.path = resolved;
  state.fromEnv = false;
  await writeMergedConfig();
}
