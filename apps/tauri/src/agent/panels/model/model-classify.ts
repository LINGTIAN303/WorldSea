/**
 * 模型/供应商「对比分类」工具
 *
 * 注册数据源本身缺少「模态」与「供应商类别」维度（仅 supportsVision 布尔），
 * 这里基于已有的 registry 能力 + 少量已知 ID 覆盖，给出可用的 UI 分类，后续可迭代完善。
 * 属于「展示层辅助」，不改变后端模型能力事实。
 */
import { MODEL_REGISTRY, getModelInfo } from '@worldsmith/agent-runtime'
import { getAllProviderManifests } from '@worldsmith/agent-runtime'

/** 可用模型分类（一级模型卡片） */
export type ModelModality = 'multimodal' | 'text' | 'image' | 'video' | 'audio'
export const MODALITY_LABELS: Record<ModelModality, string> = {
  multimodal: '全模态',
  text: '文本',
  image: '图像',
  video: '视频',
  audio: '语音',
}
export const MODALITY_ORDER: ModelModality[] = ['multimodal', 'text', 'image', 'video', 'audio']

/** 已知的 音/视频/图像/全模态 模型 ID 覆盖（registry 无此维度，据 provider-models-matrix-20260823 归纳；可后续下沉到 registry） */
const MODALITY_OVERRIDES: Record<string, ModelModality> = {
  // 视频生成
  'kling-video': 'video',
  'video-01': 'video',
  'doubao-seedance': 'video',
  'agnes-video': 'video',
  'cogvideox': 'video',
  'hailuo': 'video', // MiniMax 海螺视频（Hailuo/H3）
  'wan': 'video', // 通义万相 wan2.x
  't2v': 'video',
  'i2v': 'video',
  // 图像生成
  'gpt-image': 'image',
  'dall-e': 'image',
  'imagen': 'image',
  'agnes-image': 'image',
  'step-image': 'image',
  'cogview': 'image',
  'kling-image': 'image',
  // 语音
  'stepaudio': 'audio',
  'speech-': 'audio', // MiniMax speech-2.x T2A 语音
  'audio-speech': 'audio',
  'whisper': 'audio',
  'senseaudio': 'audio',
  // 全模态
  'mimo-v2.5': 'multimodal',
  'mimo': 'multimodal',
  'minimax-m3': 'multimodal',
  'kimi-k3': 'multimodal',
  'deepseek-v4-flash-vision-exp': 'multimodal',
  'step-3.7-flash': 'multimodal',
  'glm-5v': 'multimodal',
  'glm-4.6v': 'multimodal',
  'qwen3.8-max': 'multimodal',
  'qwen3.7-max': 'multimodal',
  'qwen3.7-plus': 'multimodal',
  'doubao-seed-evolving': 'multimodal',
  'sensenova-6.8-flash-lite': 'multimodal',
  'sensenova-6.5-pro': 'multimodal',
  'gemini-3.7-flash': 'multimodal',
  'gemini-3.6-flash': 'multimodal',
  'gemini-3.5-flash': 'multimodal',
  'gemini-3.1-pro-preview': 'multimodal',
  'qwen-vl': 'image',
  'qwen-vl-max': 'image',
}

/** 推断模型模态（精确优先，其次最长前缀匹配，避免「mimo」误匹配「mimo-v2.5」这类冲突） */
export function modalityOf(modelId: string): ModelModality {
  const key = modelId.toLowerCase()
  // 1. 精确匹配
  const exact = MODALITY_OVERRIDES[key]
  if (exact) return exact
  // 2. 前缀匹配：取匹配到的最长前缀
  let best: ModelModality | undefined
  let bestLen = 0
  for (const [prefix, mod] of Object.entries(MODALITY_OVERRIDES)) {
    if (key.startsWith(prefix) && prefix.length > bestLen) {
      best = mod
      bestLen = prefix.length
    }
  }
  if (best) return best
  // 3. 回退 registry 能力
  const info = getModelInfo(modelId)
  if (!info) return 'text'
  if (info.supportsVision) return 'image' // 至少有图像理解能力；具体视频/全模态由覆盖表补充
  return 'text'
}

/** 供应商类别（云 API 二级分类） */
export type ProviderCategory = 'official' | 'aggregate' | 'app'
export const CATEGORY_LABELS: Record<ProviderCategory, string> = {
  official: '官方 API',
  aggregate: '聚合 Plan',
  app: '应用 API',
}
export const CATEGORY_ORDER: ProviderCategory[] = ['official', 'aggregate', 'app']

/** 已知供应商类别覆盖（官方=模型原厂直连；聚合=聚合平台/中转；应用=移动端/特定应用 API）
    据 provider-models-matrix-20260823 的聚合类确认：openrouter/tencentcloud(TokenHub)/bailian(百炼)/modelscope/siliconflow 均属聚合 */
const CATEGORY_OVERRIDES: Record<string, ProviderCategory> = {
  openrouter: 'aggregate',
  agnes: 'app',
  'tencentcloud': 'aggregate',
  modelscope: 'aggregate',
  bailian: 'aggregate',
  siliconflow: 'aggregate',
  doubao: 'aggregate', // 火山方舟亦转售第三方
}

/** 推断供应商类别（云 API） */
export function categoryOf(providerId: string): ProviderCategory {
  if (CATEGORY_OVERRIDES[providerId]) return CATEGORY_OVERRIDES[providerId]
  return 'official'
}

/** 供应商 id → 分类（供二级「云 API」面板分组使用） */
export interface CloudProviderView {
  id: string
  label: string
  category: ProviderCategory
  /** 图标 URL（providerIcons 提供） */
  iconUrl?: string
}
export function getCloudProviderViews(): CloudProviderView[] {
  return getAllProviderManifests().map((m) => ({
    id: m.id,
    label: m.label,
    category: categoryOf(m.id),
  }))
}

/** 当前供应商下「可用模型」视图（按模态分组） */
export interface AvailableModelView {
  id: string
  name: string
  modality: ModelModality
}
export function getAvailableModels(providerId?: string): AvailableModelView[] {
  const list = providerId
    ? MODEL_REGISTRY.filter((m) => m.provider === providerId)
    : MODEL_REGISTRY
  return list.map((m) => ({
    id: m.id,
    name: m.name,
    modality: modalityOf(m.id),
  }))
}

/** modelId → { name, modality } 的映射（供「已保存模型网格」取展示名与模态） */
export function getModelInfoById(): Record<string, { name: string; modality: ModelModality }> {
  const map: Record<string, { name: string; modality: ModelModality }> = {}
  for (const m of MODEL_REGISTRY) {
    map[m.id] = { name: m.name, modality: modalityOf(m.id) }
  }
  return map
}