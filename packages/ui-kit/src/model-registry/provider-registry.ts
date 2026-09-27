/** 供应商统一注册表：云端供应商基础信息集中定义，新增只需加 manifest，详细见 docs/details/注释/packages/ui-kit/model-registry/provider-registry.md */

/** API 协议类型 */
export type ApiType = 'openai-completions' | 'anthropic-messages' | 'google-generative-ai'

/** 思考格式类型 */
export type ThinkingFormat = 'deepseek' | 'reasoning_content'

/** 模型兼容性配置 */
export interface ProviderCompatConfig {
  maxTokensField?: string
  supportsUsageInStreaming?: boolean
  supportsStore?: boolean
  supportsDeveloperRole?: boolean
  supportsReasoningEffort?: boolean
  supportsStrictMode?: boolean
  thinkingFormat?: ThinkingFormat
  requiresReasoningContentOnAssistantMessages?: boolean
}

/** 思考级别映射 */
export type ThinkingLevelMap = Record<string, string | null>

/** 思考模型检测函数 */
export type ThinkingDetector = (modelId: string) => boolean

/** 视觉模型检测函数 */
export type VisionDetector = (modelId: string) => boolean

/** 端点构建器：生成请求 URL 和 headers */
export interface EndpointConfig {
  /** API 端点 URL 模板，{modelId} 为占位符 */
  url: string
  /** 默认请求头（不含 Authorization，运行时自动注入） */
  headers: Record<string, string>
}

/** 供应商 Manifest 定义 */
export interface ProviderManifest {
  /** 供应商标识（全局唯一 key） */
  id: string
  /** 显示名称 */
  label: string
  /** API 协议类型 */
  apiType: ApiType
  /** 是否为国内供应商（国内供应商走 buildCustomModel 路径） */
  isDomestic: boolean
  /** Vite 代理路径前缀（开发环境用） */
  proxyPath: string
  /** 直连 API Base URL（生产环境/标题生成等非代理场景用） */
  directBaseUrl: string
  /** 聊天补全端点路径（相对于 directBaseUrl），默认 /chat/completions */
  chatCompletionsPath?: string
  /** 模型列表端点路径（相对于 directBaseUrl），默认 /models */
  modelsPath?: string
  /** 模型列表端点鉴权方式：bearer 用 Authorization 头、api-key-header 用自定义头（如 Anthropic x-api-key）、query-key 用 URL query（如 Google） */
  modelsAuthType?: 'bearer' | 'api-key-header' | 'query-key'
  /** 模型列表响应解析器：openai 用 data[].id、anthropic 用 data[].id、google 用 models[].name（去 models/ 前缀） */
  modelsParserType?: 'openai' | 'anthropic' | 'google'
  /** 默认模型 ID */
  defaultModelId: string
  /** 视觉模型检测函数，不提供则默认不支持视觉 */
  visionDetector?: VisionDetector
  /** 思考模型检测函数，不提供则默认不支持思考 */
  thinkingDetector?: ThinkingDetector
  /** 思考格式（thinkingDetector 返回 true 时使用） */
  thinkingFormat?: ThinkingFormat
  /** 兼容性配置（OpenAI 兼容供应商通用） */
  compat?: ProviderCompatConfig
  /** 思考级别映射（仅 deepseek 使用） */
  thinkingLevelMap?: ThinkingLevelMap
  /** 模型 ID 预处理：如 deepseek 需要去掉前缀路径 */
  resolveModelId?: (modelId: string) => string
  /** 端点自定义构建（仅 anthropic/google 等非 OpenAI 格式需要） */
  customEndpoint?: (apiKey: string, modelId: string) => EndpointConfig
  /** 是否支持 /v1/models 动态拉取（默认 true） */
  supportsModelListing?: boolean
  /** 请求体构建器类型标识（仅标题生成用） */
  bodyBuilderType?: 'openai' | 'anthropic' | 'google'
  /** 响应解析类型标识（仅标题生成用） */
  responseParserType?: 'openai' | 'anthropic' | 'google'
}

// ─── 供应商 Manifest 定义 ───

