/** useMemoryArchive：记忆库集成 composable（生命周期管理，工作流见文档），详细见 docs/details/注释/web/memory-archive/useMemoryArchive.md */

import { ref, readonly } from 'vue'
import {
  ArchiveManager,
  IdbStorageAdapter,
  type ArchiveConfig,
  type ArchiveMeta,
  type ArchiveResult,
  type ArchiveTriggerOptions,
  type ArchiveEventName,
  type ArchiveEventListener,
  type Hook,
  type RecallParams,
  type RecallResult,
  type TaskLogEntry,
} from '@worldsmith/memory-archive'
import {
  createWebFsOperations,
  createConfigAdapter,
  createHostEmbeddingAdapter,
  createHostLlmAdapter,
  createAgentBridgeImpl,
  convertToSnapshot,
  ChineseTokenizerAdapter,
} from './adapters'
import { registerArchiveTools, clearArchiveTools } from './archiveToolsRegistry'
import { useAgent } from '@/agent/composables/useAgent'
import { useProjectSwitcher } from '@/composables/useProjectSwitcher'
import { useArchiveStore } from '@/stores/archiveStore'
import { getSession } from '@agent/session/manager'

// ===== 模块级单例状态 =====

let archiveManager: ArchiveManager | null = null
const isInitialized = ref(false)
const isInitializing = ref(false)
/** H1.3 新增：归档进行中状态（供 UI 显示 loading） */
const isArchiving = ref(false)
const lastArchiveResult = ref<ArchiveResult | null>(null)
const hooksCount = ref(0)

/** H5.4 新增：调度器事件监听器引用（dispose 时清理） */
let schedulerSuccessListener: ((payload: unknown) => void) | null = null
let schedulerFailedListener: ((payload: unknown) => void) | null = null

/** 记忆库存储根目录名（相对于项目目录） */
const MEMORY_ARCHIVE_DIR = '.worldsmith/memory-archive'

/** H5.4 任务名中文映射 */
const TASK_NAME_CN: Record<string, string> = {
  daily: '日任务',
  weekly: '周任务',
  monthly: '月任务',
}

export function useMemoryArchive() {
  return {
    // 状态
    isInitialized: readonly(isInitialized),
    isInitializing: readonly(isInitializing),
    isArchiving: readonly(isArchiving),
    lastArchiveResult: readonly(lastArchiveResult),
    hooksCount: readonly(hooksCount),

    // 生命周期
    init,
    dispose,
    switchProject,
    switchSession,
    // H2.1 自动注入
    injectRecentSummaries,

    // 归档 API
    archive,
    archiveSession,
    recall,
    loadChunk,
    getRecentHooks,
    getAllHooks,
    tagHook,
    pinHook,
    deleteHook,
    // H5.2 回收站 API
    restoreHook,
    listTrashedHooks,
    emptyTrash,

    // 边界管理
    getBoundary,
    resetBoundary,
    restoreBoundary,

    // 配置管理（P3-4 新增）
    getConfig,
    saveConfig,

    // 周期管理（P4 新增）
    startScheduler,
    stopScheduler,
    interruptScheduler,
    getMeta,
    runDailyNow,
    runWeeklyNow,
    runMonthlyNow,
    // H5.3 两阶段合并
    confirmMerge,
    getPendingMergeGroups,

    // 事件
    on,
    off,
  }
}

// ===== 生命周期管理 =====

/**
 * 初始化记忆库
 *
 * 创建所有适配器实例和 ArchiveManager，注册归档工具。
 * 需要在 useAgent 初始化前调用（归档工具需要在 Agent 初始化时注入）。
 *
 * @returns 是否初始化成功
 */
