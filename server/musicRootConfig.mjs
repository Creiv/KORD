import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import {
  atomicWriteFileUtf8,
  kordAccountDir,
  kordAccountLibrarySelectionPath,
  kordGlobalAccountsPath,
  kordGlobalInfoDir,
} from "./kordDataStore.mjs";
import { runKordLayoutMigration } from "./migrateKordV2.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const userDir = process.env.KORD_USER_CONFIG_DIR || process.env.WPP_USER_CONFIG_DIR;
export const CONFIG_FILE = userDir
  ? path.join(path.resolve(String(userDir).trim()), "music-root.config.json")
  : path.join(__dirname, "music-root.config.json");
const BOOTSTRAP_SCHEMA_VERSION = 3;
const DEFAULT_ACCOUNT_ID = "default";

const state = {
  path: null,
  fromEnv: false,
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

function collectLegacyAccountRoots(rawAccounts) {
  const out = {};
  if (!Array.isArray(rawAccounts)) return out;
  for (const item of rawAccounts) {
    if (!item || typeof item !== "object") continue;
    const id = String(item.id || "").trim();
    if (!id || !item.musicRoot || typeof item.musicRoot !== "string") continue;
    out[id] = path.resolve(item.musicRoot.trim());
  }
  return out;
}

function normalizeAccountsArray(raw) {
  const rawArr = Array.isArray(raw) ? raw : [];
  const seen = new Set();
  const accounts = [];
  for (const item of rawArr) {
    if (!item || typeof item !== "object") continue;
    const id = String(item.id || "").trim() || makeAccountId();
    if (seen.has(id)) continue;
    seen.add(id);
    accounts.push({
      id,
      name: cleanAccountName(item.name, id === DEFAULT_ACCOUNT_ID ? "Default" : "Account"),
    });
  }
  return accounts;
}

function normalizeAccountsFromFile(file) {
  return normalizeAccountsArray(file.accounts);
}

function resolveLibraryRootFromBootstrap(file) {
  if (typeof file.musicRoot === "string" && file.musicRoot.trim()) {
    return path.resolve(file.musicRoot.trim());
  }
  return null;
}

function configNeedsPersistRewrite(file) {
  if (Number(file.schemaVersion) === 2) return false;
  const raw = Array.isArray(file.accounts) ? file.accounts : [];
  if (raw.some((a) => a && typeof a === "object" && typeof a.musicRoot === "string" && a.musicRoot.trim())) {
    return true;
  }
  return false;
}

function writeAccountsFileSync(libraryRoot, accounts) {
  const accPath = kordGlobalAccountsPath(libraryRoot);
  fs.mkdirSync(path.dirname(accPath), { recursive: true });
  fs.writeFileSync(accPath, JSON.stringify({ schemaVersion: 1, accounts }, null, 2), "utf8");
}

function loadOrCreateAccountsInLibrarySync(libraryRoot, rawBootstrapAccounts) {
  try {
    fs.mkdirSync(kordGlobalInfoDir(libraryRoot), { recursive: true });
  } catch {
    /* ignore */
  }
  const accPath = kordGlobalAccountsPath(libraryRoot);
  if (fs.existsSync(accPath)) {
    try {
      const j = JSON.parse(fs.readFileSync(accPath, "utf8"));
      const list = normalizeAccountsArray(j.accounts);
      if (list.length) return list;
    } catch {
      /* ignore */
    }
  }
  const fromBootstrap = normalizeAccountsArray(rawBootstrapAccounts);
  if (fromBootstrap.length) {
    writeAccountsFileSync(libraryRoot, fromBootstrap);
    return fromBootstrap;
  }
  const def = [{ id: DEFAULT_ACCOUNT_ID, name: "Default" }];
  writeAccountsFileSync(libraryRoot, def);
  return def;
}

async function persistAccountsToLibraryAsync() {
  const lib = state.path;
  if (!lib) return;
  const accPath = kordGlobalAccountsPath(lib);
  await fsp.mkdir(path.dirname(accPath), { recursive: true });
  await atomicWriteFileUtf8(
    accPath,
    JSON.stringify({ schemaVersion: 1, accounts: state.accounts }, null, 2),
  );
}

function persistBootstrapOnlySync() {
  try {
    fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
    fs.writeFileSync(
      CONFIG_FILE,
      JSON.stringify(
        {
          musicRoot: state.path,
          schemaVersion: BOOTSTRAP_SCHEMA_VERSION,
        },
        null,
        2,
      ),
      "utf8",
    );
  } catch {
    /* ignore */
  }
}

function persistConfigSyncFromState() {
  persistBootstrapOnlySync();
}

function shouldRewriteBootstrap(file) {
  if (Number(file.schemaVersion) !== BOOTSTRAP_SCHEMA_VERSION) return true;
  return Object.prototype.hasOwnProperty.call(file, "accounts");
}

function applyConfigFileToState() {
  const file = readFileObject();
  const rawAccounts = Array.isArray(file.accounts) ? file.accounts : [];
  const legacyRoots = collectLegacyAccountRoots(rawAccounts);
  const needsLegacyV2Rewrite = configNeedsPersistRewrite(file);

  if (needsLegacyV2Rewrite && fs.existsSync(CONFIG_FILE)) {
    try {
      fs.copyFileSync(CONFIG_FILE, `${CONFIG_FILE}.bak`);
    } catch {
      /* ignore */
    }
  }

  const fromEnv = readEnv();
  if (fromEnv) {
    state.path = fromEnv.path;
    state.fromEnv = true;
    state.accounts = loadOrCreateAccountsInLibrarySync(state.path, []);
    if (shouldRewriteBootstrap(file)) {
      persistBootstrapOnlySync();
    }
  } else {
    state.fromEnv = false;
    state.path = resolveLibraryRootFromBootstrap(file);
    if (!state.path) {
      state.accounts = [];
    } else {
      state.accounts = loadOrCreateAccountsInLibrarySync(state.path, rawAccounts);
      if (shouldRewriteBootstrap(file) || needsLegacyV2Rewrite) {
        persistBootstrapOnlySync();
      }
    }
  }

  const cfgDir = path.dirname(CONFIG_FILE);
  if (state.path) {
    void runKordLayoutMigration({
      libraryRoot: state.path,
      accounts: state.accounts,
      legacyAccountMusicRoots: legacyRoots,
      configDir: cfgDir,
    }).catch(() => {});
  }
}

function init() {
  applyConfigFileToState();
}

init();

export function reloadConfigFromDisk() {
  applyConfigFileToState();
}

export function isLibraryRootConfigured() {
  if (state.fromEnv) return true;
  if (!state.path) return false;
  try {
    return fs.existsSync(state.path) && fs.statSync(state.path).isDirectory();
  } catch {
    return false;
  }
}

function isIPv4Family(family) {
  return family === "IPv4" || family === 4;
}

function scoreLanIPv4(addr) {
  const p = String(addr).split(".");
  if (p.length !== 4) return 0;
  const a0 = Number(p[0]);
  const a1 = Number(p[1]);
  if (a0 === 10) return 80;
  if (a0 === 192 && a1 === 168) return 100;
  if (a0 === 172 && a1 >= 16 && a1 <= 31) return 40;
  if (a0 === 169 && a1 === 254) return 5;
  if (a0 === 100 && a1 >= 64 && a1 <= 127) return 20;
  if (a0 === 127) return 0;
  return 15;
}

function guessLanIPv4() {
  const nets = os.networkInterfaces();
  const cands = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (!isIPv4Family(net.family) || net.internal) continue;
      const addr = net.address;
      if (addr && addr !== "0.0.0.0") cands.push({ addr, score: scoreLanIPv4(addr) });
    }
  }
  if (!cands.length) return null;
  cands.sort((a, b) => b.score - a.score);
  return cands[0].addr;
}

