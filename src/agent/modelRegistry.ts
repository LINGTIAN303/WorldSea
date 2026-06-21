import { DEFAULT_CLOUD_CONFIGS } from '@agent/index'
import { getProviderLabelMap, getProviderManifest, detectVisionSupport } from '@agent/providers/provider-registry'
import { getCachedModels, getModelsWithBackgroundRefresh, type FetchedModelEntry } from '@agent/providers/model-fetcher'

export interface ModelInfo {
  id: string
  name: string
  provider: string
  contextLength: number
  maxOutputTokens: number
  supportsThinking: boolean
  supportsVision: boolean
  thinkingModes?: string[]
  inputPricePerMillion: number
  outputPricePerMillion: number
  cacheReadPricePerMillion: number
  cacheWritePricePerMillion: number
  currency: 'USD' | 'CNY'
}

export const MODEL_REGISTRY: ModelInfo[] = [
  { id: 'claude-opus-4-8', name: 'Claude Opus 4.8', provider: 'anthropic', contextLength: 1000000, maxOutputTokens: 128000, supportsThinking: true, supportsVision: true, thinkingModes: ['low', 'medium', 'high', 'xhigh'], inputPricePerMillion: 5, outputPricePerMillion: 25, cacheReadPricePerMillion: 0.5, cacheWritePricePerMillion: 6.25, currency: 'USD' },
  { id: 'claude-opus-4-7', name: 'Claude Opus 4.7', provider: 'anthropic', contextLength: 1000000, maxOutputTokens: 128000, supportsThinking: true, supportsVision: true, thinkingModes: ['low', 'medium', 'high', 'xhigh'], inputPricePerMillion: 5, outputPricePerMillion: 25, cacheReadPricePerMillion: 0.5, cacheWritePricePerMillion: 6.25, currency: 'USD' },
  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', provider: 'anthropic', contextLength: 1000000, maxOutputTokens: 64000, supportsThinking: true, supportsVision: true, thinkingModes: ['minimal', 'low', 'medium', 'high'], inputPricePerMillion: 3, outputPricePerMillion: 15, cacheReadPricePerMillion: 0.3, cacheWritePricePerMillion: 3.75, currency: 'USD' },
  { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', provider: 'anthropic', contextLength: 200000, maxOutputTokens: 64000, supportsThinking: true, supportsVision: true, thinkingModes: ['low', 'medium', 'high'], inputPricePerMillion: 1, outputPricePerMillion: 5, cacheReadPricePerMillion: 0.1, cacheWritePricePerMillion: 1.25, currency: 'USD' },
  { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', provider: 'anthropic', contextLength: 200000, maxOutputTokens: 64000, supportsThinking: true, supportsVision: true, thinkingModes: ['minimal', 'low', 'medium', 'high'], inputPricePerMillion: 3, outputPricePerMillion: 15, cacheReadPricePerMillion: 0.3, cacheWritePricePerMillion: 3.75, currency: 'USD' },
  { id: 'claude-opus-4-5-20251101', name: 'Claude Opus 4.5', provider: 'anthropic', contextLength: 200000, maxOutputTokens: 64000, supportsThinking: true, supportsVision: true, thinkingModes: ['minimal', 'low', 'medium', 'high'], inputPricePerMillion: 15, outputPricePerMillion: 75, cacheReadPricePerMillion: 1.5, cacheWritePricePerMillion: 18.75, currency: 'USD' },
  { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', provider: 'anthropic', contextLength: 200000, maxOutputTokens: 8192, supportsThinking: false, supportsVision: true, inputPricePerMillion: 0.8, outputPricePerMillion: 4, cacheReadPricePerMillion: 0.08, cacheWritePricePerMillion: 1, currency: 'USD' },
  { id: 'gpt-5.5', name: 'GPT-5.5', provider: 'openai', contextLength: 1000000, maxOutputTokens: 128000, supportsThinking: true, supportsVision: true, thinkingModes: ['low', 'medium', 'high', 'xhigh'], inputPricePerMillion: 5, outputPricePerMillion: 30, cacheReadPricePerMillion: 0.5, cacheWritePricePerMillion: 5, currency: 'USD' },
  { id: 'gpt-5.4', name: 'GPT-5.4', provider: 'openai', contextLength: 1000000, maxOutputTokens: 128000, supportsThinking: true, supportsVision: true, thinkingModes: ['low', 'medium', 'high', 'xhigh'], inputPricePerMillion: 2.5, outputPricePerMillion: 15, cacheReadPricePerMillion: 0.25, cacheWritePricePerMillion: 2.5, currency: 'USD' },
  { id: 'gpt-5.4-mini', name: 'GPT-5.4 Mini', provider: 'openai', contextLength: 400000, maxOutputTokens: 128000, supportsThinking: true, supportsVision: true, thinkingModes: ['low', 'medium', 'high', 'xhigh'], inputPricePerMillion: 0.75, outputPricePerMillion: 4.5, cacheReadPricePerMillion: 0.075, cacheWritePricePerMillion: 0.75, currency: 'USD' },
  { id: 'gpt-5', name: 'GPT-5', provider: 'openai', contextLength: 400000, maxOutputTokens: 128000, supportsThinking: true, supportsVision: true, thinkingModes: ['low', 'medium', 'high'], inputPricePerMillion: 1.25, outputPricePerMillion: 10, cacheReadPricePerMillion: 0.625, cacheWritePricePerMillion: 1.25, currency: 'USD' },
  { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai', contextLength: 128000, maxOutputTokens: 16384, supportsThinking: false, supportsVision: true, inputPricePerMillion: 2.5, outputPricePerMillion: 10, cacheReadPricePerMillion: 1.25, cacheWritePricePerMillion: 2.5, currency: 'USD' },
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini', provider: 'openai', contextLength: 128000, maxOutputTokens: 16384, supportsThinking: false, supportsVision: true, inputPricePerMillion: 0.15, outputPricePerMillion: 0.6, cacheReadPricePerMillion: 0.075, cacheWritePricePerMillion: 0.15, currency: 'USD' },
  { id: 'o3', name: 'o3', provider: 'openai', contextLength: 200000, maxOutputTokens: 100000, supportsThinking: true, supportsVision: true, thinkingModes: ['low', 'medium', 'high'], inputPricePerMillion: 2, outputPricePerMillion: 8, cacheReadPricePerMillion: 0.5, cacheWritePricePerMillion: 2, currency: 'USD' },
  { id: 'o4-mini', name: 'o4-mini', provider: 'openai', contextLength: 200000, maxOutputTokens: 100000, supportsThinking: true, supportsVision: true, thinkingModes: ['low', 'medium', 'high'], inputPricePerMillion: 1.1, outputPricePerMillion: 4.4, cacheReadPricePerMillion: 0.275, cacheWritePricePerMillion: 1.1, currency: 'USD' },
  { id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash', provider: 'google', contextLength: 1048576, maxOutputTokens: 65536, supportsThinking: true, supportsVision: true, thinkingModes: ['minimal', 'low', 'medium', 'high'], inputPricePerMillion: 1.5, outputPricePerMillion: 9, cacheReadPricePerMillion: 0.15, cacheWritePricePerMillion: 1.5, currency: 'USD' },
  { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro', provider: 'google', contextLength: 1048576, maxOutputTokens: 65536, supportsThinking: true, supportsVision: true, thinkingModes: ['minimal', 'low', 'medium', 'high'], inputPricePerMillion: 2, outputPricePerMillion: 12, cacheReadPricePerMillion: 0.5, cacheWritePricePerMillion: 2, currency: 'USD' },
  { id: 'gemini-2.5-pro-preview-05-06', name: 'Gemini 2.5 Pro', provider: 'google', contextLength: 1048576, maxOutputTokens: 65536, supportsThinking: true, supportsVision: true, thinkingModes: ['minimal', 'low', 'medium', 'high'], inputPricePerMillion: 1.25, outputPricePerMillion: 10, cacheReadPricePerMillion: 0.31, cacheWritePricePerMillion: 1.25, currency: 'USD' },
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', provider: 'google', contextLength: 1048576, maxOutputTokens: 65536, supportsThinking: true, supportsVision: true, thinkingModes: ['minimal', 'low', 'medium', 'high'], inputPricePerMillion: 0.15, outputPricePerMillion: 0.6, cacheReadPricePerMillion: 0.0375, cacheWritePricePerMillion: 0.15, currency: 'USD' },
  { id: 'deepseek-chat', name: 'DeepSeek Chat', provider: 'deepseek', contextLength: 128000, maxOutputTokens: 8192, supportsThinking: false, supportsVision: false, inputPricePerMillion: 0.27, outputPricePerMillion: 1.1, cacheReadPricePerMillion: 0.07, cacheWritePricePerMillion: 0.27, currency: 'CNY' },
  { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner', provider: 'deepseek', contextLength: 128000, maxOutputTokens: 8192, supportsThinking: true, supportsVision: false, thinkingModes: ['low', 'medium', 'high'], inputPricePerMillion: 4, outputPricePerMillion: 16, cacheReadPricePerMillion: 1, cacheWritePricePerMillion: 4, currency: 'CNY' },
  { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', provider: 'deepseek', contextLength: 1000000, maxOutputTokens: 384000, supportsThinking: false, supportsVision: false, inputPricePerMillion: 0.14, outputPricePerMillion: 0.28, cacheReadPricePerMillion: 0.0028, cacheWritePricePerMillion: 0.14, currency: 'USD' },
  { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', provider: 'deepseek', contextLength: 1000000, maxOutputTokens: 384000, supportsThinking: true, supportsVision: false, thinkingModes: ['minimal', 'low', 'medium', 'high'], inputPricePerMillion: 0.435, outputPricePerMillion: 0.87, cacheReadPricePerMillion: 0.003625, cacheWritePricePerMillion: 0.435, currency: 'USD' },
  { id: 'openai/gpt-oss-120b', name: 'GPT-OSS 120B', provider: 'groq', contextLength: 131072, maxOutputTokens: 65536, supportsThinking: false, supportsVision: false, inputPricePerMillion: 0.15, outputPricePerMillion: 0.6, cacheReadPricePerMillion: 0.15, cacheWritePricePerMillion: 0.15, currency: 'USD' },
  { id: 'meta-llama/llama-4-scout-17b-16e-instruct', name: 'Llama 4 Scout', provider: 'groq', contextLength: 131072, maxOutputTokens: 8192, supportsThinking: false, supportsVision: true, inputPricePerMillion: 0.11, outputPricePerMillion: 0.34, cacheReadPricePerMillion: 0.11, cacheWritePricePerMillion: 0.11, currency: 'USD' },
  { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B', provider: 'groq', contextLength: 131072, maxOutputTokens: 32768, supportsThinking: false, supportsVision: false, inputPricePerMillion: 0.59, outputPricePerMillion: 0.79, cacheReadPricePerMillion: 0.59, cacheWritePricePerMillion: 0.59, currency: 'USD' },
  { id: 'glm-5.1', name: 'GLM-5.1', provider: 'zhipu', contextLength: 198000, maxOutputTokens: 128000, supportsThinking: true, supportsVision: false, thinkingModes: ['low', 'medium', 'high'], inputPricePerMillion: 6, outputPricePerMillion: 24, cacheReadPricePerMillion: 1.5, cacheWritePricePerMillion: 6, currency: 'CNY' },
  { id: 'glm-5', name: 'GLM-5', provider: 'zhipu', contextLength: 198000, maxOutputTokens: 64000, supportsThinking: true, supportsVision: false, thinkingModes: ['low', 'medium', 'high'], inputPricePerMillion: 5, outputPricePerMillion: 20, cacheReadPricePerMillion: 1.25, cacheWritePricePerMillion: 5, currency: 'CNY' },
  { id: 'glm-4.5', name: 'GLM-4.5', provider: 'zhipu', contextLength: 198000, maxOutputTokens: 64000, supportsThinking: true, supportsVision: false, thinkingModes: ['low', 'medium', 'high'], inputPricePerMillion: 4, outputPricePerMillion: 16, cacheReadPricePerMillion: 1, cacheWritePricePerMillion: 4, currency: 'CNY' },
  { id: 'glm-5v-turbo', name: 'GLM-5V Turbo', provider: 'zhipu', contextLength: 200000, maxOutputTokens: 128000, supportsThinking: true, supportsVision: true, thinkingModes: ['low', 'medium', 'high'], inputPricePerMillion: 8, outputPricePerMillion: 32, cacheReadPricePerMillion: 2, cacheWritePricePerMillion: 8, currency: 'CNY' },
  { id: 'glm-4.6v', name: 'GLM-4.6V', provider: 'zhipu', contextLength: 128000, maxOutputTokens: 32000, supportsThinking: false, supportsVision: true, inputPricePerMillion: 6, outputPricePerMillion: 24, cacheReadPricePerMillion: 1.5, cacheWritePricePerMillion: 6, currency: 'CNY' },
  { id: 'glm-4.7-flash', name: 'GLM-4.7 Flash', provider: 'zhipu', contextLength: 200000, maxOutputTokens: 128000, supportsThinking: true, supportsVision: false, thinkingModes: ['low', 'medium', 'high'], inputPricePerMillion: 0, outputPricePerMillion: 0, cacheReadPricePerMillion: 0, cacheWritePricePerMillion: 0, currency: 'CNY' },
  { id: 'glm-4.6v-flash', name: 'GLM-4.6V Flash', provider: 'zhipu', contextLength: 128000, maxOutputTokens: 32000, supportsThinking: true, supportsVision: true, thinkingModes: ['low', 'medium', 'high'], inputPricePerMillion: 0, outputPricePerMillion: 0, cacheReadPricePerMillion: 0, cacheWritePricePerMillion: 0, currency: 'CNY' },
  { id: 'qwen3.7-max', name: 'Qwen3.7-Max', provider: 'qwen', contextLength: 1000000, maxOutputTokens: 64000, supportsThinking: true, supportsVision: false, thinkingModes: ['low', 'medium', 'high'], inputPricePerMillion: 12, outputPricePerMillion: 36, cacheReadPricePerMillion: 3, cacheWritePricePerMillion: 12, currency: 'CNY' },
  { id: 'qwen3.6-plus', name: 'Qwen3.6-Plus', provider: 'qwen', contextLength: 1000000, maxOutputTokens: 64000, supportsThinking: true, supportsVision: true, thinkingModes: ['low', 'medium', 'high'], inputPricePerMillion: 4, outputPricePerMillion: 12, cacheReadPricePerMillion: 1, cacheWritePricePerMillion: 4, currency: 'CNY' },
  { id: 'qwen3.6-flash', name: 'Qwen3.6-Flash', provider: 'qwen', contextLength: 1000000, maxOutputTokens: 64000, supportsThinking: true, supportsVision: true, thinkingModes: ['low', 'medium', 'high'], inputPricePerMillion: 0.6, outputPricePerMillion: 2.4, cacheReadPricePerMillion: 0.15, cacheWritePricePerMillion: 0.6, currency: 'CNY' },
  { id: 'qwen3-vl-plus', name: 'Qwen3-VL Plus', provider: 'qwen', contextLength: 1000000, maxOutputTokens: 64000, supportsThinking: true, supportsVision: true, thinkingModes: ['low', 'medium', 'high'], inputPricePerMillion: 4, outputPricePerMillion: 12, cacheReadPricePerMillion: 1, cacheWritePricePerMillion: 4, currency: 'CNY' },
  { id: 'qwen3-vl-flash', name: 'Qwen3-VL Flash', provider: 'qwen', contextLength: 1000000, maxOutputTokens: 64000, supportsThinking: true, supportsVision: true, thinkingModes: ['low', 'medium', 'high'], inputPricePerMillion: 0.6, outputPricePerMillion: 2.4, cacheReadPricePerMillion: 0.15, cacheWritePricePerMillion: 0.6, currency: 'CNY' },
  { id: 'MiniMax-M3', name: 'MiniMax M3', provider: 'minimax', contextLength: 1048576, maxOutputTokens: 16384, supportsThinking: true, supportsVision: true, thinkingModes: ['low', 'medium', 'high'], inputPricePerMillion: 2.1, outputPricePerMillion: 8.4, cacheReadPricePerMillion: 0.42, cacheWritePricePerMillion: 2.625, currency: 'CNY' },
  { id: 'MiniMax-M2.7', name: 'MiniMax M2.7', provider: 'minimax', contextLength: 1048576, maxOutputTokens: 16384, supportsThinking: true, supportsVision: false, thinkingModes: ['low', 'medium', 'high'], inputPricePerMillion: 2.1, outputPricePerMillion: 8.4, cacheReadPricePerMillion: 0.42, cacheWritePricePerMillion: 2.625, currency: 'CNY' },
  { id: 'MiniMax-M2.5', name: 'MiniMax M2.5', provider: 'minimax', contextLength: 192000, maxOutputTokens: 32768, supportsThinking: true, supportsVision: false, thinkingModes: ['low', 'medium', 'high'], inputPricePerMillion: 2.1, outputPricePerMillion: 8.4, cacheReadPricePerMillion: 0.21, cacheWritePricePerMillion: 2.625, currency: 'CNY' },
  { id: 'minimax-vl-01', name: 'MiniMax VL-01', provider: 'minimax', contextLength: 131072, maxOutputTokens: 8192, supportsThinking: false, supportsVision: true, inputPricePerMillion: 2.1, outputPricePerMillion: 8.4, cacheReadPricePerMillion: 0.42, cacheWritePricePerMillion: 2.625, currency: 'CNY' },
  { id: 'kimi-k2.5', name: 'Kimi K2.5', provider: 'kimi', contextLength: 262144, maxOutputTokens: 32000, supportsThinking: true, supportsVision: true, thinkingModes: ['low', 'medium', 'high'], inputPricePerMillion: 4, outputPricePerMillion: 21, cacheReadPricePerMillion: 0.7, cacheWritePricePerMillion: 4, currency: 'CNY' },
  { id: 'kimi-k2.6', name: 'Kimi K2.6', provider: 'kimi', contextLength: 262144, maxOutputTokens: 96000, supportsThinking: true, supportsVision: false, thinkingModes: ['low', 'medium', 'high'], inputPricePerMillion: 6.5, outputPricePerMillion: 27, cacheReadPricePerMillion: 1.1, cacheWritePricePerMillion: 6.5, currency: 'CNY' },
  { id: 'moonshot-v1-128k', name: 'Moonshot V1', provider: 'kimi', contextLength: 131072, maxOutputTokens: 8192, supportsThinking: false, supportsVision: false, inputPricePerMillion: 10, outputPricePerMillion: 30, cacheReadPricePerMillion: 2, cacheWritePricePerMillion: 10, currency: 'CNY' },
  { id: 'agnes-2.0-flash', name: 'Agnes 2.0 Flash', provider: 'agnes', contextLength: 1048576, maxOutputTokens: 65536, supportsThinking: false, supportsVision: false, inputPricePerMillion: 0, outputPricePerMillion: 0, cacheReadPricePerMillion: 0, cacheWritePricePerMillion: 0, currency: 'USD' },
  { id: 'agnes-1.5-flash', name: 'Agnes 1.5 Flash', provider: 'agnes', contextLength: 524288, maxOutputTokens: 32768, supportsThinking: false, supportsVision: false, inputPricePerMillion: 0, outputPricePerMillion: 0, cacheReadPricePerMillion: 0, cacheWritePricePerMillion: 0, currency: 'USD' },
  { id: 'sensenova-6.7-flash-lite', name: 'SenseNova 6.7 Flash-Lite', provider: 'sensenova', contextLength: 256000, maxOutputTokens: 64000, supportsThinking: false, supportsVision: true, inputPricePerMillion: 0, outputPricePerMillion: 0, cacheReadPricePerMillion: 0, cacheWritePricePerMillion: 0, currency: 'CNY' },
  // ── 字节豆包 (火山方舟) ──
  { id: 'doubao-1.5-pro-256k', name: 'Doubao 1.5 Pro 256K', provider: 'doubao', contextLength: 262144, maxOutputTokens: 65536, supportsThinking: true, supportsVision: false, inputPricePerMillion: 3.2, outputPricePerMillion: 16, cacheReadPricePerMillion: 0, cacheWritePricePerMillion: 0, currency: 'CNY' },
  { id: 'doubao-1.5-lite-32k', name: 'Doubao 1.5 Lite 32K', provider: 'doubao', contextLength: 32768, maxOutputTokens: 8192, supportsThinking: false, supportsVision: false, inputPricePerMillion: 0, outputPricePerMillion: 0, cacheReadPricePerMillion: 0, cacheWritePricePerMillion: 0, currency: 'CNY' },
  { id: 'doubao-seed-2.0-lite', name: 'Doubao Seed 2.0 Lite', provider: 'doubao', contextLength: 262144, maxOutputTokens: 65536, supportsThinking: true, supportsVision: true, inputPricePerMillion: 0, outputPricePerMillion: 0, cacheReadPricePerMillion: 0, cacheWritePricePerMillion: 0, currency: 'CNY' },
  // ── xAI Grok ──
  { id: 'grok-4', name: 'Grok 4', provider: 'xai', contextLength: 262144, maxOutputTokens: 32768, supportsThinking: true, supportsVision: true, inputPricePerMillion: 3, outputPricePerMillion: 15, cacheReadPricePerMillion: 0, cacheWritePricePerMillion: 0, currency: 'USD' },
  { id: 'grok-3', name: 'Grok 3', provider: 'xai', contextLength: 131072, maxOutputTokens: 16384, supportsThinking: false, supportsVision: true, inputPricePerMillion: 3, outputPricePerMillion: 15, cacheReadPricePerMillion: 0, cacheWritePricePerMillion: 0, currency: 'USD' },
  { id: 'grok-3-mini', name: 'Grok 3 Mini', provider: 'xai', contextLength: 131072, maxOutputTokens: 16384, supportsThinking: true, supportsVision: false, inputPricePerMillion: 0.3, outputPricePerMillion: 0.5, cacheReadPricePerMillion: 0, cacheWritePricePerMillion: 0, currency: 'USD' },
  // ── Mistral AI ──
  { id: 'mistral-large-latest', name: 'Mistral Large', provider: 'mistral', contextLength: 131072, maxOutputTokens: 16384, supportsThinking: false, supportsVision: false, inputPricePerMillion: 2, outputPricePerMillion: 6, cacheReadPricePerMillion: 0.5, cacheWritePricePerMillion: 2, currency: 'USD' },
  { id: 'mistral-medium-latest', name: 'Mistral Medium', provider: 'mistral', contextLength: 131072, maxOutputTokens: 16384, supportsThinking: false, supportsVision: false, inputPricePerMillion: 0.4, outputPricePerMillion: 2, cacheReadPricePerMillion: 0.1, cacheWritePricePerMillion: 0.4, currency: 'USD' },
  { id: 'mistral-small-latest', name: 'Mistral Small', provider: 'mistral', contextLength: 131072, maxOutputTokens: 16384, supportsThinking: false, supportsVision: false, inputPricePerMillion: 0.2, outputPricePerMillion: 0.6, cacheReadPricePerMillion: 0.05, cacheWritePricePerMillion: 0.2, currency: 'USD' },
  { id: 'codestral-latest', name: 'Codestral', provider: 'mistral', contextLength: 262144, maxOutputTokens: 65536, supportsThinking: false, supportsVision: false, inputPricePerMillion: 0.3, outputPricePerMillion: 0.9, cacheReadPricePerMillion: 0.075, cacheWritePricePerMillion: 0.3, currency: 'USD' },
  { id: 'pixtral-large-latest', name: 'Pixtral Large', provider: 'mistral', contextLength: 131072, maxOutputTokens: 16384, supportsThinking: false, supportsVision: true, inputPricePerMillion: 2, outputPricePerMillion: 6, cacheReadPricePerMillion: 0.5, cacheWritePricePerMillion: 2, currency: 'USD' },
  // ── StepFun ──
  { id: 'step-3.7-flash', name: 'Step 3.7 Flash', provider: 'stepfun', contextLength: 262144, maxOutputTokens: 128000, supportsThinking: true, supportsVision: true, thinkingModes: ['low', 'medium', 'high'], inputPricePerMillion: 1.35, outputPricePerMillion: 8.1, cacheReadPricePerMillion: 0.27, cacheWritePricePerMillion: 1.35, currency: 'CNY' },
  { id: 'step-3.5-flash', name: 'Step 3.5 Flash', provider: 'stepfun', contextLength: 262144, maxOutputTokens: 128000, supportsThinking: true, supportsVision: false, thinkingModes: ['low', 'medium', 'high'], inputPricePerMillion: 0.7, outputPricePerMillion: 2.1, cacheReadPricePerMillion: 0.14, cacheWritePricePerMillion: 0.7, currency: 'CNY' },
  { id: 'step-3.5-flash-2603', name: 'Step 3.5 Flash 2603', provider: 'stepfun', contextLength: 262144, maxOutputTokens: 128000, supportsThinking: true, supportsVision: false, thinkingModes: ['low', 'high'], inputPricePerMillion: 0.7, outputPricePerMillion: 2.1, cacheReadPricePerMillion: 0.14, cacheWritePricePerMillion: 0.7, currency: 'CNY' },
  { id: 'step-1o-turbo-vision', name: 'Step 1o Turbo Vision', provider: 'stepfun', contextLength: 32768, maxOutputTokens: 8192, supportsThinking: false, supportsVision: true, inputPricePerMillion: 2.5, outputPricePerMillion: 8, cacheReadPricePerMillion: 0.5, cacheWritePricePerMillion: 2.5, currency: 'CNY' },
]

export function getModelInfo(modelId: string): ModelInfo | undefined {
  return MODEL_REGISTRY.find(m => m.id === modelId)
}

export function modelSupportsVision(modelId: string): boolean {
  const info = getModelInfo(modelId)
  return info?.supportsVision ?? false
}

export function getVisionModels(): ModelInfo[] {
  return MODEL_REGISTRY.filter(m => m.supportsVision)
}

export function getModelsByProvider(provider: string): { id: string; name: string }[] {
  // 预设模型
  const presetModels = MODEL_REGISTRY.filter(m => m.provider === provider).map(m => ({ id: m.id, name: m.name }))

  // 动态拉取的模型（缓存优先，后台刷新）
  const cached = getCachedModels(provider)
  if (!cached || cached.length === 0) return presetModels

  // 合并：预设 + 动态（去重）
  const presetIds = new Set(presetModels.map(m => m.id))
  const dynamicModels = cached
    .filter(fm => !presetIds.has(fm.id))
    .map(fm => ({ id: fm.id, name: fm.id }))

  return [...presetModels, ...dynamicModels]
}

/** 异步获取合并模型列表（含后台刷新回调） */
export function getModelsByProviderAsync(
  provider: string,
  onRefreshed?: (models: { id: string; name: string }[]) => void,
): { id: string; name: string }[] {
  const presetModels = MODEL_REGISTRY.filter(m => m.provider === provider).map(m => ({ id: m.id, name: m.name }))

  const cached = getModelsWithBackgroundRefresh(provider, undefined, (fetched) => {
    if (onRefreshed) {
      const presetIds = new Set(presetModels.map(m => m.id))
      const dynamicModels = fetched
        .filter(fm => !presetIds.has(fm.id))
        .map(fm => ({ id: fm.id, name: fm.id }))
      onRefreshed([...presetModels, ...dynamicModels])
    }
  })

  if (!cached || cached.length === 0) return presetModels

  const presetIds = new Set(presetModels.map(m => m.id))
  const dynamicModels = cached
    .filter(fm => !presetIds.has(fm.id))
    .map(fm => ({ id: fm.id, name: fm.id }))

  return [...presetModels, ...dynamicModels]
}

export function getDefaultModelId(provider: string): string {
  const models = MODEL_REGISTRY.filter(m => m.provider === provider)
  if (models.length > 0) return models[0].id
  const fallback = (DEFAULT_CLOUD_CONFIGS as any)[provider]
  return fallback?.modelId || ''
}

export function getModelPresets(): { group: string; models: { id: string; name: string; provider: string }[] }[] {
  const groups: Record<string, { id: string; name: string; provider: string }[]> = {}
  for (const m of MODEL_REGISTRY) {
    if (!groups[m.provider]) groups[m.provider] = []
    groups[m.provider].push({ id: m.id, name: m.name, provider: m.provider })
  }
  const providerLabels: Record<string, string> = { ...getProviderLabelMap(), openrouter: 'OpenRouter' }
  return Object.entries(groups).map(([provider, models]) => ({
    group: providerLabels[provider] || provider,
    models,
  }))
}

export interface CostBreakdown {
  inputCost: number
  outputCost: number
  cacheReadCost: number
  cacheWriteCost: number
  total: number
  savedByCache: number
}

export function calculateCost(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number = 0,
  cacheWriteTokens: number = 0,
): CostBreakdown {
  const info = getModelInfo(modelId)
  if (!info) return { inputCost: 0, outputCost: 0, cacheReadCost: 0, cacheWriteCost: 0, total: 0, savedByCache: 0 }

  const inputCost = (inputTokens / 1_000_000) * info.inputPricePerMillion
  const outputCost = (outputTokens / 1_000_000) * info.outputPricePerMillion
  const cacheReadCost = (cacheReadTokens / 1_000_000) * info.cacheReadPricePerMillion
  const cacheWriteCost = (cacheWriteTokens / 1_000_000) * info.cacheWritePricePerMillion

  const cacheReadSavings = (cacheReadTokens / 1_000_000) * (info.inputPricePerMillion - info.cacheReadPricePerMillion)
  const cacheWriteSavings = (cacheWriteTokens / 1_000_000) * (info.inputPricePerMillion - info.cacheWritePricePerMillion)

  return {
    inputCost,
    outputCost,
    cacheReadCost,
    cacheWriteCost,
    total: inputCost + outputCost + cacheReadCost + cacheWriteCost,
    savedByCache: Math.max(0, cacheReadSavings + cacheWriteSavings),
  }
}

export function getThinkingLevels(modelId: string): { value: string; label: string; desc: string }[] {
  const info = getModelInfo(modelId)
  if (!info?.supportsThinking) return [{ value: 'off', label: '关闭', desc: '不使用思考' }]
  const levels = [
    { value: 'off', label: '关闭', desc: '不使用思考' },
    { value: 'minimal', label: '极简', desc: '最少思考' },
    { value: 'low', label: '低', desc: '轻度思考' },
    { value: 'medium', label: '中', desc: '平衡思考' },
    { value: 'high', label: '高', desc: '深度思考' },
    { value: 'xhigh', label: '极高', desc: '极致思考' },
  ]
  if (info.thinkingModes) {
    return levels.filter(l => l.value === 'off' || info.thinkingModes!.includes(l.value))
  }
  return levels
}
