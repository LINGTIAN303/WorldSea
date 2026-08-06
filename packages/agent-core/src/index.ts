/** Agent 运行时核心库（barrel 导出 + 设计原则），详细见 docs/details/注释/packages/agent-core/index.md */

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
