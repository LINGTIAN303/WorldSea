// 创作编排面板 — 类型定义
//
// 替代旧的「通用工作流引擎」类型系统。
// 所有类型面向创作场景：步骤类型 = 创作动作，而非程序节点。

// ─── 步骤类型 ─────────────────────────────────────────────────────────────

/** 6 种面向创作场景的步骤类型 */
export type StepType =
  | 'agent-task'
  | 'user-review'
  | 'batch-create'
  | 'template-apply'
  | 'consistency-check'
  | 'transform'

/** 步骤执行状态 */
export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped'

/** Pipeline 整体状态 */
export type PipelineStatus = 'draft' | 'ready' | 'running' | 'paused' | 'completed' | 'failed'

// ─── 步骤配置 ─────────────────────────────────────────────────────────────

/** Agent 执行创作任务 */
export interface AgentTaskConfig {
  /** 任务描述/prompt 模板 */
  prompt: string
  /** 绑定的 Agent 技能 ID（如 'worldbuilding'、'content-craft'） */
  skillIds?: string[]
  /** 目标实体类型（如 'character'、'region'） */
  targetEntityType?: string
  /** 预期输出描述 */
  expectedOutput?: string
}

/** 用户审阅/修改 */
export interface UserReviewConfig {
  /** 审阅提示文本 */
  instruction: string
  /** 是否可跳过 */
  skippable: boolean
}

/** 批量创建实体 */
export interface BatchCreateConfig {
  /** 目标实体类型 */
  entityType: string
  /** 创建数量 */
  count: number
  /** 参考上下文描述 */
  context?: string
  /** 名称前缀 */
  namePrefix?: string
}

/** 套用预设模板 */
export interface TemplateApplyConfig {
  /** 模板 ID */
  templateId: string
  /** 参数覆盖 */
  overrides?: Record<string, unknown>
}

/** 一致性校验 */
export interface ConsistencyCheckConfig {
  /** 检查范围：'all' | 'recent' | 指定实体类型 */
  scope: 'all' | 'recent' | string
  /** 严格度：'loose' | 'normal' | 'strict' */
  strictness: 'loose' | 'normal' | 'strict'
}

/** 数据转换 */
export interface TransformConfig {
  /** 转换描述 */
  description: string
  /** 转换规则（自然语言描述，由 Agent 解释执行） */
  rules: string
}

/** 各步骤类型的配置联合类型 */
export type StepConfig =
  | AgentTaskConfig
  | UserReviewConfig
  | BatchCreateConfig
  | TemplateApplyConfig
  | ConsistencyCheckConfig
  | TransformConfig

// ─── 步骤输出 ─────────────────────────────────────────────────────────────

/** 步骤执行结果摘要 */
export interface StepOutput {
  /** 简要结果描述 */
  summary: string
  /** 创建/修改的实体 ID 列表 */
  entityIds?: string[]
  /** 创建的关系 ID 列表 */
  relationIds?: string[]
  /** Agent 返回的详细文本 */
  detail?: string
}

// ─── 核心数据模型 ─────────────────────────────────────────────────────────

/** 创作编排步骤 */
export interface PipelineStep {
  id: string
  type: StepType
  /** 用户可读的步骤名称 */
  title: string
  /** 步骤类型特定的配置 */
  config: StepConfig
  /** 执行状态 */
  status: StepStatus
  /** 执行结果摘要 */
  output?: StepOutput | null
  /** 画布上的位置（用于可视化） */
  position?: { x: number; y: number } | null
}

/** 单个字段映射：源步骤的输出字段 → 目标步骤的输入字段 */
export interface FieldMapping {
  /** 源步骤输出字段名（如 'entityIds', 'summary'） */
  fromField: string
  /** 目标步骤输入字段名 */
  toField: string
  /** 可选的转换描述（自然语言，由 Agent 解释） */
  transform?: string
}

/** 步骤间连接 */
export interface StepConnection {
  /** 源步骤 ID */
  from: string
  /** 目标步骤 ID */
  to: string
  /** 字段级数据映射（结构化） */
  dataMapping?: FieldMapping[]
  /** 可选的文字描述（兼容旧数据） */
  description?: string
}

/** 创作编排 Pipeline */
export interface CreationPipeline {
  id: string
  name: string
  description: string
  steps: PipelineStep[]
  connections: StepConnection[]
  tags: string[]
  status: PipelineStatus
  /** 当前正在执行的步骤 ID（运行时有值） */
  currentStepId?: string | null
  createdAt: number
  updatedAt: number
}

/** Pipeline 摘要（列表显示用） */
export interface PipelineSummary {
  id: string
  name: string
  description: string
  tags: string[]
  status: PipelineStatus
  stepCount: number
  completedSteps: number
  createdAt: number
  updatedAt: number
}

// ─── 步骤库定义 ──────────────────────────────────────────────────────────

/** 步骤库中的一个可选项（用于拖拽创建） */
export interface StepLibraryItem {
  type: StepType
  /** 显示名称 */
  label: string
  /** 图标名称 */
  icon: string
  /** 简短描述 */
  description: string
  /** 默认配置模板 */
  defaultConfig: StepConfig
}

// ─── 创作模板 ─────────────────────────────────────────────────────────────

/** 创作模板定义 */
export interface CreationTemplate {
  id: string
  name: string
  description: string
  /** 模板图标 */
  icon: string
  /** 标签 */
  tags: string[]
  /** 预定义的步骤列表 */
  steps: Omit<PipelineStep, 'id' | 'status' | 'output'>[]
  /** 预定义的连接（fromIndex/toIndex 指向 steps 数组索引） */
  connections: (Omit<StepConnection, 'from' | 'to'> & { fromIndex: number; toIndex: number })[]
}

// ─── Agent 通信 ──────────────────────────────────────────────────────────

/** Pipeline 步骤 → Agent prompt 的转换结果 */
export interface AgentStepPrompt {
  /** 发送给 Agent 的 prompt */
  prompt: string
  /** 绑定的技能 ID */
  skillIds: string[]
  /** 上下文实体 ID */
  contextEntityIds?: string[]
}
