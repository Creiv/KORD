import { app, BrowserWindow, dialog, Menu, ipcMain, shell } from "electron";
import path from "path";
import fs from "fs";
import { fileURLToPath, pathToFileURL } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_NAME = "Kord Client";

let mainWindow = null;
let useConnectScreen = true;

function getAppIconPath() {
  const candidates = [
    path.join(__dirname, "..", "build", "icon.png"),
    path.join(__dirname, "..", "public", "favicon.png"),
  ];
  return candidates.find((p) => fs.existsSync(p)) || undefined;
}

function getRemoteStatePath() {
  return path.join(app.getPath("userData"), "kord-remote.json");
}

function readRemoteState() {
  const p = getRemoteStatePath();
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function writeRemoteState(s) {
  const p = getRemoteStatePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(s, null, 2), "utf8");
}

function normalizeBase(input) {
  const t = String(input || "")
    .trim()
    .replace(/\/+$/, "");
  if (!t) return null;
  if (!/^https?:\/\//i.test(t)) return `http://${t}`;
  return t;
}

function appendLaunchLog(msg) {
  try {
    const p = path.join(app.getPath("userData"), "kord-launch.log");
    fs.appendFileSync(p, `${new Date().toISOString()} ${msg}\n`, "utf8");
  } catch {
    /* ok */
  }
}

async function httpGetJson(uStr) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 20000);
  try {
    const r = await fetch(uStr, {
      signal: c.signal,
      headers: { Accept: "application/json" },
    });
    const body = await r.text();
    let j;
    try {
      j = JSON.parse(body);
    } catch {
      throw new Error(r.status ? `HTTP ${r.status}` : "Risposta non valida");
    }
    if (!r.ok) {
      if (j && j.ok === false) {
        throw new Error(String(j.error || `HTTP ${r.status}`));
      }
      throw new Error(String(j.error || `HTTP ${r.status}`));
    }
    if (j && j.ok === false) {
      throw new Error(String(j.error || "Errore"));
    }
    if (j && "data" in j && j.ok === true) {
      return j.data;
    }
    return j;
  } catch (e) {
    if (e && e.name === "AbortError") {
      throw new Error("Timeout");
    }
    throw e;
  } finally {
    clearTimeout(t);
  }
}

function appUrlFor(base, accountId) {
  const n = normalizeBase(base);
  if (!n) return null;
  const u = new URL(n.endsWith("/") ? n : `${n}/`);
  u.pathname = (u.pathname || "/").replace(/\/+$/, "") + "/";
  u.search = "";
  u.searchParams.set("kordAccount", String(accountId));
  u.searchParams.set("kordClient", "1");
  return u.toString();
}

function connectFileUrl(fallback) {
  const f = path.join(__dirname, "connect.html");
  if (!fs.existsSync(f)) return null;
  const base = pathToFileURL(f).href;
  if (!fallback) return base;
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}base=${encodeURIComponent(fallback)}`;
}

function showConnect(fallbackBase) {
  const u = connectFileUrl(fallbackBase || "");
  if (!u) {
    void dialog.showErrorBox(APP_NAME, "File connect.html mancante.");
    return;
  }
  useConnectScreen = true;
  void mainWindow?.loadURL(u);
}

function openAppFromState(base, accountId) {
  const url = appUrlFor(base, accountId);
  if (!url) {
    showConnect();
    return;
  }
  useConnectScreen = false;
  lastOpenUrl = url;
  appendLaunchLog(`load ${url}`);
  void mainWindow?.loadURL(url);
}

let lastOpenUrl = "";

function createWindow() {
  if (mainWindow) return;
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: true,
    title: APP_NAME,
    icon: getAppIconPath(),
    autoHideMenuBar: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      partition: "persist:kordclient",
      preload: path.join(__dirname, "connect-preload.cjs"),
    },
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  void mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
  void mainWindow.webContents.on("did-fail-load", (_ev, code, desc, url) => {
    if (useConnectScreen) return;
    if (!url || String(url).startsWith("file:")) return;
    appendLaunchLog(`fail-load ${code} ${url}`);
    const prev = readRemoteState();
    void dialog
      .showMessageBox(mainWindow, {
        type: "warning",
        title: APP_NAME,
        message: "Connessione persa o server non raggiungibile.",
        detail: String(desc),
        buttons: ["Riprova", "Cambia server…"],
        defaultId: 0,
        cancelId: 1,
      })
      .then((r) => {
        if (r.response === 0) {
          if (lastOpenUrl) {
            useConnectScreen = false;
            void mainWindow?.loadURL(lastOpenUrl);
          } else {
            showConnect(prev?.baseUrl);
          }
        } else {
          showConnect(prev?.baseUrl || "");
        }
      });
  });
}

function installAppMenu() {
  const isMac = process.platform === "darwin";
  const template = [];
  if (isMac) {
    template.push({
      label: APP_NAME,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "hide" },
        { type: "separator" },
        { role: "quit" },
      ],
    });
  } else {
    template.push({
      label: "File",
      submenu: [{ role: "quit", label: "Esci" }],
    });
  }
  template.push(
    { label: "View", submenu: [{ role: "reload" }, { role: "forceReload" }] },
    {
      label: "Server",
      submenu: [
        {
          label: "Cambia server…",
          click: () => {
            const prev = readRemoteState();
            showConnect(prev?.baseUrl || "");
          },
        },
      ],
    },
    { label: "Window", submenu: [{ role: "minimize" }] }
  );
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

ipcMain.handle("kord-client-probe", async (_e, rawBase) => {
  const b = normalizeBase(rawBase);
  if (!b) return { ok: false, error: "Indirizzo non valido" };
  try {
    await httpGetJson(`${b}/api/health`);
    const snapshot = await httpGetJson(`${b}/api/accounts`);
    return { ok: true, baseUrl: b, accounts: snapshot };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});

ipcMain.handle("kord-client-join", async (_e, rawBase, accountId) => {
  const b = normalizeBase(rawBase);
  if (!b || !accountId) {
    return { ok: false, error: "Dati mancanti" };
  }
  try {
    await httpGetJson(`${b}/api/health`);
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
  writeRemoteState({ baseUrl: b, accountId: String(accountId) });
  lastOpenUrl = appUrlFor(b, accountId) || "";
  useConnectScreen = false;
  if (lastOpenUrl) {
    void mainWindow?.loadURL(lastOpenUrl);
  }
  return { ok: true };
});

ipcMain.handle("kord-client-saved", () => readRemoteState());

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

if (!app.requestSingleInstanceLock()) {
  void app.whenReady().then(() => {
    try {
      dialog.showMessageBoxSync({
        type: "info",
        title: APP_NAME,
        message: "L’applicazione è già aperta.",
      });
    } finally {
      app.quit();
    }
  });
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
  void app.whenReady().then(() => {
    app.setName(APP_NAME);
    installAppMenu();
    createWindow();
    const saved = readRemoteState();
    if (saved?.baseUrl && saved?.accountId) {
      openAppFromState(saved.baseUrl, saved.accountId);
    } else {
      showConnect();
    }
  });
}