const anthropic: ProviderManifest = {
  id: 'anthropic',
  label: 'Anthropic',
  apiType: 'anthropic-messages',
  isDomestic: false,
  proxyPath: '/api/anthropic',
  directBaseUrl: 'https://api.anthropic.com',
  chatCompletionsPath: '/v1/messages',
  defaultModelId: 'claude-fable-5',
  visionDetector: () => true,
  // 思考：Fable 5 始终开启；Opus/Sonnet 5 走 Adaptive；Haiku 4.5 走 Extended
  thinkingDetector: (id) => id.startsWith('claude-fable-5') || id.startsWith('claude-opus-5') || id.startsWith('claude-sonnet-5') || id.includes('haiku-4-5'),
  customEndpoint: (apiKey, _modelId) => ({
    url: 'https://api.anthropic.com/v1/messages',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
  }),
  supportsModelListing: true,
  modelsPath: '/v1/models',
  modelsAuthType: 'api-key-header',
  modelsParserType: 'anthropic',
  bodyBuilderType: 'anthropic',
  responseParserType: 'anthropic',
}

const openai: ProviderManifest = {
  id: 'openai',
  label: 'OpenAI',
  apiType: 'openai-completions',
  isDomestic: false,
  proxyPath: '/api/openai/v1',
  directBaseUrl: 'https://api.openai.com',
  defaultModelId: 'gpt-5.6-sol',
  visionDetector: () => true,
  supportsModelListing: true,
  bodyBuilderType: 'openai',
  responseParserType: 'openai',
}

const google: ProviderManifest = {
  id: 'google',
  label: 'Google',
  apiType: 'google-generative-ai',
  isDomestic: false,
  proxyPath: '/api/google',
  directBaseUrl: 'https://generativelanguage.googleapis.com',
  chatCompletionsPath: '/v1beta/models/{modelId}:generateContent',
  defaultModelId: 'gemini-3.7-flash',
  visionDetector: () => true,
  customEndpoint: (apiKey, modelId) => ({
    url: `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`,
    headers: { 'content-type': 'application/json' },
  }),
  supportsModelListing: true,
  modelsPath: '/v1beta/models',
  modelsAuthType: 'query-key',
  modelsParserType: 'google',
  bodyBuilderType: 'google',
  responseParserType: 'google',
}

const deepseek: ProviderManifest = {
  id: 'deepseek',
  label: 'DeepSeek',
  apiType: 'openai-completions',
  isDomestic: true,
  proxyPath: '/api/deepseek',
  directBaseUrl: 'https://api.deepseek.com',
  defaultModelId: 'deepseek-v4-flash',
  visionDetector: (id) => id.includes('vision'),
  thinkingDetector: (id) => id === 'deepseek-reasoner' || id.startsWith('deepseek-v4'),
  thinkingFormat: 'deepseek',
  compat: {
    maxTokensField: 'max_tokens',
    supportsUsageInStreaming: false,
    supportsStore: false,
    supportsDeveloperRole: false,
    supportsReasoningEffort: false,
    supportsStrictMode: false,
    thinkingFormat: 'deepseek',
    requiresReasoningContentOnAssistantMessages: true,
  },
  thinkingLevelMap: { off: null, minimal: null, low: null, medium: null, high: 'high', xhigh: 'max' },
  resolveModelId: (id) => id.includes('/') ? id.split('/').pop()! : id,
  supportsModelListing: true,
  bodyBuilderType: 'openai',
  responseParserType: 'openai',
}

const groq: ProviderManifest = {
  id: 'groq',
  label: 'Groq',
  apiType: 'openai-completions',
  isDomestic: false,
  proxyPath: '/api/groq/openai/v1',
  directBaseUrl: 'https://api.groq.com/openai',
  defaultModelId: 'openai/gpt-oss-120b',
  visionDetector: (id) => id.includes('scout') && id.includes('vision'),
  compat: { maxTokensField: 'max_tokens', supportsStrictMode: false, supportsUsageInStreaming: true },
  supportsModelListing: true,
  bodyBuilderType: 'openai',
  responseParserType: 'openai',
}

const openrouter: ProviderManifest = {
  id: 'openrouter',
  label: 'OpenRouter',
  apiType: 'openai-completions',
  isDomestic: false,
  proxyPath: '/api/openrouter/api/v1',
  directBaseUrl: 'https://openrouter.ai/api',
  defaultModelId: 'openai/gpt-4o',
  visionDetector: () => true,
  compat: { maxTokensField: 'max_tokens', supportsStrictMode: false, supportsUsageInStreaming: true },
  supportsModelListing: true,
  bodyBuilderType: 'openai',
  responseParserType: 'openai',
}

