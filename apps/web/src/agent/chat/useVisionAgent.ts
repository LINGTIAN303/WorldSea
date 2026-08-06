/** useVisionAgent：vision 子 Agent 初始化与执行（从 AgentChat.onMounted 的 registerExecutor 回调拆分，依赖注入解耦） */
import type { Ref } from 'vue'
import { useSettingsStore } from '../../stores/settingsStore'
import { getVisionModels, getModelInfo, modelSupportsVision } from '@worldsmith/agent-runtime'
import { loadApiKey } from '@agent/index'
import { trackSubAgentLongTask, untrackSubAgentLongTask } from '../composables/useOrchestrator'

/** 子 Agent 任务描述（registerExecutor 回调入参的字段子集） */
export interface VisionSubAgentTask {
  id: string
  type: string
  prompt: string
  skillIds: string[]
  images?: { data: string; mimeType: string }[]
}

/** vision 子后端 Provider 配置（透传给 createSubBackend） */
export interface VisionProviderConfig {
  mode: string
  provider: string
  modelId: string
  apiKey: string
  supportsVision: boolean
  contextWindow?: number
  maxTokens: number
}

export interface UseVisionAgentOptions {
  /** useAgent.createSubBackend（创建子 Agent 后端） */
  createSubBackend: (skillIds: string[], visionProviderConfig?: unknown) => Promise<any>
  /** 当前主模型 ID（useChatSettings.currentModelId，用于判断是否支持 vision） */
  currentModelId: Ref<string>
}

export function useVisionAgent(options: UseVisionAgentOptions) {
  const { createSubBackend, currentModelId } = options
  const settingsStore = useSettingsStore()

  /** 构建 vision Provider 配置：主模型不支持 vision 且任务带图片时，从设置/视觉模型清单解析供应商与模型 */
  async function buildVisionProviderConfig(task: VisionSubAgentTask): Promise<VisionProviderConfig | undefined> {
    if (task.images && task.images.length > 0 && !modelSupportsVision(currentModelId.value)) {
      const vProvider = settingsStore.visionSubAgentProvider
      const vModel = settingsStore.visionSubAgentModel
      let provider = vProvider
      let modelId = vModel
      if (!provider || !modelId) {
        const visionModels = getVisionModels()
        if (visionModels.length > 0) {
          provider = visionModels[0].provider
          modelId = visionModels[0].id
        }
      }
      if (provider && modelId) {
        const apiKey = await loadApiKey(provider)
        if (apiKey) {
          const info = getModelInfo(modelId)
          return {
            mode: 'cloud',
            provider,
            modelId,
            apiKey,
            supportsVision: true,
            contextWindow: info?.contextLength,
            maxTokens: info ? Math.min(info.maxOutputTokens, 4096) : 4096,
          }
        }
      }
    }
    return undefined
  }

  /** 执行子 Agent：创建后端 → 跟踪长任务 → prompt + 耗时统计 → 返回结果（registerExecutor 回调主体） */
  async function initVisionAgent(task: VisionSubAgentTask): Promise<{ success: boolean; output: string; duration: number }> {
    try {
      const visionProviderConfig = await buildVisionProviderConfig(task)
      const subBackend = await createSubBackend(task.skillIds, visionProviderConfig)

      // 任务 4 P4：子 Agent 长任务跟踪（checkpoint + 心跳，复用 longTaskStore 持久层）
      trackSubAgentLongTask(task.id, subBackend, task.prompt, task.type)

      const startTime = Date.now()
      const promptOptions: { images?: { data: string; mimeType: string }[] } = {}
      if (task.images && task.images.length > 0) {
        promptOptions.images = task.images
      }
      const result = await subBackend.prompt(task.prompt, promptOptions)
      const duration = Date.now() - startTime

      await untrackSubAgentLongTask(task.id, 'completed')
      subBackend.dispose()

      return {
        success: true,
        output: typeof result === 'string' ? result : JSON.stringify(result),
        duration,
      }
    } catch (err) {
      // 任务 4 P4：失败时标记子 Agent 长任务为 failed（track 未调用时 updateTask 静默 warn，无副作用）
      await untrackSubAgentLongTask(task.id, 'failed').catch(() => {})
      return {
        success: false,
        output: err instanceof Error ? err.message : String(err),
        duration: 0,
      }
    }
  }

  return { initVisionAgent, buildVisionProviderConfig }
}
