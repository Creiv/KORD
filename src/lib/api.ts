import type {
  DashboardPayload,
  LibraryCatalogResponse,
  LibraryAlbumDetail,
  LibraryArtistDetail,
  LibraryEntityDelta,
  LibraryIndex,
  LibraryOverview,
  LibraryResponse,
  LibrarySearchResult,
  LibrarySelectionV1,
  UserSettings,
  UserStatePatch,
  UserStateV1,
} from "../types"

type Wrapped<T> = { ok: boolean; data: T; error: string | null }
const SESSION_ACCOUNT_STORAGE_KEY = "kord-session-account-id"
const LEGACY_ACTIVE_ACCOUNT_STORAGE_KEY = "kord-active-account-id"
let accountBootstrapPromise: Promise<string | null> | null = null
let accountBootstrapBackoffUntil = 0
let accountSessionValidated = false
const ACCOUNT_BOOTSTRAP_BACKOFF_MS = 8000
const API_UNREACHABLE_BACKOFF_MS = 12000
let apiUnreachableUntil = 0
let inflightUserStateFetch: Promise<UserStateV1> | null = null

/** Thrown when the KORD API cannot be reached or returns a non-JSON proxy error. */
export class BackendUnreachableError extends Error {
  constructor() {
    super("BACKEND_UNREACHABLE")
    this.name = "BackendUnreachableError"
  }
}

function markApiUnreachable() {
  apiUnreachableUntil = Date.now() + API_UNREACHABLE_BACKOFF_MS
}

function assertApiReachable() {
  if (Date.now() < apiUnreachableUntil) {
    throw new BackendUnreachableError()
  }
}

/** True when the KORD API is unreachable (server stopped, proxy down, offline). */
export function isBackendUnreachableError(err: unknown): boolean {
  if (err instanceof BackendUnreachableError) return true
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase()
  return (
    /failed to fetch|networkerror|load failed|network request failed|econnrefused|enotfound|etimedout|502|503|504|bad gateway|service unavailable|proxy error|unexpected end of json|json\.parse|invalid_api_json|backend_unreachable|empty_response/i.test(
      msg,
    ) || (err instanceof TypeError && msg.includes("fetch"))
  )
}

async function readResponseJson<T>(response: Response): Promise<T> {
  let text: string
  try {
    text = await response.text()
  } catch {
    markApiUnreachable()
    throw new BackendUnreachableError()
  }
  if (!text.trim()) {
    if (!response.ok) {
      markApiUnreachable()
      throw new BackendUnreachableError()
    }
    throw new Error("EMPTY_RESPONSE")
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text) as T
  } catch {
    if (!response.ok) {
      markApiUnreachable()
      throw new BackendUnreachableError()
    }
    throw new SyntaxError("INVALID_API_JSON")
  }
  if (
    !response.ok &&
    (response.status === 502 ||
      response.status === 503 ||
      response.status === 504)
  ) {
    const apiErr =
      parsed &&
      typeof parsed === "object" &&
      "error" in parsed &&
      typeof (parsed as { error?: string }).error === "string"
        ? (parsed as { error: string }).error.trim()
        : ""
    if (apiErr) throw new Error(apiErr)
    markApiUnreachable()
    throw new BackendUnreachableError()
  }
  return parsed as T
}

export class UserStateRevisionConflict extends Error {
  readonly currentState: UserStateV1
  constructor(currentState: UserStateV1) {
    super("USER_STATE_REVISION_CONFLICT")
    this.name = "UserStateRevisionConflict"
    this.currentState = currentState
  }
}

