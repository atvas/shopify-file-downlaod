/**
 * 店铺配置：统一的店铺列表（名称 / 域名 / Admin API Token）
 * + 「当前源 / 当前目标」两个指针。
 *
 * 配置只存浏览器 localStorage（键前缀 shopify-video-downloader-），
 * 业务页面不提供配置 UI，直接读「当前源 / 当前目标」；增删改在 /config
 * 店铺配置页完成。服务端无状态，token 只随请求发给 Shopify，绝不记录。
 *
 * 旧版是「源站点 / 目标站点」两套列表（shopify-video-downloader-configs /
 * -target-configs），首次读取时自动合并迁移到新结构；旧键保留不动。
 */

export interface StoreConfig {
  id: string
  name: string
  domain: string
  token: string
}

export const STORES_KEY = "shopify-video-downloader-stores"
export const CURRENT_SOURCE_KEY = "shopify-video-downloader-current-source"
export const CURRENT_TARGET_KEY = "shopify-video-downloader-current-target"

// 旧版键，仅迁移时读一次
const LEGACY_SOURCE_KEY = "shopify-video-downloader-configs"
const LEGACY_SOURCE_LAST_KEY = "shopify-video-downloader-last-used"
const LEGACY_TARGET_KEY = "shopify-video-downloader-target-configs"
const LEGACY_TARGET_LAST_KEY = "shopify-video-downloader-target-last-used"

interface LegacySource {
  id: string
  name: string
  storeDomain: string
  accessToken: string
}

interface LegacyTarget {
  id: string
  name: string
  domain: string
  token: string
}

function readJson<T>(key: string): T | null {
  if (typeof window === "undefined") return null
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function writeJson(key: string, value: unknown): void {
  if (typeof window === "undefined") return
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // localStorage 不可用时静默失败（与旧实现一致）
  }
}

let migrated = false

/** 把旧的源/目标两套配置合并成统一店铺列表（只跑一次） */
function ensureMigrated(): void {
  if (migrated || typeof window === "undefined") return
  migrated = true
  if (localStorage.getItem(STORES_KEY) !== null) return

  const stores: StoreConfig[] = []
  // 域名+Token 视为同一家店铺：旧的源/目标列表可能重复登记同一家
  const byIdentity = new Map<string, string>()
  // 旧 id → 新 id，用于把「上次使用」指针搬到新结构
  const idMap = new Map<string, string>()

  const add = (oldId: string, name: string, domain: string, token: string) => {
    const key = `${domain.trim().toLowerCase()}|${token}`
    let id = byIdentity.get(key)
    if (!id) {
      id = `store-${Date.now()}-${stores.length}`
      stores.push({ id, name: name || domain, domain: domain.trim(), token })
      byIdentity.set(key, id)
    }
    idMap.set(oldId, id)
  }

  for (const c of readJson<LegacySource[]>(LEGACY_SOURCE_KEY) ?? []) {
    add(c.id, c.name, c.storeDomain, c.accessToken)
  }
  for (const c of readJson<LegacyTarget[]>(LEGACY_TARGET_KEY) ?? []) {
    add(c.id, c.name, c.domain, c.token)
  }

  const lastSource = localStorage.getItem(LEGACY_SOURCE_LAST_KEY)
  const lastTarget = localStorage.getItem(LEGACY_TARGET_LAST_KEY)
  const sourceId = lastSource ? idMap.get(lastSource) : undefined
  const targetId = lastTarget ? idMap.get(lastTarget) : undefined
  if (sourceId) localStorage.setItem(CURRENT_SOURCE_KEY, sourceId)
  // 同一家店铺不能既是源又是目标：撞车时保源（源是必选项）
  if (targetId && targetId !== sourceId) {
    localStorage.setItem(CURRENT_TARGET_KEY, targetId)
  }
  writeJson(STORES_KEY, stores)
}

export function getStores(): StoreConfig[] {
  ensureMigrated()
  return readJson<StoreConfig[]>(STORES_KEY) ?? []
}

export function saveStores(stores: StoreConfig[]): void {
  writeJson(STORES_KEY, stores)
}

export function getCurrentSourceId(): string | null {
  if (typeof window === "undefined") return null
  ensureMigrated()
  return localStorage.getItem(CURRENT_SOURCE_KEY)
}

export function getCurrentTargetId(): string | null {
  if (typeof window === "undefined") return null
  ensureMigrated()
  return localStorage.getItem(CURRENT_TARGET_KEY)
}

/**
 * 指针写入带互斥：同一家店铺不能既是源又是目标，
 * 新指针与对面指针撞车时把对面顶掉。
 */
export function setCurrentSourceId(id: string | null): void {
  if (id) {
    localStorage.setItem(CURRENT_SOURCE_KEY, id)
    if (localStorage.getItem(CURRENT_TARGET_KEY) === id) {
      localStorage.removeItem(CURRENT_TARGET_KEY)
    }
  } else {
    localStorage.removeItem(CURRENT_SOURCE_KEY)
  }
}

export function setCurrentTargetId(id: string | null): void {
  if (id) {
    localStorage.setItem(CURRENT_TARGET_KEY, id)
    if (localStorage.getItem(CURRENT_SOURCE_KEY) === id) {
      localStorage.removeItem(CURRENT_SOURCE_KEY)
    }
  } else {
    localStorage.removeItem(CURRENT_TARGET_KEY)
  }
}

export function getCurrentSource(): StoreConfig | null {
  const id = getCurrentSourceId()
  return id ? (getStores().find((s) => s.id === id) ?? null) : null
}

export function getCurrentTarget(): StoreConfig | null {
  const id = getCurrentTargetId()
  return id ? (getStores().find((s) => s.id === id) ?? null) : null
}
