const K_TRACKS = "kord-random-exclude-tracks"
const K_ALBUMS = "kord-random-exclude-albums"
const WPP_TRACKS = "wpp-random-exclude-tracks"
const WPP_ALBUMS = "wpp-random-exclude-albums"
const SESSION_ACCOUNT_STORAGE_KEY = "kord-session-account-id"
const LEGACY_ACTIVE_ACCOUNT_STORAGE_KEY = "kord-active-account-id"

function loadSet(key: string): string[] {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return []
    const arr = JSON.parse(raw) as string[]
    return Array.isArray(arr) ? arr.filter((s) => typeof s === "string" && s) : []
  } catch {
    return []
  }
}

function selectedAccountId(): string | null {
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

function accountKey(primary: string): string {
  const id = selectedAccountId()
  return id ? `${primary}:${id}` : primary
}

function mergedExclusionSet(primary: string, legacy: string): Set<string> {
  const id = selectedAccountId()
  const scoped = new Set(loadSet(accountKey(primary)))
  if (!id) {
    return new Set([...scoped, ...loadSet(primary), ...loadSet(legacy)])
  }
  if (id === "default") {
    return new Set([...scoped, ...loadSet(primary), ...loadSet(legacy)])
  }
  return scoped
}

const KEYS = [K_TRACKS, K_ALBUMS, WPP_TRACKS, WPP_ALBUMS] as const

export function readLegacyLocalShuffleMigrated(): {
  albumKeys: string[]
  trackPaths: string[]
} {
  return {
    albumKeys: [...mergedExclusionSet(K_ALBUMS, WPP_ALBUMS)],
    trackPaths: [...mergedExclusionSet(K_TRACKS, WPP_TRACKS)],
  }
}

export function clearLegacyLocalShuffle() {
  try {
    for (const k of KEYS) {
      localStorage.removeItem(k)
    }
    const tAcc = accountKey(K_TRACKS)
    const aAcc = accountKey(K_ALBUMS)
    if (tAcc !== K_TRACKS) localStorage.removeItem(tAcc)
    if (aAcc !== K_ALBUMS) localStorage.removeItem(aAcc)
  } catch {
    /* ignore */
  }
}
