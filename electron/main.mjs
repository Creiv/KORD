import { app, BrowserWindow, dialog, Menu } from "electron"
import { spawn } from "child_process"
import path from "path"
import fs from "fs"
import { fileURLToPath } from "url"
import http from "http"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const DEFAULT_SERVER_PORT = 3001
const PORT_FILE = "kord-electron-port.json"
let appPort = Number(process.env.KORD_PORT || process.env.PORT) || DEFAULT_SERVER_PORT

function isDev() {
  return !app.isPackaged
}

function getProjectRoot() {
  if (isDev()) {
    return path.join(__dirname, "..")
  }
  return path.join(process.resourcesPath, "app.asar.unpacked")
}

function getServerPath() {
  return path.join(getProjectRoot(), "server", "index.mjs")
}

function appendLaunchLog(message) {
  try {
    const p = path.join(app.getPath("userData"), "kord-launch.log")
    const line = `${new Date().toISOString()} ${message}\n`
    fs.appendFileSync(p, line, "utf8")
  } catch {
    /* ok */
  }
}

function ensureUserDataConfig() {
  const dir = app.getPath("userData")
  fs.mkdirSync(dir, { recursive: true })
  const configPath = path.join(dir, "music-root.config.json")
  if (fs.existsSync(configPath)) return
  let defaultRoot = app.getPath("music")
  try {
    if (!fs.existsSync(defaultRoot)) {
      const fallback = path.join(app.getPath("home"), "Music")
      if (fs.existsSync(fallback)) defaultRoot = fallback
    }
  } catch {
    /* ok */
  }
    fs.writeFileSync(
    configPath,
    JSON.stringify(
      {
        musicRoot: defaultRoot,
        schemaVersion: 3,
      },
      null,
      2,
    ),
    "utf8",
  )
}

function getPortFilePath() {
  return path.join(app.getPath("userData"), PORT_FILE)
}

function hasExplicitServerPortFromEnv() {
  const k = process.env.KORD_PORT
  if (k != null && String(k).trim() !== "") return true
  const p = process.env.PORT
  if (p != null && String(p).trim() !== "") return true
  return false
}

function readPersistedServerPort() {
  try {
    const raw = fs.readFileSync(getPortFilePath(), "utf8")
    const n = JSON.parse(raw)?.serverPort
    const v = Number(n)
    if (Number.isFinite(v) && v >= 1 && v <= 65535) return Math.floor(v)
  } catch {
    /* ok */
  }
  return null
}

function writePersistedServerPort(p) {
  try {
    fs.writeFileSync(
      getPortFilePath(),
      JSON.stringify({ serverPort: p, savedAt: new Date().toISOString() }, null, 2),
      "utf8",
    )
  } catch (e) {
    appendLaunchLog(`warn: could not save ${PORT_FILE} ${e}`)
  }
}

function waitForHealth(p, maxMs) {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      if (Date.now() - start > maxMs) {
        reject(new Error("Timeout: server did not respond"))
        return
      }
      const req = http.request(
        { host: "127.0.0.1", port: p, path: "/api/health", method: "GET", timeout: 1500 },
        (res) => {
          res.resume()
          if (res.statusCode && res.statusCode < 500) resolve()
          else setTimeout(tryOnce, 200)
        },
      )
      req.on("error", () => setTimeout(tryOnce, 200))
      req.on("timeout", () => {
        try {
          req.destroy()
        } catch {
          /* ok */
        }
        setTimeout(tryOnce, 200)
      })
      req.end()
    }
    tryOnce()
  })
}

let serverChild = null
let mainWindow = null

const APP_NAME = "KORD"

function getAppIconPath() {
  const candidates = [
    path.join(__dirname, "..", "build", "icon.png"),
    path.join(__dirname, "..", "dist", "favicon.png"),
    path.join(__dirname, "..", "public", "favicon.png"),
  ]
  return candidates.find((p) => fs.existsSync(p)) || undefined
}

