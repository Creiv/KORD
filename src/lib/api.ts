import type {
  DashboardPayload,
  LibraryIndex,
  LibraryResponse,
  UserStateV1,
} from "../types"

type Wrapped<T> = { ok: boolean; data: T; error: string | null }
const SESSION_ACCOUNT_STORAGE_KEY = "kord-session-account-id"
const LEGACY_ACTIVE_ACCOUNT_STORAGE_KEY = "kord-active-account-id"

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

function accountParams(params: Record<string, string> = {}) {
  const out = new URLSearchParams(params)
  const id = getSelectedAccountId()
  if (id) out.set("accountId", id)
  return out
}

function accountHeaders(base: HeadersInit = {}) {
  const id = getSelectedAccountId()
  return id ? { ...base, "X-KORD-Account-Id": id } : base
}

function apiUrl(path: string, params: Record<string, string> = {}) {
  const query = accountParams(params).toString()
  return query ? `${path}?${query}` : path
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
  const response = await fetch(apiUrl("/api/library"), {
    headers: accountHeaders(),
  })
  return unwrap<LibraryResponse>(response)
}

export async function fetchLibraryIndex(): Promise<LibraryIndex> {
  const response = await fetch(apiUrl("/api/library-index"), {
    cache: "no-store",
    headers: accountHeaders(),
  })
  return unwrap<LibraryIndex>(response)
}

export async function fetchLibraryIndexForAccount(accountId: string): Promise<LibraryIndex> {
  const response = await fetch(
    `/api/accounts/${encodeURIComponent(accountId)}/library-index`,
    { cache: "no-store" },
  )
  return unwrap<LibraryIndex>(response)
}

export type LinkSharedAlbumResult = {
  scope?: "album"
  linked: number
  skipped: number
  destRelPath: string
  linkManifestPath: string
}

export type LinkSharedArtistResult = {
  scope: "artist"
  artist: string
  albums: { destRelPath: string; linked: number; skipped: number; linkManifestPath: string }[]
  errors?: { relPath: string; error: string; code?: string }[]
  totalLinked: number
  totalSkipped: number
}

export type LinkSharedResult = LinkSharedAlbumResult | LinkSharedArtistResult

export async function linkSharedFromAccount(
  sourceAccountId: string,
  relPath: string,
  scope: "album" | "artist" = "album",
): Promise<LinkSharedResult> {
  const response = await fetch("/api/studio/link-shared-album", {
    method: "POST",
    headers: accountHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ sourceAccountId, relPath, scope }),
  })
  return unwrap<LinkSharedResult>(response)
}

export async function fetchDashboard(): Promise<DashboardPayload> {
  const response = await fetch(apiUrl("/api/dashboard"), {
    cache: "no-store",
    headers: accountHeaders(),
  })
  return unwrap<DashboardPayload>(response)
}

export async function fetchUserState(): Promise<UserStateV1> {
  const response = await fetch(apiUrl("/api/user-state"), {
    headers: accountHeaders(),
  })
  return unwrap<UserStateV1>(response)
}

export async function saveUserState(state: UserStateV1): Promise<UserStateV1> {
  const response = await fetch(apiUrl("/api/user-state"), {
    method: "PUT",
    headers: accountHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ state }),
  })
  return unwrap<UserStateV1>(response)
}

export type AppConfig = {
  musicRoot: string
  lockedByEnv: boolean
  listenOnLan: boolean
  serverPort: number
  devClientPort: number
  lanAccessUrl: string | null
  defaultAccountId?: string
}

export type Account = {
  id: string
  name: string
  musicRoot: string
}

export type AccountsResponse = {
  defaultAccountId: string
  accounts: Account[]
  lockedByEnv: boolean
  createdAccountId?: string
}

export async function fetchConfig(): Promise<AppConfig> {
  const response = await fetch("/api/config")
  const data = await unwrap<AppConfig>(response)
  rememberAvailableAccount(data)
  return data
}

export async function saveAppConfig(
  patch: { musicRoot?: string; listenOnLan?: boolean }
): Promise<AppConfig> {
  const response = await fetch("/api/config", {
    method: "PUT",
    headers: accountHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(patch),
  })
  return unwrap<AppConfig>(response)
}