export function getMusicRoot() {
  return state.path;
}

export function getLibraryRoot() {
  return state.path;
}

export function getDefaultAccountId() {
  return state.accounts[0]?.id ?? "";
}

export function getAccount(accountId) {
  const id = String(accountId || "").trim();
  const account = state.accounts.find((item) => item.id === id) || state.accounts[0];
  if (!account) {
    return {
      id: "",
      name: "Default",
    };
  }
  return { id: account.id, name: account.name };
}

export function getMusicRootForAccount(_accountId) {
  return state.path;
}

export function findAccountById(accountId) {
  const id = String(accountId || "").trim();
  if (!id) return null;
  return state.accounts.find((item) => item.id === id) || null;
}

export function getMusicRootForAccountStrict(accountId) {
  if (!isLibraryRootConfigured()) {
    const e = new Error("Set the library folder in Settings first.");
    e.code = "LIBRARY_NOT_CONFIGURED";
    throw e;
  }
  const acc = findAccountById(accountId);
  if (!acc) {
    const e = new Error("Account not found");
    e.code = "ACCOUNT_NOT_FOUND";
    throw e;
  }
  return state.path;
}

export function isMusicRootFromEnv() {
  return state.fromEnv;
}

export function getListenHost() {
  return "0.0.0.0";
}

