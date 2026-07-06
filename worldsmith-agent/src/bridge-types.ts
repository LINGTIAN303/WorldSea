import type { AgentStateSnapshot, AgentMessage, FileAttachment } from './session/types'
import type { IToolContext } from './toolbus/types'
import type { ProviderConfig } from './providers/config'

export interface ImageAttachment {
  data: string
  mimeType: string
}

export type ChatMode = 'normal' | 'deep' | 'explore' | 'task' | 'group-chat'

export interface PromptOptions {
  skillNames?: string[]
  contextOverride?: string
  images?: ImageAttachment[]
  files?: FileAttachment[]
  personaPreset?: string
  chatMode?: ChatMode
}

export interface AgentEventListener {
  (event: AgentEvent): void
}

export interface UsageData {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  totalTokens: number
  cost: {
    input: number
    output: number
    cacheRead: number
    cacheWrite: number
    total: number
  }
}

export type AgentEvent =
  | { type: 'agent_start'; sessionId: string; chatMode: ChatMode }
  | { type: 'agent_end'; sessionId: string; messages: AgentMessage[] }
  | { type: 'turn_end'; message: AgentMessage }
  | { type: 'message_start'; message: AgentMessage }
  | { type: 'message_update'; messageId: string; content: string; thinking: string }
  | { type: 'message_end'; messageId: string; content: string; thinking: string; usage?: UsageData }
  | { type: 'tool_execution_start'; toolCall: { id: string; name: string; args: Record<string, unknown> } }
  | { type: 'tool_execution_update'; toolCallId: string; progress: number; status?: string }
  | { type: 'tool_execution_end'; toolCallId: string; result: string; success: boolean }
  | { type: 'usage'; usage: UsageData }
  | { type: 'a2ui'; surfaceId: string; message: A2UIMessage }
  | { type: 'block_append'; messageId: string; block: MessageBlock }
  | { type: 'error'; error: Error }

export interface A2UIComponent {
  id: string
  component: string
  children?: string[] | { componentId: string; path: string }
  [key: string]: unknown
}

export type A2UIMessage =
  | { version: 'v0.9'; createSurface: { surfaceId: string; catalogId: string; theme?: Record<string, unknown> } }
  | { version: 'v0.9'; updateComponents: { surfaceId: string; components: A2UIComponent[] } }
  | { version: 'v0.9'; updateDataModel: { surfaceId: string; path: string; value: unknown } }
  | { version: 'v0.9'; deleteSurface: { surfaceId: string } }

export type MessageBlock =
  | TableBlock
  | ChoiceBlock
  | CodeBlockData
  | EntityCardBlock
  | AlertBlock
  | StatBlock
  | ListBlock
  | ProgressBlock
  | ComparisonBlock
  | TimelineBlock
  | ImageBlock
  | VideoBlock
  | AccordionBlock
  | ManuscriptBlock

export interface TableBlock {
  type: 'table'
  id: string
  title?: string
  columns: { key: string; label: string; align?: 'left' | 'center' | 'right' }[]
  rows: Record<string, unknown>[]
  collapsible: true
}

export interface ChoiceBlock {
  type: 'choice'
  id: string
  title?: string
  mode: 'single' | 'multi'
  options: { value: string; label: string; description?: string }[]
  collapsible: false
}

export interface CodeBlockData {
  type: 'code'
  id: string
  language: string
  code: string
  runnable?: boolean
  collapsible: true
}

export interface EntityCardBlock {
  type: 'entity-card'
  id: string
  entityId: string
  entityType: string
  name: string
  description?: string
  tags?: string[]
  properties?: Record<string, unknown>
  collapsible: true
}

export interface AlertBlock {
  type: 'alert'
  id: string
  level: 'info' | 'success' | 'warning' | 'error'
  title?: string
  message: string
  collapsible: false
}

export interface StatBlock {
  type: 'stat'
  id: string
  title?: string
  items: Array<{
    label: string
    value: string | number
    icon?: string
    trend?: 'up' | 'down' | 'flat'
  }>
  collapsible: true
}

export interface ListBlock {
  type: 'list'
  id: string
  title?: string
  items: Array<{
    icon?: string
    label: string
    description?: string
    value?: string
  }>
  collapsible: true
}

export interface ProgressBlock {
  type: 'progress'
  id: string
  label: string
  progress: number
  status: 'running' | 'completed' | 'failed'
  collapsible: false
}

export interface ComparisonBlock {
  type: 'comparison'
  id: string
  title?: string
  left: { label: string; items: Record<string, string> }
  right: { label: string; items: Record<string, string> }
  collapsible: true
}

export interface TimelineBlock {
  type: 'timeline'
  id: string
  title?: string
  events: Array<{
    time: string
    label: string
    description?: string
  }>
  collapsible: true
}

