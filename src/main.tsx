import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

const u = new URLSearchParams(window.location.search)
if (u.get("kordClient") === "1" && u.get("kordAccount")) {
  try {
    localStorage.setItem("kord-session-account-id", u.get("kordAccount") || "")
    sessionStorage.setItem("kord-embed", "client")
  } catch {
    /* ignore */
  }
  u.delete("kordAccount")
  u.delete("kordClient")
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
