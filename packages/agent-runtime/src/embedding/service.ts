import { smartFetch } from '../utils/smart-fetch'

export interface EmbeddingConfig {
  baseUrl: string
  apiKey: string
  model: string
  dimensions: number
}

export const EMBEDDING_PRESETS: Record<string, EmbeddingConfig> = {
  deepseek: {
    baseUrl: 'https://api.deepseek.com',
    apiKey: '',
    model: 'deepseek-embedding',
    dimensions: 1024,
  },
  openai: {
    baseUrl: 'https://api.openai.com',
    apiKey: '',
    model: 'text-embedding-3-small',
    dimensions: 1536,
  },
  openai_large: {
    baseUrl: 'https://api.openai.com',
    apiKey: '',
    model: 'text-embedding-3-large',
    dimensions: 3072,
  },
}

const STORAGE_KEY = 'worldsmith_embedding_config'
const CACHE_KEY = 'worldsmith_embedding_cache'

interface CacheEntry {
  hash: string
  vector: number[]
  timestamp: number
}

const MAX_CACHE_SIZE = 500
const CACHE_TTL_MS = 24 * 60 * 60 * 1000

let embeddingCache = new Map<string, number[]>()

function textHash(text: string): string {
  let h = 0
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) - h + text.charCodeAt(i)) | 0
  }
  return h.toString(36)
}

function loadCache(): void {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return
    const entries: CacheEntry[] = JSON.parse(raw)
    const now = Date.now()
    for (const e of entries) {
      if (now - e.timestamp < CACHE_TTL_MS) {
        embeddingCache.set(e.hash, e.vector)
      }
    }
  } catch {}
}

function saveCache(): void {
  try {
    const entries: CacheEntry[] = []
    const now = Date.now()
    for (const [hash, vector] of embeddingCache) {
      entries.push({ hash, vector, timestamp: now })
    }
    if (entries.length > MAX_CACHE_SIZE) {
      entries.splice(0, entries.length - MAX_CACHE_SIZE)
    }
    localStorage.setItem(CACHE_KEY, JSON.stringify(entries))
  } catch {}
}

loadCache()

export function getEmbeddingConfig(): EmbeddingConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch {}
  return null
}

export function saveEmbeddingConfig(config: EmbeddingConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
}

export async function generateEmbedding(text: string, config?: EmbeddingConfig): Promise<number[]> {
  const trimmed = text.trim().slice(0, 2000)
  const cacheKey = textHash(trimmed)

  if (embeddingCache.has(cacheKey)) {
    return embeddingCache.get(cacheKey)!
  }

  const cfg = config || getEmbeddingConfig()
  if (!cfg || !cfg.apiKey) {
    throw new Error('Embedding API 未配置')
  }

  const url = `${cfg.baseUrl}/v1/embeddings`
  const body: any = {
    model: cfg.model,
    input: trimmed,
  }
  if (cfg.model.includes('text-embedding-3')) {
    body.dimensions = cfg.dimensions
  }

  const response = await smartFetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify(body),
    timeout: 30,
  })

  if (!response.ok) {
    const errText = await response.text()
    throw new Error(`Embedding API 错误 (${response.status}): ${errText}`)
  }

  const data = await response.json()
  const vector: number[] = data.data[0].embedding

  embeddingCache.set(cacheKey, vector)
  saveCache()

  return vector
}

export async function generateEmbeddings(texts: string[], config?: EmbeddingConfig): Promise<number[][]> {
  const cfg = config || getEmbeddingConfig()
  if (!cfg || !cfg.apiKey) {
    throw new Error('Embedding API 未配置')
  }

  const results: number[][] = []
  const uncached: { index: number; text: string }[] = []

  for (let i = 0; i < texts.length; i++) {
    const trimmed = texts[i].trim().slice(0, 2000)
    const cacheKey = textHash(trimmed)
    if (embeddingCache.has(cacheKey)) {
      results[i] = embeddingCache.get(cacheKey)!
    } else {
      uncached.push({ index: i, text: trimmed })
    }
  }

  if (uncached.length > 0) {
    const BATCH_SIZE = 20
    for (let b = 0; b < uncached.length; b += BATCH_SIZE) {
      const batch = uncached.slice(b, b + BATCH_SIZE)
      const url = `${cfg.baseUrl}/v1/embeddings`
      const body: any = {
        model: cfg.model,
        input: batch.map(b => b.text),
      }
      if (cfg.model.includes('text-embedding-3')) {
        body.dimensions = cfg.dimensions
      }

      const response = await smartFetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${cfg.apiKey}`,
        },
        body: JSON.stringify(body),
        timeout: 60,
      })

      if (!response.ok) {
        const errText = await response.text()
        throw new Error(`Embedding API 批量错误 (${response.status}): ${errText}`)
      }

      const data = await response.json()
      const sortedData = [...data.data].sort((a: any, b: any) => a.index - b.index)
      for (let j = 0; j < batch.length; j++) {
        const vector: number[] = sortedData[j].embedding
        results[batch[j].index] = vector
        const cacheKey = textHash(batch[j].text)
        embeddingCache.set(cacheKey, vector)
      }
    }
    saveCache()
  }

  return results
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dot / denom
}

export function clearEmbeddingCache(): void {
  embeddingCache.clear()
  localStorage.removeItem(CACHE_KEY)
}