export function getConfigSnapshot(includeMusicRoot) {
  const serverPort = Number(process.env.PORT) || 3001;
  const ip = guessLanIPv4();
  const lanAccessUrl = ip ? `http://${ip}:${serverPort}` : null;
  const snap = {
    lockedByEnv: state.fromEnv,
    libraryRootConfigured: isLibraryRootConfigured(),
    serverPort,
    devClientPort: 5173,
    lanAccessUrl,
    defaultAccountId: getDefaultAccountId(),
  };
  if (includeMusicRoot) {
    snap.musicRoot = getMusicRoot();
  }
  return snap;
}

async function writeMergedConfigBootstrap() {
  await fsp.mkdir(path.dirname(CONFIG_FILE), { recursive: true });
  await fsp.writeFile(
    CONFIG_FILE,
    JSON.stringify(
      {
        musicRoot: state.path,
        schemaVersion: BOOTSTRAP_SCHEMA_VERSION,
      },
      null,
      2,
    ),
    "utf8",
  );
}

export async function setPersistedMusicRoot(absolute) {
  if (state.fromEnv) {
    const err = new Error(
      "MUSIC_ROOT is set in the environment: unset the variable to use the in-app option.",
    );
    err.code = "ENV_LOCKED";
    throw err;
  }
  const bootstrap = readFileObject();
  const rawBootstrap = Array.isArray(bootstrap.accounts) ? bootstrap.accounts : [];
  const legacyRoots = collectLegacyAccountRoots(rawBootstrap);
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
  state.accounts = loadOrCreateAccountsInLibrarySync(resolved, rawBootstrap);
  await writeMergedConfigBootstrap();
  const cfgDir = path.dirname(CONFIG_FILE);
  void runKordLayoutMigration({
    libraryRoot: state.path,
    accounts: state.accounts,
    legacyAccountMusicRoots: legacyRoots,
    configDir: cfgDir,
  }).catch(() => {});
}

export function getAccountsSnapshot() {
  return {
    defaultAccountId: getDefaultAccountId(),
    accounts: state.accounts.map((account) => ({
      id: account.id,
      name: account.name,
    })),
    lockedByEnv: state.fromEnv,
    libraryRootConfigured: isLibraryRootConfigured(),
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

async function ensureNewAccountKordLayout(libraryRoot, accountId) {
  const dir = kordAccountDir(libraryRoot, accountId);
  if (!dir) return;
  await fsp.mkdir(dir, { recursive: true });
  const sel = kordAccountLibrarySelectionPath(libraryRoot, accountId);
  if (sel && !fs.existsSync(sel)) {
    await atomicWriteFileUtf8(
      sel,
      JSON.stringify(
        { version: 1, includeAll: false, artists: [], albums: [], tracks: [] },
        null,
        2,
      ),
    );
  }
}

function assertLibraryReady() {
  if (!isLibraryRootConfigured()) {
    const err = new Error("Set the library folder in Settings first.");
    err.code = "LIBRARY_NOT_CONFIGURED";
    throw err;
  }
}

export async function createAccount({ name } = {}) {
  assertLibraryReady();
  if (state.fromEnv) {
    const err = new Error(
      "MUSIC_ROOT is set in the environment: unset the variable to create accounts.",
    );
    err.code = "ENV_LOCKED";
    throw err;
  }
  const lib = getMusicRoot();
  await ensureMusicRootDir(lib);
  const account = {
    id: makeAccountId(),
    name: cleanAccountName(name, "New account"),
  };
  state.accounts.push(account);
  await persistAccountsToLibraryAsync();
  await ensureNewAccountKordLayout(lib, account.id);
  return { ...getAccountsSnapshot(), createdAccountId: account.id };
}

export async function updateAccount(id, patch = {}) {
  assertLibraryReady();
  const account = state.accounts.find((item) => item.id === String(id || "").trim());
  if (!account) {
    const err = new Error("Account not found");
    err.code = "ACCOUNT_NOT_FOUND";
    throw err;
  }
  if (patch.name != null) account.name = cleanAccountName(patch.name, account.name);
  await persistAccountsToLibraryAsync();
  return getAccountsSnapshot();
}

export async function deleteAccount(id) {
  assertLibraryReady();
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
  await persistAccountsToLibraryAsync();
  return getAccountsSnapshot();
}
