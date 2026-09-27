/** 动态模型拉取服务：通过 /v1/models 端点获取模型列表并缓存，详细见 docs/details/注释/packages/ui-kit/model-registry/model-fetcher.md */

import { getProviderManifest } from './provider-registry'
import { loadApiKey } from './key-store'
import { smartFetch } from './smart-fetch'
import { isTauri } from './tauri-env'

/** 缓存 key 前缀 */
const CACHE_KEY_PREFIX = 'worldsea_fetched_models_'
/** 缓存过期时间：24 小时 */
const CACHE_TTL = 24 * 60 * 60 * 1000

/** 拉取到的模型条目 */
export interface FetchedModelEntry {
  /** 模型 ID */
  id: string
  /** 供应商 ID */
  provider: string
}

interface CachedFetchedModels {
  /** 最近一次成功拉取的时间戳（即 fetchedAt） */
  timestamp: number
  /** 拉取到的模型列表 */
  models: FetchedModelEntry[]
  /** 最近一次拉取失败的提示（成功拉取或清缓存时清除；失败保留旧缓存但不覆盖 timestamp） */
  lastError?: string
}

/** 供应商模型拉取新鲜度信息（供 UI 展示「上次更新 X 前」） */
export interface ModelFetchInfo {
  /** 最近一次成功拉取的毫秒时间戳；从未成功拉取过则为 undefined */
  fetchedAt?: number
  /** 缓存是否在 TTL 内（24h）仍算新鲜 */
  isFresh: boolean
  /** 最近一次拉取失败的提示（拉取成功即清除）；undefined 表示最近一次成功或从未拉取 */
  lastError?: string
}

/**
 * 从供应商 API 拉取可用模型列表
 */
export async function fetchModelsFromProvider(providerId: string, apiKey?: string): Promise<FetchedModelEntry[]> {
  const manifest = getProviderManifest(providerId)
  if (!manifest || manifest.supportsModelListing === false) return []

  const key = apiKey || (await loadApiKey(`worldsea_ak_${providerId}`)) || ''
  if (!key) return []

  // 鉴权方式：OpenAI/多数走 bearer；Anthropic 走 x-api-key 头；Google 走 URL query `key`
  const authType = manifest.modelsAuthType || 'bearer'
  const headers: Record<string, string> = {}
  if (authType === 'api-key-header') {
    headers['x-api-key'] = key
    headers['anthropic-version'] = '2023-06-01'
  } else if (authType === 'bearer') {
    headers['Authorization'] = `Bearer ${key}`
  } else {
    headers['x-goog-api-key'] = key
  }
  headers['content-type'] = 'application/json'

  const modelsPath = manifest.modelsPath || '/v1/models'
  // 模型列表端点 URL：直接直连或以代理拼接（查询拼接统一用 URL 参数）
  const sep = authType === 'query-key' ? (modelsPath.includes('?') ? '&' : '?') : ''
  const directUrl = `${manifest.directBaseUrl}${modelsPath}${sep}${authType === 'query-key' ? `key=${encodeURIComponent(key)}` : ''}`

  // Tauri 模式：直连供应商 API；Web 开发模式：走 Vite 代理
  let modelsUrl: string
  if (isTauri()) {
    modelsUrl = directUrl
  } else {
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    if (origin) {
      const proxyBase = manifest.proxyPath
      modelsUrl = `${origin}${proxyBase}${modelsPath.startsWith('/') ? modelsPath : `/${modelsPath}`}`
    } else {
      modelsUrl = directUrl
    }
  }

  try {
    const res = await smartFetch(modelsUrl, { headers, timeout: 15 })
    if (!res.ok) return []

    const data = await res.json()
    const parserType = manifest.modelsParserType || 'openai'
    let rawIds: string[]

    if (parserType === 'google') {
      // Google: { models: [{ name: "models/gemini-..." }] }
      rawIds = (data.models || []).map((m: any) => {
        const name = typeof m?.name === 'string' ? m.name : ''
        return name.startsWith('models/') ? name.slice('models/'.length) : name
      })
    } else {
      // openai / anthropic: { data: [{ id }] }
      rawIds = (data.data || []).map((m: any) => (typeof m?.id === 'string' ? m.id : ''))
    }

    const models: FetchedModelEntry[] = rawIds
      .filter((id: string) => id.length > 0)
      .map((id: string) => ({ id, provider: providerId }))

    return models.sort((a, b) => a.id.localeCompare(b.id))
  } catch {
    return []
  }
}

