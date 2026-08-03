/**
 * useArchiveTriggers - 归档触发机制 composable
 *
 * P3-2-3 新增：通过观察 useAgent 状态变化来触发归档，最小化对 useAgent.ts 的侵入。
 *
 * 5 个触发机制：
 * 1. 初始化：watch useAgent.isInitialized，agent 初始化后自动初始化 useMemoryArchive
 * 2. session_end：watch isStreaming: true→false，agent 响应结束时触发归档
 * 3. token 阈值：setInterval 定时检查当前消息历史的 token 估算值
 * 4. 会话切换：watch currentSessionId，更新 ArchiveManager 的 sessionId + 重置 boundary
 * 5. 项目切换：监听 window 'project:switched' 事件，重新初始化 ArchiveManager
 *
 * 设计原则：
 * - 最小侵入 useAgent.ts（不修改 useAgent 的核心逻辑）
 * - 观察者模式（通过 watch 状态变化触发）
 * - 容错（归档失败不影响主流程，所有触发器都有 try-catch）
 * - 幂等（ArchiveManager 内部有读写锁和预检查）
 *
 * 使用方式：
 * ```ts
 * const { start, stop } = useArchiveTriggers()
 * start()  // 开始监听
 * stop()   // 停止监听（组件卸载时自动调用）
 * ```
 */

import { watch, onUnmounted, type WatchStopHandle } from 'vue'
import { useAgent } from '@/agent/composables/useAgent'
import { useProjectSwitcher } from '@/composables/useProjectSwitcher'
import { useMemoryArchive } from './useMemoryArchive'

/** token 阈值检查间隔（毫秒） */
const TOKEN_CHECK_INTERVAL_MS = 30_000

/** token 估算系数：4 字符 ≈ 1 token */
const CHARS_PER_TOKEN = 4