const zhipu: ProviderManifest = {
  id: 'zhipu',
  label: '智谱 GLM',
  apiType: 'openai-completions',
  isDomestic: true,
  proxyPath: '/api/zhipu/api/paas/v4',
  directBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
  defaultModelId: 'glm-5.3',
  visionDetector: (id) => /\d+v/i.test(id),
  thinkingDetector: (id) => id.startsWith('glm-5') || id.startsWith('glm-4.7'),
  thinkingFormat: 'reasoning_content',
  compat: { maxTokensField: 'max_tokens', supportsStrictMode: false, supportsUsageInStreaming: true },
  supportsModelListing: true,
  bodyBuilderType: 'openai',
  responseParserType: 'openai',
}

const qwen: ProviderManifest = {
  id: 'qwen',
  label: '通义千问',
  apiType: 'openai-completions',
  isDomestic: true,
  proxyPath: '/api/qwen/compatible-mode/v1',
  directBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  defaultModelId: 'qwen3.8-max',
  visionDetector: (id) => id.includes('vl') || id.includes('VL') || id.includes('3.8-plus') || id.includes('3.8-flash') || id.includes('3.7-plus') || id.includes('3.7-flash') || id.includes('3.7-max') || id.includes('3.6-plus') || id.includes('3.5-plus') || id.includes('3.5-flash'),
  thinkingDetector: (id) => id.includes('qwen3'),
  thinkingFormat: 'reasoning_content',
  compat: { maxTokensField: 'max_tokens', supportsStrictMode: false, supportsUsageInStreaming: true },
  supportsModelListing: true,
  bodyBuilderType: 'openai',
  responseParserType: 'openai',
}

const minimax: ProviderManifest = {
  id: 'minimax',
  label: 'MiniMax',
  apiType: 'openai-completions',
  isDomestic: true,
  proxyPath: '/api/minimax/v1',
  directBaseUrl: 'https://api.minimax.chat/v1',
  defaultModelId: 'MiniMax-M3',
  visionDetector: (id) => id.includes('vl') || id.includes('VL') || id.startsWith('MiniMax-M3'),
  thinkingDetector: (id) => id.startsWith('MiniMax-M2') || id.startsWith('MiniMax-M3'),
  thinkingFormat: 'reasoning_content',
  compat: { maxTokensField: 'max_tokens', supportsStrictMode: false, supportsUsageInStreaming: true },
  supportsModelListing: true,
  bodyBuilderType: 'openai',
  responseParserType: 'openai',
}

const kimi: ProviderManifest = {
  id: 'kimi',
  label: 'Kimi',
  apiType: 'openai-completions',
  isDomestic: true,
  proxyPath: '/api/kimi/v1',
  directBaseUrl: 'https://api.moonshot.cn/v1',
  defaultModelId: 'kimi-k3',
  visionDetector: (id) => id.startsWith('kimi-k3') || id.startsWith('kimi-k2.7') || id.startsWith('kimi-k2.6') || id.startsWith('kimi-k2.5'),
  thinkingDetector: (id) => id.startsWith('kimi-k2') || id.startsWith('kimi-k3'),
  thinkingFormat: 'reasoning_content',
  compat: { maxTokensField: 'max_tokens', supportsStrictMode: false, supportsUsageInStreaming: true },
  supportsModelListing: true,
  bodyBuilderType: 'openai',
  responseParserType: 'openai',
}

const agnes: ProviderManifest = {
  id: 'agnes',
  label: 'Agnes AI',
  apiType: 'openai-completions',
  isDomestic: true,
  proxyPath: '/api/agnes/v1',
  directBaseUrl: 'https://api.agnesai.com/v1',
  defaultModelId: 'agnes-2.5-pro',
  visionDetector: () => true,
  thinkingDetector: (id) => id.startsWith('agnes-2.5'),
  compat: { maxTokensField: 'max_tokens', supportsStrictMode: false, supportsUsageInStreaming: true },
  supportsModelListing: false,
  bodyBuilderType: 'openai',
  responseParserType: 'openai',
}