async function unwrapUserStateMutation(response: Response): Promise<UserStateV1> {
  const parsed = await readResponseJson<
    | Wrapped<UserStateV1>
    | {
        error?: string
        details?: { code?: string; currentState?: UserStateV1 }
      }
  >(response)
  if (response.status === 409) {
    const detail = parsed && typeof parsed === "object" ? (parsed as { details?: { currentState?: UserStateV1 } }).details : undefined
    const cur = detail?.currentState
    if (cur && typeof cur === "object") {
      throw new UserStateRevisionConflict(cur)
    }
    throw new Error("USER_STATE_REVISION_CONFLICT")
  }
  if (!response.ok) {
    if (parsed && typeof parsed === "object" && "error" in parsed && typeof (parsed as { error?: string }).error === "string") {
      throw new Error((parsed as { error: string }).error)
    }
    throw new Error("Request failed")
  }
  const json = parsed as Wrapped<UserStateV1>
  if ("ok" in json && "data" in json) {
    if (!json.ok) throw new Error(json.error || "Request failed")
    return json.data
  }
  return parsed as UserStateV1
}

async function unwrap<T>(response: Response): Promise<T> {
  const json = await readResponseJson<T | Wrapped<T> | { error?: string }>(response)
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

function accountHeaders(base: HeadersInit = {}) {
  const id = getSelectedAccountId()
  return id ? { ...base, "X-KORD-Account-Id": id } : base
}

function accountHeadersForPath(endpointPath: string, base: HeadersInit = {}) {
  if (pathnameOnly(endpointPath) === "/api/accounts") return base
  return accountHeaders(base)
}

function apiUrl(path: string, params: Record<string, string> = {}) {
  const qIndex = path.indexOf("?")
  const base = qIndex >= 0 ? path.slice(0, qIndex) : path
  const out = new URLSearchParams(qIndex >= 0 ? path.slice(qIndex + 1) : "")
  for (const [key, value] of Object.entries(params)) {
    if (value != null && String(value).trim() !== "") {
      out.set(key, String(value))
    }
  }
  const pname = pathnameOnly(base)
  if (pname !== "/api/accounts") {
    const id = getSelectedAccountId()
    if (id) out.set("accountId", id)
  }
  const query = out.toString()
  return query ? `${base}?${query}` : base
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
  assertApiReachable()
  return fetch(url, {
    ...init,
    headers: nextHeaders,
  }).catch((err: unknown) => {
    if (isBackendUnreachableError(err)) markApiUnreachable()
    throw err
  })
}

async function ensureSelectedAccountId(): Promise<string | null> {
  const existing = getSelectedAccountId()
  if (existing && accountSessionValidated) return existing
  if (Date.now() < accountBootstrapBackoffUntil) return existing ?? null
  if (accountBootstrapPromise) return accountBootstrapPromise
  accountBootstrapPromise = apiFetch("/api/accounts", { cache: "no-store" })
    .then((response) => unwrap<AccountsResponse>(response))
    .then((data) => {
      accountSessionValidated = true
      accountBootstrapBackoffUntil = 0
      rememberAvailableAccount(data)
      return getSelectedAccountId()
    })
    .catch(() => {
      accountBootstrapPromise = null
      accountBootstrapBackoffUntil = Date.now() + ACCOUNT_BOOTSTRAP_BACKOFF_MS
      return getSelectedAccountId()
    })
  return accountBootstrapPromise
}

export function mediaUrl(relPath: string, baseUrl?: string | null) {
  const path = `/media/${relPath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")}`
  const id = getSelectedAccountId()
  const withAccount = id ? `${path}?${new URLSearchParams({ accountId: id })}` : path
  if (!baseUrl) return withAccount
  try {
    return new URL(withAccount, baseUrl).href
  } catch {
    return withAccount
  }
}

export function coverUrlForTrackRelPath(relPath: string, width?: number) {
  const params: Record<string, string> = { path: relPath }
  if (width != null && Number.isFinite(width) && width > 0) {
    params.w = String(Math.round(width))
  }
  return apiUrl("/api/cover", params)
}

export function coverUrlForAlbumRelPath(relPath: string, width?: number) {
  const params: Record<string, string> = { path: relPath }
  if (width != null && Number.isFinite(width) && width > 0) {
    params.w = String(Math.round(width))
  }
  return apiUrl("/api/cover", params)
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

export async function fetchLibraryOverview(): Promise<LibraryOverview> {
  await ensureSelectedAccountId()
  const response = await apiFetch("/api/library-overview", { cache: "no-store" })
  return unwrap<LibraryOverview>(response)
}

export async function fetchLibraryArtistDetail(artistId: string): Promise<LibraryArtistDetail> {
  await ensureSelectedAccountId()
  const response = await apiFetch(
    `/api/library-artists/${encodeURIComponent(artistId)}`,
    { cache: "no-store" },
  )
  return unwrap<LibraryArtistDetail>(response)
}

export async function fetchLibraryAlbumDetail(relPath: string): Promise<LibraryAlbumDetail> {
  await ensureSelectedAccountId()
  const response = await apiFetch("/api/library-albums", { cache: "no-store" }, { relPath })
  return unwrap<LibraryAlbumDetail>(response)
}

export async function searchLibrary(q: string): Promise<LibrarySearchResult> {
  await ensureSelectedAccountId()
  const response = await apiFetch("/api/library-search", { cache: "no-store" }, { q })
  return unwrap<LibrarySearchResult>(response)
}

export async function resolveLibraryTracks(relPaths: string[]): Promise<{ tracks: LibraryIndex["tracks"] }> {
  await ensureSelectedAccountId()
  const response = await apiFetch("/api/library/tracks/resolve", {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ relPaths }),
  })
  return unwrap<{ tracks: LibraryIndex["tracks"] }>(response)
}

