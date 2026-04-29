# Kord

**Kord** is a local music hub: browse your library, play tracks with a persistent queue, manage playlists, and keep metadata organized. This repository provides a full-stack web app, an **Electron** desktop shell, and separate **packaged** builds for a **desktop server** and a **lightweight client** for remote use on the same network.

Kord **1.7** ships with the behavior and packaging described below. **`package.json`** is the single source for the exact semver of a given commit.

---

## Audience

- **End users & operators:** start at [Requirements](#requirements), [How to run](#how-to-run), and [Builds and installers](#builds-and-installers).
- **Developers:** see [For developers](#for-developers-and-contributors) and [`package.json` scripts](#common-scripts).

## What you get

- **Dashboard, Listen, Library, Studio, Queue, Playlists, Favorites, Recent, Settings** — a single shell with client-side routing and deep links.
- **Player** with session restore, queue, favorites, recent tracks, and a visualizer; **Cast** (Remote Playback) where the browser supports it.
- **Server** (Node / Express) that indexes your music folder, serves the UI and API, and stores per-user state on disk.
- **Tools** for downloads (optional `yt-dlp`; default is **native AAC/Opus** m4a/webm, no **ffmpeg** dependency in Kord), cover search, and metadata enrichment.
- **i18n**: UI defaults to **English**; **Italian** is available in Settings. Strings live in `src/i18n/en.ts` and `src/i18n/it.ts`.
- **Tests** (Vitest + React Testing Library) for UI, server helpers, and library logic.

## Requirements

- A recent **Node.js** (for development and from-source use).
- A folder of audio files.
- Optional: **`yt-dlp`** for Studio downloads when not using a bundled binary (development: install on `PATH`, or set `YTDLP_PATH`).
- Packaged **Kord Server** builds that use `npm run pack:*:server` run `scripts/fetch-ytdlp.mjs` before packaging and ship the official **yt-dlp** binary under `server/bin/` for the **target OS** (Linux x86_64, Windows `.exe`, or macOS asset). Override downloads with **`YTDLP_PATH`**, or on Linux AArch64/nonstandard builds use **`KORD_YTDLP_LINUX_ASSET`** (see `scripts/fetch-ytdlp.mjs`).
- **Download format** defaults to `-f bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio` (AAC preferred, then Opus in webm — no ffmpeg in the pipeline). **`KORD_YTDLP_LOSSLESS=1`** is ignored where lossless would require ffmpeg.
- **`KORD_YTDLP_COOKIES`** can point to a Netscape cookies file for restricted YouTube content ([yt-dlp cookies FAQ](https://github.com/yt-dlp/yt-dlp/wiki/FAQ#how-do-i-pass-cookies-to-yt-dlp)). Playlists preserve order with **`playlist_index`**.

## How to run

### Browser (development)

```bash
npm install
npm run dev
```

The backend uses `PORT=3001` by default (`MUSIC_ROOT` or Settings for the library path). **`WPP_USER_CONFIG_DIR`** is still honored for legacy paths; **`KORD_USER_CONFIG_DIR`** sets the directory for persisted server config (`music-root.config.json`, activity logs).

### Electron, development (full app)

```bash
npm run dev:app
```

Vite (UI) and the Node server both run; the Electron window loads the UI and the server uses your app **userData** paths.

Packaged **Kord Server** records the listening HTTP port in **`kord-electron-port.json`** under Electron **userData**. First launch tries **3001**, then increments if the port is busy; later launches reuse that port. **`KORD_PORT`** or **`PORT`** in the environment overrides this.

### Listening address and LAN

The HTTP API **listens on all interfaces** (`0.0.0.0`) **by default**, so other machines on your LAN can open **`http://<this-machine-IPv4>:<port>`** (same port as in Settings → Network).

| Variable | Meaning |
| --- | --- |
| *(unset)* | Bind `0.0.0.0` (reachable on LAN/WLAN by IPv4); **firewall** may still block — allow inbound TCP on your server port (**Windows Defender Firewall**, `ufw`, etc.). |
| **`KORD_LISTEN_HOST`** or **`KORD_LISTEN`** `127.0.0.1` / `localhost` / `loopback` | Serve **only on loopback** (no LAN access to the API host). |

**Settings → Network** shows a hint URL using a guessed LAN IPv4; it does **not** toggle binding — restart the process after changing environment variables.

**Kord Client** (remote Electron shell) has no embedded server — it connects to whichever base URL you enter.

Development with **only** Vite (`npm run dev` on `:5173`) does not expose the dev server on the LAN unless you set **`KORD_LISTEN_ON_LAN=1`** (see `vite.config.ts`). The backend on **`3001`** is what remote devices use once it is reachable (packaged server or `node server/index.mjs`).

On **Linux**, Chromium may warn about **sandbox**; **`ELECTRON_DISABLE_SANDBOX=1`** is an escape hatch where your distro restricts user namespaces ([Electron / sandbox notes](https://www.electronjs.org/docs/latest/tutorial/sandbox-option)).

---

## Builds and installers

### Release 1.7

Produce a fresh UI bundle:

```bash
npm run build
```

### Full desktop app (one OS at a time)

- `npm run pack` — installers for **the OS you run the command on** (output under `release/`).
- **`npm run pack:linux`**, **`npm run pack:win`**, **`npm run pack:mac`** — shortcut per platform.

**Windows installers** (NSIS / integrity steps) are **reliable when built on Windows** (or a Windows CI agent). Building Windows targets from **Linux** typically requires **[Wine](https://www.electron.build/multi-platform-build)** for parts of electron-builder.

### Kord Server / Kord Client (versioned artifacts)

Use **`pack:<os>:server`** / **`pack:<os>:client`** (`linux`, `win`, **or** `mac`). These scripts use **`electron-builder.kord.cjs`**, optionally pass a semver as the **last argument** (e.g. `npm run pack:linux:server -- 1.7.0`; see **`scripts/pack-release.mjs`**).

**Server** flavor runs `npm run build`, then **`scripts/fetch-ytdlp.mjs`** for the **target OS**, then packages. Prefer this when shipping Studio downloads with a bundled **yt-dlp**.

**Client** is a slim shell (no **`server/`** in the app bundle) — point it at `http://<server-host>:<port>` on first connect.

Artifacts use names like **`Kord-Server-<version>-<os>-<arch>.*`** / **`Kord-Client-...`**.

### Quality checks before tagging

```bash
npm test
npm run lint
```

`lint` may report **warnings** (non-fatal). **Errors** should be fixed for strict CI. `build` does not run `lint` automatically.

---

## For developers and contributors

### Project layout (high level)

| Area | Role |
| --- | --- |
| `src/` | React + Vite frontend, routing, player, settings, i18n |
| `server/` | Express API, library index, filesystem helpers, state under `MUSIC_ROOT/.kord/` |
| `electron/` | Main process, **Kord Client** connect flow (`connect.html`) |

### Common scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Vite + API (browser dev) |
| `npm run dev:app` | Full Electron + dev server |
| `npm run build` | Production `dist/` + TypeScript project references |
| `npm run lint` | ESLint |
| `npm test` | Vitest suite |
| `npm run pack` / `pack:*` | Electron installers (see [Builds and installers](#builds-and-installers)) |
| `npm run pack:*:server` / `pack:*:client` | Kord Server / Kord Client builds |

### User persistence (technical)

- Server user state: **`MUSIC_ROOT/.kord/user-state.v1.json`**. Legacy **`MUSIC_ROOT/.wpp/`** is read if present; new writes use **`.kord/`**.
- Per-album / per-track JSON: `kord-albuminfo.json`, `kord-trackinfo.json` (with legacy `wpp-*` read support).
- First browser launch can import legacy keys from `localStorage` (`kord-*` / `wpp-*`).

### API (main routes)

- `GET /api/library` · `GET /api/library-index` · `GET /api/dashboard`
- `GET /api/user-state` · `PUT /api/user-state`
- `GET /api/download-preset` · `POST /api/download`
- `GET /api/fs/list` · `POST /api/fs/mkdir`
- `GET /api/artwork/search` · `POST /api/artwork/apply`
- `POST /api/album-info/fetch` · `POST /api/track-info/fetch`

### Tests (what the suite covers)

- App rendering and navigation
- Legacy user-state import
- Server-side user-state persistence and sanitization
- Library indexing and quality checks

---

## Release 1.7 — notes for publishers

- **LAN / firewall:** default bind is **all interfaces**; restrict with **`KORD_LISTEN_HOST=127.0.0.1`** if the machine must not accept remote connections on the API port.
- **`pack:*:server`** is the intended path for a **standalone Studio** with bundled **yt-dlp** (remove binaries for other platforms from `server/bin/` before packing if you want a smaller installer).
- **Cross-compile:** prefer **building each OS on that OS** (or documented CI matrix) rather than relying on Wine for Windows from Linux unless you maintain that workflow.