const sensenova: ProviderManifest = {
  id: 'sensenova',
  label: '商汤 SenseNova',
  apiType: 'openai-completions',
  isDomestic: true,
  proxyPath: '/api/sensenova/v1',
  directBaseUrl: 'https://token.sensenova.cn',
  defaultModelId: 'sensenova-6.5-pro',
  visionDetector: () => true,
  thinkingDetector: (id) => id.includes('reasoner') || id.includes('6.5') || id.includes('-6-') || id.includes('6-pro') || id.includes('6-turbo'),
  compat: { maxTokensField: 'max_tokens', supportsStrictMode: false, supportsUsageInStreaming: true },
  supportsModelListing: true,
  bodyBuilderType: 'openai',
  responseParserType: 'openai',
}

const doubao: ProviderManifest = {
  id: 'doubao',
  label: '字节豆包',
  apiType: 'openai-completions',
  isDomestic: true,
  proxyPath: '/api/doubao/api/v3',
  directBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
  defaultModelId: 'doubao-seed-evolving',
  visionDetector: (id) => id.includes('vision') || id.includes('vl') || id.includes('evolving') || id.includes('2.0-lite') || id.includes('2.0-pro') || id.includes('seed-2.1') || id.includes('seed-1.8') || id.includes('2.0-mini'),
  thinkingDetector: (id) => id.includes('seed-2') || id.includes('seed-evolving') || id.includes('1.5-pro'),
  thinkingFormat: 'reasoning_content',
  compat: { maxTokensField: 'max_tokens', supportsStrictMode: false, supportsUsageInStreaming: true },
  // 火山方舟无 OpenAI 兼容 /models 列表接口（用 endpointID+鉴权），保留预设 + 手填
  supportsModelListing: false,
  bodyBuilderType: 'openai',
  responseParserType: 'openai',
}

const xai: ProviderManifest = {
  id: 'xai',
  label: 'xAI Grok',
  apiType: 'openai-completions',
  isDomestic: false,
  proxyPath: '/api/xai/v1',
  directBaseUrl: 'https://api.x.ai',
  defaultModelId: 'grok-4.6',
  visionDetector: () => true,
  thinkingDetector: (id) => id.includes('grok-4') || id.includes('grok-3'),
  thinkingFormat: 'reasoning_content',
  compat: { maxTokensField: 'max_tokens', supportsStrictMode: false, supportsUsageInStreaming: true },
  supportsModelListing: true,
  bodyBuilderType: 'openai',
  responseParserType: 'openai',
}

const mistral: ProviderManifest = {
  id: 'mistral',
  label: 'Mistral AI',
  apiType: 'openai-completions',
  isDomestic: false,
  proxyPath: '/api/mistral/v1',
  directBaseUrl: 'https://api.mistral.ai',
  defaultModelId: 'mistral-medium-3-5',
  visionDetector: (id) => id.includes('pixtral') || id.includes('medium-3-5') || id.includes('small-2603') || id.includes('large-latest'),
  thinkingDetector: (id) => id.includes('medium-3-5') || id.includes('small-2603') || id.includes('devstral'),
  compat: { maxTokensField: 'max_tokens', supportsStrictMode: false, supportsUsageInStreaming: true },
  supportsModelListing: true,
  bodyBuilderType: 'openai',
  responseParserType: 'openai',
}

const stepfun: ProviderManifest = {
  id: 'stepfun',
  label: 'StepFun',
  apiType: 'openai-completions',
  isDomestic: true,
  proxyPath: '/api/stepfun/v1',
  directBaseUrl: 'https://api.stepfun.com',
  chatCompletionsPath: '/v1/chat/completions',
  modelsPath: '/models',
  defaultModelId: 'step-3.7-flash',
  visionDetector: (id) => id === 'step-3.7-flash',
  thinkingDetector: (id) => id === 'step-3.7-flash' || id === 'step-3.5-flash' || id === 'step-3.5-flash-2603',
  thinkingFormat: 'reasoning_content',
  compat: { maxTokensField: 'max_tokens', supportsStrictMode: false, supportsUsageInStreaming: true },
  supportsModelListing: true,
  bodyBuilderType: 'openai',
  responseParserType: 'openai',
}

