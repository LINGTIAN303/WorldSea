/** useAgent：Web 端 Agent Backend 入口（端分离 P3-W5，功能退化版可用项见文档），详细见 docs/details/注释/web/agent/composables/useAgent.md */

// re-export 共享类型（21+ 文件依赖这些类型）
export type {
  ChatMode,
  InteractiveToolType,
  ToolCallView,
  PhaseOutput,
  FinalOutput,
  DeepSegment,
} from '@worldsmith/shared-composables/agent/useAgent'

// re-export 注入工具（供需要 provide/inject 的组件使用）
export {
  provideAgentBackend,
  useAgentOptional,
  AGENT_BACKEND_INJECTION_KEY,
} from '@worldsmith/shared-composables/agent/useAgent'

import { ref, computed, readonly } from 'vue'
import type { AgentMessage, ImageAttachment, FileAttachment } from '@agent/index'
import { createExecutionAdapter } from '@agent/execution'
import type { ExecutionAdapter } from '@agent/execution/adapter'
import { TerminalLogBridge } from '../TerminalLogBridge'
import type { ChatMode } from '@worldsmith/shared-composables/agent/useAgent'

/**
 * useAgent — Web 端实现
 *
 * 返回"功能退化"适配器：核心本地状态机 + 终端 execution 桥接，
 * Rust 特有字段返回空值/no-op（与 useAgentRustAdapter 占位策略一致）。
 * 返回类型使用 `as any` 以兼容调用方的字段子集访问。
 */
