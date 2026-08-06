/** HostLlmAdapter：LlmAdapter 宿主实现（OpenAI 兼容 provider，失败自动降级），详细见 docs/details/注释/web/memory-archive/adapters/HostLlmAdapter.md */

import type { LlmAdapter } from '@worldsmith/memory-archive/adapters'
import type { ProviderConfig } from '@worldsmith/agent-runtime'
import { resolveModel, buildDirectEndpoint } from '@worldsmith/agent-runtime'
import { useAgent } from '@/agent/composables/useAgent'

/** 简化的消息格式（LlmAdapter 接口要求） */
type SimpleMessage = { role: string; content: string }

/** OpenAI 兼容的 chat completion 响应结构 */
interface ChatCompletionResponse {
  choices?: Array<{
    message?: { role: string; content: string }
  }>
  error?: { message: string }
}

/**
 * 创建宿主 LLM 适配器
 *
 * 使用 useAgent 的当前 provider 配置调用 LLM。
 * 需要在 Agent 初始化后使用（getProviderConfig() 才有值）。
 */
export function createHostLlmAdapter(): LlmAdapter {
  return {
    isReady(): boolean {
      const config = getActiveProviderConfig()
      if (!config) return false
      // local 模式不支持 LLM 摘要（通常是 Ollama 等本地模型，能力有限）
      if (config.mode === 'local') return false
      // 检查 apiKey
      if (config.mode === 'cloud') return !!config.apiKey
      if (config.mode === 'custom') return !!config.apiKey
      return false
    },

    async summarize(messages: SimpleMessage[], maxLength: number): Promise<string> {
      const { url, headers, model } = await prepareLlmRequest()

      const conversationText = messages
        .map(m => `[${m.role}] ${m.content}`)
        .join('\n\n')

      const systemPrompt = '你是一个对话摘要生成助手。请生成一段结构化摘要，包含主要话题、关键决策和重要信息。摘要应该简洁但信息完整。'

      const userPrompt = `请为以下对话生成摘要（不超过${maxLength}字符）：

${conversationText}`

      const response = await callChatCompletion(url, headers, model, [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ], Math.min(maxLength, 4000), 0.3)

      return response
    },

    async assessImportance(messages: SimpleMessage[]): Promise<number> {
      const { url, headers, model } = await prepareLlmRequest()

      const conversationText = messages
        .map(m => `[${m.role}] ${m.content}`)
        .join('\n\n')

      const systemPrompt = '你是一个对话重要性评估助手。请评估对话的重要性，只返回一个0到1之间的数字（0=日常闲聊，1=关键决策/重要信息），不要返回其他内容。'

      const userPrompt = `请评估以下对话的重要性（0-1）：

${conversationText}`

      const response = await callChatCompletion(url, headers, model, [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ], 100, 0.0)

      // 解析数字
      const score = parseFloat(response.trim())
      if (isNaN(score)) return 0.5 // 解析失败返回默认值
      return Math.max(0, Math.min(1, score))
    },

    async extractKeywords(messages: SimpleMessage[]): Promise<string[]> {
      const { url, headers, model } = await prepareLlmRequest()

      const conversationText = messages
        .map(m => `[${m.role}] ${m.content}`)
        .join('\n\n')

      const systemPrompt = '你是一个关键词提取助手。请从对话中提取5-10个关键词，用逗号分隔，只返回关键词列表，不要其他内容。'

      const userPrompt = `请从以下对话中提取关键词：

${conversationText}`

      const response = await callChatCompletion(url, headers, model, [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ], 200, 0.3)

      // 解析关键词列表（支持逗号/顿号/换行分隔）
      const keywords = response
        .split(/[,，、\n]/)
        .map(k => k.trim())
        .filter(k => k.length > 0 && k.length <= 20)
        .slice(0, 10)

      return keywords
    },
  }
}

// ===== 内部辅助函数 =====

/** 从 useAgent 获取当前有效的 provider 配置 */
function getActiveProviderConfig(): ProviderConfig | null {
  try {
    const agent = useAgent()
    return agent.getProviderConfig()
  } catch {
    return null
  }
}

/** 准备 LLM 请求所需的 URL、headers 和 model */
async function prepareLlmRequest(): Promise<{ url: string; headers: Record<string, string>; model: string }> {
  const config = getActiveProviderConfig()
  if (!config) {
    throw new Error('[HostLlmAdapter] Provider config not available')
  }

  const resolved = resolveModel(config)

  if (config.mode === 'cloud') {
    // cloud 模式：使用 buildDirectEndpoint 构建端点
    const endpoint = buildDirectEndpoint(config.provider, config.apiKey, config.modelId)
    return {
      url: endpoint.url,
      headers: endpoint.headers,
      model: resolved.modelId,
    }
  } else if (config.mode === 'custom') {
    // custom 模式：直接使用 baseUrl + /v1/chat/completions
    const baseUrl = config.baseUrl.replace(/\/$/, '')
    const chatPath = config.apiType === 'anthropic-compatible' ? '/v1/messages' : '/v1/chat/completions'
    return {
      url: `${baseUrl}${chatPath}`,
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'content-type': 'application/json',
      },
      model: config.modelId,
    }
  } else {
    // local 模式：不支持
    throw new Error('[HostLlmAdapter] Local provider not supported for LLM summarization')
  }
}

/** 调用 OpenAI 兼容的 chat completion API */
async function callChatCompletion(
  url: string,
  headers: Record<string, string>,
  model: string,
  messages: Array<{ role: string; content: string }>,
  maxTokens: number,
  temperature: number,
): Promise<string> {
  const body = JSON.stringify({
    model,
    messages,
    max_tokens: maxTokens,
    temperature,
    stream: false,
  })

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body,
  })

  if (!response.ok) {
    const errText = await response.text().catch(() => 'Unknown error')
    throw new Error(`[HostLlmAdapter] LLM API error (${response.status}): ${errText}`)
  }

  const data: ChatCompletionResponse = await response.json()

  if (data.error) {
    throw new Error(`[HostLlmAdapter] LLM API returned error: ${data.error.message}`)
  }

  const content = data.choices?.[0]?.message?.content
  if (!content) {
    throw new Error('[HostLlmAdapter] LLM API returned empty response')
  }

  return content
}