// ─── 新增供应商（2026-08-23 同步，OpenAI 兼容聚合/多模态） ───

const mimo: ProviderManifest = {
  id: 'mimo',
  label: '小米 MiMo',
  apiType: 'openai-completions',
  isDomestic: true,
  proxyPath: '/api/mimo/v1',
  directBaseUrl: 'https://api.xiaomimimo.com/v1',
  chatCompletionsPath: '/chat/completions',
  defaultModelId: 'mimo-v2.5-pro',
  visionDetector: (id) => id === 'mimo-v2.5' || id.includes('omni'), // v2.5 全模态(含图/视频/音)，pro 纯文本
  thinkingDetector: (id) => id.startsWith('mimo-v2'),
  thinkingFormat: 'reasoning_content',
  compat: { maxTokensField: 'max_tokens', supportsStrictMode: false, supportsUsageInStreaming: true },
  supportsModelListing: true,
  bodyBuilderType: 'openai',
  responseParserType: 'openai',
}

const siliconflow: ProviderManifest = {
  id: 'siliconflow',
  label: 'SiliconFlow 硅基流动',
  apiType: 'openai-completions',
  isDomestic: true,
  proxyPath: '/api/siliconflow/v1',
  directBaseUrl: 'https://api.siliconflow.cn/v1',
  chatCompletionsPath: '/chat/completions',
  defaultModelId: 'deepseek-ai/DeepSeek-V4-Flash',
  visionDetector: () => true,
  thinkingDetector: (id) => id.includes('DeepSeek') || id.includes('deepseek') || id.includes('GLM') || id.includes('glm') || id.includes('Kimi') || id.includes('kimi'),
  thinkingFormat: 'reasoning_content',
  compat: { maxTokensField: 'max_tokens', supportsStrictMode: false, supportsUsageInStreaming: true },
  supportsModelListing: true,
  bodyBuilderType: 'openai',
  responseParserType: 'openai',
}

const tencentcloud: ProviderManifest = {
  id: 'tencentcloud',
  label: '腾讯云 TokenHub',
  apiType: 'openai-completions',
  isDomestic: true,
  proxyPath: '/api/tencentcloud/v1',
  directBaseUrl: 'https://api.cloud.tencent.com',
  chatCompletionsPath: '/v1/chat/completions',
  defaultModelId: 'hy3',
  visionDetector: () => true,
  thinkingDetector: (id) => id.includes('GLM') || id.includes('glm') || id.includes('Kimi') || id.includes('kimi') || id.includes('DeepSeek') || id.includes('deepseek') || id.includes('MiniMax') || id.includes('MiMo'),
  thinkingFormat: 'reasoning_content',
  compat: { maxTokensField: 'max_tokens', supportsStrictMode: false, supportsUsageInStreaming: true },
  supportsModelListing: true,
  bodyBuilderType: 'openai',
  responseParserType: 'openai',
}

const longcat: ProviderManifest = {
  id: 'longcat',
  label: 'LongCat 美团',
  apiType: 'openai-completions',
  isDomestic: true,
  proxyPath: '/api/longcat/v1',
  directBaseUrl: 'https://api.longcat.chat/v1',
  chatCompletionsPath: '/chat/completions',
  defaultModelId: 'longcat-2.0',
  visionDetector: () => true,
  thinkingDetector: (id) => id.startsWith('longcat') || id.includes('LongCat'),
  thinkingFormat: 'reasoning_content',
  compat: { maxTokensField: 'max_tokens', supportsStrictMode: false, supportsUsageInStreaming: true },
  supportsModelListing: true,
  bodyBuilderType: 'openai',
  responseParserType: 'openai',
}

const dots: ProviderManifest = {
  id: 'dots',
  label: 'Dots Studio',
  apiType: 'openai-completions',
  isDomestic: false,
  proxyPath: '/api/dots/v1',
  directBaseUrl: 'https://api.dots.ai/v1',
  chatCompletionsPath: '/chat/completions',
  defaultModelId: 'dots-3-note-preview',
  visionDetector: () => true,
  thinkingDetector: (id) => id.includes('dots-3') || id.includes('Dots'),
  compat: { maxTokensField: 'max_tokens', supportsStrictMode: false, supportsUsageInStreaming: true },
  supportsModelListing: true,
  bodyBuilderType: 'openai',
  responseParserType: 'openai',
}

