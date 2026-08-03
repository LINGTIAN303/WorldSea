/**
 * Agent 消息气泡共享类型定义
 *
 * 从原 AgentMessageBubble.vue 中提取，供主文件与各子组件复用。
 * 保持与原 props 内联类型完全一致，不改变任何字段。
 */
import type { ToolCallView } from '../blocks/InlineToolCall.vue'

/** 工具调用状态 */
export type ToolCallStatus = 'running' | 'completed' | 'failed'

/** 消息中的图片附件（base64 内联） */
export interface MessageImage {
  mimeType: string
  data: string
}

/** 消息中的文件附件 */
export interface MessageFile {
  name: string
  content: string
}

/**
 * Agent 消息体类型
 * 与 @agent/index 的 AgentMessage 结构兼容，role 扩展为支持 toolResult/system，
 * 以便直接接收来自 useAgent / useAgentRust 的消息而无需类型转换。
 */
export interface AgentMessage {
  id: string
  role: 'user' | 'assistant' | 'toolResult' | 'system'
  content: string
  thinking?: string
  images?: MessageImage[]
  files?: MessageFile[]
  /** Block 列表，类型来自 @worldsmith/agent-runtime */
  blocks?: import('@worldsmith/agent-runtime').MessageBlock[]
  toolCalls?: ToolCallView[]
  timestamp: number
  metadata?: Record<string, unknown>
}

/** 聊天模式：影响布局与思维链展示 */
export type ChatMode = 'normal' | 'deep' | 'explore' | 'task' | 'group-chat'

/** 深度模式段类型 */
export type DeepSegmentType = 'thinking' | 'tooling' | 'output'

/** Block 交互事件（与原 emits.blockAction 一致） */
export interface BlockActionEvent {
  blockId: string
  action: string
  data?: Record<string, unknown>
}

export type { ToolCallView }