export async function fetchLibraryIndexForAccount(accountId: string): Promise<LibraryIndex> {
  const response = await apiFetch(
    `/api/accounts/${encodeURIComponent(accountId)}/library-index`,
    { cache: "no-store" },
  )
  return unwrap<LibraryIndex>(response)
}

export async function fetchLibraryCatalog(opts: { summary?: boolean; artistId?: string } = {}): Promise<LibraryCatalogResponse> {
  await ensureSelectedAccountId()
  const query: Record<string, string> = {}
  if (opts.summary) query.summary = "1"
  if (opts.artistId) query.artistId = opts.artistId
  const response = await apiFetch("/api/catalog", { cache: "no-store" }, query)
  return unwrap<LibraryCatalogResponse>(response)
}

export type CatalogWebDiscoverEntry = {
  id: string
  type?: 'album' | 'song'
  title: string
  subtitle: string
  url: string
  thumbnailUrl?: string | null
}

export type CatalogWebDiscoverAlbum = CatalogWebDiscoverEntry & {
  artistName: string
  releaseType?: string | null
  trackCount?: number | null
}

export type CatalogWebDiscoverSong = CatalogWebDiscoverEntry & {
  artistName: string
  releaseType?: string | null
}

export type CatalogWebDiscoverResponse = {
  artists: CatalogWebDiscoverEntry[]
  albums: CatalogWebDiscoverAlbum[]
  songs: CatalogWebDiscoverSong[]
  error?: string | null
}

export async function fetchCatalogWebDiscover(
  opts: { force?: boolean } = {},
): Promise<CatalogWebDiscoverResponse> {
  await ensureSelectedAccountId()
  const response = await apiFetch(
    "/api/catalog-web-discover",
    { cache: "no-store" },
    opts.force ? { force: "1" } : {},
  )
  return unwrap<CatalogWebDiscoverResponse>(response)
}

export type CatalogWebTrack = {
  id: string
  title: string
  url: string
}

export async function fetchCatalogWebTracks(
  pageUrl: string,
): Promise<{
  tracks: CatalogWebTrack[]
  title: string | null
  error?: string | null
}> {
  await ensureSelectedAccountId()
  const response = await apiFetch(
    "/api/catalog-web-tracks",
    { cache: "no-store" },
    { url: pageUrl.trim() },
  )
  return unwrap<{
    tracks: CatalogWebTrack[]
    title: string | null
    error?: string | null
  }>(response)
}

