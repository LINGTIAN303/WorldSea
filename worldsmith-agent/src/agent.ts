import { CoreBackend } from './bridge'
import { HybridBackend } from './hybrid-backend'
import type { IAgentBackend } from './bridge'
import type { AgentConfig, CreateAgentOptions } from './bridge-types'
import type { CliAgentConnection } from './hybrid-backend'

import { buildSystemPrompt } from './context/injector'
import { findSkillById, resolveToolNames, initSkillRegistry } from './skills/registry'
import { SKILL_META_TOOLS } from './skills/meta-tools'
import { initToolMetaRegistry } from './tools/tool-meta-registry'
import { bootAgentGovernor } from './governor'
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
import { pluginSdkDescriptor } from '@worldsmith/plugin-sdk'
import { canvasEngineDescriptor } from '@worldsmith/canvas-engine'

const ALL_TOOLS_MAP = new Map<string, typeof entityCrudTools[0]>()

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
internalRegistry.register(pluginSdkDescriptor)
internalRegistry.register(canvasEngineDescriptor)
// uiKitDescriptor 延迟注册，避免 @worldsmith/ui-kit → @agent 循环依赖
import('@worldsmith/ui-kit').then(mod => {
  internalRegistry.register(mod.uiKitDescriptor)
}).catch(() => {})

export function getToolsForSkills(activeSkillIds: string[]): typeof entityCrudTools[0][] {
  const toolNames = resolveToolNames(activeSkillIds)
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
  { id: 'plan', label: '规划与知识', tools: [...planTools, ...kbTools] },
  { id: 'persona', label: '人格与任务', tools: [...personaTools, ...dailyTaskTools] },
  { id: 'session', label: '会话管理', tools: [...sessionTools, manuscriptClone] },
  { id: 'coding-agent', label: '编码 Agent', tools: [...codingAgentTools] },
]

export async function createWorldSmithAgent(options: CreateAgentOptions): Promise<IAgentBackend> {
  // ── Governor 编排：确保 toolbus/skills/tools 等模块已激活 ──
  // Web 端使用默认策略：detectAgentOrWebEnvironment() + agentModules（含 UI 模块）
  // 幂等：多次调用 createWorldSmithAgent 不会重复 boot
  await bootAgentGovernor()

  // ── 技能注册表初始化：扫描已安装技能（Skills Store），合并到全局 SkillRegistry ──
  // 非 Tauri 环境下安全降级（返回空），不影响内置技能
  await initSkillRegistry()

  const systemPrompt = options.systemPromptOverride ?? buildSystemPrompt({
    projectName: options.projectName || 'WorldSmith',
    entityTypes: options.toolContext.projectInfo.entityTypes,
    relationTypes: options.toolContext.projectInfo.relationTypes,
    platform: options.toolContext.platform,
    personaPreset: options.personaPreset,
    availableFontFamilies: options.availableFontFamilies,
  })

  const config: AgentConfig = {
    providerConfig: options.providerConfig,
    systemPrompt,
    tools: options.tools || ALL_TOOLS,
    toolContext: options.toolContext,
    beforeToolCall: options.beforeToolCall,
  }

  // 如果有 CLI Agent 连接，使用 HybridBackend（工具级路由）
  const cliConnection = _activeCliAgentConnection
  const backend = cliConnection?.connected
    ? new HybridBackend({ ...config, cliAgentConnection: cliConnection })
    : new CoreBackend(config)

  await backend.initialize()
  return backend
}

/** 当前活跃的 CLI Agent 连接（Web 端通过 setActiveCliAgentConnection 设置） */
let _activeCliAgentConnection: CliAgentConnection | null = null

/** 设置当前活跃的 CLI Agent 连接 */
export function setActiveCliAgentConnection(connection: CliAgentConnection | null): void {
  _activeCliAgentConnection = connection
}

/** 获取当前活跃的 CLI Agent 连接 */
export function getActiveCliAgentConnection(): CliAgentConnection | null {
  return _activeCliAgentConnection
}

export { DefaultToolBus } from './toolbus/toolbus'
export type { ToolBus } from './toolbus/toolbus'
export { MCPManager } from './mcp/mcp-manager'
export { MCPToolAdapter } from './mcp/mcp-adapter'
export type { MCPConnectionConfig, MCPTransportType, MCPToolInfo, MCPConnectionState } from './mcp/types'