/**
 * 获取缓存的动态模型列表（不触发拉取）
 */
export function getCachedModels(providerId: string): FetchedModelEntry[] | null {
  const cached = loadCache(providerId)
  return cached?.models ?? null
}

/**
 * 刷新供应商模型列表（拉取 + 缓存）
 */
export async function refreshModels(providerId: string, apiKey?: string): Promise<FetchedModelEntry[]> {
  const fetched = await fetchModelsFromProvider(providerId, apiKey)
  if (fetched.length > 0) {
    // 拉取成功：写入新缓存（timestamp 会被更新为当前时间，即 fetchedAt）
    saveCache(providerId, fetched)
  } else {
    // 拉取失败：不清缓存，保留上次成功的结果，仅记录失败原因（timestamp 保持成功时间）
    markCacheError(providerId)
  }
  return fetched
}

/**
 * 获取供应商模型列表（缓存优先，过期则异步刷新）
 * 返回缓存中的模型列表，同时触发后台刷新
 */
export function getModelsWithBackgroundRefresh(
  providerId: string,
  apiKey?: string,
  onRefreshed?: (models: FetchedModelEntry[]) => void,
): FetchedModelEntry[] {
  const cached = loadCache(providerId)
  const result = cached?.models ?? []

  // 后台刷新
  refreshModels(providerId, apiKey).then(fresh => {
    if (fresh.length > 0 && onRefreshed) onRefreshed(fresh)
  })

  return result
}

/**
 * 获取供应商模型拉取的「新鲜度」信息（供 UI 显示「上次更新 X 前」）
 */
export function getLastModelFetchInfo(providerId: string): ModelFetchInfo {
  const cached = loadCache(providerId)
  if (!cached) return { isFresh: false }
  return {
    fetchedAt: cached.timestamp,
    isFresh: Date.now() - cached.timestamp <= CACHE_TTL,
    lastError: cached.lastError,
  }
}

/** 清除供应商缓存 */
export function clearModelCache(providerId: string): void {
  localStorage.removeItem(`${CACHE_KEY_PREFIX}${providerId}`)
}

/** 清除所有供应商缓存 */
export function clearAllModelCache(): void {
  const keysToRemove: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key?.startsWith(CACHE_KEY_PREFIX)) keysToRemove.push(key)
  }
  keysToRemove.forEach(k => localStorage.removeItem(k))
}

function loadCache(providerId: string): CachedFetchedModels | null {
  try {
    const raw = localStorage.getItem(`${CACHE_KEY_PREFIX}${providerId}`)
    if (!raw) return null
    const cached: CachedFetchedModels = JSON.parse(raw)
    if (Date.now() - cached.timestamp > CACHE_TTL) {
      localStorage.removeItem(`${CACHE_KEY_PREFIX}${providerId}`)
      return null
    }
    return cached
  } catch {
    return null
  }
}

function saveCache(providerId: string, models: FetchedModelEntry[]): void {
  try {
    const cached: CachedFetchedModels = { timestamp: Date.now(), models }
    localStorage.setItem(`${CACHE_KEY_PREFIX}${providerId}`, JSON.stringify(cached))
  } catch { /* quota exceeded, ignore */ }
}

/** 拉取失败时：保留旧缓存并仅记录失败原因（不清空，也不更新 timestamp 成功时间） */
function markCacheError(providerId: string): void {
  try {
    const raw = localStorage.getItem(`${CACHE_KEY_PREFIX}${providerId}`)
    if (!raw) return
    const cached = JSON.parse(raw) as CachedFetchedModels
    cached.lastError = '拉取失败，已保留上次成功缓存'
    localStorage.setItem(`${CACHE_KEY_PREFIX}${providerId}`, JSON.stringify(cached))
  } catch { /* 忽略写入失败 */ }
}
