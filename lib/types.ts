export interface MediaFile {
  url: string
  name: string
  type: "video" | "image"
  selected: boolean
  resolvedUrl?: string | null
}

export interface SavedConfig {
  id: string
  name: string
  storeDomain: string
  accessToken: string
}

export interface TargetConfig {
  id: string
  name: string
  domain: string
  token: string
}

/** /api/shopify-resolve 按 NDJSON 逐行推送的条目 */
export interface ResolveResult {
  original: string
  resolved: string | null
  filename: string | null
  error?: string
}

export const STORAGE_KEY = "shopify-video-downloader-configs"
export const LAST_USED_KEY = "shopify-video-downloader-last-used"
export const TARGET_CONFIGS_KEY = "shopify-video-downloader-target-configs"
export const TARGET_LAST_USED_KEY = "shopify-video-downloader-target-last-used"

export function getSavedConfigsFromStorage(): SavedConfig[] {
  if (typeof window === "undefined") return []
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored ? JSON.parse(stored) : []
  } catch {
    return []
  }
}

export function getLastUsedConfigFromStorage(): SavedConfig | null {
  if (typeof window === "undefined") return null
  try {
    const lastUsedId = localStorage.getItem(LAST_USED_KEY)
    if (lastUsedId) {
      const configs = getSavedConfigsFromStorage()
      return configs.find((c) => c.id === lastUsedId) || null
    }
  } catch {
    // ignore
  }
  return null
}

export function getTargetConfigsFromStorage(): TargetConfig[] {
  if (typeof window === "undefined") return []
  try {
    const stored = localStorage.getItem(TARGET_CONFIGS_KEY)
    return stored ? JSON.parse(stored) : []
  } catch {
    return []
  }
}

export function getLastUsedTargetFromStorage(): TargetConfig | null {
  if (typeof window === "undefined") return null
  try {
    const lastUsedId = localStorage.getItem(TARGET_LAST_USED_KEY)
    if (lastUsedId) {
      const configs = getTargetConfigsFromStorage()
      return configs.find((c) => c.id === lastUsedId) || null
    }
  } catch {
    // ignore
  }
  return null
}
