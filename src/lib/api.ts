import type {
  DashboardPayload,
  LibraryCatalogResponse,
  LibraryIndex,
  LibraryResponse,
  LibrarySelectionV1,
  UserStateV1,
} from "../types"

type Wrapped<T> = { ok: boolean; data: T; error: string | null }
const SESSION_ACCOUNT_STORAGE_KEY = "kord-session-account-id"
const LEGACY_ACTIVE_ACCOUNT_STORAGE_KEY = "kord-active-account-id"
let accountBootstrapPromise: Promise<string | null> | null = null

async function unwrap<T>(response: Response): Promise<T> {
  const json = (await response.json()) as T | Wrapped<T> | { error?: string }
  if (!response.ok) {
    if (json && typeof json === "object" && "error" in json && typeof json.error === "string") {
      throw new Error(json.error)
    }
    throw new Error("Request failed")
  }
  if (json && typeof json === "object" && "ok" in json && "data" in json) {
    const wrapped = json as Wrapped<T>
    if (!wrapped.ok) throw new Error(wrapped.error || "Request failed")
    return wrapped.data
  }
  return json as T
}

export function getSelectedAccountId(): string | null {
  try {
    return (
      localStorage.getItem(SESSION_ACCOUNT_STORAGE_KEY) ||
      localStorage.getItem(LEGACY_ACTIVE_ACCOUNT_STORAGE_KEY) ||
      null
    )
  } catch {
    return null
  }
}

export function setSelectedAccountId(id: string) {
  try {
    localStorage.setItem(SESSION_ACCOUNT_STORAGE_KEY, id)
    localStorage.removeItem(LEGACY_ACTIVE_ACCOUNT_STORAGE_KEY)
    accountBootstrapPromise = Promise.resolve(id)
    window.dispatchEvent(new CustomEvent("kord-account-session-changed"))
  } catch {
    /* ignore */
  }
}

function rememberAvailableAccount(data: AccountsResponse | AppConfig) {
  try {
    const current = getSelectedAccountId()
    if ("accounts" in data && current) {
      if (data.accounts.some((account) => account.id === current)) return
      const fallback = data.defaultAccountId || data.accounts[0]?.id
      if (fallback) setSelectedAccountId(fallback)
      return
    }
    if (current) return
    const id = "accounts" in data
      ? data.defaultAccountId || data.accounts[0]?.id
      : data.defaultAccountId
    if (id) setSelectedAccountId(id)
  } catch {
    /* ignore */
  }
}

