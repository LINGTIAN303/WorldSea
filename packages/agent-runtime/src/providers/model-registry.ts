/** 模型注册表：LLM 模型元数据与查询/筛选/成本计算，详细见 docs/details/注释/packages/agent-runtime/providers-model-registry.md */

import { DEFAULT_CLOUD_CONFIGS } from './config'
import { getProviderLabelMap } from './provider-registry'
import { getCachedModels, getModelsWithBackgroundRefresh } from './model-fetcher'

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
  /** 高峰时段价格（可选，仅支持峰谷计价的供应商如 DeepSeek 使用） */
  peakInputPricePerMillion?: number
  peakOutputPricePerMillion?: number
  peakCacheReadPricePerMillion?: number
}

export const MODEL_REGISTRY: ModelInfo[] = [
  // ── Anthropic（保留 Opus 4.8/4.7；移除 Sonnet 4.6 / 3.5 Haiku 等；Fable/Opus/Sonnet 5 走 Adaptive Thinking，Haiku 4.5 走 Extended）──
  { id: 'claude-fable-5', name: 'Fable 5', provider: 'anthropic', contextLength: 1000000, maxOutputTokens: 128000, supportsThinking: true, supportsVision: true, thinkingModes: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'], inputPricePerMillion: 10, outputPricePerMillion: 50, cacheReadPricePerMillion: 1, cacheWritePricePerMillion: 12.5, currency: 'USD' },
  { id: 'claude-opus-5', name: 'Opus 5', provider: 'anthropic', contextLength: 1000000, maxOutputTokens: 128000, supportsThinking: true, supportsVision: true, thinkingModes: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'], inputPricePerMillion: 5, outputPricePerMillion: 25, cacheReadPricePerMillion: 0.5, cacheWritePricePerMillion: 6.25, currency: 'USD' },
  { id: 'claude-sonnet-5', name: 'Sonnet 5', provider: 'anthropic', contextLength: 1000000, maxOutputTokens: 128000, supportsThinking: true, supportsVision: true, thinkingModes: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'], inputPricePerMillion: 2, outputPricePerMillion: 10, cacheReadPricePerMillion: 0.2, cacheWritePricePerMillion: 2.5, currency: 'USD' },
  { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', provider: 'anthropic', contextLength: 200000, maxOutputTokens: 64000, supportsThinking: true, supportsVision: true, thinkingModes: ['off', 'low', 'medium', 'high'], inputPricePerMillion: 1, outputPricePerMillion: 5, cacheReadPricePerMillion: 0.1, cacheWritePricePerMillion: 1.25, currency: 'USD' },
  { id: 'claude-opus-4-8', name: 'Claude Opus 4.8', provider: 'anthropic', contextLength: 1000000, maxOutputTokens: 128000, supportsThinking: true, supportsVision: true, thinkingModes: ['low', 'medium', 'high', 'xhigh'], inputPricePerMillion: 5, outputPricePerMillion: 25, cacheReadPricePerMillion: 0.5, cacheWritePricePerMillion: 6.25, currency: 'USD' },
  { id: 'claude-opus-4-7', name: 'Claude Opus 4.7', provider: 'anthropic', contextLength: 1000000, maxOutputTokens: 128000, supportsThinking: true, supportsVision: true, thinkingModes: ['low', 'medium', 'high', 'xhigh'], inputPricePerMillion: 5, outputPricePerMillion: 25, cacheReadPricePerMillion: 0.5, cacheWritePricePerMillion: 6.25, currency: 'USD' },
  // ── OpenAI（新旗舰 GPT-5.6 三档；移除 gpt-5/gpt-4o/o3/o4-mini）──
  { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol', provider: 'openai', contextLength: 1000000, maxOutputTokens: 128000, supportsThinking: true, supportsVision: true, thinkingModes: ['off', 'low', 'medium', 'high', 'xhigh'], inputPricePerMillion: 5, outputPricePerMillion: 30, cacheReadPricePerMillion: 0.5, cacheWritePricePerMillion: 6.25, currency: 'USD' },
  { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra', provider: 'openai', contextLength: 1000000, maxOutputTokens: 128000, supportsThinking: true, supportsVision: true, thinkingModes: ['off', 'low', 'medium', 'high', 'xhigh'], inputPricePerMillion: 2, outputPricePerMillion: 12, cacheReadPricePerMillion: 0.2, cacheWritePricePerMillion: 2.5, currency: 'USD' },
  { id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna', provider: 'openai', contextLength: 1000000, maxOutputTokens: 128000, supportsThinking: true, supportsVision: true, thinkingModes: ['off', 'low', 'medium', 'high', 'xhigh'], inputPricePerMillion: 0.2, outputPricePerMillion: 1.2, cacheReadPricePerMillion: 0.02, cacheWritePricePerMillion: 0.25, currency: 'USD' },
  { id: 'gpt-5.5', name: 'GPT-5.5', provider: 'openai', contextLength: 1000000, maxOutputTokens: 128000, supportsThinking: true, supportsVision: true, thinkingModes: ['low', 'medium', 'high', 'xhigh'], inputPricePerMillion: 5, outputPricePerMillion: 30, cacheReadPricePerMillion: 0.5, cacheWritePricePerMillion: 6.25, currency: 'USD' },
  { id: 'gpt-5.4', name: 'GPT-5.4', provider: 'openai', contextLength: 1000000, maxOutputTokens: 128000, supportsThinking: true, supportsVision: true, thinkingModes: ['low', 'medium', 'high', 'xhigh'], inputPricePerMillion: 2.5, outputPricePerMillion: 15, cacheReadPricePerMillion: 0.25, cacheWritePricePerMillion: 3.125, currency: 'USD' },
  { id: 'gpt-5.4-mini', name: 'GPT-5.4 Mini', provider: 'openai', contextLength: 400000, maxOutputTokens: 128000, supportsThinking: true, supportsVision: true, thinkingModes: ['low', 'medium', 'high', 'xhigh'], inputPricePerMillion: 0.75, outputPricePerMillion: 4.5, cacheReadPricePerMillion: 0.075, cacheWritePricePerMillion: 0.9375, currency: 'USD' },
  // ── Google（新旗舰 Gemini 3.7/3.6 Flash、3.5 Flash-Lite；移除 2.5 系列）──
  // 注：3.7/3.6 Flash 为限时价 $0.75/$3.75（至 2026-12-31，之后翻倍 $1.5/$7.5）；3.7 不支持 minimal thinking 档
  { id: 'gemini-3.7-flash', name: 'Gemini 3.7 Flash', provider: 'google', contextLength: 1000000, maxOutputTokens: 65536, supportsThinking: true, supportsVision: true, thinkingModes: ['off', 'low', 'medium', 'high'], inputPricePerMillion: 0.75, outputPricePerMillion: 3.75, cacheReadPricePerMillion: 0.075, cacheWritePricePerMillion: 0.5, currency: 'USD' },
  { id: 'gemini-3.6-flash', name: 'Gemini 3.6 Flash', provider: 'google', contextLength: 1000000, maxOutputTokens: 65536, supportsThinking: true, supportsVision: true, thinkingModes: ['off', 'minimal', 'low', 'medium', 'high'], inputPricePerMillion: 0.75, outputPricePerMillion: 3.75, cacheReadPricePerMillion: 0.075, cacheWritePricePerMillion: 0.5, currency: 'USD' },
  { id: 'gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash-Lite', provider: 'google', contextLength: 1000000, maxOutputTokens: 65536, supportsThinking: true, supportsVision: true, thinkingModes: ['off', 'minimal', 'low', 'medium', 'high'], inputPricePerMillion: 0.3, outputPricePerMillion: 2.5, cacheReadPricePerMillion: 0.03, cacheWritePricePerMillion: 0.3, currency: 'USD' },
  { id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash', provider: 'google', contextLength: 1000000, maxOutputTokens: 65536, supportsThinking: true, supportsVision: true, thinkingModes: ['minimal', 'low', 'medium', 'high'], inputPricePerMillion: 1.5, outputPricePerMillion: 9, cacheReadPricePerMillion: 0.15, cacheWritePricePerMillion: 1.5, currency: 'USD' },
  { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro', provider: 'google', contextLength: 1000000, maxOutputTokens: 65536, supportsThinking: true, supportsVision: true, thinkingModes: ['minimal', 'low', 'medium', 'high'], inputPricePerMillion: 2, outputPricePerMillion: 12, cacheReadPricePerMillion: 0.5, cacheWritePricePerMillion: 2, currency: 'USD' },
  // ── DeepSeek：deepseek-chat / deepseek-reasoner 已下线并入 v4-flash 非思考/思考模式 ──
  // 峰谷计价（2026-08-17 生效，北京时区）：高峰=工作日 9-12/14-18，低谷=其余；周末全天低谷。
  // 主价字段存低谷价（低价参考），peak* 存高峰价。汇率按官方人民币原价。
  { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', provider: 'deepseek', contextLength: 1000000, maxOutputTokens: 384000, supportsThinking: true, supportsVision: false, thinkingModes: ['off', 'low', 'medium', 'high', 'max'], inputPricePerMillion: 1.5, outputPricePerMillion: 4.5, cacheReadPricePerMillion: 0.05, cacheWritePricePerMillion: 0, currency: 'CNY', peakInputPricePerMillion: 3, peakOutputPricePerMillion: 9, peakCacheReadPricePerMillion: 0.1 },
  { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', provider: 'deepseek', contextLength: 1000000, maxOutputTokens: 384000, supportsThinking: true, supportsVision: false, thinkingModes: ['off', 'low', 'medium', 'high', 'max'], inputPricePerMillion: 4.5, outputPricePerMillion: 13.5, cacheReadPricePerMillion: 0.15, cacheWritePricePerMillion: 0, currency: 'CNY', peakInputPricePerMillion: 9, peakOutputPricePerMillion: 27, peakCacheReadPricePerMillion: 0.3 },
  { id: 'deepseek-v4-flash-vision-exp', name: 'DeepSeek V4 Flash Vision', provider: 'deepseek', contextLength: 1000000, maxOutputTokens: 384000, supportsThinking: true, supportsVision: true, thinkingModes: ['off', 'low', 'medium', 'high'], inputPricePerMillion: 1.5, outputPricePerMillion: 4.5, cacheReadPricePerMillion: 0.05, cacheWritePricePerMillion: 0, currency: 'CNY', peakInputPricePerMillion: 3, peakOutputPricePerMillion: 9, peakCacheReadPricePerMillion: 0.1 },
  // ── Groq（官方页 IP 受限，暂保持）──
  { id: 'openai/gpt-oss-120b', name: 'GPT-OSS 120B', provider: 'groq', contextLength: 131072, maxOutputTokens: 65536, supportsThinking: false, supportsVision: false, inputPricePerMillion: 0.15, outputPricePerMillion: 0.6, cacheReadPricePerMillion: 0.15, cacheWritePricePerMillion: 0.15, currency: 'USD' },
  { id: 'meta-llama/llama-4-scout-17b-16e-instruct', name: 'Llama 4 Scout', provider: 'groq', contextLength: 131072, maxOutputTokens: 8192, supportsThinking: false, supportsVision: true, inputPricePerMillion: 0.11, outputPricePerMillion: 0.34, cacheReadPricePerMillion: 0.11, cacheWritePricePerMillion: 0.11, currency: 'USD' },
  { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B', provider: 'groq', contextLength: 131072, maxOutputTokens: 32768, supportsThinking: false, supportsVision: false, inputPricePerMillion: 0.59, outputPricePerMillion: 0.79, cacheReadPricePerMillion: 0.59, cacheWritePricePerMillion: 0.59, currency: 'USD' },
  // ── 智谱 GLM（新旗舰 5.3/5.2，移除 glm-5/5-turbo/4.7/4.6/4.5，保留 4.7-flash）──
  { id: 'glm-5.3', name: 'GLM-5.3', provider: 'zhipu', contextLength: 1000000, maxOutputTokens: 128000, supportsThinking: true, supportsVision: false, thinkingModes: ['low', 'high', 'max'], inputPricePerMillion: 8, outputPricePerMillion: 28, cacheReadPricePerMillion: 2, cacheWritePricePerMillion: 8, currency: 'CNY' },
  { id: 'glm-5.2', name: 'GLM-5.2', provider: 'zhipu', contextLength: 1000000, maxOutputTokens: 128000, supportsThinking: true, supportsVision: false, thinkingModes: ['off', 'low', 'medium', 'high'], inputPricePerMillion: 8, outputPricePerMillion: 28, cacheReadPricePerMillion: 2, cacheWritePricePerMillion: 8, currency: 'CNY' },
  { id: 'glm-5.1', name: 'GLM-5.1', provider: 'zhipu', contextLength: 200000, maxOutputTokens: 128000, supportsThinking: true, supportsVision: false, thinkingModes: ['off', 'low', 'medium', 'high'], inputPricePerMillion: 6, outputPricePerMillion: 24, cacheReadPricePerMillion: 1.3, cacheWritePricePerMillion: 6, currency: 'CNY' },
  { id: 'glm-4.7-flash', name: 'GLM-4.7 Flash', provider: 'zhipu', contextLength: 200000, maxOutputTokens: 128000, supportsThinking: true, supportsVision: false, thinkingModes: ['off', 'low', 'medium', 'high'], inputPricePerMillion: 0, outputPricePerMillion: 0, cacheReadPricePerMillion: 0, cacheWritePricePerMillion: 0, currency: 'CNY' },
  { id: 'glm-5v-turbo', name: 'GLM-5V Turbo', provider: 'zhipu', contextLength: 200000, maxOutputTokens: 128000, supportsThinking: true, supportsVision: true, thinkingModes: ['off', 'low', 'medium', 'high'], inputPricePerMillion: 5, outputPricePerMillion: 22, cacheReadPricePerMillion: 1.2, cacheWritePricePerMillion: 5, currency: 'CNY' },
  { id: 'glm-4.6v', name: 'GLM-4.6V', provider: 'zhipu', contextLength: 200000, maxOutputTokens: 128000, supportsThinking: false, supportsVision: true, inputPricePerMillion: 6, outputPricePerMillion: 24, cacheReadPricePerMillion: 1.5, cacheWritePricePerMillion: 6, currency: 'CNY' },
  // ── 通义千问（新旗舰 qwen3.8-max；移除 qwen3.6-flash / 3-vl-*）──
  { id: 'qwen3.8-max', name: 'Qwen3.8-Max', provider: 'qwen', contextLength: 1000000, maxOutputTokens: 131072, supportsThinking: true, supportsVision: true, thinkingModes: ['low', 'high', 'xhigh'], inputPricePerMillion: 12, outputPricePerMillion: 36, cacheReadPricePerMillion: 2.4, cacheWritePricePerMillion: 12, currency: 'CNY' },
  { id: 'qwen3.7-max', name: 'Qwen3.7-Max', provider: 'qwen', contextLength: 1000000, maxOutputTokens: 131072, supportsThinking: true, supportsVision: true, thinkingModes: ['off', 'low', 'medium', 'high'], inputPricePerMillion: 12, outputPricePerMillion: 36, cacheReadPricePerMillion: 2.4, cacheWritePricePerMillion: 12, currency: 'CNY' },
  { id: 'qwen3.7-plus', name: 'Qwen3.7-Plus', provider: 'qwen', contextLength: 1000000, maxOutputTokens: 131072, supportsThinking: true, supportsVision: true, thinkingModes: ['off', 'low', 'medium', 'high'], inputPricePerMillion: 4, outputPricePerMillion: 12, cacheReadPricePerMillion: 0.8, cacheWritePricePerMillion: 4, currency: 'CNY' },
  { id: 'qwen3.7-flash', name: 'Qwen3.7-Flash', provider: 'qwen', contextLength: 1000000, maxOutputTokens: 65536, supportsThinking: true, supportsVision: true, thinkingModes: ['off', 'low', 'medium', 'high'], inputPricePerMillion: 0.6, outputPricePerMillion: 2.4, cacheReadPricePerMillion: 0.12, cacheWritePricePerMillion: 0.6, currency: 'CNY' },
  { id: 'qwen3.6-plus', name: 'Qwen3.6-Plus', provider: 'qwen', contextLength: 1000000, maxOutputTokens: 131072, supportsThinking: true, supportsVision: true, thinkingModes: ['off', 'low', 'medium', 'high'], inputPricePerMillion: 4, outputPricePerMillion: 12, cacheReadPricePerMillion: 0.8, cacheWritePricePerMillion: 4, currency: 'CNY' },
  // ── MiniMax（M3 新旗舰 1M/~512K；移除 M2.5 / vl-01）──
  { id: 'MiniMax-M3', name: 'MiniMax M3', provider: 'minimax', contextLength: 1000000, maxOutputTokens: 512000, supportsThinking: true, supportsVision: true, thinkingModes: ['off', 'low', 'medium', 'high'], inputPricePerMillion: 2.1, outputPricePerMillion: 8.4, cacheReadPricePerMillion: 0.42, cacheWritePricePerMillion: 2.625, currency: 'CNY' },
  { id: 'MiniMax-M2.7', name: 'MiniMax M2.7', provider: 'minimax', contextLength: 200000, maxOutputTokens: 200000, supportsThinking: true, supportsVision: false, thinkingModes: ['off', 'low', 'medium', 'high'], inputPricePerMillion: 2.1, outputPricePerMillion: 8.4, cacheReadPricePerMillion: 0.42, cacheWritePricePerMillion: 2.625, currency: 'CNY' },
  { id: 'MiniMax-M2.7-highspeed', name: 'MiniMax M2.7 HS', provider: 'minimax', contextLength: 200000, maxOutputTokens: 200000, supportsThinking: true, supportsVision: false, thinkingModes: ['off', 'low', 'medium', 'high'], inputPricePerMillion: 4.2, outputPricePerMillion: 16.8, cacheReadPricePerMillion: 0.42, cacheWritePricePerMillion: 2.625, currency: 'CNY' },
  // ── Kimi（新旗舰 K3；移除 moonshot-v1-128k；K2.6 支持视觉）──
  { id: 'kimi-k3', name: 'Kimi K3', provider: 'kimi', contextLength: 1000000, maxOutputTokens: 131072, supportsThinking: true, supportsVision: true, thinkingModes: ['off', 'low', 'medium', 'high'], inputPricePerMillion: 20, outputPricePerMillion: 100, cacheReadPricePerMillion: 2, cacheWritePricePerMillion: 20, currency: 'CNY' },
  { id: 'kimi-k2.7-code', name: 'Kimi K2.7 Code', provider: 'kimi', contextLength: 256000, maxOutputTokens: 65536, supportsThinking: true, supportsVision: true, thinkingModes: ['off', 'low', 'medium', 'high'], inputPricePerMillion: 6.5, outputPricePerMillion: 27, cacheReadPricePerMillion: 1.3, cacheWritePricePerMillion: 6.5, currency: 'CNY' },
  { id: 'kimi-k2.7-code-highspeed', name: 'Kimi K2.7 Code HS', provider: 'kimi', contextLength: 256000, maxOutputTokens: 65536, supportsThinking: true, supportsVision: true, thinkingModes: ['off', 'low', 'medium', 'high'], inputPricePerMillion: 13, outputPricePerMillion: 54, cacheReadPricePerMillion: 2.6, cacheWritePricePerMillion: 13, currency: 'CNY' },
  { id: 'kimi-k2.6', name: 'Kimi K2.6', provider: 'kimi', contextLength: 256000, maxOutputTokens: 96000, supportsThinking: true, supportsVision: true, thinkingModes: ['off', 'low', 'medium', 'high'], inputPricePerMillion: 6.5, outputPricePerMillion: 27, cacheReadPricePerMillion: 1.1, cacheWritePricePerMillion: 6.5, currency: 'CNY' },
  // ── Agnes AI（新旗舰 2.5-pro/flash；无列表接口预设+手填）──
  { id: 'agnes-2.5-pro', name: 'Agnes 2.5 Pro', provider: 'agnes', contextLength: 1000000, maxOutputTokens: 65536, supportsThinking: true, supportsVision: true, thinkingModes: ['off', 'low', 'medium', 'high', 'xhigh'], inputPricePerMillion: 0.45, outputPricePerMillion: 0.9, cacheReadPricePerMillion: 0.045, cacheWritePricePerMillion: 0, currency: 'USD' },
  { id: 'agnes-2.5-flash', name: 'Agnes 2.5 Flash', provider: 'agnes', contextLength: 512000, maxOutputTokens: 65536, supportsThinking: true, supportsVision: true, thinkingModes: ['off', 'low', 'medium', 'high'], inputPricePerMillion: 0, outputPricePerMillion: 0, cacheReadPricePerMillion: 0, cacheWritePricePerMillion: 0, currency: 'USD' },
  { id: 'agnes-2.0-flash', name: 'Agnes 2.0 Flash', provider: 'agnes', contextLength: 256000, maxOutputTokens: 65536, supportsThinking: false, supportsVision: true, inputPricePerMillion: 0, outputPricePerMillion: 0, cacheReadPricePerMillion: 0, cacheWritePricePerMillion: 0, currency: 'USD' },
  { id: 'agnes-1.5-flash', name: 'Agnes 1.5 Flash', provider: 'agnes', contextLength: 256000, maxOutputTokens: 64000, supportsThinking: false, supportsVision: true, inputPricePerMillion: 0, outputPricePerMillion: 0, cacheReadPricePerMillion: 0, cacheWritePricePerMillion: 0, currency: 'USD' },
  // ── 商汤 SenseNova（日日新 V6.5/V6 系列主力）──
  // 注：Token Plan 公测免费托管第三方模型（deepseek-v4-flash / glm-5.2）与原厂 id 重复，
  // 不在此预设，靠 /models 动态拉取返回。这里只登记商汤自有模型。
  { id: 'sensenova-6.8-flash-lite', name: 'SenseNova 6.8 Flash Lite', provider: 'sensenova', contextLength: 256000, maxOutputTokens: 65536, supportsThinking: false, supportsVision: true, inputPricePerMillion: 0, outputPricePerMillion: 0, cacheReadPricePerMillion: 0, cacheWritePricePerMillion: 0, currency: 'CNY' },
  { id: 'sensenova-6.5-pro', name: 'SenseNova V6.5-Pro', provider: 'sensenova', contextLength: 128000, maxOutputTokens: 65536, supportsThinking: true, supportsVision: true, thinkingModes: ['off', 'low', 'medium', 'high'], inputPricePerMillion: 3, outputPricePerMillion: 9, cacheReadPricePerMillion: 0, cacheWritePricePerMillion: 0, currency: 'CNY' },
  { id: 'sensenova-6.5-turbo', name: 'SenseNova V6.5-Turbo', provider: 'sensenova', contextLength: 128000, maxOutputTokens: 65536, supportsThinking: true, supportsVision: true, thinkingModes: ['off', 'low', 'medium', 'high'], inputPricePerMillion: 1.5, outputPricePerMillion: 4.5, cacheReadPricePerMillion: 0, cacheWritePricePerMillion: 0, currency: 'CNY' },
  { id: 'sensenova-6-pro', name: 'SenseNova V6-Pro', provider: 'sensenova', contextLength: 128000, maxOutputTokens: 65536, supportsThinking: true, supportsVision: true, thinkingModes: ['off', 'low', 'medium', 'high'], inputPricePerMillion: 3, outputPricePerMillion: 9, cacheReadPricePerMillion: 0, cacheWritePricePerMillion: 0, currency: 'CNY' },
  { id: 'sensenova-6-turbo', name: 'SenseNova V6-Turbo', provider: 'sensenova', contextLength: 128000, maxOutputTokens: 65536, supportsThinking: true, supportsVision: true, thinkingModes: ['off', 'low', 'medium', 'high'], inputPricePerMillion: 1.5, outputPricePerMillion: 4.5, cacheReadPricePerMillion: 0, cacheWritePricePerMillion: 0, currency: 'CNY' },
  { id: 'sensenova-6-reasoner', name: 'SenseNova V6-Reasoner', provider: 'sensenova', contextLength: 128000, maxOutputTokens: 65536, supportsThinking: true, supportsVision: true, thinkingModes: ['off', 'low', 'medium', 'high'], inputPricePerMillion: 4, outputPricePerMillion: 16, cacheReadPricePerMillion: 0, cacheWritePricePerMillion: 0, currency: 'CNY' },
  { id: 'sensenova-6.7-flash-lite', name: 'SenseNova 6.7 Flash-Lite', provider: 'sensenova', contextLength: 256000, maxOutputTokens: 64000, supportsThinking: false, supportsVision: true, inputPricePerMillion: 0, outputPricePerMillion: 0, cacheReadPricePerMillion: 0, cacheWritePricePerMillion: 0, currency: 'CNY' },
  { id: 'sensenova-u1-fast', name: 'SenseNova U1 Fast', provider: 'sensenova', contextLength: 32768, maxOutputTokens: 16384, supportsThinking: false, supportsVision: true, inputPricePerMillion: 0, outputPricePerMillion: 0, cacheReadPricePerMillion: 0, cacheWritePricePerMillion: 0, currency: 'CNY' },
  // ── 字节豆包（火山方舟，Seed 2.x 分段计费；移除 1.6-flash / 1.5 系列）──
  { id: 'doubao-seed-evolving', name: 'Doubao-Seed-Evolving', provider: 'doubao', contextLength: 1000000, maxOutputTokens: 256000, supportsThinking: true, supportsVision: true, thinkingModes: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'], inputPricePerMillion: 6, outputPricePerMillion: 30, cacheReadPricePerMillion: 1.2, cacheWritePricePerMillion: 6, currency: 'CNY' },
  { id: 'doubao-seed-1.8', name: 'Doubao-Seed-1.8', provider: 'doubao', contextLength: 256000, maxOutputTokens: 96000, supportsThinking: true, supportsVision: true, thinkingModes: ['off', 'low', 'medium', 'high'], inputPricePerMillion: 0.8, outputPricePerMillion: 2, cacheReadPricePerMillion: 0.16, cacheWritePricePerMillion: 0.8, currency: 'CNY' },
  { id: 'doubao-seed-2.1-pro', name: 'Doubao-Seed-2.1 Pro', provider: 'doubao', contextLength: 256000, maxOutputTokens: 256000, supportsThinking: true, supportsVision: true, thinkingModes: ['off', 'low', 'medium', 'high'], inputPricePerMillion: 6, outputPricePerMillion: 30, cacheReadPricePerMillion: 1.2, cacheWritePricePerMillion: 6, currency: 'CNY' },
  { id: 'doubao-seed-2.1-turbo', name: 'Doubao-Seed-2.1 Turbo', provider: 'doubao', contextLength: 256000, maxOutputTokens: 256000, supportsThinking: true, supportsVision: true, thinkingModes: ['off', 'low', 'medium', 'high'], inputPricePerMillion: 3, outputPricePerMillion: 15, cacheReadPricePerMillion: 0.6, cacheWritePricePerMillion: 3, currency: 'CNY' },
  { id: 'doubao-seed-2.0-pro', name: 'Doubao-Seed-2.0 Pro', provider: 'doubao', contextLength: 256000, maxOutputTokens: 128000, supportsThinking: true, supportsVision: true, thinkingModes: ['off', 'low', 'medium', 'high'], inputPricePerMillion: 3.2, outputPricePerMillion: 16, cacheReadPricePerMillion: 0.64, cacheWritePricePerMillion: 3.2, currency: 'CNY' },
  { id: 'doubao-seed-2.0-lite', name: 'Doubao Seed 2.0 Lite', provider: 'doubao', contextLength: 256000, maxOutputTokens: 128000, supportsThinking: true, supportsVision: true, thinkingModes: ['off', 'low', 'medium', 'high'], inputPricePerMillion: 0.6, outputPricePerMillion: 3.6, cacheReadPricePerMillion: 0.12, cacheWritePricePerMillion: 0.6, currency: 'CNY' },
  { id: 'doubao-seed-2.0-mini', name: 'Doubao Seed 2.0 Mini', provider: 'doubao', contextLength: 256000, maxOutputTokens: 128000, supportsThinking: true, supportsVision: true, thinkingModes: ['off', 'low', 'medium', 'high'], inputPricePerMillion: 0.2, outputPricePerMillion: 2, cacheReadPricePerMillion: 0.04, cacheWritePricePerMillion: 0.2, currency: 'CNY' },
  { id: 'doubao-seed-2.0-code', name: 'Doubao Seed 2.0 Code', provider: 'doubao', contextLength: 256000, maxOutputTokens: 128000, supportsThinking: true, supportsVision: false, thinkingModes: ['off', 'low', 'medium', 'high'], inputPricePerMillion: 3.2, outputPricePerMillion: 16, cacheReadPricePerMillion: 0.64, cacheWritePricePerMillion: 3.2, currency: 'CNY' },
  // ── xAI Grok（新旗舰 4.6/4.5；移除 4.3/build/4/3）──
  { id: 'grok-4.6', name: 'Grok 4.6', provider: 'xai', contextLength: 500000, maxOutputTokens: 65536, supportsThinking: true, supportsVision: true, thinkingModes: ['off', 'low', 'medium', 'high', 'xhigh'], inputPricePerMillion: 2, outputPricePerMillion: 6, cacheReadPricePerMillion: 0.5, cacheWritePricePerMillion: 0, currency: 'USD' },
  { id: 'grok-4.5', name: 'Grok 4.5', provider: 'xai', contextLength: 500000, maxOutputTokens: 65536, supportsThinking: true, supportsVision: true, thinkingModes: ['off', 'low', 'medium', 'high'], inputPricePerMillion: 2, outputPricePerMillion: 6, cacheReadPricePerMillion: 0.3, cacheWritePricePerMillion: 0, currency: 'USD' },
  // ── Mistral AI（新旗舰 Medium 3.5 / Large 3 / Small 4）──
  { id: 'mistral-medium-3-5', name: 'Mistral Medium 3.5', provider: 'mistral', contextLength: 256000, maxOutputTokens: 65536, supportsThinking: true, supportsVision: true, thinkingModes: ['off', 'low', 'medium', 'high'], inputPricePerMillion: 1.5, outputPricePerMillion: 7.5, cacheReadPricePerMillion: 0.15, cacheWritePricePerMillion: 0, currency: 'USD' },
  { id: 'mistral-large-latest', name: 'Mistral Large 3', provider: 'mistral', contextLength: 262144, maxOutputTokens: 65536, supportsThinking: false, supportsVision: true, inputPricePerMillion: 0.5, outputPricePerMillion: 1.5, cacheReadPricePerMillion: 0.05, cacheWritePricePerMillion: 0, currency: 'USD' },
  { id: 'mistral-small-2603', name: 'Mistral Small 4', provider: 'mistral', contextLength: 262144, maxOutputTokens: 65536, supportsThinking: true, supportsVision: true, thinkingModes: ['off', 'low', 'medium', 'high'], inputPricePerMillion: 0.15, outputPricePerMillion: 0.6, cacheReadPricePerMillion: 0.015, cacheWritePricePerMillion: 0, currency: 'USD' },
  { id: 'codestral-latest', name: 'Codestral', provider: 'mistral', contextLength: 32000, maxOutputTokens: 16384, supportsThinking: false, supportsVision: false, inputPricePerMillion: 0.3, outputPricePerMillion: 0.9, cacheReadPricePerMillion: 0.03, cacheWritePricePerMillion: 0, currency: 'USD' },
  { id: 'devstral', name: 'Devstral 2', provider: 'mistral', contextLength: 262144, maxOutputTokens: 65536, supportsThinking: true, supportsVision: false, thinkingModes: ['off', 'low', 'medium', 'high'], inputPricePerMillion: 0.4, outputPricePerMillion: 0.9, cacheReadPricePerMillion: 0.04, cacheWritePricePerMillion: 0, currency: 'USD' },
  { id: 'pixtral-large-latest', name: 'Pixtral Large', provider: 'mistral', contextLength: 131072, maxOutputTokens: 16384, supportsThinking: false, supportsVision: true, inputPricePerMillion: 2, outputPricePerMillion: 6, cacheReadPricePerMillion: 0.5, cacheWritePricePerMillion: 0, currency: 'USD' },
  // ── StepFun（移除 step-1o-turbo-vision）──
  { id: 'step-3.7-flash', name: 'Step 3.7 Flash', provider: 'stepfun', contextLength: 262144, maxOutputTokens: 128000, supportsThinking: true, supportsVision: true, thinkingModes: ['off', 'low', 'medium', 'high'], inputPricePerMillion: 1.35, outputPricePerMillion: 8.1, cacheReadPricePerMillion: 0.27, cacheWritePricePerMillion: 1.35, currency: 'CNY' },
  { id: 'step-3.5-flash', name: 'Step 3.5 Flash', provider: 'stepfun', contextLength: 262144, maxOutputTokens: 128000, supportsThinking: true, supportsVision: false, thinkingModes: ['off', 'low', 'medium', 'high'], inputPricePerMillion: 0.7, outputPricePerMillion: 2.1, cacheReadPricePerMillion: 0.14, cacheWritePricePerMillion: 0.7, currency: 'CNY' },
  { id: 'step-3.5-flash-2603', name: 'Step 3.5 Flash 2603', provider: 'stepfun', contextLength: 262144, maxOutputTokens: 128000, supportsThinking: true, supportsVision: false, thinkingModes: ['off', 'low', 'high'], inputPricePerMillion: 0.7, outputPricePerMillion: 2.1, cacheReadPricePerMillion: 0.14, cacheWritePricePerMillion: 0.7, currency: 'CNY' },
  // ── 小米 MiMo（新供应商，V2.5 系列）──
  // 官方 2026-08-06 定价：pro=纯文本1M/128K，v2.5=全模态(含图像/视频/音频)1M/128K
  { id: 'mimo-v2.5-pro', name: 'MiMo-V2.5 Pro', provider: 'mimo', contextLength: 1000000, maxOutputTokens: 128000, supportsThinking: true, supportsVision: false, thinkingModes: ['off', 'low', 'medium', 'high'], inputPricePerMillion: 3, outputPricePerMillion: 6, cacheReadPricePerMillion: 0.025, cacheWritePricePerMillion: 0, currency: 'CNY' },
  { id: 'mimo-v2.5', name: 'MiMo-V2.5', provider: 'mimo', contextLength: 1000000, maxOutputTokens: 128000, supportsThinking: true, supportsVision: true, thinkingModes: ['off', 'low', 'medium', 'high'], inputPricePerMillion: 1, outputPricePerMillion: 2, cacheReadPricePerMillion: 0.02, cacheWritePricePerMillion: 0, currency: 'CNY' },
  // ── SiliconFlow（聚合平台，动态拉取为主，这里放代表性预设兜底）──
  { id: 'deepseek-ai/DeepSeek-V4-Flash', name: 'DeepSeek-V4-Flash', provider: 'siliconflow', contextLength: 1000000, maxOutputTokens: 65536, supportsThinking: true, supportsVision: false, thinkingModes: ['off', 'low', 'medium', 'high'], inputPricePerMillion: 1, outputPricePerMillion: 2, cacheReadPricePerMillion: 0.02, cacheWritePricePerMillion: 0, currency: 'CNY' },
  // ── 腾讯云 TokenHub（聚合平台；Hy3 混元旗舰）──
  { id: 'hy3', name: '腾讯混元 Hy3', provider: 'tencentcloud', contextLength: 262144, maxOutputTokens: 262144, supportsThinking: true, supportsVision: false, thinkingModes: ['off', 'low', 'high'], inputPricePerMillion: 1, outputPricePerMillion: 4, cacheReadPricePerMillion: 0.25, cacheWritePricePerMillion: 0, currency: 'CNY' },
  // ── LongCat（美团，新供应商；官方 1M ctx/262K out，纯文本）──
  { id: 'longcat-2.0', name: 'LongCat-2.0', provider: 'longcat', contextLength: 1000000, maxOutputTokens: 262144, supportsThinking: true, supportsVision: false, thinkingModes: ['off', 'low', 'medium', 'high'], inputPricePerMillion: 5, outputPricePerMillion: 20, cacheReadPricePerMillion: 0.1, cacheWritePricePerMillion: 0, currency: 'CNY' },
  // ── Dots Studio（新供应商；官方 280B MoE/512K ctx，图文视频音频全模态）──
  { id: 'dots-3-note-preview', name: 'Dots3-Note Preview', provider: 'dots', contextLength: 512000, maxOutputTokens: 65536, supportsThinking: true, supportsVision: true, thinkingModes: ['off', 'low', 'medium', 'high'], inputPricePerMillion: 0, outputPricePerMillion: 0, cacheReadPricePerMillion: 0, cacheWritePricePerMillion: 0, currency: 'USD' },
  // ── 讯飞星火（MaaS 聚合，动态拉取为主）──
  { id: 'spark-ultra', name: 'Spark Ultra', provider: 'xfyun', contextLength: 128000, maxOutputTokens: 8192, supportsThinking: true, supportsVision: false, thinkingModes: ['off', 'low', 'medium', 'high'], inputPricePerMillion: 21, outputPricePerMillion: 21, cacheReadPricePerMillion: 0, cacheWritePricePerMillion: 0, currency: 'CNY' },
  // ── 阿里云百炼（bailian，聚合，base 与通义互通；模型 id 与 qwen 重叠故不预设，依赖动态拉取全量）──
  // 说明：bailian 与 qwen 共用 DashScope base+key，其可用模型（Qwen3.8-Max/DeepSeek/Kimi/GLM 等）
  // 由 /models 动态拉取返回，模型 id 与各原厂一致，故不在本表重复预设，避免 getModelInfo 冲突。
  // 接入时 bailian manifest 复用 qwen 的 base_url，仅开通第三方模型白名单。
  // ── ModelScope 魔搭（聚合免费试用）──
  { id: 'Qwen/Qwen2.5-Coder-32B-Instruct', name: 'Qwen2.5-Coder-32B', provider: 'modelscope', contextLength: 131072, maxOutputTokens: 32768, supportsThinking: false, supportsVision: false, inputPricePerMillion: 0, outputPricePerMillion: 0, cacheReadPricePerMillion: 0, cacheWritePricePerMillion: 0, currency: 'CNY' },
  { id: 'deepseek-ai/DeepSeek-R1', name: 'DeepSeek-R1', provider: 'modelscope', contextLength: 131072, maxOutputTokens: 32768, supportsThinking: true, supportsVision: false, thinkingModes: ['off', 'low', 'medium', 'high'], inputPricePerMillion: 0, outputPricePerMillion: 0, cacheReadPricePerMillion: 0, cacheWritePricePerMillion: 0, currency: 'CNY' },
  // ── 可灵 Kling（图像/视频生成，纳入但非传统对话）──
  { id: 'kling-v2', name: 'Kling Video', provider: 'kling', contextLength: 32768, maxOutputTokens: 16384, supportsThinking: false, supportsVision: true, inputPricePerMillion: 0, outputPricePerMillion: 0, cacheReadPricePerMillion: 0, cacheWritePricePerMillion: 0, currency: 'CNY' },
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
    { value: 'max', label: '最大', desc: '全力思考' },
  ]
  if (info.thinkingModes) {
    // 档位完全由模型自身 thinkingModes 决定（含 off：如 glm-5.3/qwen3.8-max 思考恒开则不含 off）
    return levels.filter(l => info.thinkingModes!.includes(l.value))
  }
  return levels
}
