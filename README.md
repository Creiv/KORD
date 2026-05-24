# Kord 3.2

**Your local music hub.** One interface to listen, organize, enrich your library, and play with the music — on your disk, on your network, under your control.

*Exact semver in `package.json` · UI in English and Italian*

---

## Why Kord

Kord is not a cloud service: it is **home for your audio**. It indexes the folder you choose, keeps queue, playlists, favorites, and stats per profile, and gives you studio-grade tools built in. Open the player, turn on the visualizer, launch **Plectr** on the track that is playing, or let **DiscoWall** turn the chart into light and color.

Built for **legal libraries** (rights-free music, your own productions, podcasts, material you are allowed to use). You decide what to import; Kord helps you manage it.

---

## Everything Kord does

### Command center

| Area | What you get |
| --- | --- |
| **Dashboard** | Artists / albums / tracks overview, highlighted favorites, recently updated albums, **instant mix** by genre and mood, resume listening session, library quality alerts (covers, metadata, loose-track folders). |
| **Library** | Browse by **artists, genres, and moods**; quick search (`Ctrl+K`); sort modes; album and track sheets; edit titles, tags, **LRC** or plain lyrics; **smart shuffle** exclusions (single track, whole album, genre). |
| **Studio** | One workspace with tabs: listen, catalog discovery, download, metadata, artwork. |
| **Queue · Playlists · Favorites · Recent** | Full session management: reorder, repeat, save sets, jump back in time. |
| **Statistics** | Top tracks, artists, albums, and genres; filters for plays, favorites, and shuffle blocks. |
| **Achievements** | XP progression, levels, daily streak, dozens of badges (plays, favorites, playlists, library, Plectr…). |
| **Settings** | Library root, local accounts, theme and visualizer, LAN / Cloudflare, backup, activity log, YouTube cookies for downloads. |

### Listening and player

- **Persistent player** with queue, shuffle, repeat (off / all / one), volume, session restore on launch.
- **Listen** (in Studio): now playing, up-next queue, shuffle across the library, recent history, **lyrics** panel (synced LRC or plain text).
- **Crossfade** (off, 3 s, 5 s) between tracks and softer UI transitions when artwork changes.
- **Visualizer** modes: bars, mirror, wave, smooth wave, H·M·B waves, signals, karaoke — driven by live audio analysis.
- **Google Cast** (Remote Playback) where the browser supports it.
- **Mobile dock**: compact controls, swipe between tracks, quick access to Plectr and sections.

### Studio — your post-production room

- **Listen** — guided listening experience inside the studio flow.
- **Discover** — **local** catalog (per-account artist/album selection) and **web** suggestions (preview and download into the library).
- **Download** — `yt-dlp` bundled in Server packs; single, playlist/album, artist discography; classic and **explore** UI; folders under *Music*; progress and cancel; native AAC/Opus (m4a/webm) without ffmpeg in Kord; optional YouTube cookies.
- **Metadata** — album and track enrichment (MusicBrainz / iTunes and Kord pipeline), bulk scan, heuristic **title cleanup**, prune orphan track metadata.
- **Covers** — artwork search and apply to album folders.

### Plectr and DiscoWall

- **Plectr** — rhythm game on charts generated from audio: track analysis, **easy / normal / hard**, tap / hold / swipe, score, combo, accuracy, **per-track records** (session + account), **live sync** with the player (no separate countdown — follow the song you are already playing).
- **DiscoWall** — grid wall visual that reacts to the Plectr chart, song time, and audio energy: motifs, colors, and bursts on notes.

### Personalization and profiles

- **Themes** — preset palettes (light/dark, Prism Engine, custom colors).
- **Languages** — **English** or **Italian** UI.
- **Local accounts** — multiple profiles on one machine, each with state (favorites, playlists, stats, Plectr records, shuffle exclusions) under `.kord/` in the library.
- **Backup and restore** — ZIP of settings and state; browsable server activity log.

### Network and distribution

- **Node server + React UI** — API and interface from one install; filesystem index of the *music root*.
- **LAN** — listens on all interfaces by default: other devices open `http://<IP>:<port>` (firewall permitting).
- **External access** — **Cloudflare** tunnel from Settings (quick trycloudflare URL or stable named tunnel).
- **Electron** — full desktop app; **Kord Server** (server + yt-dlp per target OS); **Kord Client** (UI only, points at an existing server).

---

## Disclaimer

Kord and its creators **are not responsible** for what users download, import, or manage. Each user is **solely responsible** for copyright and local law compliance. Use only content you have rights or permission to use.

---

## Technical (brief)

### Requirements

- Recent **Node.js** (development and from-source use).
- A folder of audio files.
- **yt-dlp** optional in dev (`PATH` or `YTDLP_PATH`); included in **`pack:*:server`** builds per target OS.

### Quick start

```bash
npm install
npm run dev          # browser: Vite :5173 + API :3001
npm run dev:app      # Electron + server in userData
```

Library root: `MUSIC_ROOT` or Settings. Server config dir: `KORD_USER_CONFIG_DIR` (legacy: `WPP_USER_CONFIG_DIR`).

| Variable | Effect |
| --- | --- |
| `KORD_LISTEN_HOST=127.0.0.1` | Loopback only (no LAN) |
| `KORD_PORT` / `PORT` | HTTP port |
| `KORD_YTDLP_COOKIES` | Netscape cookies file for downloads |
| `KORD_LISTEN_ON_LAN=1` | Expose Vite dev server on LAN |

### Build and release 3.2

```bash
npm run build
npm test && npm run lint
npm run pack              # installer for current OS → release/
npm run pack:linux:server -- 3.2.0   # versioned Kord Server
npm run pack:linux:client -- 3.2.0   # remote client
```

Windows: prefer building on Windows. Linux Electron: `ELECTRON_DISABLE_SANDBOX=1` if needed.

### Repo (at a glance)

| Path | Role |
| --- | --- |
| `src/` | React, player, routing, i18n, Plectr game |
| `server/` | Express, library index, downloads, state in `MUSIC_ROOT/.kord/` |
| `electron/` | Main process, Kord Client connect flow |

**Scripts:** `dev` · `dev:app` · `build` · `test` · `lint` · `pack` / `pack:linux|win|mac` · `pack:*:server|client`

**Main API:** `/api/library` · `/api/library-index` · `/api/dashboard` · `/api/user-state` · `/api/download` · `/api/artwork/*` · `/api/album-info/*` · `/api/track-info/*` · `/api/fs/*`

**Publishers:** default LAN bind — restrict with `KORD_LISTEN_HOST` when remote access is not wanted; `pack:*:server` for Studio with bundled yt-dlp; build on the target OS when possible.

---

*Kord 3.2 by Creiv — local music, serious tools, play on the beat.*
