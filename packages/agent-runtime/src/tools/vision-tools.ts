/** 视觉分析工具集：跨供应商图片视觉分析（OpenAI/Anthropic/Gemini），详细见 docs/details/注释/packages/agent-runtime/tools-vision-tools.md */

import type { ToolDefinition } from '../bridge-types'
import type { ToolMeta } from '@worldsmith/agent-core'
import type { IToolContext } from '../toolbus/types'
import { storeImages, getImages, removeImages, type StoredImage } from '../stores/image-store'
import { loadApiKey } from '../providers/key-store'
import { getAllProviderManifests } from '../providers/provider-registry'
import { smartFetch, resolveApiBaseUrl } from '../utils/smart-fetch'

export { storeImages, getImages, removeImages, type StoredImage }

/** localStorage 键名：视觉子 Agent 的供应商和模型配置 */
const VISION_SUB_AGENT_PROVIDER_KEY = 'worldsmith_vision_sub_agent_provider'
const VISION_SUB_AGENT_MODEL_KEY = 'worldsmith_vision_sub_agent_model'

/** 视觉 API 的供应商代理路径映射（从 provider-registry 统一读取） */
const PROVIDER_BASE_URLS: Record<string, string> = (() => {
  const map: Record<string, string> = {}
  for (const m of getAllProviderManifests()) {
    map[m.id] = resolveApiBaseUrl(m.id)
  }
  // Google 视觉端点路径不同
  map['google'] = resolveApiBaseUrl('google').replace(/\/v1$/, '/v1beta')
  return map
})()

/** 读取视觉模型配置，未配置返回 null */
function getVisionConfig(): { provider: string; modelId: string } | null {
  const provider = localStorage.getItem(VISION_SUB_AGENT_PROVIDER_KEY) || ''
  const modelId = localStorage.getItem(VISION_SUB_AGENT_MODEL_KEY) || ''
  if (provider && modelId) return { provider, modelId }
  return null
}

/** 视觉分析请求超时时间 (120 秒) */
const VISION_TIMEOUT = 120_000

/**
 * 统一视觉 API 调用入口
 * 根据供应商名称分发到对应的 API 实现
 */
async function callVisionApi(
  provider: string,
  modelId: string,
  apiKey: string,
  prompt: string,
  images: StoredImage[],
): Promise<string> {
  const baseUrl = PROVIDER_BASE_URLS[provider]
  if (!baseUrl) throw new Error(`未知的视觉模型供应商: ${provider}`)

  const isAnthropic = provider === 'anthropic'
  const isGoogle = provider === 'google'

  if (isAnthropic) {
    return callAnthropicApi(baseUrl, modelId, apiKey, prompt, images)
  }

  if (isGoogle) {
    return callGoogleApi(baseUrl, modelId, apiKey, prompt, images)
  }

  return callOpenAiCompatibleApi(baseUrl, modelId, apiKey, prompt, images)
}

/**
 * OpenAI 兼容 API 调用
 * 构建 chat/completions 请求，图片以 image_url 类型嵌入 content 数组
 */
async function callOpenAiCompatibleApi(
  baseUrl: string,
  modelId: string,
  apiKey: string,
  prompt: string,
  images: StoredImage[],
): Promise<string> {
  const content: any[] = []
  for (const img of images) {
    content.push({
      type: 'image_url',
      image_url: {
        url: `data:${img.mimeType};base64,${img.data}`,
      },
    })
  }
  content.push({ type: 'text', text: prompt })

  const body = {
    model: modelId,
    messages: [
      { role: 'user', content },
    ],
    max_tokens: 4096,
    stream: false,
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), VISION_TIMEOUT)

  try {
    const resp = await smartFetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
      timeout: 120,
    })

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '')
      throw new Error(`API 返回 ${resp.status}: ${errText.slice(0, 500)}`)
    }

    const json = await resp.json()
    const text = json?.choices?.[0]?.message?.content
    if (!text) throw new Error('API 返回空内容')
    return text
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Anthropic 原生 API 调用
 * 使用 v1/messages 端点，x-api-key 鉴权，content 用 image source 格式
 */
async function callAnthropicApi(
  baseUrl: string,
  modelId: string,
  apiKey: string,
  prompt: string,
  images: StoredImage[],
): Promise<string> {
  const content: any[] = []
  for (const img of images) {
    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: img.mimeType,
        data: img.data,
      },
    })
  }
  content.push({ type: 'text', text: prompt })

  const body = {
    model: modelId,
    messages: [
      { role: 'user', content },
    ],
    max_tokens: 4096,
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), VISION_TIMEOUT)

  try {
    const resp = await smartFetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
      timeout: 120,
    })

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '')
      throw new Error(`API 返回 ${resp.status}: ${errText.slice(0, 500)}`)
    }

    const json = await resp.json()
    const text = json?.content?.[0]?.text
    if (!text) throw new Error('API 返回空内容')
    return text
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Google Gemini API 调用
 * 使用 generateContent 端点，API Key 通过查询参数传递
 * 图片以 inline_data 格式嵌入 parts 数组
 */
