/** useChatMetrics：聊天上下文用量/成本/归档阈值计算（从 AgentChat 拆分），详细见 docs/details/注释/web/agent/chat/useChatMetrics.md */
import { computed, type Ref, type ComputedRef } from 'vue'
import { calculateCost, getVisionModels } from '@worldsmith/agent-runtime'
import { useSettingsStore } from '../../stores/settingsStore'
import { useMemoryArchive } from '@/memory-archive/useMemoryArchive'

/** 上下文用量信息 */
export interface ContextUsage {
  used: number
  total: number
  pct: number
}

/** 模型费率明细 */
type CostBreakdown = ReturnType<typeof calculateCost>

export interface UseChatMetricsOptions {
  /** 当前模型 ID */
  currentModelId: Ref<string>
  /** 当前供应商 */
  currentProvider: Ref<string>
  /** 上下文窗口长度（用户配置） */
  contextLength: Ref<number>
  /** 上次请求的 token 用量 */
  lastRequestUsage: Ref<{
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheWriteTokens: number
  }>
  /** 累计 token 用量 */
  totalUsage: Ref<{
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheWriteTokens: number
  }>
}

export function useChatMetrics(options: UseChatMetricsOptions) {
  const { currentModelId, contextLength, lastRequestUsage, totalUsage } = options
  const settingsStore = useSettingsStore()

  const hasVisionSubAgent = computed(() => {
    const vProvider = settingsStore.visionSubAgentProvider
    const vModel = settingsStore.visionSubAgentModel
    if (vProvider && vModel) return true
    return getVisionModels().length > 0
  })

  const calculatedCost: ComputedRef<CostBreakdown> = computed(() => {
    return calculateCost(
      currentModelId.value,
      totalUsage.value.inputTokens,
      totalUsage.value.outputTokens,
      totalUsage.value.cacheReadTokens,
      totalUsage.value.cacheWriteTokens,
    )
  })

  const contextUsage: ComputedRef<ContextUsage> = computed(() => {
    const total = contextLength.value
    const used = lastRequestUsage.value.inputTokens
      + lastRequestUsage.value.cacheReadTokens
      + lastRequestUsage.value.cacheWriteTokens
    const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0
    return { used, total, pct }
  })

  /** H3.3: 归档阈值（tokens） */
  const archiveThreshold = computed(() => {
    try {
      const memoryArchive = useMemoryArchive()
      if (!memoryArchive.isInitialized.value) return 0
      const config = memoryArchive.getConfig()
      return config.archiveThreshold ?? 0
    } catch {
      return 0
    }
  })

  /** H3.3: 归档阈值在进度条上的位置（百分比） */
  const archiveThresholdPct = computed(() => {
    const total = contextLength.value
    if (total <= 0 || archiveThreshold.value <= 0) return 0
    return Math.min(100, (archiveThreshold.value / total) * 100)
  })

  /** H3.3: 增强的 tooltip（含归档阈值提示） */
  const contextBarTitle = computed(() => {
    const used = contextUsage.value.used.toLocaleString()
    const total = contextUsage.value.total.toLocaleString()
    const pct = Math.round(contextUsage.value.pct)
    let title = `上下文窗口: ${used} / ${total} tokens (${pct}%)`
    if (archiveThreshold.value > 0) {
      title += `\n归档阈值: ${archiveThreshold.value.toLocaleString()} tokens`
      if (contextUsage.value.used >= archiveThreshold.value) {
        title += '\n⚠ 已超过归档阈值，即将触发自动归档'
      }
    }
    return title
  })

  return {
    hasVisionSubAgent,
    calculatedCost,
    contextUsage,
    archiveThreshold,
    archiveThresholdPct,
    contextBarTitle,
  }
}

export type UseChatMetricsReturn = ReturnType<typeof useChatMetrics>