function pathnameOnly(full: string) {
  return full.split(/[?#]/)[0] ?? full
}

function accountParams(params: Record<string, string> = {}) {
  const out = new URLSearchParams(params)
  return out
}

function accountHeaders(base: HeadersInit = {}) {
  const id = getSelectedAccountId()
  return id ? { ...base, "X-KORD-Account-Id": id } : base
}

function accountHeadersForPath(endpointPath: string, base: HeadersInit = {}) {
  if (pathnameOnly(endpointPath) === "/api/accounts") return base
  return accountHeaders(base)
}

function apiUrl(path: string, params: Record<string, string> = {}) {
  const out = accountParams(params)
  const pname = pathnameOnly(path)
  if (pname !== "/api/accounts") {
    const id = getSelectedAccountId()
    if (id) out.set("accountId", id)
  }
  const query = out.toString()
  return query ? `${path}?${query}` : path
}

function apiFetch(
  pathname: string,
  init?: RequestInit,
  query: Record<string, string> = {},
): Promise<Response> {
  const url = apiUrl(pathname, query)
  const hdr = init?.headers
  const pathForHdr = pathnameOnly(pathname.split("?")[0] ?? pathname)
  const nextHeaders =
    hdr !== undefined
      ? accountHeadersForPath(pathForHdr, hdr as HeadersInit)
      : accountHeadersForPath(pathForHdr)
  return fetch(url, {
    ...init,
    headers: nextHeaders,
  })
}

async function ensureSelectedAccountId(): Promise<string | null> {
  if (accountBootstrapPromise) return accountBootstrapPromise
  accountBootstrapPromise = apiFetch("/api/accounts", { cache: "no-store" })
    .then((response) => unwrap<AccountsResponse>(response))
    .then((data) => {
      rememberAvailableAccount(data)
      return getSelectedAccountId()
    })
    .catch(() => {
      accountBootstrapPromise = null
      return getSelectedAccountId()
    })
  return accountBootstrapPromise
}

export function mediaUrl(relPath: string) {
  const path = `/media/${relPath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")}`
  const id = getSelectedAccountId()
  return id ? `${path}?${new URLSearchParams({ accountId: id })}` : path
}

export function coverUrlForTrackRelPath(relPath: string) {
  return apiUrl("/api/cover", { path: relPath })
}

export function coverUrlForAlbumRelPath(relPath: string) {
  return apiUrl("/api/cover", { path: relPath })
}

export async function fetchLibrary(): Promise<LibraryResponse> {
  await ensureSelectedAccountId()
  const response = await apiFetch("/api/library")
  return unwrap<LibraryResponse>(response)
}

export async function fetchLibraryIndex(): Promise<LibraryIndex> {
  await ensureSelectedAccountId()
  const response = await apiFetch("/api/library-index", { cache: "no-store" })
  return unwrap<LibraryIndex>(response)
}

export async function fetchLibraryIndexForAccount(accountId: string): Promise<LibraryIndex> {
  const response = await apiFetch(
    `/api/accounts/${encodeURIComponent(accountId)}/library-index`,
    { cache: "no-store" },
  )
  return unwrap<LibraryIndex>(response)
}

export async function fetchLibraryCatalog(): Promise<LibraryCatalogResponse> {
  await ensureSelectedAccountId()
  const response = await apiFetch("/api/catalog", { cache: "no-store" })
  return unwrap<LibraryCatalogResponse>(response)
}

export async function fetchMyLibrarySelection(): Promise<LibrarySelectionV1> {
  await ensureSelectedAccountId()
  const response = await apiFetch("/api/my-library-selection", {
    cache: "no-store",
  })
  return unwrap<LibrarySelectionV1>(response)
}

export async function patchMyLibrarySelection(
  patch: Partial<{
    includeAll: boolean
    addArtists: string[]
    removeArtists: string[]
    addAlbums: string[]
    removeAlbums: string[]
    addTracks: string[]
    removeTracks: string[]
  }>,
): Promise<LibrarySelectionV1> {
  await ensureSelectedAccountId()
  const response = await apiFetch("/api/my-library-selection", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  })
  return unwrap<LibrarySelectionV1>(response)
}

export async function fetchDashboard(): Promise<DashboardPayload> {
  await ensureSelectedAccountId()
  const response = await apiFetch("/api/dashboard", { cache: "no-store" })
  return unwrap<DashboardPayload>(response)
}

export async function fetchUserState(): Promise<UserStateV1> {
  await ensureSelectedAccountId()
  const response = await apiFetch("/api/user-state")
  return unwrap<UserStateV1>(response)
}

export async function saveUserState(state: UserStateV1): Promise<UserStateV1> {
  await ensureSelectedAccountId()
  const response = await apiFetch("/api/user-state", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state }),
  })
  return unwrap<UserStateV1>(response)
}

export type AppConfig = {
  musicRoot?: string | null
  lockedByEnv: boolean
  libraryRootConfigured?: boolean
  serverPort: number
  devClientPort: number
  lanAccessUrl: string | null
  defaultAccountId?: string
}

export type Account = {
  id: string
  name: string
}

export type AccountsResponse = {
  defaultAccountId: string
  accounts: Account[]
  lockedByEnv: boolean
  createdAccountId?: string
}

export async function fetchConfig(): Promise<AppConfig> {
  const response = await apiFetch("/api/config")
  const data = await unwrap<AppConfig>(response)
  rememberAvailableAccount(data)
  return data
}