/** URL per `<audio src>`: streaming via proxy token (affidabile anche su Windows). */
export async function catalogWebPreviewAudioSrc(
  watchUrl: string,
): Promise<string> {
  const { playUrl } = await fetchCatalogWebPreviewPlayUrl(watchUrl)
  return apiUrl(playUrl)
}

/** URL diretto pipe yt-dlp (fallback legacy). */
export function catalogWebPreviewStreamUrl(watchUrl: string): string {
  return apiUrl("/api/catalog-web-preview/play", {
    url: watchUrl.trim(),
  })
}

/** @deprecated Usare {@link catalogWebPreviewAudioSrc}. */
export async function fetchCatalogWebPreviewPlayUrl(
  watchUrl: string,
): Promise<{ playUrl: string }> {
  await ensureSelectedAccountId()
  const response = await apiFetch(
    "/api/catalog-web-preview",
    { cache: "no-store" },
    { url: watchUrl.trim() },
  )
  return unwrap<{ playUrl: string }>(response)
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
  if (inflightUserStateFetch) return inflightUserStateFetch
  inflightUserStateFetch = (async () => {
    try {
      await ensureSelectedAccountId()
      const response = await apiFetch("/api/user-state")
      return await unwrap<UserStateV1>(response)
    } catch (err: unknown) {
      if (isBackendUnreachableError(err)) markApiUnreachable()
      throw err
    } finally {
      inflightUserStateFetch = null
    }
  })()
  return inflightUserStateFetch
}

export async function patchUserSettings(
  expectedRevision: number,
  patch: Partial<UserSettings>,
): Promise<UserStateV1> {
  await ensureSelectedAccountId()
  const response = await apiFetch("/api/user-state/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expectedRevision, settings: patch }),
  })
  return unwrapUserStateMutation(response)
}

export async function patchUserState(patch: UserStatePatch): Promise<UserStateV1> {
  await ensureSelectedAccountId()
  const response = await apiFetch("/api/user-state", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state: patch }),
  })
  return unwrapUserStateMutation(response)
}

export async function saveUserState(state: UserStateV1, omitPlaylists = false): Promise<UserStateV1> {
  await ensureSelectedAccountId()
  const { settings: _drop, ...rest } = state
  void _drop
  const patch: Record<string, unknown> = { ...rest }
  if (omitPlaylists) delete patch.playlists
  const exp =
    typeof state.revision === "number" && Number.isFinite(state.revision) && state.revision >= 1
      ? Math.floor(state.revision)
      : 1
  const response = await apiFetch("/api/user-state", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expectedRevision: exp, state: patch }),
  })
  return unwrapUserStateMutation(response)
}

export type AppConfig = {
  musicRoot?: string | null
  lockedByEnv: boolean
  libraryRootConfigured?: boolean
  localAccess?: boolean
  libraryRootWritable?: boolean
  libraryRootLabel?: string | null
  youtubeCookiesConfigured?: boolean
  youtubeCookiesWritable?: boolean
  youtubeCookiesLockedByEnv?: boolean
  youtubeCookiesLabel?: string | null
  serverPort: number
  devClientPort: number
  lanAccessUrl: string | null
  defaultAccountId?: string
  remoteAccess?: RemoteAccessState
}

