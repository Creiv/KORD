# KORD

Hub locale per ascolto, archivio e manutenzione di una libreria musicale personale.

## Cosa include

- shell professionale con dashboard, Ascolta, Libreria, Studio, Coda, Playlist, Preferiti, Recenti e Impostazioni
- routing client-side con deep link su viste libreria e playlist
- player con resume sessione, coda persistente, preferiti, recenti e visualizer
- backend Express con indice libreria normalizzato, dashboard e user state in `MUSIC_ROOT/.kord/user-state.v1.json` (se presente ancora un backup da versioni precedenti, viene letto da `MUSIC_ROOT/.wpp/`)
- strumenti operativi per download, artwork e metadata enrichment
- suite test con `Vitest` + `React Testing Library` su frontend e helper backend

## Requisiti

- Node.js recente
- una cartella musica locale disponibile
- opzionale: `yt-dlp` per il modulo download

## App desktop (Electron)

- **Sviluppo (finestra + Vite + server)**: `npm run dev:app` (Vite su 5173, server integrato in Electron; config musica sotto la cartella dati utente dell’app).
- **Pacchetto installabile** (dopo `npm run build`):
  - `npm run pack` — genera l’artefatto per l’**OS su cui lanci** (es. su Linux: AppImage in `release/`).
  - `npm run pack:linux` / `pack:win` / `pack:mac` — forza un target; **Windows e macOS** in genere vanno generati su quell’OS (o in CI) perché i toolchain non sono sempre disponibili altrove.
- Gli eseguibili risultano in **`release/`** (nome con versione, es. `kord-0.0.0-linux-x64.AppImage`).

Su Linux, se l’esecuzione segnala problemi con la **sandbox** Chromium, avviare con `ELECTRON_DISABLE_SANDBOX=1` o seguire le note sul permesso di `chrome-sandbox` nella build non installata (AppImage/`.deb` di solito non lo richiedono).

## Avvio (browser)

```bash
npm install
npm run dev
```

Per default il backend usa:

```bash
MUSIC_ROOT=Da impostazioni
PORT=3001
```

Puoi sovrascriverli via variabili d’ambiente. L’app desktop usa inoltre `KORD_USER_CONFIG_DIR` (nel codice del server, con retrocompatibilità su `WPP_USER_CONFIG_DIR` per build vecchie).

## Script

```bash
npm run dev
npm run build
npm run lint
npm test
```

## Persistenza utente

Lo stato utente lato server è in:

```txt
MUSIC_ROOT/.kord/user-state.v1.json
```

Le installazioni che avevano ancora solo `MUSIC_ROOT/.wpp/` vengono lette automaticamente; le nuove scritture usano `.kord/`. Metadati album/brano su disco: `kord-albuminfo.json` e `kord-trackinfo.json` (con supporto in lettura ai file `wpp-*` legacy).

Alla prima apertura, l’app importa automaticamente i dati legacy in `localStorage` (chiavi `kord-*`, con lettura opzionale delle vecchie `wpp-*`).

## API principali

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

## Test

La suite copre:

- rendering e navigazione dell’app
- import legacy dello user state
- persistenza/sanificazione dello user state server
- indicizzazione libreria e alert qualità
