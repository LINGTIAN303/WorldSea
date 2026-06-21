/**
 * CLI 专用 Agent 工厂
 * 跳过 Web 端依赖（entity-core/plugin-sdk/canvas-engine 的 Vue 组件），
 * 只注册 CLI 可用的工具集
 */
import { CoreBackend } from '../bridge'
import type { IAgentBackend } from '../bridge'
import type { AgentConfig, CreateAgentOptions } from '../bridge-types'
import type { ToolDefinition } from '../bridge-types'
import { buildSystemPrompt } from '../context/injector'
import { codingAgentTools, LEGACY_TO_CODING_MAP } from '../tools/coding-agent-tools'
import { entityCrudTools } from '../tools/entity-crud'
import { relationManageTools } from '../tools/relation-manage'
import { contentSearchTools } from '../tools/content-search'
import { memoryTools } from '../tools/memory'
import { fileTools } from '../tools/file-tools'
import { gitTools } from '../tools/git-tools'
import { sysTools } from '../tools/sys-tools'
import { kbTools } from '../tools/kb-tools'
import { personaTools } from '../tools/persona'
import { sessionTools } from '../tools/session-tools'
import { nativeTools } from '../tools/native-tools'
import { planTools } from '../tools/plan-tools'
import { schemaTools } from '../tools/schema-tools'
import { algoTools } from '../tools/algo-tools'
import { projectTools } from '../tools/project-io'
import { visionTools } from '../tools/vision-tools'
import { crawlTools } from '../tools/crawl-tool'
import { docConvertTools } from '../tools/doc-convert-tool'
import { outputTools } from '../tools/output-tools'
import { pluginTools } from '../tools/plugin-tools'
import { pkgTools } from '../tools/pkg-tools'
import { webSearchTools } from '../tools/web-search'
import { webFetchTools } from '../tools/web-fetch'
import { orchestratorTools } from '../tools/orchestrator-tools'
import { InternalChainRegistry } from '../toolbus/internal-registry'
import { initToolMetaRegistry } from '../tools/tool-meta-registry'
import { bootAgentGovernor } from '../governor'
import { cliAgentModules } from '../governor-modules'

// CLI 可用工具集（排除依赖 Vue 的 a2ui/webCli/terminalLauncher 等）
const CLI_TOOLS: ToolDefinition[] = [
  ...codingAgentTools,
  ...entityCrudTools,
  ...relationManageTools,
  ...contentSearchTools,
  ...memoryTools,
  ...fileTools,
  ...gitTools,
  ...sysTools,
  ...kbTools,
  ...personaTools,
  ...sessionTools,
  ...nativeTools,
  ...planTools,
  ...schemaTools,
  ...algoTools,
  ...projectTools,
  ...visionTools,
  ...crawlTools,
  ...docConvertTools,
  ...outputTools,
  ...pluginTools,
  ...pkgTools,
  ...webSearchTools,
  ...webFetchTools,
  ...orchestratorTools,
]

const CLI_TOOLS_MAP = new Map<string, ToolDefinition>()

function registerCliTools(): void {
  for (const t of CLI_TOOLS) {
    CLI_TOOLS_MAP.set(t.name, t)
    if (t.meta?.aliases) {
      for (const alias of t.meta.aliases) {
        if (!CLI_TOOLS_MAP.has(alias)) CLI_TOOLS_MAP.set(alias, t)
      }
    }
  }
  for (const [legacy, canonical] of Object.entries(LEGACY_TO_CODING_MAP)) {
    if (!CLI_TOOLS_MAP.has(legacy)) {
      const tool = CLI_TOOLS_MAP.get(canonical)
      if (tool) CLI_TOOLS_MAP.set(legacy, tool)
    }
  }
}

registerCliTools()

// 初始化工具元数据注册中心（CLI 端使用 CLI_TOOLS）
initToolMetaRegistry(CLI_TOOLS)

// CLI 不需要 Web 端的描述符注册
const cliRegistry = new InternalChainRegistry()

export type CreateCliAgentOptions = CreateAgentOptions

/**
 * 创建 CLI 专用 Agent
 * 与 createWorldSmithAgent 共享接口，但跳过 Vue 依赖
 */
export async function createCliAgent(options: CreateCliAgentOptions): Promise<IAgentBackend> {
  // ── Governor 编排：确保 CLI 端模块已激活 ──
  // CLI 端使用 cliAgentModules（排除 ui-render 相关模块）
  // 幂等：多次调用 createCliAgent 不会重复 boot
  await bootAgentGovernor({ modules: cliAgentModules })

  const systemPrompt = options.systemPromptOverride ?? buildSystemPrompt({
    projectName: options.projectName || 'WorldSmith-CLI',
    entityTypes: options.toolContext.projectInfo.entityTypes,
    relationTypes: options.toolContext.projectInfo.relationTypes,
    platform: 'cli',
    personaPreset: options.personaPreset,
  })

  const config: AgentConfig = {
    providerConfig: options.providerConfig,
    systemPrompt,
    tools: CLI_TOOLS,
    toolContext: options.toolContext,
    beforeToolCall: options.beforeToolCall,
  }

  const backend = new CoreBackend(config)
  await backend.initialize()
  return backend
}

export { CLI_TOOLS, CLI_TOOLS_MAP, cliRegistry }