async function init(): Promise<boolean> {
  if (isInitialized.value || isInitializing.value) return isInitialized.value
  // Web 端：无 IndexedDB 环境（如隐私模式）时跳过；不依赖 Tauri
  if (typeof indexedDB === 'undefined') {
    console.warn('[useMemoryArchive] IndexedDB unavailable, skipping initialization')
    return false
  }

  isInitializing.value = true
  try {
    const projectInfo = useProjectSwitcher().currentProject.value
    if (!projectInfo?.id) {
      console.warn('[useMemoryArchive] No project bound, skipping initialization')
      return false
    }

    const sessionId = useAgent().currentSessionId.value
    if (!sessionId) {
      console.warn('[useMemoryArchive] No active session, skipping initialization')
      return false
    }

    // Web 端无文件系统目录：用项目 id 作为命名空间（IdbStorageAdapter 以 dbName 隔离）
    const basePath = projectInfo.dirPath
      ? `${projectInfo.dirPath}/${MEMORY_ARCHIVE_DIR}`
      : `memory-archive/${projectInfo.id}`

    // 创建适配器
    const fs = createWebFsOperations()
    const storage = new IdbStorageAdapter()
    const configAdapter = createConfigAdapter()
    const embeddingAdapter = createHostEmbeddingAdapter()
    const llmAdapter = createHostLlmAdapter()
    // H2.2: 创建中文分词器（未安装分词库时自动降级）
    const tokenizer = new ChineseTokenizerAdapter()

    // 加载配置
    const savedConfig = await configAdapter.loadConfig()
    const config: Partial<ArchiveConfig> = savedConfig || {}

    // 创建 AgentBridge（工具就绪时注册到 archiveToolsRegistry）
    const agentBridge = createAgentBridgeImpl({
      onToolsReady: (tools) => {
        registerArchiveTools(tools)
      },
    })

    // 创建 ArchiveManager
    archiveManager = new ArchiveManager({
      agentBridge,
      storage,
      embeddingAdapter,
      llmAdapter,
      projectId: projectInfo.id,
      sessionId,
      fs,
      basePath,
      config,
      tokenizer, // H2.2 注入分词器
    })

    // 初始化 ArchiveManager（加载钩子、注册工具）
    await archiveManager.init()

    // H5.4 注册调度器事件监听器（自动调度任务执行后通知用户）
    schedulerSuccessListener = (payload: unknown) => {
      const log = payload as { taskName?: string; processedCount?: number }
      const name = log?.taskName ? TASK_NAME_CN[log.taskName] ?? log.taskName : '任务'
      const extra = typeof log?.processedCount === 'number' ? `，处理 ${log.processedCount} 项` : ''
      import('@/composables/useToast')
        .then(({ toastSuccess }) => toastSuccess(`记忆库${name}完成${extra}`))
        .catch(() => { /* useToast 不可用时忽略 */ })
    }
    schedulerFailedListener = (payload: unknown) => {
      const log = payload as { taskName?: string; error?: string }
      const name = log?.taskName ? TASK_NAME_CN[log.taskName] ?? log.taskName : '任务'
      const err = log?.error ? `：${log.error}` : ''
      import('@/composables/useToast')
        .then(({ toastError }) => toastError(`记忆库${name}失败${err}`))
        .catch(() => { /* useToast 不可用时忽略 */ })
    }
    archiveManager.on('scheduler:task-success', schedulerSuccessListener)
    archiveManager.on('scheduler:task-failed', schedulerFailedListener)

    // 更新状态
    hooksCount.value = archiveManager.getAllHooks().length
    isInitialized.value = true

    console.log('[useMemoryArchive] Initialized successfully', {
      projectId: projectInfo.id,
      basePath,
      hooks: hooksCount.value,
    })

    return true
  } catch (err) {
    console.error('[useMemoryArchive] Initialization failed:', err)
    return false
  } finally {
    isInitializing.value = false
  }
}

/**
 * 销毁记忆库
 *
 * 清理资源，清除归档工具注册。
 * 项目切换或应用关闭时调用。
 */
function dispose(): void {
  // H5.4 清理调度器事件监听器
  if (archiveManager) {
    if (schedulerSuccessListener) {
      archiveManager.off('scheduler:task-success', schedulerSuccessListener)
    }
    if (schedulerFailedListener) {
      archiveManager.off('scheduler:task-failed', schedulerFailedListener)
    }
  }
  schedulerSuccessListener = null
  schedulerFailedListener = null

  if (archiveManager) {
    archiveManager.dispose()
  }
  archiveManager = null
  clearArchiveTools()
  isInitialized.value = false
  isInitializing.value = false
  isArchiving.value = false
  lastArchiveResult.value = null
  hooksCount.value = 0
}

/**
 * 切换项目
 *
 * 销毁当前 ArchiveManager，用新项目的配置重新初始化。
 * 在 project:switched 事件中调用。
 */
async function switchProject(): Promise<boolean> {
  dispose()
  return init()
}

/** 切换会话：更新 ArchiveManager sessionId 并重置 boundary（复用缓存/适配器），详细见 docs/details/注释/web/memory-archive/useMemoryArchive.md */
function switchSession(newSessionId: string): void {
  if (!archiveManager || !isInitialized.value) {
    console.warn('[useMemoryArchive] Not initialized, skipping session switch')
    return
  }
  archiveManager.updateSessionId(newSessionId)
  console.log('[useMemoryArchive] Session switched:', newSessionId)
}

