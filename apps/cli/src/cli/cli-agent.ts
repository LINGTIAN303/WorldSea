/**
 * CLI 专用 Agent 工厂
 * 跳过 Web 端依赖（entity-core/plugin-sdk/canvas-engine 的 Vue 组件），
 * 只注册 CLI 可用的工具集
 *
 * 阶段 2.0 批次3：CoreBackend 已移除（依赖 pi-ai），CLI Agent 创建不可用。
 * Agent 循环已由 Rust 端 agent_runtime::AgentLoop 接管。
 * CLI 入口待后续迁移到 Rust 二进制。
 */
import type { IAgentBackend, CreateAgentOptions, ToolDefinition } from '@worldsmith/agent-runtime'
import {
  buildSystemPrompt,
  codingAgentTools,
  LEGACY_TO_CODING_MAP,
  entityCrudTools,
  relationManageTools,
  contentSearchTools,
  memoryTools,
  fileTools,
  gitTools,
  sysTools,
  kbTools,
  personaTools,
  sessionTools,
  nativeTools,
  planTools,
  schemaTools,
  algoTools,
  projectTools,
  visionTools,
  crawlTools,
  docConvertTools,
  outputTools,
  pluginTools,
  pkgTools,
  webSearchTools,
  webFetchTools,
  orchestratorTools,
  InternalChainRegistry,
  initToolMetaRegistry,
  bootAgentGovernor,
  cliAgentModules,
} from '@worldsmith/agent-runtime'

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
 *
 * 阶段 2.0 批次3：CoreBackend 已移除，此函数运行时抛错。
 */
export async function createCliAgent(_options: CreateCliAgentOptions): Promise<IAgentBackend> {
  // 阶段 2.0 批次3：CoreBackend 已移除（依赖 pi-ai），CLI Agent 创建不可用
  // Agent 循环已迁移至 Rust 后端，CLI 入口待后续迁移到 Rust 二进制
  void bootAgentGovernor  // 保留引用避免未使用警告
  void buildSystemPrompt
  void cliAgentModules
  throw new Error(
    '[cli-agent] createCliAgent 已废弃（批次3 移除 pi-ai 依赖）。\n' +
    'Agent 循环已迁移至 Rust 后端，CLI 入口待后续迁移到 Rust 二进制。'
  )
}

export { CLI_TOOLS, CLI_TOOLS_MAP, cliRegistry }
