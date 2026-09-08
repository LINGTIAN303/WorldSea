/** 核心类型定义（权限/分类/元数据/技能/事件契约），详细见 docs/details/注释/packages/agent-core/types/index.md */

// ─── 平台 ────────────────────────────────────────────────

export type Platform = 'web' | 'tauri' | 'cli'

// ─── 权限级别 ────────────────────────────────────────────

/**
 * 工具权限级别
 *
 * - safe: 只读/查询，无需确认
 * - moderate: 写入/修改，开启安全确认时需确认
 * - dangerous: 删除/危险操作，强制确认+高亮警告
 */
export type PermissionLevel = 'safe' | 'moderate' | 'dangerous'

// ─── 工具分类 ────────────────────────────────────────────

/**
 * 工具分类标识
 *
 * 用于 UI 分组展示和技能-工具映射。
 * 与 worldsea-agent 的 TOOL_CATEGORIES 对齐。
 */
export type ToolCategoryId =
  | 'entity'
  | 'relation'
  | 'search'
  | 'output'
  | 'a2ui'
  | 'memory'
  | 'project'
  | 'schema'
  | 'retrofit'
  | 'algo'
  | 'file'
  | 'dev'
  | 'plugin'
  | 'orchestrator'
  | 'vision'
  | 'plan'
  | 'persona'
  | 'native'
  | 'session'
  | 'coding'

/**
 * 工具分类元数据
 */
export interface ToolCategoryMeta {
  id: ToolCategoryId
  label: string
  icon?: string
}

// ─── 工具参数 ────────────────────────────────────────────

export interface ToolParameter {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object'
  description: string
  required?: boolean
  enum?: string[]
  items?: ToolParameter
  properties?: Record<string, ToolParameter>
}

// ─── 工具元数据 ──────────────────────────────────────────

/**
 * 工具声明式元数据
 *
 * 每个工具定义必须附带此元数据，取代散落在各处的硬编码列表。
 * 新增工具时只需在此声明权限/分类/平台，自动传播到所有消费方。
 */
export interface ToolMeta {
  /** 权限级别，决定是否需要用户确认 */
  permission: PermissionLevel

  /** 所属工具分类 */
  category: ToolCategoryId

  /** 支持的运行平台（空数组=全平台） */
  platforms?: Platform[]

  /** 旧工具名别名映射（用于兼容旧技能配置） */
  aliases?: string[]

  /** 是否始终可用（不依赖技能激活） */
  alwaysAvailable?: boolean

  /**
   * 子命令级别的权限覆盖
   *
   * 用于 shell_session 等合并工具，根据子命令动态调整权限。
   * key=子命令值，value=覆盖的权限级别。
   */
  subCommandPermissions?: Record<string, PermissionLevel>

  /**
   * 子命令级别的危险模式检测
   *
   * 用于 execute_command / shell_session(exec) 等工具，
   * 根据命令内容动态升级权限。
   */
  dangerousPatterns?: RegExp[]

  /** 工具的中文显示名（用于权限确认弹窗） */
  displayName?: string
}

// ─── 工具定义 ────────────────────────────────────────────

/**
 * 扩展工具定义（含元数据）
 *
 * 在 worldsea-agent 的 ToolDefinition 基础上增加 meta 字段，
 * 使工具自描述其权限、分类和平台可用性。
 */
export interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, ToolParameter>
  meta: ToolMeta
  execute: (args: Record<string, unknown>, ctx: IToolContext) => Promise<string>
}

// ─── 工具上下文 ──────────────────────────────────────────

/**
 * 工具执行上下文
 *
 * 最小化接口，仅声明 agent-core 需要的契约。
 * 具体实现由消费方注入。
 */
export interface IToolContext {
  stores: IToolStores
  projectInfo: {
    name: string
    entityTypes: string[]
    relationTypes: string[]
  }
  platform?: Platform
  emitA2UI?: (surfaceId: string, message: unknown) => void
  appendBlock?: (block: unknown) => void
  reportProgress?: (progress: number, status?: string) => void
}

export interface IToolStores {
  entity: IEntityStore
  relation: IRelationStore
  file: IFileStore
  settings: ISettingsStore
  ui: IUIStore
}

export interface IEntityStore {
  entities: unknown[] | { value: unknown[] }
  add(entity: unknown, source?: string): Promise<string>
  update(id: string, changes: Record<string, unknown>, source?: string): Promise<void>
  remove(id: string, source?: string): Promise<void>
  getById(id: string): Promise<unknown>
  getAllEntities(): Promise<unknown[]>
}