export async function saveAppConfig(
  patch: { musicRoot?: string }
): Promise<AppConfig> {
  const response = await apiFetch("/api/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  })
  return unwrap<AppConfig>(response)
}

export async function saveConfig(musicRoot: string): Promise<AppConfig> {
  return saveAppConfig({ musicRoot })
}

export async function fetchAccounts(): Promise<AccountsResponse> {
  const response = await apiFetch("/api/accounts", { cache: "no-store" })
  const data = await unwrap<AccountsResponse>(response)
  rememberAvailableAccount(data)
  return data
}

export async function createAccount(input: { name: string }): Promise<AccountsResponse> {
  const response = await apiFetch("/api/accounts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })
  const data = await unwrap<AccountsResponse>(response)
  if (data.createdAccountId) setSelectedAccountId(data.createdAccountId)
  return data
}

export async function updateAccount(
  id: string,
  patch: { name?: string },
): Promise<AccountsResponse> {
  const response = await apiFetch(`/api/accounts/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  })
  const data = await unwrap<AccountsResponse>(response)
  return data
}

export async function deleteAccount(id: string): Promise<AccountsResponse> {
  const response = await apiFetch(`/api/accounts/${encodeURIComponent(id)}`, {
    method: "DELETE",
  })
  const data = await unwrap<AccountsResponse>(response)
  const selected = getSelectedAccountId()
  if (selected === id) {
    setSelectedAccountId(data.accounts[0]?.id || data.defaultAccountId)
  }
  return data
}

export type ActivityLogEntry = {
  ts: string
  accountId: string
  kind: string
  action: string
  folder: string | null
  musicRoot?: string
  detail?: string | null
}

export async function fetchActivityLog(
  limit = 500,
): Promise<{ entries: ActivityLogEntry[] }> {
  const response = await apiFetch("/api/activity-log", {
    cache: "no-store",
  }, {
    limit: String(limit),
  })
  return unwrap<{ entries: ActivityLogEntry[] }>(response)
}

/** Scarica un ZIP: config, stato utente e metadati (json) per tutti gli account, senza audio. */
export async function downloadKordDataBackup(): Promise<string> {
  const response = await apiFetch("/api/backup/kord-data", {
    method: "GET",
    cache: "no-store",
  })
  if (!response.ok) {
    const text = await response.text()
    let msg = "Backup failed"
    try {
      const j = JSON.parse(text) as { error?: string }
      if (j?.error) msg = j.error
    } catch {
      if (text) msg = text
    }
    throw new Error(msg)
  }
  const cd = response.headers.get("Content-Disposition") || ""
  const m = /filename\*?=(?:UTF-8''|"?)([^";\n]+)/i.exec(cd)
  const name =
    (m?.[1] || "")
      .replace(/^["']|["']$/g, "")
      .trim() || "kord-backup.zip"
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = decodeURIComponent(name)
  a.rel = "noopener"
  a.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
  return name
}

export async function uploadKordDataRestore(
  file: File,
): Promise<{ restored: boolean; accountCount: number }> {
  const fd = new FormData()
  fd.append("file", file)
  const response = await apiFetch("/api/backup/kord-restore", {
    method: "POST",
    body: fd,
  })
  return unwrap<{ restored: boolean; accountCount: number }>(response)
}

export type PresetYtdlp = {
  found: boolean
  file: string | null
  text: string
  program: string
  args: string[]
  exampleUrl: string | null
}

export async function fetchDownloadPreset(): Promise<PresetYtdlp> {
  const response = await apiFetch("/api/download-preset")
  return unwrap<PresetYtdlp>(response)
}

export type YoutubeReleaseEntry = {
  id: string
  title: string
  url: string
  trackCount: number | null
}

export type YoutubeReleasesList = {
  listTitle: string
  uploader: string
  channelUrl: string
  entries: YoutubeReleaseEntry[]
}

export type YoutubeReleasesListMeta = {
  listTitle: string
  uploader: string
  channelUrl: string
  total: number
}

export async function fetchYoutubeReleasesList(
  url: string,
): Promise<YoutubeReleasesList> {
  const response = await apiFetch("/api/youtube-releases-list", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  })
  return unwrap<YoutubeReleasesList>(response)
}

/**
 * Stesso elenco coi conteggi, ma in streaming (NDJSON): meta → entry × N → done.
 */
export async function streamYoutubeReleasesList(
  url: string,
  cbs: {
    onMeta: (m: YoutubeReleasesListMeta) => void
    onEntry: (e: YoutubeReleaseEntry) => void
    onDone: () => void
  },
  signal?: AbortSignal,
): Promise<void> {
  const response = await apiFetch("/api/youtube-releases-list", {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, stream: true }),
  })
  if (!response.ok) {
    let msg = `Request failed (${response.status})`
    try {
      const j = (await response.json()) as { error?: string }
      if (j.error) msg = j.error
    } catch {
      /* ignore */
    }
    throw new Error(msg)
  }
  const reader = response.body?.getReader()
  if (!reader) throw new Error("Releases: response body not readable")
  const decoder = new TextDecoder()
  let buffer = ""
  let gotDone = false
  const handleLine = (t: string) => {
    if (!t.trim()) return
    let row: {
      type?: string
      listTitle?: string
      uploader?: string
      channelUrl?: string
      total?: number
      entry?: YoutubeReleaseEntry
      message?: string
    }
    try {
      row = JSON.parse(t) as typeof row
    } catch {
      throw new Error("Releases: invalid response line")
    }
    if (row.type === "meta") {
      cbs.onMeta({
        listTitle: String(row.listTitle ?? "").trim(),
        uploader: String(row.uploader ?? "").trim(),
        channelUrl: String(row.channelUrl ?? "").trim(),
        total: Math.max(0, Math.floor(Number(row.total) || 0)),
      })
      return
    }
    if (row.type === "entry" && row.entry) {
      cbs.onEntry(row.entry)
      return
    }
    if (row.type === "done") {
      gotDone = true
      cbs.onDone()
      return
    }
    if (row.type === "error") {
      throw new Error(
        String(row.message ?? "Releases stream error").trim() || "Releases error",
      )
    }
  }
  for (;;) {
    const { value, done } = await reader.read()
    if (value) {
      buffer += decoder.decode(value, { stream: true })
    }
    const parts = buffer.split("\n")
    buffer = parts.pop() ?? ""
    for (const line of parts) {
      handleLine(line)
    }
    if (done) {
      handleLine(buffer)
      break
    }
  }
  if (!gotDone) cbs.onDone()
}

export type DownloadRes = {
  ok: boolean
  stdout: string
  stderr: string
  code: number
  progress?: { current: number; total: number } | null
  musicRoot: string
  command: string
  error?: string
  cancelled?: boolean
  /** true se yt-dlp ha prodotto output più lungo del contenuto incluso nei campi sopra */
  logTruncated?: boolean
  stdoutTotalChars?: number
  stderrTotalChars?: number
}

function downloadResFromDoneMsg(msg: Record<string, unknown>): DownloadRes {
  return {
    ok: Boolean(msg.ok),
    stdout: String(msg.stdout ?? ""),
    stderr: String(msg.stderr ?? ""),
    code: Number(msg.code ?? -1),
    progress: (msg.progress as DownloadRes["progress"]) ?? null,
    musicRoot: String(msg.musicRoot ?? ""),
    command: String(msg.command ?? ""),
    ...(msg.cancelled === true ? { cancelled: true } : {}),
    ...(msg.error != null && msg.error !== ""
      ? { error: String(msg.error) }
      : {}),
    ...(msg.logTruncated === true ? { logTruncated: true as const } : {}),
    ...(typeof msg.stdoutTotalChars === "number"
      ? { stdoutTotalChars: Math.floor(Number(msg.stdoutTotalChars)) }
      : {}),
    ...(typeof msg.stderrTotalChars === "number"
      ? { stderrTotalChars: Math.floor(Number(msg.stderrTotalChars)) }
      : {}),
  }
}

export type StudioDownloadKind =
  | "download_single"
  | "download_playlist"
  | "download_releases"
  | "download_ytmusic"
  | "download_unknown"

export type RunYtdlpDownloadOpts = {
  signal?: AbortSignal
  /** UUID v4 — obbligatorio per poter fermare il download da /api/download-cancel */
  downloadId: string
  /** Classificazione per il registro attività (Impostazioni) */
  downloadKind?: StudioDownloadKind
}

export async function cancelStudioDownload(downloadId: string): Promise<void> {
  try {
    const response = await apiFetch("/api/download-cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ downloadId }),
    })
    if (response.ok) await unwrap(response)
  } catch {
    /* richiesta best-effort */
  }
}

export async function fetchDownloadFlatCount(url: string): Promise<number> {
  const response = await apiFetch("/api/download-flat-count", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  })
  const data = await unwrap<{ count: number }>(response)
  const n = data.count
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) {
    throw new Error("Invalid count from server")
  }
  return Math.floor(n)
}

/** UUID v4 per /api/download: su http://IP:porta randomUUID() può lanciare (contesto non sicuro). */
export function newStudioDownloadId(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === "function") {
    try {
      return c.randomUUID()
    } catch {
      /* SecurityError fuori da localhost/https */
    }
  }
  if (!c || typeof c.getRandomValues !== "function") {
    throw new Error("Impossibile generare downloadId (crypto assente)")
  }
  const buf = new Uint8Array(16)
  c.getRandomValues(buf)
  buf[6] = (buf[6]! & 0x0f) | 0x40
  buf[8] = (buf[8]! & 0x3f) | 0x80
  const h = Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("")
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
}

export async function runYtdlpDownload(
  url: string,
  outputDir?: string,
  onProgress?: (p: { current: number; total: number }) => void,
  opts?: RunYtdlpDownloadOpts,
): Promise<DownloadRes> {
  const downloadId = opts?.downloadId?.trim() ?? ""
  if (!downloadId) {
    throw new Error("runYtdlpDownload: downloadId required")
  }
  const response = await apiFetch("/api/download", {
    method: "POST",
    signal: opts?.signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url,
      downloadId,
      downloadKind: opts?.downloadKind ?? "download_unknown",
      ...(outputDir != null && outputDir !== "" ? { outputDir } : {}),
    }),
  })
  const ct = response.headers.get("content-type") || ""
  if (!response.ok) {
    let msg = `Download error (${response.status})`
    try {
      const errBody = (await response.json()) as { error?: string }
      if (errBody.error) msg = errBody.error
    } catch {
      /* ignore */
    }
    throw new Error(msg)
  }
  if (ct.includes("application/json")) {
    return (await response.json()) as DownloadRes
  }
  const reader = response.body?.getReader()
  if (!reader) throw new Error("Download: unreadable body")
  const decoder = new TextDecoder()
  let buffer = ""
  let final: DownloadRes | null = null
  const handleLine = (line: string) => {
    const t = line.trim()
    if (!t) return
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(t) as Record<string, unknown>
    } catch {
      return
    }
    const ty = msg.type
    if (ty === "keepalive" || ty === "started") return
    if (msg.type === "progress" && onProgress) {
      const pr = msg.progress as { current?: number; total?: number } | undefined
      if (
        pr &&
        typeof pr.current === "number" &&
        typeof pr.total === "number"
      ) {
        onProgress({ current: pr.current, total: pr.total })
      }
    }
    if (msg.type === "done") {
      const pr = msg.progress as { current?: number; total?: number } | undefined
      if (
        onProgress &&
        pr &&
        typeof pr.current === "number" &&
        typeof pr.total === "number"
      ) {
        onProgress({ current: pr.current, total: pr.total })
      }
      final = downloadResFromDoneMsg(msg)
    }
  }
  for (;;) {
    const { done, value } = await reader.read()
    if (value) buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split("\n")
    buffer = lines.pop() ?? ""
    for (const line of lines) handleLine(line)
    if (done) {
      buffer += decoder.decode()
      const rest = buffer.split("\n")
      for (const line of rest) handleLine(line)
      break
    }
  }
  if (!final) throw new Error("Download: incomplete response")
  return final
}

export type FsList = {
  path: string
  parent: string
  dirs: { name: string; relPath: string }[]
  musicRoot: string
}

export async function listMusicDirs(path: string): Promise<FsList> {
  const response = await apiFetch("/api/fs/list", {}, { path: path || "" })
  return unwrap<FsList>(response)
}

export async function clearDownloadDestAudioFiles(
  relPath: string,
): Promise<{ deleted: string[] }> {
  const response = await apiFetch("/api/fs/clear-dl-dest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: relPath }),
  })
  return unwrap<{ deleted: string[] }>(response)
}

export async function deleteAudioRelPaths(
  relPaths: string[],
): Promise<{ deleted: string[] }> {
  const response = await apiFetch("/api/fs/delete-audio-relpaths", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ relPaths }),
  })
  return unwrap<{ deleted: string[] }>(response)
}

export async function deleteAlbumFolder(
  albumPath: string,
): Promise<{ deleted: string[]; deletedFolder: string }> {
  const response = await apiFetch("/api/fs/delete-album-folder", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ albumPath }),
  })
  return unwrap<{ deleted: string[]; deletedFolder: string }>(response)
}

export type ArtworkHit = {
  name: string
  artist: string
  artwork: string
  url: string
  source?: string
}

export async function searchArtwork(
  opts: { q?: string; artist?: string; album?: string } | string,
): Promise<ArtworkHit[]> {
  const flat: Record<string, string> = {}
  if (typeof opts === "string") {
    flat.q = opts
  } else {
    if (opts.q) flat.q = opts.q
    if (opts.artist) flat.artist = opts.artist
    if (opts.album) flat.album = opts.album
  }
  if (!Object.keys(flat).length) return []
  const response = await apiFetch("/api/artwork/search", {}, flat)
  const data = await unwrap<{ results: ArtworkHit[] }>(response)
  return data.results || []
}

export async function applyArtwork(
  albumPath: string,
  imageUrl: string,
): Promise<void> {
  const response = await apiFetch("/api/artwork/apply", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ albumPath, imageUrl }),
  })
  await unwrap<{ saved: string }>(response)
}

export async function createMusicSubdir(
  parent: string,
  name: string,
): Promise<{ relPath: string }> {
  const response = await apiFetch("/api/fs/mkdir", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ parent, name }),
  })
  const json = (await response.json()) as { error?: string; relPath?: string }
  if (!response.ok) throw new Error(json.error || "Failed to create folder")
  return { relPath: json.relPath || "" }
}

export type FetchedAlbumMeta = {
  ok: boolean
  title?: string | null
  musicbrainzReleaseId?: string
  date: string | null
  country: string | null
  label: string | null
  fetchedAt?: string
  expectedTrackCount?: number
  expectedTracks?: { disc?: number; position?: number | null; title: string }[]
}

export type AlbumMetaSavePatch = {
  title?: string | null
  releaseDate?: string | null
  label?: string | null
  country?: string | null
  musicbrainzReleaseId?: string | null
}

export type FetchedTrackMeta = {
  ok: boolean
  title?: string
  releaseDate: string | null
  genre: string | null
  durationMs: number | null
  trackNumber: number | null
  discNumber: number | null
  source: string | null
  url: string | null
  fetchedAt?: string
}

export async function fetchAlbumInfo(
  albumPath: string,
  artist: string,
  album: string,
): Promise<{ ok: true; albumPath: string; meta: FetchedAlbumMeta }> {
  const response = await apiFetch("/api/album-info/fetch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ albumPath, artist, album }),
  })
  const json = (await response.json()) as
    | { ok: true; albumPath: string; meta: FetchedAlbumMeta }
    | { error?: string }
  if (!response.ok)
    throw new Error(
      "error" in json ? json.error || "Failed to fetch album metadata" : "Failed to fetch album metadata",
    )
  return json as { ok: true; albumPath: string; meta: FetchedAlbumMeta }
}

export async function saveAlbumInfoManual(
  albumPath: string,
  patch: AlbumMetaSavePatch,
): Promise<{ albumPath: string; meta: Record<string, unknown> }> {
  const response = await apiFetch("/api/album-info/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ albumPath, patch }),
  })
  const data = await unwrap<{ albumPath: string; meta: Record<string, unknown> }>(
    response,
  )
  return data
}

export async function fetchTrackInfo(
  relPath: string,
): Promise<{ ok: true; relPath: string; meta: FetchedTrackMeta }> {
  const response = await apiFetch("/api/track-info/fetch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ relPath }),
  })
  const json = (await response.json()) as
    | { ok: true; relPath: string; meta: FetchedTrackMeta }
    | { error?: string }
  if (!response.ok)
    throw new Error(
      "error" in json
        ? json.error || "Failed to fetch track metadata"
        : "Failed to fetch track metadata",
    )
  return json as { ok: true; relPath: string; meta: FetchedTrackMeta }
}

export type TrackMetaSavePatch = {
  title?: string | null;
  releaseDate?: string | null;
  genre?: string | null;
  /** fino a 3 id canonici; `null` o `[]` azzera. */
  moods?: string[] | null;
  /** compat salvataggi vecchi */
  mood?: string | null;
  durationMs?: number | null;
  trackNumber?: number | null;
  discNumber?: number | null;
  source?: string | null;
  url?: string | null;
};

export async function saveTrackInfoManual(
  relPath: string,
  patch: TrackMetaSavePatch,
): Promise<{ ok: true; relPath: string; meta: Record<string, unknown> }> {
  const response = await apiFetch("/api/track-info/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ relPath, patch }),
  })
  const json = (await response.json()) as
    | { ok: true; relPath: string; meta: Record<string, unknown> }
    | { error?: string }
  if (!response.ok)
    throw new Error(
      "error" in json
        ? json.error || "Failed to save track metadata"
        : "Failed to save track metadata",
    )
  return json as { ok: true; relPath: string; meta: Record<string, unknown> }
}

export async function pruneOrphanTrackMetaForAlbum(
  albumPath: string,
): Promise<{ albumPath: string; removed: string[]; written: boolean }> {
  const response = await apiFetch("/api/track-info/prune-orphans", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ albumPath }),
  })
  return unwrap<{ albumPath: string; removed: string[]; written: boolean }>(
    response,
  )
}

export type SanitizeTrackTitlesOneAlbum = {
  changes: { fileName: string; from: string; to: string }[]
  written: boolean
  albumPath: string
}

export type SanitizeTrackTitlesAll = {
  changes: { albumRel: string; fileName: string; from: string; to: string }[]
  albumsScanned: number
  dryRun: boolean
}

export async function sanitizeTrackTitles(
  body: { scope: "all"; dryRun?: boolean },
): Promise<SanitizeTrackTitlesAll>
export async function sanitizeTrackTitles(body: {
  scope: "album"
  albumPath: string
  dryRun?: boolean
}): Promise<SanitizeTrackTitlesOneAlbum>
export async function sanitizeTrackTitles(
  body:
    | { scope: "all"; dryRun?: boolean }
    | { scope: "album"; albumPath: string; dryRun?: boolean },
): Promise<SanitizeTrackTitlesAll | SanitizeTrackTitlesOneAlbum> {
  const response = await apiFetch("/api/studio/sanitize-track-titles", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...body,
      dryRun: Boolean((body as { dryRun?: boolean }).dryRun),
    }),
  })
  return unwrap<SanitizeTrackTitlesAll | SanitizeTrackTitlesOneAlbum>(response)
}

export type GenreAutoApplyBatchRes = {
  ok: number
  errorCount: number
  errors: { relPath: string; err: string }[]
}

export async function applyGenreAutoBatch(
  items: { relPath: string; genre: string }[],
): Promise<GenreAutoApplyBatchRes> {
  const response = await apiFetch("/api/studio/genre-auto-apply", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items }),
  })
  return unwrap<GenreAutoApplyBatchRes>(response)
}