/** H2.1 自动注入最近钩子摘要（新会话/切换时，避免重复注入），详细见 docs/details/注释/web/memory-archive/useMemoryArchive.md */
async function injectRecentSummaries(): Promise<string> {
  ensureReady()
  // 检查是否已存在归档摘要消息（避免重复注入）
  const agent = useAgent()
  const hasArchiveSummary = agent.messages.value.some(
    (msg: { role: string; metadata?: { source?: string } }) =>
      msg.role === 'system' && msg.metadata?.source === 'memory-archive'
  )
  if (hasArchiveSummary) {
    console.log('[useMemoryArchive] 已存在归档摘要，跳过自动注入')
    return ''
  }
  const summaryText = await archiveManager!.injectRecentSummaries()
  if (summaryText) {
    console.log('[useMemoryArchive] 自动注入钩子摘要完成')
  }
  return summaryText
}

// ===== 归档 API =====

/** 执行归档 */
async function archive(trigger: ArchiveTriggerOptions): Promise<ArchiveResult> {
  ensureReady()
  isArchiving.value = true
  try {
    const result = await archiveManager!.archive(trigger)
    lastArchiveResult.value = result
    // P13 决策：同步边界到 archiveStore（Pinia + sessionStorage 持久化）
    try {
      useArchiveStore().setBoundary(result.newBoundaryIndex)
    } catch (err) {
      console.warn('[useMemoryArchive] 同步边界到 archiveStore 失败:', err)
    }
    // H1.2 新增：归档完成提醒
    try {
      const { toastSuccess } = await import('@/composables/useToast')
      toastSuccess(`已归档 ${result.newBoundaryIndex} 条对话到记忆库`)
    } catch {
      // useToast 不可用时忽略
    }
    return result
  } finally {
    isArchiving.value = false
  }
}

/** H6.2 归档指定会话（删除会话前调用，不推进 boundary），详细见 docs/details/注释/web/memory-archive/useMemoryArchive.md */
async function archiveSession(sessionId: string): Promise<ArchiveResult | null> {
  ensureReady()
  // 从 Agent 会话数据库读取目标会话
  const session = await getSession(sessionId)
  if (!session?.messages || session.messages.length === 0) {
    console.log(`[useMemoryArchive] archiveSession: 会话 ${sessionId} 无消息，跳过归档`)
    return null
  }
  // 转换为 AgentMessageSnapshot
  const snapshots = session.messages.map(convertToSnapshot)
  if (snapshots.length < (archiveManager!.getConfig().minArchiveMessages ?? 10)) {
    console.log(`[useMemoryArchive] archiveSession: 会话 ${sessionId} 消息数 ${snapshots.length} 不足，跳过归档`)
    return null
  }
  try {
    const result = await archiveManager!.archiveExternalMessages(
      sessionId,
      snapshots,
      { source: 'session_end' }
    )
    console.log(`[useMemoryArchive] archiveSession: 会话 ${sessionId} 归档完成`, {
      hookId: result.hookId,
      tokenCount: result.tokenCount,
      chunkCount: result.chunkCount,
    })
    return result
  } catch (err) {
    console.warn(`[useMemoryArchive] archiveSession: 会话 ${sessionId} 归档失败:`, err)
    return null
  }
}

/** 检索记忆 */
async function recall(params: RecallParams): Promise<RecallResult[]> {
  ensureReady()
  return archiveManager!.recall(params)
}

/** 加载记忆片段 */
async function loadChunk(hookId: string, chunkId: string) {
  ensureReady()
  return archiveManager!.loadChunk(hookId, chunkId)
}

/** 获取最近的钩子 */
async function getRecentHooks(count: number): Promise<Hook[]> {
  ensureReady()
  return archiveManager!.getRecentHooks(count)
}

/** 获取所有钩子 */
function getAllHooks(): Hook[] {
  ensureReady()
  return archiveManager!.getAllHooks()
}

/** 给钩子打标签 */
async function tagHook(hookId: string, tags: string[]): Promise<void> {
  ensureReady()
  await archiveManager!.tagHook(hookId, tags)
}

/** 标记钩子为 pinned */
async function pinHook(hookId: string, pinned: boolean): Promise<void> {
  ensureReady()
  await archiveManager!.pinHook(hookId, pinned)
}

/** 删除钩子（H5.2：默认软删除到回收站，permanent=true 永久删除） */
async function deleteHook(hookId: string, permanent: boolean = false): Promise<void> {
  ensureReady()
  await archiveManager!.deleteHook(hookId, permanent)
  hooksCount.value = archiveManager!.getAllHooks().length
}

/** H5.2 从回收站恢复钩子 */
async function restoreHook(hookId: string): Promise<void> {
  ensureReady()
  await archiveManager!.restoreHook(hookId)
  hooksCount.value = archiveManager!.getAllHooks().length
}

/** H5.2 列出回收站中的钩子 */
async function listTrashedHooks(): Promise<Hook[]> {
  ensureReady()
  return archiveManager!.listTrashedHooks()
}

/** H5.2 清空回收站（可选按时间过滤） */
async function emptyTrash(beforeTimestamp?: number): Promise<{ hooks: number; files: number }> {
  ensureReady()
  return archiveManager!.emptyTrash(beforeTimestamp)
}

