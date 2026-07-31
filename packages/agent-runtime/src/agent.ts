import type { IAgentBackend } from './bridge-types'
import type { CreateAgentOptions } from './bridge-types'

import { findSkillById } from './skills/registry'
import { SKILL_META_TOOLS } from './skills/meta-tools'
import { initToolMetaRegistry } from './tools/tool-meta-registry'
import { getGlobalSkillRegistry, getGlobalToolRegistry } from '@worldsmith/agent-core'
import { entityCrudTools } from './tools/entity-crud'
import { relationManageTools } from './tools/relation-manage'
import { contentSearchTools } from './tools/content-search'
import { dailyTaskTools } from './tools/daily-task'
// webSearchTools / webFetchTools 已包含在 codingAgentTools 中，不再单独导入到 ALL_TOOLS
import { webSearchTools } from './tools/web-search'
import { webFetchTools } from './tools/web-fetch'
import { a2uiTools } from './tools/a2ui-tools'
import { a2uiHelperTools } from './tools/a2ui-helpers'
import { memoryTools } from './tools/memory'
import { projectTools } from './tools/project-io'
import { retrofitTools } from './tools/retrofit-tools'
import { schemaTools } from './tools/schema-tools'
import { algoTools } from './tools/algo-tools'
import { fileTools } from './tools/file-tools'
import { pluginTools } from './tools/plugin-tools'
import { moduleBuilderTools } from './tools/module-builder-tools'
// terminalTools 已被 codingAgentTools 的 shell_session 完全取代（action 参数统一）
// 旧工具名通过 LEGACY_TO_CODING_MAP 别名映射到 shell_session
import { webCliTools } from './tools/web-cli-tools'
// fsTools 已被 codingAgentTools 取代，不再暴露给 Agent
// 旧工具名通过 LEGACY_TO_CODING_MAP 别名映射到 codingAgentTools
import { pkgTools } from './tools/pkg-tools'
import { gitTools } from './tools/git-tools'
import { sysTools } from './tools/sys-tools'
import { terminalLauncherTools } from './tools/terminal-launcher-tools'
import { orchestratorTools } from './tools/orchestrator-tools'
import { pipelineTools } from './tools/pipeline-tools'
import { outputTools } from './tools/output-tools'
import { manuscriptClone } from './tools/manuscript-tools'
import { visionTools } from './tools/vision-tools'
import { imageGenTools } from './tools/image-gen-tools'
import { videoGenTools } from './tools/video-gen-tools'
import { planTools } from './tools/plan-tools'
import { taskTools } from './tools/task-tools'
import { kbTools } from './tools/kb-tools'
import { personaTools } from './tools/persona'
import { sessionTools } from './tools/session-tools'
import { crawlTools } from './tools/crawl-tool'
import { docConvertTools } from './tools/doc-convert-tool'
import { entityContextTools } from './tools/entity-context'
import { nativeTools } from './tools/native-tools'
import { codingAgentTools, LEGACY_TO_CODING_MAP } from './tools/coding-agent-tools'
import { LEGACY_ALGO_MAP } from './tools/algo-tools'
import { PLUGIN_BACKEND_TOOLS, LEGACY_PLUGIN_MAP } from './tools/plugin-backend-tools'
import { InternalChainRegistry } from './toolbus/internal-registry'
import { entityCoreDescriptor } from '@worldsmith/entity-core'
import { canvasEngineDescriptor } from '@worldsmith/canvas-engine'

/**
 * 全部工具的 Map（name → tool 定义），供：
 * - `getToolsForSkills` 内部使用
 * - `useAgentRust` 监听 `agent:tool_call` 事件后查找 TS 工具实现（P0-A3b）
 *
 * 阶段 2.5 导出：Rust 后端通过 FrontendToolBridge emit `agent:tool_call:{sessionId}`
 * 事件到前端，前端在监听器中通过 `ALL_TOOLS_MAP.get(toolName)` 拿到 TS 工具实现并执行，
 * 然后通过 `invoke('cmd_agent_tool_result', ...)` 回传结果给 Rust。
 */
export const ALL_TOOLS_MAP = new Map<string, typeof entityCrudTools[0]>()

