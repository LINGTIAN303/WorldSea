/**
 * AgentBridgeImpl - AgentBridge 接口的宿主实现
 *
 * 对接 useAgent composable，为 memory-archive 框架提供消息访问、边界推进、
 * 摘要注入和工具注册能力。
 *
 * 关键设计：
 * 1. 消息转换：AgentMessage → AgentMessageSnapshot（'toolResult' → 'tool'）
 * 2. 边界推进：直接 splice useAgent().messages 数组（释放上下文窗口）
 * 3. 摘要注入：在 messages 开头插入系统消息（包含归档摘要）
 * 4. 工具注册：通过回调函数将工具传递给 useMemoryArchive（由其注入到 Agent）
 *    （IAgentBackend 不暴露 toolBus，需要 useMemoryArchive 在初始化时注入）
 * 5. 边界持久化（P12）：advanceBoundary 时写入 sessionStorage，
 *    restoreBoundary/resetBoundary 用于 abort/clearHistory 恢复
 * 6. 钩子摘要缓存（P12）：injectHookSummary 时缓存文本，getHookSummaryForPrompt 返回
 */

import type { AgentBridge } from '@worldsmith/memory-archive/adapters'
import type {
  AgentMessageSnapshot,
  ArchiveResult,
  ArchiveTool,
  Hook,
} from '@worldsmith/memory-archive/types'
import { countMessagesTokens } from '@worldsmith/memory-archive/utils'
import type { AgentMessage } from '@agent/session/types'
import { useAgent } from '@/agent/composables/useAgent'

/** 归档完成回调类型 */
type ArchiveCompleteCallback = (result: ArchiveResult) => void

/** 工具就绪回调类型（由 useMemoryArchive 提供，用于将工具注入 Agent） */
type ToolsReadyCallback = (tools: ArchiveTool[]) => void

/** sessionStorage key：持久化归档边界索引（P12 决策） */
const BOUNDARY_STORAGE_KEY = 'archive:boundary'

export interface AgentBridgeImplOptions {
  /** 工具就绪回调（ArchiveManager.init() 创建工具后调用） */
  onToolsReady?: ToolsReadyCallback
}

/**
 * 创建宿主 AgentBridge 实例
 *
 * @param options 配置选项
 * @returns AgentBridge 实例
 */