// ===== 边界管理 =====

function getBoundary(): number {
  ensureReady()
  return archiveManager!.getBoundary()
}

function resetBoundary(): void {
  ensureReady()
  archiveManager!.resetBoundary()
  // P13 决策：同步重置 archiveStore
  try {
    useArchiveStore().resetBoundary()
  } catch (err) {
    console.warn('[useMemoryArchive] 重置 archiveStore 边界失败:', err)
  }
}

/** 恢复边界：从 archiveStore（sessionStorage）恢复（P13，使用场景见文档），详细见 docs/details/注释/web/memory-archive/useMemoryArchive.md */
function restoreBoundary(): void {
  ensureReady()
  try {
    const archiveStore = useArchiveStore()
    archiveStore.restoreBoundary()
    const savedIndex = archiveStore.archivedBoundaryIndex
    if (savedIndex > 0) {
      archiveManager!.restoreBoundary(savedIndex)
      console.log('[useMemoryArchive] 边界已恢复:', savedIndex)
    }
  } catch (err) {
    console.warn('[useMemoryArchive] 恢复边界失败:', err)
  }
}

// ===== 配置管理（P3-4 新增）=====

/**
 * 获取当前配置（只读副本）
 *
 * P3-4 新增：供 UI 读取配置展示。
 */
function getConfig(): ArchiveConfig {
  ensureReady()
  return archiveManager!.getConfig()
}

/**
 * 保存配置
 *
 * P3-4 新增：更新 ArchiveManager 运行时配置 + 持久化到 ConfigAdapter。
 * 会同步更新 boundary 阈值和 HookBuilder 参数。
 *
 * @param partial 部分配置
 */
async function saveConfig(partial: Partial<ArchiveConfig>): Promise<void> {
  ensureReady()
  // 1. 更新运行时配置
  archiveManager!.updateConfig(partial)
  // 2. 持久化完整配置
  const fullConfig = archiveManager!.getConfig()
  try {
    const configAdapter = createConfigAdapter()
    await configAdapter.saveConfig(fullConfig)
    console.log('[useMemoryArchive] 配置已保存')
  } catch (err) {
    console.warn('[useMemoryArchive] 配置持久化失败:', err)
    // 不抛出，运行时配置已更新，持久化失败不影响功能
  }
}

// ===== 周期管理（P4 新增）=====

/**
 * 启动周期任务调度器
 */
function startScheduler(): void {
  ensureReady()
  archiveManager!.startScheduler()
}

/**
 * 停止周期任务调度器
 */
function stopScheduler(): void {
  if (archiveManager) {
    archiveManager.stopScheduler()
  }
}

/**
 * 中断当前运行的周期任务
 */
function interruptScheduler(): void {
  if (archiveManager) {
    archiveManager.interruptScheduler()
  }
}

/**
 * 获取记忆库元数据
 */
async function getMeta(): Promise<ArchiveMeta> {
  ensureReady()
  return archiveManager!.getMeta()
}

/**
 * 手动触发日任务
 */
async function runDailyNow(): Promise<TaskLogEntry> {
  ensureReady()
  return archiveManager!.runDailyNow()
}

/**
 * 手动触发周任务
 */
async function runWeeklyNow(): Promise<TaskLogEntry> {
  ensureReady()
  return archiveManager!.runWeeklyNow()
}

/**
 * 手动触发月任务
 */
async function runMonthlyNow(): Promise<TaskLogEntry> {
  ensureReady()
  return archiveManager!.runMonthlyNow()
}

/**
 * H5.3 确认合并（两阶段合并 - 阶段 2）
 *
 * 用户在 UI 确认后调用，对 pending_merge 钩子执行实际合并。
 *
 * @returns 实际合并的组数
 */
async function confirmMerge(): Promise<number> {
  ensureReady()
  const count = await archiveManager!.confirmMerge()
  hooksCount.value = archiveManager!.getAllHooks().length
  return count
}

/**
 * H5.3 获取待合并组（供 UI 显示）
 */
function getPendingMergeGroups(): Array<{ mainHook: Hook; pendingHooks: Hook[] }> {
  ensureReady()
  return archiveManager!.getPendingMergeGroups()
}

// ===== 事件系统 =====

function on(event: ArchiveEventName, listener: ArchiveEventListener): void {
  ensureReady()
  archiveManager!.on(event, listener)
}

function off(event: ArchiveEventName, listener: ArchiveEventListener): void {
  ensureReady()
  archiveManager!.off(event, listener)
}

// ===== 内部辅助 =====

function ensureReady(): void {
  if (!archiveManager || !isInitialized.value) {
    throw new Error('[useMemoryArchive] Not initialized. Call init() first.')
  }
}
