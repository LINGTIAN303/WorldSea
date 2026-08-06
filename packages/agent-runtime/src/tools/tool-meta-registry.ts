/** 工具元数据注册中心：统一查询接口（全局注册表 + 别名解析），详细见 docs/details/注释/packages/agent-runtime/tools-tool-meta-registry.md */

import type { ToolMeta } from '@worldsmith/agent-core'
import { getGlobalToolRegistry } from '@worldsmith/agent-core'
import type { ToolDefinition } from '../bridge-types'
import { LEGACY_ALGO_MAP } from './algo-tools'
import { LEGACY_PLUGIN_MAP } from './plugin-backend-tools'

/** 工具列表注入点（默认从 agent.ts 注入，CLI 从 cli-agent.ts 注入） */
// 任务3 接线后：工具直接注册到全局 ToolRegistry，不再需要本地 _toolsSource 变量。
// 保留 initToolMetaRegistry 作为注入入口语义，内部委托 ToolRegistry。

/** 注入工具列表到全局 ToolRegistry（首次 getToolMeta 前调用），详细见 docs/details/注释/packages/agent-runtime/tools-tool-meta-registry.md */
export function initToolMetaRegistry(tools: ToolDefinition[]): void {
  _metaCache = null

  // 任务3 接线：注册到全局 ToolRegistry（声明式首选源）
  // ToolRegistry.register 用 Map.set，同名工具覆盖（幂等）；
  // initToolMetaRegistry 通常仅在启动时调用一次。
  const registry = getGlobalToolRegistry()
  for (const tool of tools) {
    if (tool.meta) {
      registry.register(tool as import('@worldsmith/agent-core').ToolDefinition)
    }
  }
}

/** 旧工具名→标准工具名的别名映射 */
const ALIAS_MAP: Record<string, string> = {
  fs_read: 'read_file',
  fs_write: 'write_file',
  fs_list: 'list_directory',
  fs_search: 'search_files',
  fs_stat: 'read_file',
  fs_mkdir: 'write_file',
  fs_copy: 'execute_command',
  fs_move: 'execute_command',
  fs_delete: 'execute_command',
  detect_shells: 'shell_session',
  shell_session_create: 'shell_session',
  shell_session_exec: 'shell_session',
  shell_session_input: 'shell_session',
  shell_session_destroy: 'shell_session',
  shell_session_list: 'shell_session',
  content_search: 'search_files',
  file_read: 'read_file',
  file_write: 'write_file',
  file_list: 'list_directory',
  file_delete: 'execute_command',
}

/**
 * 旧工具名独立元数据（已淘汰 · 任务3 后续）
 *
 * 所有静态工具已补声明式 meta 并注册到全局 ToolRegistry；旧工具名通过
 * ALIAS_MAP / meta.aliases / LEGACY_ALGO_MAP / LEGACY_PLUGIN_MAP 解析到标准工具。
 * 此对象保留为空作历史标记，buildMetaCache 不再从中收集。
 */
/** 工具名→元数据的缓存 */
let _metaCache: Map<string, ToolMeta> | null = null

/**
 * 获取工具元数据
 *
 * 查找优先级（任务3 后续：LEGACY_TOOL_META 已淘汰）：
 * 1. 全局 ToolRegistry（声明式首选源，含别名解析）
 * 2. ALIAS_MAP / LEGACY_ALGO_MAP / LEGACY_PLUGIN_MAP（旧工具名别名）
 * 3. 兜底：moderate 权限
 */
export function getToolMeta(toolName: string): ToolMeta {
  if (!_metaCache) {
    _metaCache = buildMetaCache()
  }
  return _metaCache.get(toolName) || { permission: 'moderate', category: 'coding' }
}

/** 重置缓存（测试用） */
export function resetToolMetaCache(): void {
  _metaCache = null
}

function buildMetaCache(): Map<string, ToolMeta> {
  const cache = new Map<string, ToolMeta>()

  // 1. 从全局 ToolRegistry 收集（任务3 接线：声明式首选源，含别名）
  //    ToolRegistry.register 时已自动注册 meta.aliases，此处一次性导出
  const registry = getGlobalToolRegistry()
  for (const tool of registry.getAll()) {
    if (tool.meta) {
      cache.set(tool.name, tool.meta)
      if (tool.meta.aliases) {
        for (const alias of tool.meta.aliases) {
          cache.set(alias, tool.meta)
        }
      }
    }
  }

  // 1.5. 无 meta 的工具不进 ToolRegistry（能力链工具由兜底 moderate/coding 处理）

  // 2. 从 ALIAS_MAP 补充别名映射
  for (const [alias, canonical] of Object.entries(ALIAS_MAP)) {
    if (!cache.has(alias)) {
      const meta = cache.get(canonical)
      if (meta) cache.set(alias, meta)
    }
  }

  // 2.5. 从 LEGACY_ALGO_MAP 补充 algo 旧名映射
  for (const [alias, canonical] of Object.entries(LEGACY_ALGO_MAP)) {
    if (!cache.has(alias)) {
      const meta = cache.get(canonical)
      if (meta) cache.set(alias, meta)
    }
  }

  // 2.6. 从 LEGACY_PLUGIN_MAP 补充插件旧名映射
  for (const [alias, canonical] of Object.entries(LEGACY_PLUGIN_MAP)) {
    if (!cache.has(alias)) {
      const meta = cache.get(canonical)
      if (meta) cache.set(alias, meta)
    }
  }

  // 3. LEGACY_TOOL_META 已淘汰（任务3 后续）：所有静态工具声明式 meta 进 ToolRegistry，
  //    旧工具名通过 ALIAS_MAP / LEGACY_ALGO_MAP / LEGACY_PLUGIN_MAP 解析，无需独立兜底表。

  return cache
}