export function createAgentBridgeImpl(options: AgentBridgeImplOptions = {}): AgentBridge {
  const archiveCompleteCallbacks: ArchiveCompleteCallback[] = []

  /** 缓存的钩子摘要文本（injectHookSummary 时写入，getHookSummaryForPrompt 读取） */
  let cachedHookSummary = ''

  return {
    /**
     * 获取当前会话消息快照
     *
     * 将 useAgent 的 AgentMessage 转换为框架所需的 AgentMessageSnapshot：
     * - 'toolResult' 角色映射为 'tool'
     * - assistant 消息的 toolCalls 信息保留在 metadata 中
     * - toolResult 消息的 toolName 从 metadata 中提取
     */
    getCurrentMessages(): AgentMessageSnapshot[] {
      return fetchCurrentSnapshots()
    },

    /**
     * 获取当前上下文 token 数
     *
     * 使用 gpt-tokenizer 估算所有消息的 token 总数。
     */
    getCurrentTokenCount(): number {
      const snapshots = fetchCurrentSnapshots()
      return countMessagesTokens(snapshots)
    },

    /**
     * 推进归档边界
     *
     * H1.2 修复：不再截断前端 useAgent().messages（用户仍可见完整历史），
     * 改为调用 backend.trimContext 清理 PI Agent 内部 state.messages，
     * 释放上下文窗口空间。
     *
     * 前端通过 archiveStore.archivedBoundaryIndex 显示"已归档 N 条"折叠提示，
     * 而非真正移除消息。
     *
     * P12 决策：同时将边界索引持久化到 sessionStorage，
     * 供 abort 重建 agent 后恢复。
     *
     * 注意：此操作不可逆，归档前确保记忆文件已持久化。
     *
     * @param archivedUpToIndex 本次归档的消息数（从消息数组开头计）
     */
    advanceBoundary(archivedUpToIndex: number): void {
      if (archivedUpToIndex <= 0) return
      // H1.2：调用 backend.trimContext 清理 Agent 内部上下文
      const agent = useAgent()
      if (typeof agent.trimContext === 'function') {
        agent.trimContext(archivedUpToIndex)
      } else {
        console.warn('[AgentBridgeImpl] backend.trimContext 不可用，Agent 内部上下文未清理')
      }
      // P12 决策：持久化边界索引（累计值由 archiveStore 管理）
      // 注意：这里持久化的是"已归档"的事实，而非新的边界索引
      // restoreBoundary 时读取的是归档前的索引，用于 AgentMessageList 显示已归档消息数
      try {
        sessionStorage.setItem(BOUNDARY_STORAGE_KEY, String(archivedUpToIndex))
      } catch {
        // sessionStorage 不可用时忽略
      }
    },

    /**
     * 注入钩子摘要到消息上下文
     *
     * 将归档钩子的摘要作为系统消息注入到 messages 数组开头，
     * 使 Agent 能感知之前对话的关键信息。
     *
     * P12 决策：同时缓存摘要文本，供 getHookSummaryForPrompt() 使用。
     *
     * @returns 注入的摘要文本
     */
    injectHookSummary(hooks: Hook[]): string {
      if (hooks.length === 0) return ''

      const summaryParts = hooks.map(h => {
        const title = h.chunkTitles[0]?.title || '归档记忆'
        return `### ${title}\n${h.summary}`
      })
      const summaryText = `以下是之前对话的归档记忆摘要，供你参考：\n\n${summaryParts.join('\n\n')}`

      // P12 决策：缓存摘要文本
      cachedHookSummary = summaryText

      const systemMsg: AgentMessage = {
        id: `archive-summary-${Date.now()}`,
        role: 'system',
        content: summaryText,
        timestamp: Date.now(),
        metadata: {
          source: 'memory-archive',
          hookIds: hooks.map(h => h.id),
        },
      }

      const msgs = useAgent().messages
      msgs.value = [systemMsg, ...msgs.value]

      return summaryText
    },

    /**
     * 注册归档工具到 Agent
     *
     * ArchiveManager.init() 创建归档工具后调用此方法。
     * 由于 IAgentBackend 不暴露 toolBus，工具通过 onToolsReady 回调
     * 传递给 useMemoryArchive，由其在 Agent 初始化时注入。
     */
    registerTools(tools: ArchiveTool[]): void {
      if (options.onToolsReady) {
        options.onToolsReady(tools)
      }
    },

    /**
     * 是否正在流式输出
     *
     * 归档前检查，流式输出中禁止归档（避免消息不一致）。
     */
    isStreaming(): boolean {
      return useAgent().isStreaming.value
    },

    /**
     * 归档完成回调（可选）
     *
     * 注册回调，归档完成时通知调用方。
     */
    onArchiveComplete(callback: ArchiveCompleteCallback): void {
      archiveCompleteCallbacks.push(callback)
    },

    /**
     * 恢复归档边界（P12 决策）
     *
     * 从 sessionStorage 读取持久化的边界索引。
     * 用于 abort 重建 agent / ensureInitialized 后调用。
     *
     * 注意：此方法仅读取持久化值，不修改 messages 数组。
     * 边界的实际恢复由 ArchiveManager.restoreBoundary() 完成。
     */
    restoreBoundary(): void {
      // 读取操作由 archiveStore 负责，这里仅作为接口对齐
      // 实际恢复逻辑在 useMemoryArchive.restoreBoundary() 中
    },

    /**
     * 重置归档边界（P12 决策）
     *
     * 清空 sessionStorage 中的边界索引。
     * 用于 clearHistory 时调用。
     */
    resetBoundary(): void {
      try {
        sessionStorage.removeItem(BOUNDARY_STORAGE_KEY)
      } catch {
        // sessionStorage 不可用时忽略
      }
    },

    /**
     * 获取钩子摘要文本（P12 决策）
     *
     * 返回最近注入的钩子摘要文本，供 system prompt 拼接使用。
     * 与 injectHookSummary 的区别：此方法不修改 messages 数组，
     * 仅返回缓存文本。
     *
     * @returns 钩子摘要文本，无摘要时返回空字符串
     */
    getHookSummaryForPrompt(): string {
      return cachedHookSummary
    },
  }
}

// ===== 内部辅助函数 =====

/**
 * 获取当前消息快照（独立函数，避免 this 绑定问题）
 *
 * 从 useAgent 读取当前消息并转换为 AgentMessageSnapshot。
 * 在 getCurrentMessages 和 getCurrentTokenCount 中复用。
 */
function fetchCurrentSnapshots(): AgentMessageSnapshot[] {
  const msgs = useAgent().messages.value
  return msgs.map(convertToSnapshot)
}

/**
 * 将 AgentMessage 转换为 AgentMessageSnapshot
 *
 * 转换规则：
 * - role: 'toolResult' → 'tool'，其他保持不变
 * - toolName: 从 metadata.toolName 提取（toolResult 消息）
 * - toolCallId: 从 metadata.toolCallId 提取
 * - toolCalls: assistant 消息的 toolCalls 信息保留在 metadata 中
 */
export function convertToSnapshot(msg: AgentMessage): AgentMessageSnapshot {
  const role = msg.role === 'toolResult' ? 'tool' : msg.role

  const snapshot: AgentMessageSnapshot = {
    role: role as AgentMessageSnapshot['role'],
    content: msg.content,
    timestamp: msg.timestamp,
  }

  // 提取 toolName 和 toolCallId（从 metadata）
  if (msg.metadata) {
    if (msg.metadata.toolName) {
      snapshot.toolName = msg.metadata.toolName as string
    }
    if (msg.metadata.toolCallId) {
      snapshot.toolCallId = msg.metadata.toolCallId as string
    }
    snapshot.metadata = { ...msg.metadata }
  }

  // assistant 消息的 toolCalls 信息保留在 metadata 中
  if (msg.toolCalls && msg.toolCalls.length > 0) {
    if (!snapshot.metadata) snapshot.metadata = {}
    snapshot.metadata.toolCalls = msg.toolCalls.map(tc => ({
      id: tc.id,
      name: tc.name,
      status: tc.status,
    }))
    // 如果没有 toolName，从第一个 toolCall 提取
    if (!snapshot.toolName && msg.toolCalls[0]) {
      snapshot.toolName = msg.toolCalls[0].name
    }
  }

  return snapshot
}
