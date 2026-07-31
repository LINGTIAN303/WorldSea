/**
 * Orchestrator 模块入口 — Agent 编排框架
 *
 * 阶段 0：TS 接口定义 + 简单实现
 * 阶段 1：迁移到 Rust trait
 *
 * 详见 docs/agent-orchestration-roadmap.md
 */

// ─── 类型定义 ────────────────────────────────────────────
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
  // 阶段 0.6 新增：Memory Pattern 类型
  MemoryAccessor,
  MemoryRecallOptions,
  MemoryRecallResult,
  MemoryInjectOptions,
  MemoryArchiveResult,
  MemoryChunkContent,
  MemoryOutputType,
  // 阶段 0.7 新增：Working Memory 类型
  WorkingMemoryEntry,
  WorkingMemorySnapshot,
} from './types'

// ─── 默认实现 ────────────────────────────────────────────
export {
  DefaultOrchestrator,
} from './default-orchestrator'

// ─── 基础节点（阶段 0.2-0.6 逐步实现） ──────────────────
export { ReactNode } from './nodes/react-node'
export type { ReactNodeConfig, ReactNodeWorkingMemoryConfig } from './nodes/react-node'
export { PlanNode } from './nodes/plan-node'
export type { PlanNodeConfig } from './nodes/plan-node'
export { ExecuteNode } from './nodes/execute-node'
export type { ExecuteNodeConfig } from './nodes/execute-node'
export { ReflectionNode } from './nodes/reflection-node'
export type { ReflectionNodeConfig, ReflectionDimension } from './nodes/reflection-node'
export { RefineNode } from './nodes/refine-node'
export type { RefineNodeConfig } from './nodes/refine-node'
// 阶段 0.6 新增：Memory Pattern 横切节点
export { MemoryNode } from './nodes/memory-node'
export type { MemoryNodeConfig, MemoryNodeAction } from './nodes/memory-node'

// ─── 工具类（阶段 0.6 新增） ──────────────────────────────
export { ShortTermMemoryHelper } from './short-term-memory'
export type { ShortTermMemoryOptions, TrimResult } from './short-term-memory'
// 阶段 0.7 新增：工作记忆工具类
export { WorkingMemoryHelper } from './working-memory'
export type {
  WorkingMemoryOptions,
  WorkingMemoryPushResult,
  WorkingMemoryTrimResult,
  WorkingMemoryMergeResult,
  WorkingMemoryPushInput,
} from './working-memory'