export function useAgent() {
  /* ── 消息状态机（本地） ── */
  const messages = ref<AgentMessage[]>([])
  const isStreaming = ref(false)
  const currentSessionId = ref<string | null>(null)
  const isInitialized = ref(true)

  async function sendMessage(
    text: string,
    images?: ImageAttachment[],
    _files?: FileAttachment[],
    _mode?: ChatMode,
  ): Promise<void> {
    const userMsg: AgentMessage = {
      id: `web-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: Date.now(),
      images: images?.map((img) => ({ type: 'image' as const, data: img.data, mimeType: img.mimeType })),
    }
    messages.value.push(userMsg)

    // Web 端聊天后端未接通：本地提示（后续接入 CLI Server 消息通道时替换）
    isStreaming.value = true
    const replyId = `web-${Date.now() + 1}`
    messages.value.push({
      id: replyId,
      role: 'assistant',
      content: '⚠️ Web 端聊天后端尚未接通。当前为界面预览模式，消息不会真正发送。请启动 worldsmith-server 服务后重试。',
      timestamp: Date.now(),
    })
    isStreaming.value = false
  }

  async function sendBlockAction(_steerText: string, _displayText?: string): Promise<void> {
    // Web 端 no-op（需 Agent 后端）
  }

  async function abort(): Promise<void> {
    isStreaming.value = false
  }

  function newSession(): void {
    messages.value = []
    currentSessionId.value = null
  }

  function clearHistory(): void {
    messages.value = []
  }

  /* ── 用量 / 成本（占位，对齐 Tauri 端对象结构） ── */
  const isPinned = ref(false)
  const isVisible = ref(false)
  function show(): void {
    isVisible.value = true
  }
  function hide(): void {
    isVisible.value = false
  }
  const initError = ref<string | null>(null)
  function clearInitError(): void {
    initError.value = null
  }
  async function detectAndOfferResume(): Promise<void> {
    // Web 端占位：长任务恢复检测依赖 Agent 后端，暂不实现
  }
  const emptyUsage = () => ({ requestCount: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalCost: 0, savedByCache: 0 })
  const totalUsage = ref(emptyUsage())
  const lastRequestUsage = ref(emptyUsage())
  const cumulativeUsage = ref(emptyUsage())
  const cacheHitRate = computed(() => 0)
  function updateThinkingLevel(): void {}
  async function updateModel(): Promise<void> {}
  async function refreshSearchConfig(): Promise<void> {}

  /* ── A2UI（占位） ── */
  const a2uiSurfaces = ref<unknown[]>([])
  function resolveDataBinding(binding: unknown, _dataModel: Record<string, unknown>): unknown {
    return binding
  }

  /* ── 最后一条助手消息状态（SpaceChat/AgentMessageList 依赖） ── */
  const lastAssistantHasContent = computed(() => {
    const last = [...messages.value].reverse().find((m) => m.role === 'assistant')
    return last ? Boolean(last.content) : false
  })
  const lastAssistantHasThinking = computed(() => {
    const last = [...messages.value].reverse().find((m) => m.role === 'assistant')
    return last ? Boolean((last as { thinking?: unknown }).thinking) : false
  })

  /* ── 深度模式段 / 最终输出 / 工具确认（占位，Agent 后端未接通） ── */
  const deepSegments = ref<unknown[]>([])
  const finalOutput = ref<unknown>(null)
  function resolveToolConfirmation(): void {}

  /* ── 终端（@agent/execution 桥接，参考 useTerminal） ── */
  const terminalVisible = ref(false)
  const ptyId = ref<string | null>(null)
  const logBridge = new TerminalLogBridge()

  let terminalAdapter: ExecutionAdapter | null = null
  async function getTerminalAdapter(): Promise<ExecutionAdapter | null> {
    if (!terminalAdapter) {
      try {
        terminalAdapter = await createExecutionAdapter()
      } catch {
        return null
      }
    }
    return terminalAdapter
  }

  async function openTerminal(): Promise<void> {
    terminalVisible.value = true
    const a = await getTerminalAdapter()
    if (!a) return
    if (!a.isAvailable()) {
      const connected = await a.tryConnect()
      if (!connected) return
    }
    const id = `pty-${Date.now()}`
    await a.spawnPty(id, { shell: null, cwd: null, cols: 80, rows: 24 })
    ptyId.value = id
  }

  async function closeTerminal(): Promise<void> {
    terminalVisible.value = false
    if (ptyId.value && terminalAdapter) {
      try {
        await terminalAdapter.killPty(ptyId.value)
      } catch {}
    }
    ptyId.value = null
    terminalAdapter = null
  }

  async function writePtyInput(data: string): Promise<void> {
    if (!ptyId.value) return
    const a = await getTerminalAdapter()
    if (!a) return
    await a.writePty(ptyId.value, data)
  }

  async function resizePty(cols: number, rows: number): Promise<void> {
    if (!ptyId.value) return
    const a = await getTerminalAdapter()
    if (!a) return
    await a.resizePty(ptyId.value, cols, rows)
  }

  /* ── 初始化 / 子后端（占位） ── */
  async function ensureInitialized(): Promise<boolean> {
    isInitialized.value = true
    return true
  }

  interface FakeSubBackend {
    prompt(text: string): Promise<string>
    abort(): Promise<void>
    dispose(): void
  }
  async function createSubBackend(): Promise<FakeSubBackend> {
    return {
      async prompt(_text: string): Promise<string> {
        return 'Web 端子后端未接通'
      },
      async abort(): Promise<void> {},
      dispose(): void {},
    }
  }

  /* ── 聊天模式（占位） ── */
  const activeChatMode = ref<ChatMode>('normal')
  const lockedChatMode = ref<ChatMode | null>(null)
  function setChatMode(): void {}

  /* ── 会话（占位） ── */
  async function switchSession(): Promise<void> {}

  /* ── 长任务（占位） ── */
  const resumableTasks = ref<unknown[]>([])
  const activeTask = ref<unknown>(null)
  const heartbeatStatus = ref<unknown>(null)
  const hasActiveTask = computed(() => false)
  async function resumeTask(): Promise<void> {}
  async function discardTask(): Promise<void> {}

  /* ── Rust 特有（占位） ── */
  function getProviderConfig(): unknown {
    return null
  }

  /* ── MCP 连接（占位，useMcpConnections 共享包依赖） ── */
  function getMCPConnections(): unknown[] {
    return []
  }
  async function addMCPConnection(): Promise<void> {}
  async function removeMCPConnection(): Promise<void> {}

  return {
    messages,
    isStreaming: readonly(isStreaming),
    sendMessage,
    sendBlockAction,
    abort,
    hide,
    newSession,
    clearHistory,
    isPinned,
    isVisible,
    show,
    initError,
    clearInitError,
    detectAndOfferResume,
    totalUsage,
    lastRequestUsage,
    cumulativeUsage,
    cacheHitRate,
    updateThinkingLevel,
    updateModel,
    refreshSearchConfig,
    a2uiSurfaces,
    resolveDataBinding,
    lastAssistantHasContent,
    lastAssistantHasThinking,
    deepSegments,
    finalOutput,
    resolveToolConfirmation,
    switchSession,
    currentSessionId,
    isInitialized,
    terminalVisible,
    ptyId,
    logBridge,
    openTerminal,
    closeTerminal,
    writePtyInput,
    resizePty,
    ensureInitialized,
    createSubBackend,
    activeChatMode,
    lockedChatMode,
    setChatMode,
    resumableTasks,
    resumeTask,
    discardTask,
    activeTask,
    heartbeatStatus,
    hasActiveTask,
    getProviderConfig,
    getMCPConnections,
    addMCPConnection,
    removeMCPConnection,
  } as any
}
