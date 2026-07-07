/**
 * Agent 工厂
 *
 * 基于 pi-agent-core 创建 Agent 实例的工厂函数。
 * 整合 ToolBus + PermissionGuard + ExecutionAdapter，
 * 提供统一的 Agent 创建入口。
 */

import type {
  IAgentBackend,
  ToolDefinition,
  IToolContext,
  ProviderConfig,
} from '../types'
import type { ToolBus } from '../bus'
import type { PermissionGuard } from '../guard'

export interface AgentConfig {
  providerConfig: ProviderConfig
  systemPrompt: string
  tools: ToolDefinition[]
  toolContext: IToolContext
  beforeToolCall?: (info: {
    toolCall: { id?: string; name: string; args: Record<string, unknown> }
  }) => Promise<{ block: boolean; reason?: string } | void>
}

export interface CreateAgentOptions {
  providerConfig: ProviderConfig
  toolContext: IToolContext
  toolBus: ToolBus
  guard: PermissionGuard
  activeSkillIds?: string[]
  systemPrompt?: string
  projectName?: string
  platform?: import('../types').Platform
}

/**
 * 创建 Agent 实例
 *
 * 此函数返回一个符合 IAgentBackend 接口的 Agent 实例。
 * 实际的 pi-agent-core 集成由消费方（worldsmith-agent）的 CoreBackend 实现，
 * 此处仅定义契约和辅助逻辑。
 */
export async function createAgent(_options: CreateAgentOptions): Promise<IAgentBackend> {
  // Agent 实例的实际创建由消费方完成（需要 pi-agent-core 依赖）
  // 此处抛出错误提示消费方使用自己的工厂函数
  throw new Error(
    'createAgent() is a contract function. Use createWorldSmithAgent() from worldsmith-agent instead, ' +
    'which implements the actual pi-agent-core integration.'
  )
}

/**
 * 从 ToolBus + 技能列表解析工具集
 *
 * 供 CoreBackend 使用的辅助函数。
 */
export function resolveToolsForAgent(
  toolBus: ToolBus,
  activeSkillIds: string[],
  platform?: import('../types').Platform,
): ToolDefinition[] {
  return toolBus.resolve(activeSkillIds, platform)
}