const xfyun: ProviderManifest = {
  id: 'xfyun',
  label: '讯飞星火 MaaS',
  apiType: 'openai-completions',
  isDomestic: true,
  proxyPath: '/api/xfyun/v1',
  directBaseUrl: 'https://maas-api.xfyun.cn/v1',
  chatCompletionsPath: '/chat/completions',
  defaultModelId: 'spark-ultra',
  visionDetector: (id) => id.includes('vision') || id.includes('VL') || id.includes('vl'),
  thinkingDetector: (id) => id.includes('spark-x') || id.includes('ultra') || id.includes('pro'),
  compat: { maxTokensField: 'max_tokens', supportsStrictMode: false, supportsUsageInStreaming: true },
  supportsModelListing: true,
  bodyBuilderType: 'openai',
  responseParserType: 'openai',
}

const bailian: ProviderManifest = {
  id: 'bailian',
  label: '阿里云百炼',
  apiType: 'openai-completions',
  isDomestic: true,
  proxyPath: '/api/bailian/compatible-mode/v1',
  // base 与通义千问互通（同一 DashScope），此处走百炼兼容端点
  directBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  chatCompletionsPath: '/chat/completions',
  defaultModelId: 'qwen3.8-max',
  visionDetector: (id) => id.includes('qv') || id.includes('vl') || id.includes('VL') || id.includes('vision'),
  thinkingDetector: (id) => id.includes('qwen3') || id.includes('DeepSeek') || id.includes('deepseek') || id.includes('GLM') || id.includes('glm') || id.includes('kimi') || id.includes('Kimi'),
  thinkingFormat: 'reasoning_content',
  compat: { maxTokensField: 'max_tokens', supportsStrictMode: false, supportsUsageInStreaming: true },
  supportsModelListing: true,
  bodyBuilderType: 'openai',
  responseParserType: 'openai',
}

const modelscope: ProviderManifest = {
  id: 'modelscope',
  label: 'ModelScope 魔搭',
  apiType: 'openai-completions',
  isDomestic: true,
  proxyPath: '/api/modelscope/v1',
  directBaseUrl: 'https://api-inference.modelscope.cn/v1',
  chatCompletionsPath: '/chat/completions',
  defaultModelId: 'Qwen/Qwen2.5-Coder-32B-Instruct',
  visionDetector: (id) => id.includes('VL') || id.includes('vl') || id.includes('Vision') || id.includes('vision'),
  thinkingDetector: (id) => id.includes('R1') || id.includes('Reason') || id.includes('Thinking') || id.includes('qwq'),
  compat: { maxTokensField: 'max_tokens', supportsStrictMode: false, supportsUsageInStreaming: true },
  supportsModelListing: true,
  bodyBuilderType: 'openai',
  responseParserType: 'openai',
}

const kling: ProviderManifest = {
  id: 'kling',
  label: '可灵 Kling',
  apiType: 'openai-completions',
  isDomestic: true,
  proxyPath: '/api/kling/v1',
  directBaseUrl: 'https://api.klingai.com',
  chatCompletionsPath: '/v1/videos/text2video',
  defaultModelId: 'kling-v2',
  visionDetector: () => true,
  thinkingDetector: () => false,
  compat: { maxTokensField: 'max_tokens', supportsStrictMode: false, supportsUsageInStreaming: false },
  // 可灵为图像/视频生成，无 LLM /models 列表，关闭动态拉取
  supportsModelListing: false,
  bodyBuilderType: 'openai',
  responseParserType: 'openai',
}

// ─── 注册表 ───

/** 所有内置供应商 Manifest 列表 */
const ALL_MANIFESTS: ProviderManifest[] = [
  anthropic,
  openai,
  google,
  deepseek,
  groq,
  openrouter,
  zhipu,
  qwen,
  minimax,
  kimi,
  agnes,
  sensenova,
  doubao,
  xai,
  mistral,
  stepfun,
  mimo,
  siliconflow,
  tencentcloud,
  longcat,
  dots,
  xfyun,
  bailian,
  modelscope,
  kling,
]

/** 按 ID 索引的注册表 */
const REGISTRY = new Map<string, ProviderManifest>()
for (const m of ALL_MANIFESTS) {
  REGISTRY.set(m.id, m)
}

