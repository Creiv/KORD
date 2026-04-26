# Kord

**Kord** is a local music hub: browse your library, play tracks with a persistent queue, manage playlists, and keep metadata organized. This repository provides a full-stack web app, an **Electron** desktop shell, and separate **packaged** builds for a **headless server** and a **lightweight client** for remote use on the same network.

- **End users** can follow [What you get](#what-you-get) and [How to run](#how-to-run) (server, client, or browser).
- **Developers and contributors** can use [Project layout](#project-layout), [Build & packaging](#build--packaging), [Configuration](#configuration), and [API](#api).

## What you get

- **Dashboard, Listen, Library, Studio, Queue, Playlists, Favorites, Recent, Settings** — a single shell with client-side routing and deep links.
- **Player** with session restore, queue, favorites, recent tracks, and a visualizer.
- **Server** (Node / Express) that indexes your music folder, serves the UI and API, and stores per-user state on disk.
- **Tools** for downloads (optional `yt-dlp`; uses **native m4a/webm** audio without bundling `ffmpeg` — the library also indexes **mp3, flac, ogg, opus**, etc.), cover search, and metadata enrichment.
- **i18n**: UI defaults to **English**; **Italian** is available in Settings. Strings are in `src/i18n/en.ts` and `src/i18n/it.ts`.
- **Tests** (Vitest + React Testing Library) for UI, server helpers, and library logic.

## Requirements

- A recent **Node.js** (for development and from-source use).
- A folder of audio files.
- Optional: **`yt-dlp`** for the download feature (in development, install it on your `PATH`, or set `YTDLP_PATH`). **Packaged Kord Server** runs `scripts/fetch-ytdlp.mjs` during `pack:*:server` and ships the official binary under `server/bin/` for that OS, so **Studio download** works without a separate install. Override with `YTDLP_PATH` or `KORD_YTDLP_LINUX_ASSET` (see `scripts/fetch-ytdlp.mjs`). Downloads use **native AAC/Opus** (m4a/webm) by default so **ffmpeg is not required**; set **`KORD_YTDLP_LOSSLESS=1`** to force FLAC extraction (needs **ffmpeg** on the server).

## How to run

### Run in the browser (development)

```bash
npm install
npm run dev
```

The backend uses `MUSIC_ROOT` (or the path set in the app) and defaults to `PORT=3001`. You can override with environment variables. For older installs, `WPP_USER_CONFIG_DIR` is still read; the app also recognizes `KORD_USER_CONFIG_DIR`.

### Full desktop app (Electron, development)

```bash
npm run dev:app
```

Vite and the server run inside Electron; the music root is set from app data.

The **packaged** Kord Server app (Linux and Windows) saves the HTTP port in **`kord-electron-port.json`** next to your other config (in the Electron **userData** folder). The first successful start uses **3001**, or the next free port if that one is taken; later launches reuse the same port. Set **`KORD_PORT`** or **`PORT`** in the environment to force a port and skip this file.

### LAN access (any mode)

In **Settings → Network** (only in the **Kord Server** app, not in the **Kord Client**), you can bind the server to all interfaces (`0.0.0.0`) so other devices on the same LAN can use Kord. The setting is stored with your music folder config; **restart** after changing it. The exact path of `music-root.config.json` is defined in the server’s `musicRootConfig.mjs`. The URL shown for LAN access picks a sensible IPv4 from your machine’s network interfaces; on **Windows** you may also need to allow the app in **Windows Defender Firewall** for incoming traffic on the server port, especially after the first run.

On **Linux**, packaged Electron may log Chromium **sandbox** warnings; you can set `ELECTRON_DISABLE_SANDBOX=1` for non-root runs or follow Chrome’s sandbox notes for your distro.

## Packaged server and client (release)

After a production build:

```bash
npm run build
```

- **Platform-specific** full app (e.g. AppImage on Linux) — same as before:
  - `npm run pack` (current OS), or `npm run pack:linux` / `pack:win` / `pack:mac`.
- **Kord Server** and **Kord Client** (versioned names in `release/`):
  - Linux: `npm run pack:linux:server` / `npm run pack:linux:client`
  - Windows: `npm run pack:win:server` / `npm run pack:win:client`
  - macOS: `npm run pack:mac:server` / `npm run pack:mac:client`

You can pass a version as the last argument, e.g. `npm run pack:linux:server -- 2.0.0` (see `scripts/pack-release.mjs`).

- **Kord Server** — headless service for your music library; configure host/port and music root as documented for the server.
- **Kord Client** — on first run, enter the server’s **IP:port** and pick an **account**; the window then opens the remote UI. The flow is a minimal, centered connect screen in `electron/connect.html` (no long onboarding copy).

---

## For developers and contributors

### Project layout (high level)

- **`src/`** — React + Vite frontend, routing, player, settings, i18n.
- **Server** — Express API, library index, file operations, state paths under `MUSIC_ROOT/.kord/` (see below).
- **`electron/`** — Electron main process, preload, and `connect.html` for the **Client** build.

### Common scripts

| Script                                    | Purpose                                                                                                     |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `npm run dev`                             | Vite + API (browser dev)                                                                                    |
| `npm run dev:app`                         | Full Electron dev                                                                                           |
| `npm run build`                           | Production web + main bundle for Electron                                                                   |
| `npm run lint`                            | Lint                                                                                                        |
| `npm test`                                | Test suite                                                                                                  |
| `npm run pack` / `pack:*`                 | Full Electron installers per platform                                                                       |
| `npm run pack:*:server` / `pack:*:client` | Kord Server / Kord Client artifacts (see [Packaged server and client](#packaged-server-and-client-release)) |

### User persistence (technical)

- Server user state: **`MUSIC_ROOT/.kord/user-state.v1.json`**. Legacy **`MUSIC_ROOT/.wpp/`** is read if present; new writes go under **`.kord/`**.
- Per-album / per-track JSON on disk: `kord-albuminfo.json`, `kord-trackinfo.json` (with legacy `wpp-*` read support).
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