export type RemoteAccessState = {
  enabled: boolean
  status: "stopped" | "starting" | "running" | "error"
  provider: string
  publicUrl: string | null
  error: string | null
  startedAt: string | null
  cloudflaredPath: string
  cloudflareLoggedIn: boolean
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

export async function fetchRemoteAccessState(): Promise<RemoteAccessState> {
  const response = await apiFetch("/api/remote-access", { cache: "no-store" })
  return unwrap<RemoteAccessState>(response)
}

export async function startRemoteAccess(): Promise<RemoteAccessState> {
  const response = await apiFetch("/api/remote-access/start", {
    method: "POST",
  })
  return unwrap<RemoteAccessState>(response)
}

export async function stopRemoteAccess(): Promise<RemoteAccessState> {
  const response = await apiFetch("/api/remote-access/stop", {
    method: "POST",
  })
  return unwrap<RemoteAccessState>(response)
}

export async function getRemoteAccessLoginUrl(): Promise<{ loginUrl: string; note: string }> {
  const response = await apiFetch("/api/remote-access/login", {
    method: "POST",
  })
  return unwrap<{ loginUrl: string; note: string }>(response)
}

export async function logoutRemoteAccessLogin(): Promise<RemoteAccessState> {
  const response = await apiFetch("/api/remote-access/logout", {
    method: "POST",
  })
  return unwrap<RemoteAccessState>(response)
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

export async function uploadYoutubeCookies(file: File): Promise<AppConfig> {
  const fd = new FormData()
  fd.append("file", file)
  const response = await apiFetch("/api/config/youtube-cookies", {
    method: "POST",
    body: fd,
  })
  return unwrap<AppConfig>(response)
}

export async function clearYoutubeCookies(): Promise<AppConfig> {
  const response = await apiFetch("/api/config/youtube-cookies", {
    method: "DELETE",
  })
  return unwrap<AppConfig>(response)
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
  cookiesConfigured?: boolean
}

export async function fetchDownloadPreset(): Promise<PresetYtdlp> {
  const response = await apiFetch("/api/download-preset")
  return unwrap<PresetYtdlp>(response)
}

export type YoutubeExploreFilter = "all" | "songs" | "albums" | "artists"

export type YoutubeExploreResult = {
  id: string
  type: "song" | "album" | "artist"
  title: string
  subtitle: string
  url: string
  thumbnailUrl?: string | null
}

export async function fetchYoutubeExploreSearch(
  query: string,
): Promise<{ results: YoutubeExploreResult[] }> {
  const response = await apiFetch("/api/youtube-explore-search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  })
  return unwrap<{ results: YoutubeExploreResult[] }>(response)
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
    onListReady?: () => void
    onEntryPatch?: (e: YoutubeReleaseEntry) => void
    onDone: () => void
  },
  opts?: { enrichCounts?: boolean; signal?: AbortSignal },
): Promise<void> {
  const signal = opts?.signal
  const response = await apiFetch("/api/youtube-releases-list", {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url,
      stream: true,
      ...(opts?.enrichCounts ? { enrichCounts: true } : {}),
    }),
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
    if (row.type === "list_ready") {
      cbs.onListReady?.()
      return
    }
    if (row.type === "entry_patch" && row.entry) {
      cbs.onEntryPatch?.(row.entry)
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
  downloadedItems?: string[]
  skippedItems?: { label: string; reason: string }[]
  failedItems?: { label: string; reason: string }[]
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
    downloadedItems: Array.isArray(msg.downloadedItems)
      ? msg.downloadedItems.map((x) => String(x)).filter(Boolean)
      : [],
    skippedItems: Array.isArray(msg.skippedItems)
      ? msg.skippedItems
          .map((x) => {
            const row = x as { label?: unknown; reason?: unknown }
            return { label: String(row.label ?? ""), reason: String(row.reason ?? "") }
          })
          .filter((x) => x.label)
      : [],
    failedItems: Array.isArray(msg.failedItems)
      ? msg.failedItems
          .map((x) => {
            const row = x as { label?: unknown; reason?: unknown }
            return { label: String(row.label ?? ""), reason: String(row.reason ?? "") }
          })
          .filter((x) => x.label)
      : [],
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
  let itemSummary: {
    downloadedItems: string[]
    skippedItems: { label: string; reason: string }[]
    failedItems: { label: string; reason: string }[]
  } = {
    downloadedItems: [],
    skippedItems: [],
    failedItems: [],
  }
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
    if (ty === "items") {
      itemSummary = {
        downloadedItems: Array.isArray(msg.downloadedItems)
          ? msg.downloadedItems.map((x) => String(x)).filter(Boolean)
          : [],
        skippedItems: Array.isArray(msg.skippedItems)
          ? msg.skippedItems
              .map((x) => {
                const row = x as { label?: unknown; reason?: unknown }
                return { label: String(row.label ?? ""), reason: String(row.reason ?? "") }
              })
              .filter((x) => x.label)
          : [],
        failedItems: Array.isArray(msg.failedItems)
          ? msg.failedItems
              .map((x) => {
                const row = x as { label?: unknown; reason?: unknown }
                return { label: String(row.label ?? ""), reason: String(row.reason ?? "") }
              })
              .filter((x) => x.label)
          : [],
      }
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
      final = {
        ...downloadResFromDoneMsg(msg),
        downloadedItems:
          Array.isArray(msg.downloadedItems) && msg.downloadedItems.length
            ? msg.downloadedItems.map((x) => String(x)).filter(Boolean)
            : itemSummary.downloadedItems,
        skippedItems:
          Array.isArray(msg.skippedItems) && msg.skippedItems.length
            ? (downloadResFromDoneMsg(msg).skippedItems ?? [])
            : itemSummary.skippedItems,
        failedItems:
          Array.isArray(msg.failedItems) && msg.failedItems.length
            ? (downloadResFromDoneMsg(msg).failedItems ?? [])
            : itemSummary.failedItems,
      }
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

export type FsDirSearchResult = {
  name: string
  relPath: string
}

export async function listMusicDirs(path: string): Promise<FsList> {
  const response = await apiFetch("/api/fs/list", {}, { path: path || "" })
  return unwrap<FsList>(response)
}

export async function searchMusicDirs(q: string): Promise<FsDirSearchResult[]> {
  const query = q.trim()
  if (!query) return []
  const response = await apiFetch("/api/fs/search-dirs", {}, { q: query })
  const data = await unwrap<{ results: FsDirSearchResult[] }>(response)
  return data.results || []
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
): Promise<{ deleted: string[]; affectedAlbums?: string[] }> {
  const response = await apiFetch("/api/fs/delete-audio-relpaths", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ relPaths }),
  })
  return unwrap<{ deleted: string[]; affectedAlbums?: string[] }>(response)
}

export async function deleteAlbumFolder(
  albumPath: string,
): Promise<{ deleted: string[]; deletedFolder: string; affectedAlbums?: string[] }> {
  const response = await apiFetch("/api/fs/delete-album-folder", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ albumPath }),
  })
  return unwrap<{ deleted: string[]; deletedFolder: string; affectedAlbums?: string[] }>(response)
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
): Promise<LibraryEntityDelta & { saved: string; abs?: string }> {
  const response = await apiFetch("/api/artwork/apply", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ albumPath, imageUrl }),
  })
  return unwrap<LibraryEntityDelta & { saved: string; abs?: string }>(response)
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
  genre?: string | null
  label?: string | null
  country?: string | null
  musicbrainzReleaseId?: string | null
}