// ─── 查询 API ───

/** 获取供应商 Manifest，不存在返回 undefined */
export function getProviderManifest(id: string): ProviderManifest | undefined {
  return REGISTRY.get(id)
}

/** 获取所有已注册的供应商 Manifest */
export function getAllProviderManifests(): ProviderManifest[] {
  return ALL_MANIFESTS
}

/** 获取所有国内供应商 ID */
export function getDomesticProviderIds(): string[] {
  return ALL_MANIFESTS.filter(m => m.isDomestic).map(m => m.id)
}

/** 获取 Vite 代理路径映射 */
export function getProxyPathMap(): Record<string, string> {
  const map: Record<string, string> = {}
  for (const m of ALL_MANIFESTS) {
    map[m.id] = m.proxyPath
  }
  return map
}

/** 获取默认模型映射 */
export function getDefaultModelMap(): Record<string, string> {
  const map: Record<string, string> = {}
  for (const m of ALL_MANIFESTS) {
    map[m.id] = m.defaultModelId
  }
  return map
}

/** 获取供应商标签映射 */
export function getProviderLabelMap(): Record<string, string> {
  const map: Record<string, string> = {}
  for (const m of ALL_MANIFESTS) {
    map[m.id] = m.label
  }
  return map
}

/** 检测模型是否支持视觉 */
export function detectVisionSupport(providerId: string, modelId: string): boolean {
  const m = REGISTRY.get(providerId)
  if (!m?.visionDetector) return false
  return m.visionDetector(modelId)
}

/** 检测模型是否支持思考 */
export function detectThinkingSupport(providerId: string, modelId: string): boolean {
  const m = REGISTRY.get(providerId)
  if (!m?.thinkingDetector) return false
  return m.thinkingDetector(modelId)
}

/** 解析模型 ID（供应商特定预处理） */
export function resolveModelId(providerId: string, modelId: string): string {
  const m = REGISTRY.get(providerId)
  if (m?.resolveModelId) return m.resolveModelId(modelId)
  return modelId
}

/** 构建直连端点（标题生成等非代理场景） */
export function buildDirectEndpoint(providerId: string, apiKey: string, modelId: string): EndpointConfig {
  const m = REGISTRY.get(providerId)
  if (!m) {
    // 未知供应商，走 OpenAI 兼容默认
    return {
      url: `https://api.openai.com/v1/chat/completions`,
      headers: { 'Authorization': `Bearer ${apiKey}`, 'content-type': 'application/json' },
    }
  }

  // 自定义端点构建器（anthropic/google 等非标准格式）
  if (m.customEndpoint) {
    return m.customEndpoint(apiKey, modelId)
  }

  // 标准 OpenAI 兼容端点
  const chatPath = m.chatCompletionsPath || '/v1/chat/completions'
  const url = `${m.directBaseUrl}${chatPath}`
  return {
    url,
    headers: { 'Authorization': `Bearer ${apiKey}`, 'content-type': 'application/json' },
  }
}

/** 构建模型列表端点 URL */
export function buildModelsEndpoint(providerId: string): string | null {
  const m = REGISTRY.get(providerId)
  if (!m || m.supportsModelListing === false) return null
  const modelsPath = m.modelsPath || '/v1/models'
  return `${m.directBaseUrl}${modelsPath}`
}

/** 构建代理端点 URL（运行时代理场景） */
export function buildProxyEndpoint(providerId: string): string {
  const m = REGISTRY.get(providerId)
  if (!m) return ''
  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173'
  return `${origin}${m.proxyPath}`
}

/** 注册新的供应商 Manifest（运行时扩展） */
export function registerProviderManifest(manifest: ProviderManifest): void {
  if (REGISTRY.has(manifest.id)) {
    console.warn(`[provider-registry] 供应商 "${manifest.id}" 已存在，将被覆盖`)
  }
  REGISTRY.set(manifest.id, manifest)
  if (!ALL_MANIFESTS.find(m => m.id === manifest.id)) {
    ALL_MANIFESTS.push(manifest)
  }
}

/** 获取所有供应商 ID 列表 */
export function getProviderIds(): string[] {
  return ALL_MANIFESTS.map(m => m.id)
}
