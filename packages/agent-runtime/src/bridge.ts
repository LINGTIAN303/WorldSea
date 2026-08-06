/** 阶段 2.0 批次3 重写：移除 CoreBackend 类，仅保留 bridge-types 类型重导出，详细见 docs/details/注释/packages/agent-runtime/bridge.md */

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
