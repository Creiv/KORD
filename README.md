# KORD

Local hub for listening to, organizing, and maintaining a personal music library.

## Interface language

The UI defaults to **English**. In **Settings** you can choose **Italian**; strings live in `src/i18n/en.ts` and `src/i18n/it.ts` so more languages can be added later.

## What it includes

- Shell with Dashboard, Listen, Library, Studio, Queue, Playlists, Favorites, Recent, and Settings
- Client-side routing with deep links into library and playlist views
- Player with session restore, persistent queue, favorites, recent tracks, and audio visualizer
- Express backend with a normalized library index, dashboard, and user state in `MUSIC_ROOT/.kord/user-state.v1.json` (if an older backup exists, it is read from `MUSIC_ROOT/.wpp/`)
- Operational tools for downloads, cover search, and metadata enrichment
- Test suite with Vitest and React Testing Library on the frontend and backend helpers

## Requirements

- A recent Node.js version
- A local music folder
- Optional: `yt-dlp` for the download module

## Desktop app (Electron)

- **Development (window + Vite + server)**: `npm run dev:app` (Vite on 5173, server embedded in Electron; music folder is configured in the app user data).
- **Installable package** (after `npm run build`):
  - `npm run pack` — builds for the **OS you run the command on** (e.g. on Linux: AppImage in `release/`).
  - `npm run pack:linux` / `pack:win` / `pack:mac` — force a target; **Windows and macOS** builds are usually produced on that OS (or in CI) because toolchains are not always available elsewhere.
- Binaries end up in **`release/`** (name includes version, e.g. `kord-0.0.0-linux-x64.AppImage`).

On Linux, if Chromium **sandbox** warnings appear, run with `ELECTRON_DISABLE_SANDBOX=1` or follow `chrome-sandbox` permission notes for non-installed builds (AppImage / `.deb` often do not require this).

## Run in the browser

```bash
npm install
npm run dev
```

By default the backend uses:

```bash
MUSIC_ROOT=<set in app settings>
PORT=3001
```

Override with environment variables. The desktop app also uses `KORD_USER_CONFIG_DIR` (with backward compatibility for `WPP_USER_CONFIG_DIR` on older builds).

### LAN access

In **Settings → Network** you can bind the API (and, in development, Vite) to all interfaces (`0.0.0.0`) so other devices on the same LAN can open the app. The flag is stored in `music-root.config.json` together with the music folder path (see server `musicRootConfig.mjs` for where that file lives). **Restart KORD** after changing it so processes pick up the new listen address.

## Scripts

```bash
npm run dev
npm run build
npm run lint
npm test
```

## User persistence

Server-side user state is stored at:

```txt
MUSIC_ROOT/.kord/user-state.v1.json
```

Installations that only had `MUSIC_ROOT/.wpp/` are still read automatically; new writes use `.kord/`. On-disk album and track metadata: `kord-albuminfo.json` and `kord-trackinfo.json` (legacy `wpp-*` files are still read).

On first launch, the app imports legacy data from `localStorage` (`kord-*` keys, with optional reads of old `wpp-*` keys).

## Main API routes

- `GET /api/library`
- `GET /api/library-index`
- `GET /api/dashboard`
- `GET /api/user-state`
- `PUT /api/user-state`
- `GET /api/download-preset`
- `POST /api/download`
- `GET /api/fs/list`
- `POST /api/fs/mkdir`
- `GET /api/artwork/search`
- `POST /api/artwork/apply`
- `POST /api/album-info/fetch`
- `POST /api/track-info/fetch`

## Tests

The suite covers:

- App rendering and navigation
- Legacy user-state import
- Server-side user-state persistence and sanitization
- Library indexing and quality alerts
