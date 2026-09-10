// 创作编排面板 — 类型定义
//
// 替代旧的「通用工作流引擎」类型系统。
// 所有类型面向创作场景：步骤类型 = 创作动作，而非程序节点。

// ─── 步骤类型 ─────────────────────────────────────────────────────────────

/**
 * 9 种面向创作场景的步骤类型
 *
 * 2026-09-09 接轨：tot-search（思维树探索）/ got-solve（思维图求解）/
 * multi-agent（多智能体并行产出+聚合）为编排模式节点（B 轨 TotNode/GotNode/
 * MultiAgentNode），由主 Agent 直接调用 pattern_step_run 工具执行。
 * 见 docs/plans/2026-09-09-编排双轨收口审查与6模块迁移.md。
 */
export type StepType =
  | 'agent-task'
  | 'user-review'
  | 'batch-create'
  | 'template-apply'
  | 'consistency-check'
  | 'transform'
  | 'tot-search'
  | 'got-solve'
  | 'multi-agent'

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

/** 思维树搜索（ToT：expand → evaluate → prune → select）——2026-09-09 接轨 B 轨 TotNode */
export interface TotSearchConfig {
  /** 根问题 / 创作任务描述（写入黑板 task.intent） */
  intent: string
  /** 展开器 prompt（system）：如何基于当前分支生成候选细化方案 */
  expandPrompt: string
  /** 评分器 prompt（system）：如何对候选方案打 0-100 分（独立于展开器，避免自我偏好） */
  evaluatePrompt: string
  /** 每叶子展开的候选数（branching_k） */
  branchingK: number
  /** 剪枝后保留宽度（keep_top_b） */
  keepTopB: number
  /** 树深上限（治理终止闸门） */
  maxDepth: number
}

/** 思维图求解（GoT：split → 并发视角求解 → merge → evaluate）——2026-09-09 接轨 B 轨 GotNode */
export interface GotSolveConfig {
  /** 任务意图（写入黑板 task.intent） */
  intent: string
  /** 拆分 prompt（system）：如何把任务拆为 2-4 个独立求解视角 */
  splitPrompt: string
  /** 融合 prompt（system）：如何对齐冲突并融合各视角部分解 */
  mergePrompt: string
  /** 评估 prompt（system）：判定融合解是否达标（accept） */
  evaluatePrompt: string
  /** resplit/remerge 轮次上限 */
  maxRounds: number
}

/** multi-agent 车道委派的子 Agent 规格条目（对齐后端 SubAgentSpec） */
export interface MultiAgentSpecItem {
  /** 子 Agent 唯一 id（委派引用） */
  id: string
  /** 人类可读名称 */
  name: string
  /** 能力描述（供切分时参考专长） */
  description: string
  /** 系统提示词（专长与行为边界） */
  systemPrompt: string
}

/** 多智能体并行产出+聚合（Multi-Agent：decompose → 车道并发委派子 Agent → 聚合）——2026-09-09 接轨 B 轨 MultiAgentNode */
export interface MultiAgentConfig {
  /** 任务意图（写入黑板 task.intent，切分目标） */
  intent: string
  /** 切分 prompt（system）：把任务静态切为互不阻塞的独立车道 */
  decomposePrompt: string
  /** 车道数上限（切分结果截断） */
  maxLanes: number
  /** 委派子 Agent 规格（车道并行委派目标，按车道序轮转） */
  specs: MultiAgentSpecItem[]
}

/** 各步骤类型的配置联合类型 */
export type StepConfig =
  | AgentTaskConfig
  | UserReviewConfig
  | BatchCreateConfig
  | TemplateApplyConfig
  | ConsistencyCheckConfig
  | TransformConfig
  | TotSearchConfig
  | GotSolveConfig
  | MultiAgentConfig

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