async function callGoogleApi(
  baseUrl: string,
  modelId: string,
  apiKey: string,
  prompt: string,
  images: StoredImage[],
): Promise<string> {
  const parts: any[] = []
  for (const img of images) {
    parts.push({
      inline_data: {
        mime_type: img.mimeType,
        data: img.data,
      },
    })
  }
  parts.push({ text: prompt })

  const body = {
    contents: [
      { role: 'user', parts },
    ],
    generationConfig: {
      maxOutputTokens: 4096,
    },
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), VISION_TIMEOUT)

  try {
    const url = `${baseUrl}/models/${modelId}:generateContent?key=${apiKey}`
    const resp = await smartFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
      timeout: 120,
    })

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '')
      throw new Error(`API 返回 ${resp.status}: ${errText.slice(0, 500)}`)
    }

    const json = await resp.json()
    const text = json?.candidates?.[0]?.content?.parts?.[0]?.text
    if (!text) throw new Error('API 返回空内容')
    return text
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * vision_analyze 工具
 *
 * 分析用户发送的图片内容。从 image-store 内存缓存中获取图片数据，
 * 调用配置的视觉子模型进行分析。支持跨供应商调用。
 */
const visionAnalyzeTool: ToolDefinition = {
  name: 'vision_analyze',
  description: '分析图片内容。当用户发送了图片需要识别、描述、分析时使用此工具。支持跨厂商调用视觉模型——即使当前主模型不支持视觉，也能通过此工具调用支持视觉的模型来分析图片。可以多次调用以获取不同角度的分析。',
  parameters: {
    image_id: {
      type: 'string',
      description: '图片批次 ID（系统在用户发送图片时生成并告知你）',
      required: true,
    },
    prompt: {
      type: 'string',
      description: '对图片的分析要求。例如："详细描述图片内容"、"识别图片中的文字"、"分析图片中的颜色和构图"、"对比这些图片的异同"',
      required: true,
    },
  },
  meta: {
    permission: 'safe',
    category: 'vision',
    alwaysAvailable: true,
    displayName: '视觉分析',
  } satisfies ToolMeta,
  execute: async (args: Record<string, unknown>, _ctx: IToolContext): Promise<string> => {
    const imageId = String(args.image_id)
    const prompt = String(args.prompt)

    const images = getImages(imageId)
    if (!images || images.length === 0) {
      return JSON.stringify({
        ok: false,
        error: `未找到图片（ID: ${imageId}）。图片可能已过期（30分钟有效期），请让用户重新发送。`,
      })
    }

    const visionConfig = getVisionConfig()
    if (!visionConfig) {
      return JSON.stringify({
        ok: false,
        error: '视觉 SubAgent 未配置。请在设置 > 视觉面板中配置视觉模型供应商和模型。',
      })
    }

    const apiKey = await loadApiKey(visionConfig.provider)
    if (!apiKey) {
      const providerNames: Record<string, string> = {
        anthropic: 'Anthropic', openai: 'OpenAI', google: 'Google',
        deepseek: 'DeepSeek', groq: 'Groq', openrouter: 'OpenRouter',
        zhipu: '智谱', qwen: '通义千问', minimax: 'MiniMax', kimi: 'Kimi',
      }
      return JSON.stringify({
        ok: false,
        error: `视觉模型供应商 ${providerNames[visionConfig.provider] || visionConfig.provider} 未配置 API Key，请在供应商面板中填入。`,
      })
    }

    try {
      const analysis = await callVisionApi(
        visionConfig.provider,
        visionConfig.modelId,
        apiKey,
        prompt,
        images,
      )

      return JSON.stringify({
        ok: true,
        imageCount: images.length,
        analysis,
      })
    } catch (err) {
      return JSON.stringify({
        ok: false,
        error: `视觉分析失败: ${err instanceof Error ? err.message : String(err)}`,
      })
    }
  },
}

/**
 * list_vision_images 工具
 *
 * 查看当前可用的图片批次（信息有限，因图片数据不在工具上下文中直接暴露）
 */
const listVisionImagesTool: ToolDefinition = {
  name: 'list_vision_images',
  description: '查看当前可用的图片批次列表。当不确定有哪些图片可用时使用此工具。',
  parameters: {},
  meta: {
    permission: 'safe',
    category: 'vision',
    alwaysAvailable: true,
    displayName: '列出视觉图片',
  } satisfies ToolMeta,
  execute: async (_args: Record<string, unknown>, _ctx: IToolContext): Promise<string> => {
    return JSON.stringify({
      ok: true,
      hint: '图片 ID 在用户发送图片时由系统生成，会包含在用户消息中。请查看用户消息中的图片 ID，然后使用 vision_analyze 工具分析。',
    })
  },
}

export const visionTools = [visionAnalyzeTool, listVisionImagesTool]
