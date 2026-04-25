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
const DEFAULT_ACCOUNT_ID = "default";

const state = {
  path: null,
  fromEnv: false,
  listenOnLan: false,
  accounts: [],
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

function makeAccountId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `acct-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function cleanAccountName(value, fallback = "Default") {
  const name = String(value || "").trim();
  return name || fallback;
}

function normalizeAccount(input, fallbackMusicRoot) {
  const src = input && typeof input === "object" ? input : {};
  const id = String(src.id || "").trim() || makeAccountId();
  const musicRoot =
    typeof src.musicRoot === "string" && src.musicRoot.trim()
      ? path.resolve(src.musicRoot)
      : path.resolve(fallbackMusicRoot || DEFAULT_PATH);
  return {
    id,
    name: cleanAccountName(src.name, id === DEFAULT_ACCOUNT_ID ? "Default" : "Account"),
    musicRoot,
  };
}

function normalizeAccounts(file) {
  const fallbackMusicRoot =
    typeof file.musicRoot === "string" && file.musicRoot.trim()
      ? file.musicRoot
      : DEFAULT_PATH;
  const raw = Array.isArray(file.accounts) ? file.accounts : [];
  const seen = new Set();
  const accounts = raw
    .map((item) => normalizeAccount(item, fallbackMusicRoot))
    .filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
  if (!accounts.length) {
    accounts.push({
      id: DEFAULT_ACCOUNT_ID,
      name: "Default",
      musicRoot: path.resolve(fallbackMusicRoot),
    });
  }
  return accounts;
}

function init() {
  const file = readFileObject();
  state.listenOnLan = Boolean(file.listenOnLan);
  state.accounts = normalizeAccounts(file);
  const fromEnv = readEnv();
  if (fromEnv) {
    state.path = fromEnv.path;
    state.fromEnv = true;
    return;
  }
  state.fromEnv = false;
  state.path = state.accounts[0]?.musicRoot || path.resolve(DEFAULT_PATH);
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

export function getDefaultAccountId() {
  return state.accounts[0]?.id || DEFAULT_ACCOUNT_ID;
}

export function getAccount(accountId) {
  const id = String(accountId || "").trim();
  const account =
    state.accounts.find((item) => item.id === id) || state.accounts[0];
  if (!account) {
    return {
      id: DEFAULT_ACCOUNT_ID,
      name: "Default",
      musicRoot: state.fromEnv ? state.path : path.resolve(DEFAULT_PATH),
    };
  }
  return {
    id: account.id,
    name: account.name,
    musicRoot: state.fromEnv ? state.path : account.musicRoot,
  };
}

export function getMusicRootForAccount(accountId) {
  return getAccount(accountId).musicRoot;
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
    musicRoot: getMusicRoot(),
    lockedByEnv: state.fromEnv,
    listenOnLan: state.listenOnLan,
    serverPort,
    devClientPort: 5173,
    lanAccessUrl,
    defaultAccountId: getDefaultAccountId(),
  };
}

async function writeMergedConfig() {
  await fsp.mkdir(path.dirname(CONFIG_FILE), { recursive: true });
  await fsp.writeFile(
    CONFIG_FILE,
    JSON.stringify(
      {
        musicRoot: state.accounts[0]?.musicRoot || state.path,
        listenOnLan: state.listenOnLan,
        accounts: state.accounts,
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
  const current = state.accounts[0];
  if (current) current.musicRoot = resolved;
  state.path = resolved;
  state.fromEnv = false;
  await writeMergedConfig();
}

export function getAccountsSnapshot() {
  return {
    defaultAccountId: getDefaultAccountId(),
    accounts: state.accounts.map((account) => ({
      id: account.id,
      name: account.name,
      musicRoot: state.fromEnv ? state.path : account.musicRoot,
    })),
    lockedByEnv: state.fromEnv,
  };
}

async function ensureMusicRootDir(resolved) {
  await fsp.mkdir(resolved, { recursive: true });
  const st = fs.statSync(resolved);
  if (!st.isDirectory()) {
    const err = new Error("Path is not a directory");
    err.code = "NOT_DIR";
    throw err;
  }
}

export async function createAccount({ name, musicRoot } = {}) {
  if (state.fromEnv) {
    const err = new Error(
      "MUSIC_ROOT is set in the environment: unset the variable to use per-account libraries."
    );
    err.code = "ENV_LOCKED";
    throw err;
  }
  const resolved = path.resolve(String(musicRoot || "").trim() || DEFAULT_PATH);
  await ensureMusicRootDir(resolved);
  const account = {
    id: makeAccountId(),
    name: cleanAccountName(name, "New account"),
    musicRoot: resolved,
  };
  state.accounts.push(account);
  state.path = state.accounts[0]?.musicRoot || resolved;
  await writeMergedConfig();
  return { ...getAccountsSnapshot(), createdAccountId: account.id };
}

export async function updateAccount(id, patch = {}) {
  const account = state.accounts.find((item) => item.id === String(id || "").trim());
  if (!account) {
    const err = new Error("Account not found");
    err.code = "ACCOUNT_NOT_FOUND";
    throw err;
  }
  if (patch.name != null) account.name = cleanAccountName(patch.name, account.name);
  if (patch.musicRoot != null) {
    if (state.fromEnv) {
      const err = new Error(
        "MUSIC_ROOT is set in the environment: unset the variable to use per-account libraries."
      );
      err.code = "ENV_LOCKED";
      throw err;
    }
    const resolved = path.resolve(String(patch.musicRoot || "").trim() || DEFAULT_PATH);
    await ensureMusicRootDir(resolved);
    account.musicRoot = resolved;
  }
  state.path = state.accounts[0]?.musicRoot || state.path;
  await writeMergedConfig();
  return getAccountsSnapshot();
}

export async function deleteAccount(id) {
  const accountId = String(id || "").trim();
  const index = state.accounts.findIndex((item) => item.id === accountId);
  if (index < 0) {
    const err = new Error("Account not found");
    err.code = "ACCOUNT_NOT_FOUND";
    throw err;
  }
  if (state.accounts.length <= 1) {
    const err = new Error("Keep at least one account");
    err.code = "LAST_ACCOUNT";
    throw err;
  }
  state.accounts.splice(index, 1);
  state.path = state.accounts[0]?.musicRoot || path.resolve(DEFAULT_PATH);
  await writeMergedConfig();
  return getAccountsSnapshot();
}
