import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { setSelectedAccountId } from "./lib/api"

const u = new URLSearchParams(window.location.search)
const electronEmbed = u.get("rekordClient") === "1"
const fromUrlAccount = String(u.get("accountId") ?? "").trim()
const electronAccount =
  electronEmbed ? String(u.get("rekordAccount") ?? "").trim() : ""
const bootstrapAccount = fromUrlAccount || electronAccount
if (bootstrapAccount) {
  try {
    setSelectedAccountId(bootstrapAccount)
    if (electronEmbed) {
      sessionStorage.setItem("rekord-embed", "client")
    }
  } catch {
    /* ignore */
  }
}
if (electronEmbed) {
  document.documentElement.dataset.rekordClient = "1"
  u.delete("rekordClient")
  u.delete("rekordAccount")
  const qAid = String(u.get("accountId") ?? "").trim()
  if (!qAid && bootstrapAccount) u.set("accountId", bootstrapAccount)
  const q = u.toString()
  const next = `${window.location.pathname}${q ? `?${q}` : ""}${window.location.hash || ""}`
  window.history.replaceState(null, document.title, next)
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* install prompt stays unavailable if registration fails */
    })
  })
}
