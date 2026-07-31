/**
 * @worldsmith/agent-core — Agent 运行时核心库
 *
 * 基于 PI 框架的 Agent 核心抽象层，提供：
 * - 声明式工具元数据系统（ToolMeta）
 * - 统一权限守卫（PermissionGuard）
 * - 工具注册中心（ToolRegistry）
 * - 技能注册中心（SkillRegistry）
 * - 工具总线（ToolBus）
 * - 执行适配器接口（ExecutionAdapter）
 * - Agent 工厂契约
 *
 * 设计原则：
 * - 新增工具时只需在 ToolMeta 中声明权限/分类/平台，自动传播到所有消费方
 * - 权限守卫从元数据自动解析，取代散落在各处的硬编码列表
 * - 技能定义声明式，取代巨型单文件硬编码数组
 * - 核心库零外部依赖，具体实现由消费方注入
 */

// ─── 类型 ────────────────────────────────────────────────
export type {
  Platform,
  PermissionLevel,
  ToolCategoryId,
  ToolCategoryMeta,
  ToolParameter,
  ToolMeta,
  ToolDefinition,
  IToolContext,
  IToolStores,
  IEntityStore,
  IRelationStore,
  IFileStore,
  ISettingsStore,
  IUIStore,
  SkillDeclaration,
  SkillVisibility,
  SkillCategory,
  OutputPreference,
  ThinkingLevel,
  ChatMode,
  UsageData,
  ToolCallInfo,
  AgentEvent,
  AgentEventListener,
  IAgentBackend,
  PromptOptions,
  ProviderConfig,
} from './types'

// ─── 权限守卫 ────────────────────────────────────────────
export {
  PermissionGuard,
  createBeforeToolCallGuard,
} from './guard'
export type {
  PermissionGuardConfig,
  PermissionCheckResult,
} from './guard'

// ─── 注册中心 ────────────────────────────────────────────
export {
  ToolRegistry,
  getGlobalToolRegistry,
  resetGlobalToolRegistry,
  SkillRegistry,
  getGlobalSkillRegistry,
  resetGlobalSkillRegistry,
} from './registry'

// ─── 工具总线 ────────────────────────────────────────────
export {
  DefaultToolBus,
} from './bus'
export type {
  ToolBus,
} from './bus'

// ─── 执行适配器 ──────────────────────────────────────────
export type {
  ExecOptions,
  ExecResult,
  PtyOptions,
  ShellInfo,
  ShellSessionInfo,
  ShellExecResult,
  ExecutionAdapter,
  ExecutionAdapterFactory,
} from './execution'

// ─── Agent 工厂 ──────────────────────────────────────────
export {
  createAgent,
  resolveToolsForAgent,
} from './factory'
export type {
  AgentConfig,
  CreateAgentOptions,
} from './factory'

// ─── Orchestrator（Agent 编排框架，阶段 0） ─────────────
// 详见 docs/agent-orchestration-roadmap.md
export type {
  OrchestratorState,
  OrchestratorMessage,
  PlanItem,
  ReflectionResult,
  NodeContext,
  NodeBackendAccessor,
  PromptCallOptions,
  NodeResult,
  OrchestratorNode,
  NodeType,
  OrchestratorEdge,
  Orchestrator,
  OrchestratorRunOptions,
  OrchestratorResult,
  OrchestratorEvent,
} from './orchestrator'
export {
  DefaultOrchestrator,
} from './orchestrator'
