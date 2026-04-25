const { contextBridge, ipcRenderer } = require("electron")

contextBridge.exposeInMainWorld("kordClientConnect", {
  probe: (base) => ipcRenderer.invoke("kord-client-probe", base),
  join: (base, accountId) => ipcRenderer.invoke("kord-client-join", base, accountId),
  getSaved: () => ipcRenderer.invoke("kord-client-saved"),
})
