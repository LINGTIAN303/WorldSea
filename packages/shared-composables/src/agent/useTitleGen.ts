import type { ProviderConfig } from '@agent/index'
import { buildDirectEndpoint, getProviderManifest } from '@agent/providers/provider-registry'

const TITLE_PROMPT = `根据以下对话内容，生成一个简短的会话标题（不超过20个字，不要加引号，不要加句号，只输出标题本身）：

用户：{user}
助手：{assistant}`

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

export async function generateTitle(
  cfg: ProviderConfig,
  userMsg: string,
  assistantMsg: string,
): Promise<string | null> {
  const prompt = TITLE_PROMPT
    .replace('{user}', userMsg.slice(0, 300))
    .replace('{assistant}', assistantMsg.slice(0, 300))

  const { url, headers, model } = resolveEndpoint(cfg)

  const body = buildLLMBody(cfg, model, prompt, 60, 0.3)

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    if (!resp.ok) return null

    const json = await resp.json()
    const title = extractTitle(cfg, json)
    if (!title) return null
    return title.slice(0, 30)
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}