export interface IRelationStore {
  relations: unknown[] | { value: unknown[] }
  add(relation: unknown, source?: string): Promise<string>
  update(id: string, changes: Record<string, unknown>): Promise<void>
  remove(id: string, source?: string): Promise<void>
  getAllRelations(): Promise<unknown[]>
}

export interface IFileStore {
  add(name: string, path: string, mimeType: string, size: number, content: string, entityId?: string, tags?: string[]): Promise<string>
  getById(id: string): Promise<unknown>
  getByPath(path: string): Promise<unknown>
  getByEntity(entityId: string): Promise<unknown[]>
  getContent(id: string): Promise<unknown>
  update(id: string, changes: Record<string, unknown>): Promise<void>
  remove(id: string): Promise<void>
  associateEntity(fileId: string, entityId: string): Promise<void>
  disassociateEntity(fileId: string): Promise<void>
  getAllFiles(): Promise<unknown[]>
}

export interface ISettingsStore {
  getProviderConfig(): unknown
  getSearchConfig?(): { engine?: string; apiKey?: string }
}

export interface IUIStore {
  confirm(title: string, message: string): Promise<boolean>
}

// ─── 技能声明 ────────────────────────────────────────────

export type SkillVisibility = 'always' | 'advanced' | 'developer' | 'hidden'

export type SkillCategory = 'domain' | 'action' | 'persona'

export interface OutputPreference {
  channel: 'chat' | 'a2ui' | 'plugin' | 'file'
  component?: string
  plugin?: string
  condition?: string
}

/**
 * 技能声明
 *
 * 声明式定义，替代 registry.ts 中的硬编码 SkillMeta。
 * 每个技能目录包含 skill.yaml + SKILL.md，
 * SkillRegistry 动态加载并注册。
 */
export interface SkillDeclaration {
  id: string
  name: string
  icon: string
  description: string
  category: SkillCategory
  enabled: boolean
  visibility: SkillVisibility
  version: string

  /** 技能允许使用的工具名列表 */
  allowedTools: string[]

  /** 基础工具（技能激活时始终包含） */
  baseTools: string[]

  /** 技能提示词文件路径（相对于技能目录） */
  promptFile?: string

  /** 参考文档路径列表 */
  references?: string[]

  /** 资源文件路径列表 */
  assets?: string[]

  /** 触发关键词 */
  triggers?: string[]

  /** 输出偏好 */
  outputPreferences?: OutputPreference[]

  /** 关联插件 */
  relatedPlugins?: string[]

  /** 标签 */
  tags?: string[]

  /** 优先级（数值越大越优先） */
  priority?: number

  /** 是否自动激活 */
  autoActivate?: boolean

  /** 示例用法 */
  examples?: string[]
}

// ─── Agent 事件 ──────────────────────────────────────────

export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'

/**
 * 会话模式（三模式移除后收敛，2026-08-31）：
 * - `normal`：普通会话（统一模式，不再区分深度思考/知识探索/任务执行）
 * - `group-chat`：群聊会话类型标记（保留）
 */
export type ChatMode = 'normal' | 'group-chat'

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

export interface ToolCallInfo {
  id: string
  name: string
  args: Record<string, unknown>
}

export type AgentEvent =
  | { type: 'agent_start'; sessionId: string; chatMode: ChatMode }
  | { type: 'agent_end'; sessionId: string }
  | { type: 'turn_end' }
  | { type: 'message_start'; messageId: string }
  | { type: 'message_update'; messageId: string; content: string; thinking: string }
  | { type: 'message_end'; messageId: string; content: string; thinking: string; usage?: UsageData }
  | { type: 'tool_execution_start'; toolCall: ToolCallInfo }
  | { type: 'tool_execution_update'; toolCallId: string; progress: number; status?: string }
  | { type: 'tool_execution_end'; toolCallId: string; result: string; success: boolean }
  | { type: 'usage'; usage: UsageData }
  | { type: 'error'; error: Error }

export interface AgentEventListener {
  (event: AgentEvent): void
}

// ─── Agent 后端接口 ──────────────────────────────────────

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
  readonly isStreaming: boolean
}

export interface PromptOptions {
  skillNames?: string[]
  contextOverride?: string
  images?: Array<{ data: string; mimeType: string }>
  files?: Array<{ name: string; content: string; mimeType: string }>
  personaPreset?: string
  chatMode?: ChatMode
}

// ─── Provider 配置 ───────────────────────────────────────

export interface ProviderConfig {
  provider: string
  modelId: string
  baseUrl?: string
  apiKey?: string
  contextWindow?: number
  maxTokens?: number
  temperature?: number
}
