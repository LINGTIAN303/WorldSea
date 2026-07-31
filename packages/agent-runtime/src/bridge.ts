/**
 * # bridge.ts — 阶段 2.0 批次3 重写
 *
 * ## 历史
 * - 阶段 1.x：本文件实现 `CoreBackend` 类，桥接 pi-ai 的 `streamSimple` 实现 Agent 循环
 * - 阶段 2.0 批次3（本次）：移除 `CoreBackend` 类和 pi-ai 依赖，
 *   Agent 循环已由 Rust 端 `agent_runtime::AgentLoop` 接管
 *
 * ## 保留内容
 * 仅保留从 `bridge-types.ts` 的类型重新导出，避免外部引用断裂：
 * - `IAgentBackend` 接口（被 useAgentRust.ts 等实现）
 * - `AgentEvent` / `AgentEventListener` 等事件类型
 * - `PromptOptions` / `AgentConfig` 等配置类型
 *
 * ## 功能退化说明
 * `CoreBackend` 类已删除。以下功能受影响：
 * - 群聊（useGroupChat.ts 直接 `new CoreBackend(...)`）→ 运行时抛错
 * - Smart Fill（useSmartFillChat.ts 通过 createWorldSmithAgent 间接依赖）→ 运行时抛错
 * - Agent 私聊（AgentPrivateChat.vue 通过 createWorldSmithAgent）→ 运行时抛错
 *
 * 这是"接受功能退化，直接删除"决策的预期行为。
 * 后续可在 Rust 端实现多 Agent 实例管理，恢复群聊等能力。
 */

export type {
  PromptOptions,
  AgentEvent,
  AgentEventListener,
  AgentConfig,
  ToolDefinition,
  ToolParameter,
  IAgentBackend,
  UsageData,
  ThinkingLevel,
  A2UIMessage,
  A2UIComponent,
} from './bridge-types'