function registerAllTools(): void {
  // 与 ALL_TOOLS 保持一致：排除重复工具
  const all = [
    ...entityCrudTools,
    ...entityContextTools,
    ...relationManageTools,
    ...contentSearchTools,
    ...dailyTaskTools,
    // webSearchTools / webFetchTools 已包含在 codingAgentTools 中，不再单独注册
    ...a2uiTools,
    ...a2uiHelperTools,
    ...memoryTools,
    ...projectTools,
    ...retrofitTools,
    ...schemaTools,
    ...algoTools,
    ...fileTools,
    ...pluginTools,
    ...moduleBuilderTools,
    // terminalTools 已被 codingAgentTools 的 shell_session 完全取代
    ...webCliTools,
    // fsTools 已被 codingAgentTools 取代，不再注册
    ...pkgTools,
    ...gitTools,
    ...sysTools,
    ...terminalLauncherTools,
    ...orchestratorTools,
    ...pipelineTools,
    ...PLUGIN_BACKEND_TOOLS,
    ...outputTools,
    manuscriptClone,
    ...visionTools,
    ...imageGenTools,
    ...videoGenTools,
    ...planTools,
    ...taskTools,
    ...kbTools,
    ...personaTools,
    ...sessionTools,
    ...crawlTools,
    ...docConvertTools,
    ...nativeTools,
    ...codingAgentTools,
  ]
  for (const t of all) {
    ALL_TOOLS_MAP.set(t.name, t)
    // 注册工具别名（meta.aliases）
    if (t.meta?.aliases) {
      for (const alias of t.meta.aliases) {
        if (!ALL_TOOLS_MAP.has(alias)) {
          ALL_TOOLS_MAP.set(alias, t)
        }
      }
    }
  }
  // 注册旧工具名→标准工具名的别名映射（供技能系统 resolveToolNames 查找）
  for (const [legacy, canonical] of Object.entries(LEGACY_TO_CODING_MAP)) {
    if (!ALL_TOOLS_MAP.has(legacy)) {
      const tool = ALL_TOOLS_MAP.get(canonical)
      if (tool) ALL_TOOLS_MAP.set(legacy, tool)
    }
  }
  // 注册 algo 旧工具名→algo_run 的别名映射
  for (const [legacy, canonical] of Object.entries(LEGACY_ALGO_MAP)) {
    if (!ALL_TOOLS_MAP.has(legacy)) {
      const tool = ALL_TOOLS_MAP.get(canonical)
      if (tool) ALL_TOOLS_MAP.set(legacy, tool)
    }
  }
  // 注册插件后端旧工具名→域级工具的别名映射
  for (const [legacy, canonical] of Object.entries(LEGACY_PLUGIN_MAP)) {
    if (!ALL_TOOLS_MAP.has(legacy)) {
      const tool = ALL_TOOLS_MAP.get(canonical)
      if (tool) ALL_TOOLS_MAP.set(legacy, tool)
    }
  }
}

registerAllTools()

export const internalRegistry = new InternalChainRegistry()
internalRegistry.register(entityCoreDescriptor)
// pluginSdkDescriptor 延迟注册，避免 @worldsmith/plugin-sdk → @agent 循环依赖导致 TDZ
import('@worldsmith/plugin-sdk').then(mod => {
  internalRegistry.register(mod.pluginSdkDescriptor)
}).catch(() => {})
internalRegistry.register(canvasEngineDescriptor)
// uiKitDescriptor 延迟注册，避免 @worldsmith/ui-kit → @agent 循环依赖
import('@worldsmith/ui-kit').then(mod => {
  internalRegistry.register(mod.uiKitDescriptor)
}).catch(() => {})

export function getToolsForSkills(activeSkillIds: string[]): typeof entityCrudTools[0][] {
  // 任务3 收尾：切换到声明式 SkillRegistry.resolveToolNames（基础集 = ToolRegistry.getAlwaysAvailable，等价于旧 ALWAYS_AVAILABLE_TOOLS）
  const toolNames = getGlobalSkillRegistry().resolveToolNames(activeSkillIds, getGlobalToolRegistry())
  const tools: typeof entityCrudTools[0][] = []
  const seen = new Set<string>()

  for (const name of toolNames) {
    const t = ALL_TOOLS_MAP.get(name)
    if (t && !seen.has(name)) {
      tools.push(t)
      seen.add(name)
    }
  }

  const registryTools = internalRegistry.resolve(
    activeSkillIds.flatMap(id => {
      const skill = findSkillById(id)
      return skill?.capabilities
        ? [...skill.capabilities.internal, ...skill.capabilities.cli, ...skill.capabilities.mcp]
        : []
    }),
    'web',
  )
  for (const t of registryTools) {
    if (!seen.has(t.name)) {
      tools.push(t)
      seen.add(t.name)
    }
  }

  tools.push(...SKILL_META_TOOLS)

  return tools
}

