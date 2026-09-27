/**
 * Companion LLM 调用辅助（自旧 shared-composables/agent/useTitleGen.ts 打捞，2026-09-27 E8）
 * 仅保留陪伴模式所需三函数：resolveEndpoint / buildLLMBody / extractTitle；
 * 会话标题生成（generateTitle）随旧 Agent 会话面退场，不再保留。
 */

import type { ProviderConfig } from '@worldsea/ui-kit/model-registry'
import { buildDirectEndpoint, getProviderManifest } from '@worldsea/ui-kit/model-registry'

export function resolveEndpoint(cfg: ProviderConfig): { url: string; headers: Record<string, string>; model: string } {
  if (cfg.mode === 'cloud') {
    const endpoint = buildDirectEndpoint(cfg.provider, cfg.apiKey, cfg.modelId)
    return { url: endpoint.url, headers: endpoint.headers, model: cfg.modelId }
  }

  if (cfg.mode === 'local') {
    const base = cfg.endpoint.replace(/\/+$/, '')
    return {
      url: `${base}/v1/chat/completions`,
      headers: { 'content-type': 'application/json' },
      model: cfg.modelId,
    }
  }

  const base = cfg.baseUrl.replace(/\/+$/, '')
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (cfg.apiKey) headers['Authorization'] = `Bearer ${cfg.apiKey}`
  return {
    url: `${base}/v1/chat/completions`,
    headers,
    model: cfg.modelId,
  }
}

export function buildLLMBody(
  cfg: ProviderConfig,
  model: string,
  prompt: string,
  maxTokens: number,
  temperature: number,
): any {
  const manifest = cfg.mode === 'cloud' ? getProviderManifest(cfg.provider) : undefined
  const bodyType = manifest?.bodyBuilderType || 'openai'

  if (bodyType === 'google') {
    return { contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: maxTokens, temperature } }
  }
  // anthropic 和 openai 共用相同结构
  return { model, messages: [{ role: 'user', content: prompt }], max_tokens: maxTokens, temperature }
}

export function extractTitle(cfg: ProviderConfig, json: any): string | null {
  try {
    const manifest = cfg.mode === 'cloud' ? getProviderManifest(cfg.provider) : undefined
    const parserType = manifest?.responseParserType || 'openai'

    if (parserType === 'google') {
      return json?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null
    }
    if (parserType === 'anthropic') {
      return json?.content?.[0]?.text?.trim() || json?.content?.[0]?.input?.trim() || null
    }
    return json?.choices?.[0]?.message?.content?.trim() || null
  } catch { return null }
}