export type FetchedTrackMeta = {
  ok: boolean
  title?: string
  releaseDate: string | null
  genre: string | null
  lyrics?: string | null
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
): Promise<{
  ok: true;
  albumPath: string;
  meta: FetchedAlbumMeta;
  album?: LibraryEntityDelta["album"];
}> {
  const response = await apiFetch("/api/album-info/fetch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ albumPath, artist, album }),
  })
  const json = (await response.json()) as
    | {
        ok: true;
        albumPath: string;
        meta: FetchedAlbumMeta;
        album?: LibraryEntityDelta["album"];
      }
    | { error?: string }
  if (!response.ok)
    throw new Error(
      "error" in json ? json.error || "Failed to fetch album metadata" : "Failed to fetch album metadata",
    )
  return json as {
    ok: true;
    albumPath: string;
    meta: FetchedAlbumMeta;
    album?: LibraryEntityDelta["album"];
  }
}

export async function saveAlbumInfoManual(
  albumPath: string,
  patch: AlbumMetaSavePatch,
): Promise<{ albumPath: string; meta: Record<string, unknown>; album?: LibraryEntityDelta["album"]; tracks?: LibraryEntityDelta["tracks"] }> {
  const response = await apiFetch("/api/album-info/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ albumPath, patch }),
  })
  const data = await unwrap<{ albumPath: string; meta: Record<string, unknown>; album?: LibraryEntityDelta["album"]; tracks?: LibraryEntityDelta["tracks"] }>(
    response,
  )
  return data
}