export function useArchiveTriggers() {
  const agent = useAgent()
  const memoryArchive = useMemoryArchive()

  let tokenCheckInterval: ReturnType<typeof setInterval> | null = null
  let projectSwitchedHandler: ((e: Event) => void) | null = null
  let watchStops: WatchStopHandle[] = []
  let isStarted = false

  // ===== 触发器 0：初始化（watch useAgent.isInitialized + currentProject） =====

  /**
   * 监听 useAgent.isInitialized 和 currentProject，两者都就绪后初始化 useMemoryArchive
   *
   * useMemoryArchive.init() 依赖：
   * - useAgent.currentSessionId（需要 useAgent 已初始化）
   * - useProjectSwitcher().currentProject（需要项目已加载）
   *
   * 两者初始化顺序不确定，所以同时 watch，当两者都满足条件时调用 handleInit()。
   * 使用 immediate: true 处理两者都已就绪的情况（如热重载）。
   */
  function setupInitTrigger(): void {
    const projectSwitcher = useProjectSwitcher()
    const stop = watch(
      [() => agent.isInitialized.value, () => projectSwitcher.currentProject.value],
      ([agentReady, project]) => {
        if (agentReady === true && project !== null) {
          handleInit()
        }
      },
      { immediate: true }
    )
    watchStops.push(stop)
  }

  /** 初始化 useMemoryArchive */
  async function handleInit(): Promise<void> {
    if (memoryArchive.isInitialized.value || memoryArchive.isInitializing.value) return

    try {
      const ok = await memoryArchive.init()
      if (ok) {
        console.log('[useArchiveTriggers] useMemoryArchive 初始化成功')
        // H2.1: 初始化完成后自动注入最近钩子摘要（应用启动时的当前会话）
        try {
          await memoryArchive.injectRecentSummaries()
        } catch (err) {
          console.warn('[useArchiveTriggers] 初始化后自动注入失败:', err)
        }
      }
    } catch (err) {
      console.warn('[useArchiveTriggers] useMemoryArchive 初始化失败:', err)
    }
  }

  // ===== 触发器 1：session_end（agent 响应结束） =====

  /**
   * 监听 isStreaming: true→false，触发 session_end 归档
   *
   * 不区分 abort/正常结束：abort 后也可能需要归档已生成内容。
   * ArchiveManager 内部会判断消息数量是否达到 minArchiveMessages。
   */
  function setupSessionEndTrigger(): void {
    const stop = watch(
      () => agent.isStreaming.value,
      (newVal, oldVal) => {
        if (oldVal === true && newVal === false) {
          handleSessionEnd()
        }
      }
    )
    watchStops.push(stop)
  }

  // ===== 触发器 2：token 阈值（定时检查） =====

  /**
   * 定时检查当前消息历史的 token 估算值
   *
   * 超过 archiveThreshold 时触发 threshold 归档。
   * 流式输出时跳过检查（避免中断响应）。
   */
  function setupTokenThresholdTrigger(): void {
    tokenCheckInterval = setInterval(() => {
      checkTokenThreshold()
    }, TOKEN_CHECK_INTERVAL_MS)
  }

  // ===== 触发器 3：会话切换 =====

  /**
   * 监听 currentSessionId 变化，更新 ArchiveManager 的 sessionId + 重置 boundary
   *
   * 注意：watch 触发时 messages 已被替换为新会话的内容，
   * 所以无法在此处归档旧会话。旧会话的归档依赖 session_end 触发。
   */
  function setupSessionSwitchTrigger(): void {
    const stop = watch(
      () => agent.currentSessionId.value,
      (newSessionId, oldSessionId) => {
        if (newSessionId !== oldSessionId && newSessionId) {
          handleSessionSwitch(newSessionId)
        }
      }
    )
    watchStops.push(stop)
  }

  // ===== 触发器 4：项目切换 =====

  /**
   * 监听 window 'project:switched' 事件，重新初始化 ArchiveManager
   */
  function setupProjectSwitchTrigger(): void {
    projectSwitchedHandler = () => {
      handleProjectSwitch()
    }
    window.addEventListener('project:switched', projectSwitchedHandler)
  }

  // ===== 内部处理函数 =====

  /** session_end 归档处理 */
  async function handleSessionEnd(): Promise<void> {
    if (!memoryArchive.isInitialized.value) return
    // H6.4：正在归档时跳过，避免不必要的排队（写锁会保证互斥，但提前跳过更高效）
    if (memoryArchive.isArchiving.value) return
    const sessionId = agent.currentSessionId.value
    if (!sessionId) return

    try {
      const result = await memoryArchive.archive({ source: 'session_end' })
      console.log('[useArchiveTriggers] session_end 归档完成:', {
        hookId: result.hookId,
        tokenCount: result.tokenCount,
        chunkCount: result.chunkCount,
      })
    } catch (err) {
      // 归档失败不影响主流程（可能是消息不足、流式输出中等正常情况）
      console.warn('[useArchiveTriggers] session_end 归档跳过:', err instanceof Error ? err.message : err)
    }
  }

  /** 会话切换处理 */
  async function handleSessionSwitch(newSessionId: string): Promise<void> {
    if (!memoryArchive.isInitialized.value) return

    try {
      memoryArchive.switchSession(newSessionId)
      // H2.1: 新会话/切换会话后自动注入最近钩子摘要
      try {
        await memoryArchive.injectRecentSummaries()
      } catch (err) {
        console.warn('[useArchiveTriggers] 自动注入钩子摘要失败:', err)
      }
    } catch (err) {
      console.warn('[useArchiveTriggers] 会话切换处理失败:', err)
    }
  }

  /** token 阈值归档处理 */
  async function checkTokenThreshold(): Promise<void> {
    if (!memoryArchive.isInitialized.value) return
    if (agent.isStreaming.value) return // 流式输出时不归档
    // H6.4：正在归档时跳过，避免不必要的排队（写锁会保证互斥，但提前跳过更高效）
    if (memoryArchive.isArchiving.value) return

    const messages = agent.messages.value
    const estimatedTokens = estimateMessagesTokens(messages)

    // H1.4：动态阈值范围机制
    // 从实际配置获取 [archiveThresholdMin, archiveThresholdMax] 区间
    const config = memoryArchive.getConfig()
    const thresholdMin = config.archiveThresholdMin ?? config.archiveThreshold * 0.75
    const thresholdMax = config.archiveThresholdMax ?? config.archiveThreshold * 1.25

    // 低于下限：不归档
    if (estimatedTokens < thresholdMin) return

    // 超过上限：强制归档
    const shouldForceArchive = estimatedTokens >= thresholdMax

    // 在 [min, max] 区间内：结合用户消息占比动态决定触发点
    let shouldArchive = shouldForceArchive
    if (!shouldForceArchive) {
      const dynamicThreshold = computeDynamicThreshold(messages, thresholdMin, thresholdMax)
      shouldArchive = estimatedTokens >= dynamicThreshold
    }

    if (shouldArchive) {
      try {
        const result = await memoryArchive.archive({ source: 'threshold' })
        console.log('[useArchiveTriggers] threshold 归档完成:', {
          hookId: result.hookId,
          tokenCount: result.tokenCount,
          chunkCount: result.chunkCount,
          estimatedTokens,
          thresholdRange: `[${thresholdMin}, ${thresholdMax}]`,
          forced: shouldForceArchive,
        })
      } catch (err) {
        console.warn('[useArchiveTriggers] threshold 归档跳过:', err instanceof Error ? err.message : err)
      }
    }
  }

  /** 项目切换处理 */
  async function handleProjectSwitch(): Promise<void> {
    try {
      await memoryArchive.switchProject()
      console.log('[useArchiveTriggers] 项目切换后重新初始化完成')
    } catch (err) {
      console.warn('[useArchiveTriggers] 项目切换处理失败:', err)
    }
  }

  // ===== 辅助函数 =====

  /**
   * 估算消息历史的 token 数
   *
   * 粗略估算：4 字符 ≈ 1 token。
   * 包含 content 和 thinking 字段。
   */
  function estimateMessagesTokens(messages: ReadonlyArray<{ content?: string; thinking?: string }>): number {
    let totalChars = 0
    for (const msg of messages) {
      if (msg.content) totalChars += msg.content.length
      if (msg.thinking) totalChars += msg.thinking.length
    }
    return Math.ceil(totalChars / CHARS_PER_TOKEN)
  }

  /**
   * H1.4：计算动态归档触发点
   *
   * 在 [thresholdMin, thresholdMax] 区间内，根据用户消息占比动态决定触发点：
   * - 用户消息占比高 → 触发点接近 max（延迟归档，保护用户重要对话）
   * - 用户消息占比低（工具/agent 输出多）→ 触发点接近 min（提前归档，释放上下文）
   *
   * 公式：dynamicThreshold = min + (max - min) * userRatio
   * 其中 userRatio = 用户消息字符数 / 总字符数
   *
   * @param messages 当前消息列表
   * @param thresholdMin 阈值下限
   * @param thresholdMax 阈值上限
   * @returns 动态触发点 token 数
   */
  function computeDynamicThreshold(
    messages: ReadonlyArray<{ role?: string; content?: string; thinking?: string }>,
    thresholdMin: number,
    thresholdMax: number
  ): number {
    let userChars = 0
    let totalChars = 0
    for (const msg of messages) {
      const chars = (msg.content?.length ?? 0) + (msg.thinking?.length ?? 0)
      totalChars += chars
      if (msg.role === 'user') {
        userChars += chars
      }
    }
    // userRatio 范围 [0, 1]，0 = 全工具输出，1 = 全用户消息
    const userRatio = totalChars > 0 ? userChars / totalChars : 0.5
    return Math.round(thresholdMin + (thresholdMax - thresholdMin) * userRatio)
  }

  // ===== 生命周期 =====

  /**
   * 开始监听所有触发器
   *
   * 在 App.vue onMounted 中调用。会自动处理 useMemoryArchive 的初始化时序：
   * - watch useAgent.isInitialized，agent 初始化后自动调用 useMemoryArchive.init()
   * - 其他触发器在 useMemoryArchive 初始化后自动开始工作（内部检查 isInitialized）
   */
  function start(): void {
    if (isStarted) return
    isStarted = true

    setupInitTrigger()
    setupSessionEndTrigger()
    setupTokenThresholdTrigger()
    setupSessionSwitchTrigger()
    setupProjectSwitchTrigger()

    console.log('[useArchiveTriggers] 触发器已启动')
  }

  /** 停止监听所有触发器 */
  function stop(): void {
    if (!isStarted) return
    isStarted = false

    // 停止所有 watch
    for (const stopWatch of watchStops) {
      stopWatch()
    }
    watchStops = []

    // 停止定时器
    if (tokenCheckInterval) {
      clearInterval(tokenCheckInterval)
      tokenCheckInterval = null
    }

    // 移除事件监听
    if (projectSwitchedHandler) {
      window.removeEventListener('project:switched', projectSwitchedHandler)
      projectSwitchedHandler = null
    }

    console.log('[useArchiveTriggers] 触发器已停止')
  }

  // 组件卸载时自动清理
  onUnmounted(() => {
    stop()
  })

  return {
    start,
    stop,
  }
}