export const ALL_TOOLS = [
  ...entityCrudTools,
  ...entityContextTools,
  ...relationManageTools,
  ...contentSearchTools,
  ...dailyTaskTools,
  // webSearchTools / webFetchTools 已包含在 codingAgentTools 中，不再单独展开
  ...a2uiTools,
  ...a2uiHelperTools,
  ...memoryTools,
  ...projectTools,
  ...retrofitTools,
  ...schemaTools,
  ...algoTools,
  ...fileTools,
  ...pluginTools,
  ...moduleBuilderTools,
  // terminalTools 已被 codingAgentTools 的 shell_session 完全取代
  ...webCliTools,
  // fsTools 已被 codingAgentTools 取代（read_file/write_file/list_directory/search_files/execute_command）
  ...pkgTools,
  ...gitTools,
  ...sysTools,
  ...terminalLauncherTools,
  ...orchestratorTools,
  ...pipelineTools,
  ...PLUGIN_BACKEND_TOOLS,
  ...outputTools,
  manuscriptClone,
  ...visionTools,
  ...imageGenTools,
  ...videoGenTools,
  ...planTools,
  ...taskTools,
  ...kbTools,
  ...personaTools,
  ...sessionTools,
  ...SKILL_META_TOOLS,
  ...crawlTools,
  ...docConvertTools,
  ...nativeTools,
  ...codingAgentTools,
]

// 初始化工具元数据注册中心
initToolMetaRegistry(ALL_TOOLS)

/** 工具分类定义（供 UI 按分组展示工具勾选面板） */
export interface ToolCategory {
  id: string
  label: string
  tools: typeof entityCrudTools[0][]
}

export const TOOL_CATEGORIES: ToolCategory[] = [
  { id: 'entity', label: '实体管理', tools: [...entityCrudTools, ...entityContextTools] },
  { id: 'relation', label: '关系管理', tools: [...relationManageTools] },
  { id: 'search', label: '搜索与检索', tools: [...contentSearchTools, ...webSearchTools, ...webFetchTools, ...crawlTools] },
  { id: 'output', label: '输出渲染', tools: [...outputTools] },
  { id: 'a2ui', label: 'A2UI 界面', tools: [...a2uiTools, ...a2uiHelperTools] },
  { id: 'memory', label: '记忆系统', tools: [...memoryTools] },
  { id: 'project', label: '项目管理', tools: [...projectTools] },
  { id: 'schema', label: 'Schema 管理', tools: [...schemaTools] },
  { id: 'retrofit', label: '改造工具', tools: [...retrofitTools] },
  { id: 'algo', label: '算法工具', tools: [...algoTools] },
  { id: 'file', label: '文件操作', tools: [...fileTools, ...docConvertTools] },
  { id: 'dev', label: '开发工具', tools: [...terminalLauncherTools, ...webCliTools, ...pkgTools, ...gitTools, ...sysTools] },
  { id: 'native', label: '原生能力', tools: [...nativeTools] },
  { id: 'plugin', label: '插件系统', tools: [...pluginTools, ...moduleBuilderTools, ...PLUGIN_BACKEND_TOOLS] },
  { id: 'orchestrator', label: '编排与流水线', tools: [...orchestratorTools, ...pipelineTools] },
  { id: 'vision', label: '视觉与生成', tools: [...visionTools, ...imageGenTools, ...videoGenTools] },
  { id: 'plan', label: '规划与知识', tools: [...planTools, ...kbTools, ...taskTools] },
  { id: 'persona', label: '人格与任务', tools: [...personaTools, ...dailyTaskTools] },
  { id: 'session', label: '会话管理', tools: [...sessionTools, manuscriptClone] },
  { id: 'coding-agent', label: '编码 Agent', tools: [...codingAgentTools] },
]

export async function createWorldSmithAgent(_options: CreateAgentOptions): Promise<IAgentBackend> {
  // 阶段 2.0 批次3：CoreBackend/HybridBackend 已移除（依赖 pi-ai）
  // Agent 循环已由 Rust 端 agent_runtime::AgentLoop 接管
  // 此函数保留导出签名以避免编译错误，但运行时抛错
  throw new Error(
    '[worldsmith-agent] createWorldSmithAgent 已废弃（批次3 移除 pi-ai 依赖）。\n' +
    'Agent 循环已迁移至 Rust 后端，请使用 useAgentRustAdapter。\n' +
    '受影响功能：Smart Fill、群聊、Agent 私聊等基于 TS CoreBackend 的能力。'
  )
}

export { DefaultToolBus } from './toolbus/toolbus'
export type { ToolBus } from './toolbus/toolbus'
export { MCPManager } from './mcp/mcp-manager'
export { MCPToolAdapter } from './mcp/mcp-adapter'
export type { MCPConnectionConfig, MCPTransportType, MCPToolInfo, MCPConnectionState } from './mcp/types'