export async function saveConfig(musicRoot: string): Promise<AppConfig> {
  return saveAppConfig({ musicRoot })
}

export async function fetchAccounts(): Promise<AccountsResponse> {
  const response = await fetch("/api/accounts", { cache: "no-store" })
  const data = await unwrap<AccountsResponse>(response)
  rememberAvailableAccount(data)
  return data
}

export async function createAccount(input: {
  name: string
  musicRoot: string
}): Promise<AccountsResponse> {
  const response = await fetch("/api/accounts", {
    method: "POST",
    headers: accountHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(input),
  })
  const data = await unwrap<AccountsResponse>(response)
  if (data.createdAccountId) setSelectedAccountId(data.createdAccountId)
  return data
}

export async function updateAccount(
  id: string,
  patch: { name?: string; musicRoot?: string },
): Promise<AccountsResponse> {
  const response = await fetch(`/api/accounts/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: accountHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(patch),
  })
  const data = await unwrap<AccountsResponse>(response)
  return data
}

export async function deleteAccount(id: string): Promise<AccountsResponse> {
  const response = await fetch(`/api/accounts/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: accountHeaders(),
  })
  const data = await unwrap<AccountsResponse>(response)
  const selected = getSelectedAccountId()
  if (selected === id) {
    setSelectedAccountId(data.accounts[0]?.id || data.defaultAccountId)
  }
  return data
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
  const response = await fetch(apiUrl("/api/download-preset"), {
    headers: accountHeaders(),
  })
  return unwrap<PresetYtdlp>(response)
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
    ...(msg.error != null && msg.error !== ""
      ? { error: String(msg.error) }
      : {}),
  }
}

export async function runYtdlpDownload(
  url: string,
  outputDir?: string,
  onProgress?: (p: { current: number; total: number }) => void,
): Promise<DownloadRes> {
  const response = await fetch("/api/download", {
    method: "POST",
    headers: accountHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      url,
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
    if (msg.type === "done") final = downloadResFromDoneMsg(msg)
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
  const response = await fetch(apiUrl("/api/fs/list", { path: path || "" }), {
    headers: accountHeaders(),
  })
  return unwrap<FsList>(response)
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
  const params = new URLSearchParams()
  if (typeof opts === "string") {
    params.set("q", opts)
  } else {
    if (opts.q) params.set("q", opts.q)
    if (opts.artist) params.set("artist", opts.artist)
    if (opts.album) params.set("album", opts.album)
  }
  if (![...params.values()].length) return []
  const response = await fetch(
    apiUrl("/api/artwork/search", Object.fromEntries(params)),
    { headers: accountHeaders() },
  )
  const data = await unwrap<{ results: ArtworkHit[] }>(response)
  return data.results || []
}

export async function applyArtwork(
  albumPath: string,
  imageUrl: string,
): Promise<void> {
  const response = await fetch("/api/artwork/apply", {
    method: "POST",
    headers: accountHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ albumPath, imageUrl }),
  })
  await unwrap<{ saved: string }>(response)
}

export async function createMusicSubdir(
  parent: string,
  name: string,
): Promise<{ relPath: string }> {
  const response = await fetch("/api/fs/mkdir", {
    method: "POST",
    headers: accountHeaders({ "Content-Type": "application/json" }),
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
  const response = await fetch("/api/album-info/fetch", {
    method: "POST",
    headers: accountHeaders({ "Content-Type": "application/json" }),
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
  const response = await fetch("/api/album-info/save", {
    method: "POST",
    headers: accountHeaders({ "Content-Type": "application/json" }),
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
  const response = await fetch("/api/track-info/fetch", {
    method: "POST",
    headers: accountHeaders({ "Content-Type": "application/json" }),
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
  const response = await fetch("/api/track-info/save", {
    method: "POST",
    headers: accountHeaders({ "Content-Type": "application/json" }),
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
  const response = await fetch("/api/studio/sanitize-track-titles", {
    method: "POST",
    headers: accountHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      ...body,
      dryRun: Boolean((body as { dryRun?: boolean }).dryRun),
    }),
  })
  return unwrap<SanitizeTrackTitlesAll | SanitizeTrackTitlesOneAlbum>(response)
}
