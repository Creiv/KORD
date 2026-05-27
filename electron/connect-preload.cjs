const { contextBridge, ipcRenderer } = require("electron")

contextBridge.exposeInMainWorld("rekordClientConnect", {
  probe: (base) => ipcRenderer.invoke("rekord-client-probe", base),
  join: (base, accountId) => ipcRenderer.invoke("rekord-client-join", base, accountId),
  getSaved: () => ipcRenderer.invoke("rekord-client-saved"),
})
