import type { ProviderConfig } from '@agent/index'
import type { ModelHealthResult, HealthStatus } from './types'
import { getModelInfo } from '@worldsmith/agent-runtime'

const CACHE_TTL = 5 * 60 * 1000
const HEALTH_TIMEOUT = 10000

const healthCache: Record<string, ModelHealthResult> = {}

export class ModelHealthChecker {
  static async checkHealth(
    providerConfig: ProviderConfig,
    modelId: string,
  ): Promise<ModelHealthResult> {
    const cacheKey = `${(providerConfig as any).provider || 'custom'}:${modelId}`
    const cached = healthCache[cacheKey]
    if (cached && Date.now() - cached.checkedAt < CACHE_TTL) {
      return cached
    }

    const info = getModelInfo(modelId)
    if (!info) {
      const result: ModelHealthResult = {
        status: 'unreachable',
        latency: 0,
        error: '模型未在注册表中找到',
        checkedAt: Date.now(),
      }
      healthCache[cacheKey] = result
      return result
    }

    try {
      const start = Date.now()
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT)

      const provider = (providerConfig as any).provider
      const apiKey = (providerConfig as any).apiKey
      const baseUrl = (providerConfig as any).baseUrl || (providerConfig as any).endpoint

      let endpoint: string
      let headers: Record<string, string>
      let body: string

      if (provider === 'anthropic') {
        const base = baseUrl || 'https://api.anthropic.com/v1'
        endpoint = `${base}/messages`
        headers = {
          'Content-Type': 'application/json',
          'x-api-key': apiKey || '',
          'anthropic-version': '2023-06-01',
        }
        body = JSON.stringify({
          model: modelId,
          max_tokens: 1,
          messages: [{ role: 'user', content: 'Hi' }],
        })
      } else if (provider === 'google') {
        const base = baseUrl || `https://generativelanguage.googleapis.com/v1beta`
        endpoint = `${base}/models/${modelId}:generateContent?key=${apiKey || ''}`
        headers = { 'Content-Type': 'application/json' }
        body = JSON.stringify({
          contents: [{ parts: [{ text: 'Hi' }] }],
          generationConfig: { maxOutputTokens: 1 },
        })
      } else {
        const base = baseUrl || 'https://api.openai.com/v1'
        endpoint = `${base}/chat/completions`
        headers = {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey || ''}`,
        }
        body = JSON.stringify({
          model: modelId,
          max_tokens: 1,
          messages: [{ role: 'user', content: 'Hi' }],
        })
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      })

      clearTimeout(timer)
      const latency = Date.now() - start

      let status: HealthStatus = 'healthy'
      if (latency > 8000) status = 'unreachable'
      else if (latency > 3000) status = 'slow'

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        status = response.status === 401 ? 'unreachable' : 'slow'
        const result: ModelHealthResult = {
          status,
          latency,
          error: `HTTP ${response.status}: ${errorText.slice(0, 100)}`,
          checkedAt: Date.now(),
        }
        healthCache[cacheKey] = result
        return result
      }

      const result: ModelHealthResult = {
        status,
        latency,
        checkedAt: Date.now(),
      }
      healthCache[cacheKey] = result
      return result
    } catch (err: any) {
      const result: ModelHealthResult = {
        status: 'unreachable',
        latency: 0,
        error: err.name === 'AbortError' ? '请求超时' : (err.message || '连接失败'),
        checkedAt: Date.now(),
      }
      healthCache[cacheKey] = result
      return result
    }
  }

  static async checkMultiple(
    configs: Array<{ providerConfig: ProviderConfig; modelId: string; agentId: string }>,
  ): Promise<Record<string, ModelHealthResult>> {
    const promises = configs.map(async ({ providerConfig, modelId, agentId }) => {
      const result = await ModelHealthChecker.checkHealth(providerConfig, modelId)
      return { agentId, result }
    })
    const settled = await Promise.allSettled(promises)
    const results: Record<string, ModelHealthResult> = {}
    for (const r of settled) {
      if (r.status === 'fulfilled') {
        results[r.value.agentId] = r.value.result
      }
    }
    return results
  }

  static clearCache(): void {
    for (const key of Object.keys(healthCache)) {
      delete healthCache[key]
    }
  }
}