function installAppMenu() {
  const isMac = process.platform === "darwin"
  const viewItems = [
    { role: "reload", label: "Reload" },
    { role: "forceReload", label: "Reload (clear cache)" },
  ]
  if (isDev()) {
    viewItems.push(
      { role: "toggleDevTools", label: "Developer Tools" },
      { type: "separator" },
    )
  }
  viewItems.push(
    { role: "resetZoom", label: "Actual size" },
    { role: "zoomIn", label: "Zoom in" },
    { role: "zoomOut", label: "Zoom out" },
    { type: "separator" },
    { role: "togglefullscreen", label: "Full screen" },
  )
  const template = []
  if (isMac) {
    template.push({
      label: APP_NAME,
      submenu: [
        { role: "about", label: "About" },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide", label: "Hide" },
        { role: "hideOthers", label: "Hide Others" },
        { role: "unhide", label: "Show All" },
        { type: "separator" },
        { role: "quit", label: "Quit" },
      ],
    })
    template.push({
      label: "File",
      submenu: [{ role: "close", label: "Close Window" }],
    })
  } else {
    template.push({
      label: "File",
      submenu: [
        { role: "quit", label: "Quit", accelerator: "Ctrl+Q" },
      ],
    })
  }
  template.push(
    {
      label: "Edit",
      submenu: [
        { role: "undo", label: "Undo" },
        { role: "redo", label: "Redo" },
        { type: "separator" },
        { role: "cut", label: "Cut" },
        { role: "copy", label: "Copy" },
        { role: "paste", label: "Paste" },
        { type: "separator" },
        { role: "selectAll", label: "Select All" },
      ],
    },
    { label: "View", submenu: viewItems },
    {
      label: "Window",
      submenu: [
        { role: "minimize", label: "Minimize" },
        { role: "zoom", label: "Zoom" },
        { type: "separator" },
        { role: "close", label: "Close" },
      ],
    },
    {
      label: "Help",
      submenu: [
        {
          label: "About",
          click: () => {
            void dialog.showMessageBox({
              type: "info",
              title: APP_NAME,
              message: APP_NAME,
              detail: `Version ${app.getVersion()}\nPlatform: ${process.platform} ${process.arch}.`,
            })
          },
        },
      ],
    },
  )
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function pickPortDevOrExplicit() {
  return Number(process.env.KORD_PORT || process.env.PORT) || DEFAULT_SERVER_PORT
}

async function tryStartOnPort(userData, port, useStdio, cwd, script) {
  const env = {
    ...process.env,
    KORD_USER_CONFIG_DIR: userData,
    WPP_USER_CONFIG_DIR: userData,
    PORT: String(port),
    ELECTRON_RUN_AS_NODE: "1",
  }
  appendLaunchLog(`spawn server on ${port} cwd=${cwd}`)
  const child = spawn(process.execPath, [script], {
    env,
    cwd,
    stdio: useStdio ? "inherit" : "ignore",
  })
  child.on("error", (err) => {
    console.error("[kord] server", err)
  })
  const exitP = new Promise((resolve) => {
    child.once("exit", (c) => resolve(c))
  })
  const healthP = waitForHealth(String(port), 45000)
    .then(() => "ok")
    .catch(() => "health-fail")
  const r = await Promise.race([healthP, exitP.then((code) => ({ exit: code }))])
  if (r !== "ok") {
    try {
      child.kill("SIGTERM")
    } catch {
      /* ok */
    }
    return false
  }
  serverChild = child
  serverChild.on("exit", (code) => {
    if (code !== 0 && code != null) {
      appendLaunchLog(`server exit ${code}`)
    }
  })
  return true
}

async function startServer() {
  const userData = app.getPath("userData")
  const useStdio =
    isDev() ||
    process.env.KORD_ELECTRON_LOG === "1" ||
    process.env.WPP_ELECTRON_LOG === "1"
  const cwd = getProjectRoot()
  const script = getServerPath()
  if (!fs.existsSync(script)) {
    throw new Error(`Server not found: ${script}`)
  }

  const explicit = hasExplicitServerPortFromEnv()
  if (isDev() || explicit) {
    appPort = pickPortDevOrExplicit()
    const ok = await tryStartOnPort(userData, appPort, useStdio, cwd, script)
    if (!ok) {
      throw new Error(
        `The server process exited immediately. If another instance is running or the port is busy, close the other window or restart the session.`,
      )
    }
    return
  }

  const preferred = readPersistedServerPort() ?? DEFAULT_SERVER_PORT
  const maxTries = 80
  for (let i = 0; i < maxTries; i++) {
    const tryPort = preferred + i
    if (tryPort > 65535) break
    const ok = await tryStartOnPort(userData, tryPort, useStdio, cwd, script)
    if (ok) {
      appPort = tryPort
      writePersistedServerPort(tryPort)
      appendLaunchLog(`persisted server port ${tryPort}`)
      return
    }
  }
  throw new Error(
    "Could not start the server on a free port. Close other apps using this range or set KORD_PORT in the environment.",
  )
}

function createWindow() {
  const p = String(appPort)
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
      sandbox: true,
    },
  })
  const url = isDev() ? "http://127.0.0.1:5173" : `http://127.0.0.1:${p}/`
  void mainWindow.loadURL(url)
  void mainWindow.webContents.on("did-fail-load", (_ev, code, reason) => {
    appendLaunchLog(`did-fail-load ${code} ${reason}`)
  })
  mainWindow.on("closed", () => {
    mainWindow = null
  })
}

function stopServer() {
  if (serverChild && !serverChild.killed) {
    try {
      serverChild.kill("SIGTERM")
    } catch {
      /* ok */
    }
    serverChild = null
  }
}

app.on("before-quit", () => {
  stopServer()
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit()
  }
})

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

if (!app.requestSingleInstanceLock()) {
  void app.whenReady().then(() => {
    try {
      dialog.showMessageBoxSync({
        type: "info",
        title: APP_NAME,
        message:
          "KORD is already running (another instance is open). Check other windows, the taskbar or system tray, or end the KORD process from Task Manager / System Monitor.",
      })
    } finally {
      app.quit()
    }
  })
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })

  void app.whenReady().then(async () => {
    app.setName(APP_NAME)
    ensureUserDataConfig()
    installAppMenu()
    appendLaunchLog("ready")
    try {
      await startServer()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      appendLaunchLog(`error: ${msg}`)
      console.error(e)
      try {
        dialog.showErrorBox("KORD — startup failed", `${msg}\n\nDetails: ${app.getPath("userData")}/kord-launch.log`)
      } catch {
        /* ok */
      }
      app.quit()
      return
    }
    createWindow()
  })
}
