/**
 * 动态模型拉取服务
 *
 * 通过各供应商的 /v1/models 端点动态获取可用模型列表。
 * 拉取结果仅返回模型 ID 列表，由消费方与 MODEL_REGISTRY 合并。
 *
 * 特性：
 * - 结果缓存到 localStorage（24 小时过期），避免每次启动都拉取
 * - 支持手动刷新
 * - 未知模型使用合理默认值填充
 */

import { buildModelsEndpoint, getProviderManifest } from './provider-registry'
import { loadApiKey } from './key-store'
import { smartFetch } from '../utils/smart-fetch'
import { isTauri } from '../execution'

/** 缓存 key 前缀 */
const CACHE_KEY_PREFIX = 'worldsmith_fetched_models_'
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
  timestamp: number
  models: FetchedModelEntry[]
}

/**
 * 从供应商 API 拉取可用模型列表
 */
export async function fetchModelsFromProvider(providerId: string, apiKey?: string): Promise<FetchedModelEntry[]> {
  const manifest = getProviderManifest(providerId)
  if (!manifest || manifest.supportsModelListing === false) return []

  const key = apiKey || loadApiKey(`worldsmith_ak_${providerId}`) || ''
  if (!key) return []

  // 构建请求 URL：优先使用代理路径（开发环境），降级到直连
  let modelsUrl: string
  const headers: Record<string, string> = { 'Authorization': `Bearer ${key}` }

  // Tauri 模式：直连供应商 API；Web 开发模式：走 Vite 代理
  if (isTauri()) {
    const directUrl = buildModelsEndpoint(providerId)
    if (!directUrl) return []
    modelsUrl = directUrl
  } else {
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    if (origin) {
      const proxyBase = manifest.proxyPath
      const modelsPath = manifest.modelsPath || '/models'
      modelsUrl = `${origin}${proxyBase}${modelsPath.startsWith('/') ? modelsPath : `/${modelsPath}`}`
    } else {
      const directUrl = buildModelsEndpoint(providerId)
      if (!directUrl) return []
      modelsUrl = directUrl
    }
  }

  try {
    const res = await smartFetch(modelsUrl, {
      headers,
      timeout: 15,
    })
    if (!res.ok) return []

    const data = await res.json()
    const models: FetchedModelEntry[] = (data.data || [])
      .map((m: any) => {
        const id = typeof m.id === 'string' ? m.id : ''
        if (!id) return null
        return { id, provider: providerId }
      })
      .filter(Boolean) as FetchedModelEntry[]

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
    saveCache(providerId, fetched)
  } else {
    // 拉取失败不清缓存，保留上次成功的结果
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
