/**
 * 归档工具注册表
 *
 * 在 useMemoryArchive 和 useAgent 之间传递归档工具。
 *
 * 工作流程：
 * 1. useMemoryArchive 初始化时，ArchiveManager.init() 创建归档工具
 * 2. AgentBridgeImpl.registerTools() 通过 onToolsReady 回调将工具传递给 useMemoryArchive
 * 3. useMemoryArchive 将 ArchiveTool 转换为 ToolDefinition，调用 registerArchiveTools()
 * 4. useAgent.ensureInitialized() 通过 getArchiveTools() 获取工具，加入到 mainTools
 *
 * 如果 useAgent 已初始化（动态注册场景），通过 useAgent 的 registerDynamicTools() 方法注册。
 */

import type { ArchiveTool } from '@worldsmith/memory-archive/types'
import type { ToolDefinition, ToolParameter } from '@agent/bridge-types'
import type { ToolMeta } from '@worldsmith/agent-core'
import type { IToolContext } from '@agent/toolbus/types'

/** 已注册的归档工具（ToolDefinition 格式） */
let registeredTools: ToolDefinition[] = []

/**
 * 注册归档工具
 *
 * 将 ArchiveTool 转换为 ToolDefinition 格式并存储。
 * useAgent.ensureInitialized() 会通过 getArchiveTools() 获取这些工具。
 */
export function registerArchiveTools(tools: ArchiveTool[]): void {
  registeredTools = tools.map(convertToToolDefinition)
}

/**
 * 获取已注册的归档工具
 *
 * 供 useAgent.ensureInitialized() 在构建 mainTools 时调用。
 */
export function getArchiveTools(): ToolDefinition[] {
  return registeredTools
}

/** 清除已注册的归档工具（项目切换/销毁时调用） */
export function clearArchiveTools(): void {
  registeredTools = []
}

/**
 * 将 ArchiveTool 转换为 ToolDefinition
 *
 * ArchiveTool 是框架内部的工具定义格式，
 * ToolDefinition 是 worldsmith-agent 的工具定义格式。
 */
function convertToToolDefinition(archiveTool: ArchiveTool): ToolDefinition {
  const meta: ToolMeta = {
    permission: 'safe',
    category: 'memory',
    alwaysAvailable: true,
    displayName: getToolDisplayName(archiveTool.name),
  }

  return {
    name: archiveTool.name,
    description: archiveTool.description,
    parameters: convertParameters(archiveTool.parameters),
    meta,
    execute: async (args: Record<string, unknown>, _ctx: IToolContext): Promise<string> => {
      const result = await archiveTool.execute(args)
      return typeof result === 'string' ? result : JSON.stringify(result)
    },
  }
}

/**
 * 转换参数格式
 *
 * ArchiveTool.parameters: Record<string, unknown>（实际值为 ToolParameter 结构）
 * ToolDefinition.parameters: Record<string, ToolParameter>
 *
 * ArchiveManager.createArchiveTools() 创建的参数对象已经是 ToolParameter 兼容结构
 * （含 type/description/required/enum/default 等字段），这里做类型收窄。
 */
function convertParameters(params: Record<string, unknown>): Record<string, ToolParameter> {
  const result: Record<string, ToolParameter> = {}
  for (const [key, value] of Object.entries(params)) {
    if (isToolParameter(value)) {
      result[key] = value
    } else {
      // 非标准结构，降级为 string 类型
      result[key] = { type: 'string', description: String(value) }
    }
  }
  return result
}

/** 类型守卫：判断值是否为 ToolParameter 结构 */
function isToolParameter(value: unknown): value is ToolParameter {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.type === 'string' &&
    ['string', 'number', 'boolean', 'array', 'object'].includes(v.type)
  )
}

/** 获取工具的中文显示名 */
function getToolDisplayName(name: string): string {
  const displayNames: Record<string, string> = {
    archive_recall: '检索归档记忆',
    archive_load_chunk: '加载归档片段',
    archive_tag: '标记归档记忆',
    archive_now: '立即归档对话',
  }
  return displayNames[name] || name
}