export interface ImageBlock {
  type: 'image'
  id: string
  src: string
  alt?: string
  caption?: string
  collapsible: true
}

export interface AccordionBlock {
  type: 'accordion'
  id: string
  title?: string
  sections: Array<{
    title: string
    content: string
  }>
  collapsible: true
}

export interface VideoBlock {
  type: 'video'
  id: string
  src: string
  caption?: string
  collapsible: true
}

export interface ManuscriptBlock {
  type: 'manuscript'
  id: string
  title?: string
  content: string
  layout: 'horizontal' | 'vertical'
  animation: 'ink-drop' | 'brush-stroke' | 'fade-in' | 'float-up'
  shadow: 'sunlight' | 'soft' | 'none'
  decoration?: 'seal' | 'flourish' | 'border' | 'none'
  fontSize?: 'sm' | 'md' | 'lg' | 'xl'
  fontFamily?: string
  collapsible: true
  textColor?: string
  background?: string
  backgroundImage?: string
  backgroundOverlay?: string
  shadowColor?: string
  shadowOffset?: string
  shadowBlur?: number
  fontWeight?: string
  fontStyle?: 'normal' | 'italic'
  letterSpacing?: string
  lineHeight?: string
  width?: number
  height?: number
  sourceSessionId?: string
  exportConfig?: ExportCorrectorConfig
}

export interface ExportCorrectorConfig {
  dimensionMode: 'auto' | 'fixed'
  aspectRatio: number | null
  width: number | null
  height: number | null
  padding: number
  maxWidth: number
  backgroundFit: 'cover' | 'contain' | 'stretch'
  bgColorOverride: string | null
  fontSizeOverride: number | null
  lineHeightOverride: number | null
  textShadow: string | null
  watermark: string
  borderRadius: number
  outputFormat: 'png' | 'jpeg' | 'webp'
  outputQuality: number
  outputScale: number
  textAlign: 'left' | 'center' | 'right'
  letterSpacingOverride: number | null
}

export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'

export interface IAgentBackend {
  prompt(text: string, options?: PromptOptions): Promise<void>
  steer(text: string): Promise<void>
  followUp(text: string): Promise<void>
  abort(): Promise<void>
  updateModel(provider: string, modelId: string, baseUrl?: string, apiKey?: string, contextWindow?: number, maxTokens?: number, temperature?: number): Promise<void>
  updateThinkingLevel(level: ThinkingLevel): void
  clearHistory(): void
  subscribe(listener: AgentEventListener): () => void
  dispose(): void
  readonly state: AgentStateSnapshot
  readonly isStreaming: boolean
  /**
   * H1.2 新增：清理 PI Agent 内部上下文消息（不影响前端显示）
   *
   * 归档后调用，释放 Agent 内部 state.messages 的上下文窗口空间。
   * 与 clearHistory 的区别：clearHistory 清空全部并重置，
   * trimContext 只移除前 upToIndex 条，保留后续消息。
   *
   * @param upToIndex 要移除的消息数（从开头计）
   */
  trimContext?(upToIndex: number): void
  /**
   * 任务 4 P1 新增：获取 pi-ai agent 内部 messages（含完整 tool call/result）
   *
   * 用于长任务 checkpoint 持久化，区别于 state.messages（WorldSmith UI 快照）。
   * 恢复时将此 messages 写回新 agent.state.messages，即可从断点续跑。
   */
  getRuntimeMessages?(): unknown[]
  /**
   * 任务 4 P2 新增：写回 pi-ai agent 内部 messages（断点恢复用）
   *
   * 恢复时将 checkpoint 持久化的 messages 写回新 agent.state.messages，
   * agent 即可基于历史 messages 继续对话。
   */
  setRuntimeMessages?(messages: unknown[]): void
}

export interface AgentConfig {
  providerConfig: ProviderConfig
  systemPrompt: string
  tools: ToolDefinition[]
  toolContext: IToolContext
  beforeToolCall?: (info: { toolCall: { name: string; args: Record<string, unknown> } }) => Promise<{ block: boolean; reason?: string } | void>
}

export interface CreateAgentOptions {
  providerConfig: ProviderConfig
  toolContext: IToolContext
  tools?: AgentConfig['tools']
  beforeToolCall?: AgentConfig['beforeToolCall']
  projectName?: string
  personaPreset?: string
  availableFontFamilies?: string[]
  systemPromptOverride?: string
}

export interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, ToolParameter>
  /** 声明式元数据（权限级别、分类、平台、别名等） */
  meta?: import('@worldsmith/agent-core').ToolMeta
  execute: (args: Record<string, unknown>, ctx: IToolContext) => Promise<string>
}

export interface ToolParameter {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object'
  description: string
  required?: boolean
  enum?: string[]
  items?: ToolParameter
  properties?: Record<string, ToolParameter>
}
