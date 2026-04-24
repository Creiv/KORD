import { app, BrowserWindow, dialog, Menu } from "electron"
import { spawn } from "child_process"
import path from "path"
import fs from "fs"
import { fileURLToPath } from "url"
import http from "http"
import net from "net"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

let appPort = Number(process.env.PORT) || 3001

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

function findFreePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer()
    s.on("error", reject)
    s.listen(0, "127.0.0.1", () => {
      const addr = s.address()
      const p = addr && typeof addr === "object" && "port" in addr ? addr.port : null
      s.close((err) => (err != null ? reject(err) : p != null ? resolve(p) : reject(new Error("porta non disponibile"))))
    })
  })
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
  fs.writeFileSync(configPath, JSON.stringify({ musicRoot: defaultRoot }, null, 2), "utf8")
}

function waitForHealth(p, maxMs) {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      if (Date.now() - start > maxMs) {
        reject(new Error("Timeout: server non risponde"))
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

function installAppMenu() {
  const isMac = process.platform === "darwin"
  const viewItems = [
    { role: "reload", label: "Ricarica" },
    { role: "forceReload", label: "Ricarica (senza cache)" },
  ]
  if (isDev()) {
    viewItems.push(
      { role: "toggleDevTools", label: "Strumenti per sviluppatori" },
      { type: "separator" },
    )
  }
  viewItems.push(
    { role: "resetZoom", label: "Zoom normale" },
    { role: "zoomIn", label: "Aumenta" },
    { role: "zoomOut", label: "Riduci" },
    { type: "separator" },
    { role: "togglefullscreen", label: "Schermo intero" },
  )
  const template = []
  if (isMac) {
    template.push({
      label: APP_NAME,
      submenu: [
        { role: "about", label: "Informazioni" },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide", label: "Nascondi" },
        { role: "hideOthers", label: "Nascondi le altre" },
        { role: "unhide", label: "Mostra tutto" },
        { type: "separator" },
        { role: "quit", label: "Esci" },
      ],
    })
    template.push({
      label: "File",
      submenu: [{ role: "close", label: "Chiudi finestra" }],
    })
  } else {
    template.push({
      label: "File",
      submenu: [
        { role: "quit", label: "Esci", accelerator: "Ctrl+Q" },
      ],
    })
  }
  template.push(
    {
      label: "Modifica",
      submenu: [
        { role: "undo", label: "Annulla" },
        { role: "redo", label: "Ripeti" },
        { type: "separator" },
        { role: "cut", label: "Taglia" },
        { role: "copy", label: "Copia" },
        { role: "paste", label: "Incolla" },
        { type: "separator" },
        { role: "selectAll", label: "Seleziona tutto" },
      ],
    },
    { label: "Vista", submenu: viewItems },
    {
      label: "Finestra",
      submenu: [
        { role: "minimize", label: "Riduci a icona" },
        { role: "zoom", label: "Ingrandisci" },
        { type: "separator" },
        { role: "close", label: "Chiudi" },
      ],
    },
    {
      label: "Aiuto",
      submenu: [
        {
          label: "Informazioni",
          click: () => {
            void dialog.showMessageBox({
              type: "info",
              title: APP_NAME,
              message: APP_NAME,
              detail: `Versione ${app.getVersion()}\nSistema: ${process.platform} ${process.arch}.`,
            })
          },
        },
      ],
    },
  )
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function pickPort() {
  if (isDev()) {
    return Promise.resolve(Number(process.env.PORT) || 3001)
  }
  return findFreePort()
}

async function startServer() {
  const userData = app.getPath("userData")
  const useStdio =
    isDev() ||
    process.env.KORD_ELECTRON_LOG === "1" ||
    process.env.WPP_ELECTRON_LOG === "1"
  appPort = await pickPort()
  const env = {
    ...process.env,
    KORD_USER_CONFIG_DIR: userData,
    WPP_USER_CONFIG_DIR: userData,
    PORT: String(appPort),
    ELECTRON_RUN_AS_NODE: "1",
  }
  const cwd = getProjectRoot()
  const script = getServerPath()
  if (!fs.existsSync(script)) {
    throw new Error(`Server non trovato: ${script}`)
  }
  appendLaunchLog(`spawn server on ${appPort} cwd=${cwd}`)
  serverChild = spawn(process.execPath, [script], {
    env,
    cwd,
    stdio: useStdio ? "inherit" : "ignore",
  })
  serverChild.on("error", (err) => {
    console.error("[kord] server", err)
  })
  const exitP = new Promise((resolve) => {
    serverChild.once("exit", (c) => resolve(c))
  })
  const r = await Promise.race([waitForHealth(String(appPort), 45000).then(() => "ok"), exitP])
  if (r !== "ok") {
    throw new Error(
      `Il processo server è uscito subito (codice ${String(r)}). Se un'altra istanza è aperta o la posta resta bloccata, chiudi l'altra finestra o riavvia la sessione.`,
    )
  }
  serverChild.on("exit", (code) => {
    if (code !== 0 && code != null) {
      appendLaunchLog(`server exit ${code}`)
    }
  })
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
    autoHideMenuBar: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
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
          "L'applicazione risulta già in esecuzione (un'altra istanza è aperta). Controlla le finestre, la barra attività o uscita dal vassoio, oppure termina il processo «KORD» dal gestore attività.",
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
        dialog.showErrorBox("KORD — avvio non riuscito", `${msg}\n\nDettagli: ${app.getPath("userData")}/kord-launch.log`)
      } catch {
        /* ok */
      }
      app.quit()
      return
    }
    createWindow()
  })
}