export async function fetchTrackInfo(
  relPath: string,
): Promise<{
  ok: true;
  relPath: string;
  meta: FetchedTrackMeta;
  track?: LibraryEntityDelta["track"];
}> {
  const response = await apiFetch("/api/track-info/fetch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ relPath }),
  })
  const json = (await response.json()) as
    | {
        ok: true;
        relPath: string;
        meta: FetchedTrackMeta;
        track?: LibraryEntityDelta["track"];
      }
    | { error?: string }
  if (!response.ok)
    throw new Error(
      "error" in json
        ? json.error || "Failed to fetch track metadata"
        : "Failed to fetch track metadata",
    )
  return json as {
    ok: true;
    relPath: string;
    meta: FetchedTrackMeta;
    track?: LibraryEntityDelta["track"];
  }
}

export async function fetchTrackLyrics(
  relPath: string,
): Promise<{ ok: true; relPath: string; syncedLyrics: string | null; plainLyrics: string | null }> {
  await ensureSelectedAccountId()
  const response = await apiFetch("/api/track-lyrics/fetch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ relPath }),
  })
  return unwrap<{ ok: true; relPath: string; syncedLyrics: string | null; plainLyrics: string | null }>(response)
}

export type TrackMetaSavePatch = {
  title?: string | null;
  releaseDate?: string | null;
  genre?: string | null;
  lyrics?: string | null;
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
): Promise<{ ok: true; relPath: string; meta: Record<string, unknown>; track?: LibraryEntityDelta["track"]; album?: LibraryEntityDelta["album"] }> {
  const response = await apiFetch("/api/track-info/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ relPath, patch }),
  })
  const json = (await response.json()) as
    | { ok: true; relPath: string; meta: Record<string, unknown>; track?: LibraryEntityDelta["track"]; album?: LibraryEntityDelta["album"] }
    | { error?: string }
  if (!response.ok)
    throw new Error(
      "error" in json
        ? json.error || "Failed to save track metadata"
        : "Failed to save track metadata",
    )
  return json as { ok: true; relPath: string; meta: Record<string, unknown>; track?: LibraryEntityDelta["track"]; album?: LibraryEntityDelta["album"] }
}

export async function savePlectrBestScore(
  relPath: string,
  result: {
    score: number;
    grade: string;
    accuracy: number;
    maxCombo: number;
    hits?: number;
    misses?: number;
    updatedAt?: string;
  },
): Promise<{
  ok: true;
  relPath: string;
  meta: Record<string, unknown>;
  track?: LibraryEntityDelta["track"];
}> {
  const response = await apiFetch("/api/plectr/save-best", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ relPath, result }),
  });
  const json = (await response.json()) as
    | {
        ok: true;
        relPath: string;
        meta: Record<string, unknown>;
        track?: LibraryEntityDelta["track"];
      }
    | { error?: string };
  if (!response.ok) {
    throw new Error(
      "error" in json ? json.error || "Failed to save Plectr score" : "Failed to save Plectr score",
    );
  }
  return json as {
    ok: true;
    relPath: string;
    meta: Record<string, unknown>;
    track?: LibraryEntityDelta["track"];
  };
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
