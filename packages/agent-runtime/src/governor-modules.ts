/**
 * worldsmith-agent/src/governor-modules.ts — Agent 包模块描述符
 *
 * 将 Agent 包的 toolbus/skills/tools 系统声明为 governor 模块，
 * 由 createAgentGovernor() 在 boot() 时按 priority + 依赖拓扑自动激活。
 *
 * 模块分层：
 * 1. critical（基础设施）：ToolBus、内部能力链、工具元数据
 *    - 失败则中止 boot()，抛出错误
 * 2. normal（核心功能）：Skills 注册表 + 各类工具集
 *    - 失败记录但继续
 * 3. lazy（延迟加载）：MCP、群聊系统
 *    - 空闲时加载，失败静默
 *
 * 与 src/governor/bootstrap.ts 的区别：
 * - 不依赖 Vue/Pinia（Agent 包可在 terminal 环境运行）
 * - 工具注册保持静态 import（governor 只编排初始化顺序与环境验证）
 * - Web 端和 CLI 端共用同一套模块描述符，通过 requires/hosts 过滤
 */
import type { ModuleDescriptor } from '@worldsmith/governor-core/types'

/* ════════════════════════════════════════
   critical 模块：基础设施
   ════════════════════════════════════════ */

/**
 * ToolBus 注册中心初始化。
 *
 * 创建 DefaultToolBus 实例并注册到全局，
 * 供后续 skills/tools 模块使用。
 *
 * 必须在所有工具模块之前完成。
 */
const toolbusModule: ModuleDescriptor = {
  id: 'agent.toolbus',
  name: 'ToolBus 注册中心',
  version: '1.0.0',
  priority: 'critical',
  defaultActive: true,
  description: '初始化 DefaultToolBus 实例，供工具注册与解析',

  activate: async () => {
    // ToolBus 实例由 agent.ts / cli-agent.ts 按需创建
    // 此模块仅作为依赖前置声明，确保 toolbus 模块加载
    const { DefaultToolBus } = await import('./toolbus/toolbus')
    // 验证 ToolBus 可用
    if (typeof DefaultToolBus !== 'function') {
      throw new Error('DefaultToolBus 未正确导出')
    }
  },
}

/**
 * 内部能力链注册。
 *
 * 注册 entity-core/plugin-sdk/canvas-engine 的能力描述符到 InternalChainRegistry。
 * ui-kit 延迟注册以避免循环依赖。
 *
 * 注册实际在 agent.ts（Web 端）模块加载时完成，此处仅验证。
 * CLI 端使用空的 cliRegistry，跳过验证。
 *
 * 依赖 toolbus 模块完成。
 */
const internalRegistryModule: ModuleDescriptor = {
  id: 'agent.internal-registry',
  name: '内部能力链',
  version: '1.0.0',
  priority: 'critical',
  defaultActive: true,
  description: '注册 entity-core/plugin-sdk/canvas-engine 能力描述符',
  dependencies: [{ moduleId: 'agent.toolbus', optional: false }],

  activate: async () => {
    // 注册已在 agent.ts（Web 端）模块加载时完成
    // CLI 端使用空的 cliRegistry，无需验证
    if (typeof window !== 'undefined') {
      const { internalRegistry } = await import('./agent')
      if (internalRegistry.getRegisteredLibraryIds().length === 0) {
        throw new Error('internalRegistry 未正确注册能力描述符')
      }
    }
  },
}

/**
 * 工具元数据注册中心。
 *
 * 初始化 tool-meta-registry，为所有工具（含旧工具名）提供元数据查询。
 *
 * 注册实际在 agent.ts（Web 端）或 cli-agent.ts（CLI 端）模块加载时完成，
 * 此处仅验证工具元数据可查询。
 *
 * 依赖 internal-registry 完成（工具列表需要先组装）。
 */
const toolMetaModule: ModuleDescriptor = {
  id: 'agent.tool-meta',
  name: '工具元数据',
  version: '1.0.0',
  priority: 'critical',
  defaultActive: true,
  description: '初始化工具元数据注册中心',
  dependencies: [{ moduleId: 'agent.internal-registry', optional: false }],

  activate: async () => {
    // 注册已在 agent.ts（Web 端）或 cli-agent.ts（CLI 端）模块加载时完成
    // 此处仅验证工具元数据可查询
    const { getToolMeta } = await import('./tools/tool-meta-registry')
    const meta = getToolMeta('entity_crud')
    if (!meta) {
      throw new Error('工具元数据注册中心未正确初始化')
    }
  },
}

/* ════════════════════════════════════════
   normal 模块：核心功能
   ════════════════════════════════════════ */

/**
 * Skills 注册表加载。
 *
 * SKILL_REGISTRY 在模块加载时已静态初始化，
 * 此模块负责验证注册表一致性并构建索引。
 */
const skillsModule: ModuleDescriptor = {
  id: 'agent.skills',
  name: 'Skills 注册表',
  version: '1.0.0',
  priority: 'normal',
  requires: ['llm-provider'],
  defaultActive: true,
  description: '加载 Skills 注册表并验证一致性',
  dependencies: [{ moduleId: 'agent.tool-meta', optional: false }],

  activate: async () => {
    const { validateRegistryConsistency, SKILL_REGISTRY } = await import('./skills/registry')
    const warnings = validateRegistryConsistency()
    if (warnings.length > 0) {
      console.warn('[AgentGovernor] Skills 注册表一致性警告:', warnings)
    }
    // 验证 SKILL_REGISTRY 已加载
    if (!Array.isArray(SKILL_REGISTRY) || SKILL_REGISTRY.length === 0) {
      throw new Error('SKILL_REGISTRY 未正确加载')
    }
  },
}

/**
 * 实体 CRUD 工具。
 *
 * 包含 entity_crud/entity_context 工具集。
 * 需要 db 能力（实体存储）。
 */
const entityToolsModule: ModuleDescriptor = {
  id: 'agent.tools.entity',
  name: '实体工具',
  version: '1.0.0',
  priority: 'normal',
  requires: ['db'],
  defaultActive: true,
  description: '实体 CRUD 与上下文工具',
  dependencies: [{ moduleId: 'agent.tool-meta', optional: false }],

  activate: async () => {
    // 工具通过静态 import 注册到 ALL_TOOLS_MAP
    // 此处验证模块可加载
    await import('./tools/entity-crud')
    await import('./tools/entity-context')
  },
}

/**
 * 关系管理工具。
 */
const relationToolsModule: ModuleDescriptor = {
  id: 'agent.tools.relation',
  name: '关系工具',
  version: '1.0.0',
  priority: 'normal',
  requires: ['db'],
  defaultActive: true,
  description: '关系管理工具',
  dependencies: [{ moduleId: 'agent.tool-meta', optional: false }],

  activate: async () => {
    await import('./tools/relation-manage')
  },
}

/**
 * 搜索工具。
 *
 * 包含 content_search/web_search/web_fetch/crawl 工具。
 * 需要 network 能力（联网搜索）。
 */
const searchToolsModule: ModuleDescriptor = {
  id: 'agent.tools.search',
  name: '搜索工具',
  version: '1.0.0',
  priority: 'normal',
  requires: ['network'],
  defaultActive: true,
  description: '内容搜索与联网搜索工具',
  dependencies: [{ moduleId: 'agent.tool-meta', optional: false }],

  activate: async () => {
    await import('./tools/content-search')
    await import('./tools/web-search')
    await import('./tools/web-fetch')
    await import('./tools/crawl-tool')
  },
}

/**
 * 记忆系统工具。
 */
const memoryToolsModule: ModuleDescriptor = {
  id: 'agent.tools.memory',
  name: '记忆工具',
  version: '1.0.0',
  priority: 'normal',
  requires: ['db'],
  defaultActive: true,
  description: '长期记忆管理工具',
  dependencies: [{ moduleId: 'agent.tool-meta', optional: false }],

  activate: async () => {
    await import('./tools/memory')
  },
}

/**
 * 知识库工具。
 *
 * 需要 embedding 能力（向量检索）。
 */
const kbToolsModule: ModuleDescriptor = {
  id: 'agent.tools.kb',
  name: '知识库工具',
  version: '1.0.0',
  priority: 'normal',
  requires: ['db', 'embedding'],
  defaultActive: true,
  description: '知识库管理工具',
  dependencies: [{ moduleId: 'agent.tool-meta', optional: false }],

  activate: async () => {
    await import('./tools/kb-tools')
  },
}

/**
 * 编码 Agent 工具集。
 *
 * 包含 read_file/write_file/edit_file/search_files/list_directory/execute_command/shell_session 等。
 * 需要 fs 能力（文件系统访问）。
 */
const codingToolsModule: ModuleDescriptor = {
  id: 'agent.tools.coding',
  name: '编码工具',
  version: '1.0.0',
  priority: 'normal',
  requires: ['fs'],
  defaultActive: true,
  description: '编码 Agent 标准工具集',
  dependencies: [{ moduleId: 'agent.tool-meta', optional: false }],

  activate: async () => {
    await import('./tools/coding-agent-tools')
  },
}

/**
 * 输出渲染工具。
 *
 * output_table/output_choice/output_code 等工具。
 * 需要 ui-render 能力（DOM 渲染）—— CLI 环境下仍可用（输出到终端）。
 */
const outputToolsModule: ModuleDescriptor = {
  id: 'agent.tools.output',
  name: '输出工具',
  version: '1.0.0',
  priority: 'normal',
  defaultActive: true,
  description: '输出渲染工具（表格/选择/代码等）',
  dependencies: [{ moduleId: 'agent.tool-meta', optional: false }],

  activate: async () => {
    await import('./tools/output-tools')
  },
}

/**
 * 文件操作工具。
 *
 * file_tools/doc_convert_tool。
 * 需要 fs 能力。
 */
const fileToolsModule: ModuleDescriptor = {
  id: 'agent.tools.file',
  name: '文件工具',
  version: '1.0.0',
  priority: 'normal',
  requires: ['fs'],
  defaultActive: true,
  description: '文件操作与文档转换工具',
  dependencies: [{ moduleId: 'agent.tool-meta', optional: false }],

  activate: async () => {
    await import('./tools/file-tools')
    await import('./tools/doc-convert-tool')
  },
}

/**
 * 开发工具。
 *
 * git/pkg/sys 工具。
 * 需要 fs 能力。
 */
const devToolsModule: ModuleDescriptor = {
  id: 'agent.tools.dev',
  name: '开发工具',
  version: '1.0.0',
  priority: 'normal',
  requires: ['fs'],
  defaultActive: true,
  description: 'Git/包管理/系统信息工具',
  dependencies: [{ moduleId: 'agent.tool-meta', optional: false }],

  activate: async () => {
    await import('./tools/git-tools')
    await import('./tools/pkg-tools')
    await import('./tools/sys-tools')
  },
}

/**
 * 插件系统工具。
 *
 * plugin_tools/module_builder_tools/plugin_backend_tools。
 */
const pluginToolsModule: ModuleDescriptor = {
  id: 'agent.tools.plugin',
  name: '插件工具',
  version: '1.0.0',
  priority: 'normal',
  defaultActive: true,
  description: '插件系统与模块构建工具',
  dependencies: [{ moduleId: 'agent.tool-meta', optional: false }],

  activate: async () => {
    await import('./tools/plugin-tools')
    await import('./tools/module-builder-tools')
    await import('./tools/plugin-backend-tools')
  },
}

/**
 * 编排工具。
 *
 * orchestrator/pipeline 工具。
 */
const orchestratorToolsModule: ModuleDescriptor = {
  id: 'agent.tools.orchestrator',
  name: '编排工具',
  version: '1.0.0',
  priority: 'normal',
  defaultActive: true,
  description: 'Agent 调度与流水线工具',
  dependencies: [{ moduleId: 'agent.tool-meta', optional: false }],

  activate: async () => {
    await import('./tools/orchestrator-tools')
    await import('./tools/pipeline-tools')
  },
}

/**
 * 视觉与生成工具。
 *
 * vision/image_gen/video_gen 工具。
 * 需要 llm-provider 能力（调用视觉/生成模型）。
 */
const visionToolsModule: ModuleDescriptor = {
  id: 'agent.tools.vision',
  name: '视觉工具',
  version: '1.0.0',
  priority: 'normal',
  requires: ['llm-provider'],
  defaultActive: true,
  description: '视觉分析与图像/视频生成工具',
  dependencies: [{ moduleId: 'agent.tool-meta', optional: false }],

  activate: async () => {
    await import('./tools/vision-tools')
    await import('./tools/image-gen-tools')
    await import('./tools/video-gen-tools')
  },
}

/**
 * 规划工具。
 *
 * plan_tools 工具。
 */
const planToolsModule: ModuleDescriptor = {
  id: 'agent.tools.plan',
  name: '规划工具',
  version: '1.0.0',
  priority: 'normal',
  defaultActive: true,
  description: '计划管理工具',
  dependencies: [{ moduleId: 'agent.tool-meta', optional: false }],

  activate: async () => {
    await import('./tools/plan-tools')
  },
}

/**
 * 人格工具。
 */
const personaToolsModule: ModuleDescriptor = {
  id: 'agent.tools.persona',
  name: '人格工具',
  version: '1.0.0',
  priority: 'normal',
  defaultActive: true,
  description: '人格管理与日常任务工具',
  dependencies: [{ moduleId: 'agent.tool-meta', optional: false }],

  activate: async () => {
    await import('./tools/persona')
    await import('./tools/daily-task')
  },
}

/**
 * 会话工具。
 */
const sessionToolsModule: ModuleDescriptor = {
  id: 'agent.tools.session',
  name: '会话工具',
  version: '1.0.0',
  priority: 'normal',
  defaultActive: true,
  description: '会话管理与文境工具',
  dependencies: [{ moduleId: 'agent.tool-meta', optional: false }],

  activate: async () => {
    await import('./tools/session-tools')
    await import('./tools/manuscript-tools')
  },
}

/**
 * 原生能力工具。
 *
 * native_tools：dialog/clipboard/open_url/notify/native_fetch。
 * 在 terminal 环境下部分能力不可用（dialog/clipboard），但工具本身仍注册（执行时降级）。
 */
const nativeToolsModule: ModuleDescriptor = {
  id: 'agent.tools.native',
  name: '原生工具',
  version: '1.0.0',
  priority: 'normal',
  defaultActive: true,
  description: '原生能力工具（dialog/clipboard/notify 等）',
  dependencies: [{ moduleId: 'agent.tool-meta', optional: false }],

  activate: async () => {
    await import('./tools/native-tools')
  },
}

/**
 * A2UI 工具。
 *
 * a2ui_tools/a2ui_helpers。
 * 仅在 Web 端可用（需要 ui-render 能力）。
 */
const a2uiToolsModule: ModuleDescriptor = {
  id: 'agent.tools.a2ui',
  name: 'A2UI 工具',
  version: '1.0.0',
  priority: 'normal',
  requires: ['ui-render'],
  hosts: ['desktop', 'browser'],
  defaultActive: true,
  description: 'A2UI 界面工具（仅 Web 端）',
  dependencies: [{ moduleId: 'agent.tool-meta', optional: false }],

  activate: async () => {
    await import('./tools/a2ui-tools')
    await import('./tools/a2ui-helpers')
  },
}

/**
 * Web CLI 工具。
 *
 * web_cli_tools：通过 CLI 工具联网搜索。
 * 仅在 Web 端可用（CLI 端已有原生 shell）。
 */
const webCliToolsModule: ModuleDescriptor = {
  id: 'agent.tools.web-cli',
  name: 'Web CLI 工具',
  version: '1.0.0',
  priority: 'normal',
  requires: ['ui-render'],
  hosts: ['desktop', 'browser'],
  defaultActive: true,
  description: 'Web CLI 联网工具（仅 Web 端）',
  dependencies: [{ moduleId: 'agent.tool-meta', optional: false }],

  activate: async () => {
    await import('./tools/web-cli-tools')
  },
}

/**
 * 终端启动器工具。
 *
 * terminal_launcher_tools：智能终端启动器。
 * 仅在 Web 端可用。
 */
const terminalLauncherToolsModule: ModuleDescriptor = {
  id: 'agent.tools.terminal-launcher',
  name: '终端启动器',
  version: '1.0.0',
  priority: 'normal',
  requires: ['ui-render'],
  hosts: ['desktop', 'browser'],
  defaultActive: true,
  description: '智能终端启动器（仅 Web 端）',
  dependencies: [{ moduleId: 'agent.tool-meta', optional: false }],

  activate: async () => {
    await import('./tools/terminal-launcher-tools')
  },
}

/**
 * Retrofit/Schema/Algo 工具。
 *
 * 改造工具、Schema 管理、算法工具。
 */
const retrofitToolsModule: ModuleDescriptor = {
  id: 'agent.tools.retrofit',
  name: '改造与算法工具',
  version: '1.0.0',
  priority: 'normal',
  defaultActive: true,
  description: 'Retrofit/Schema/Algo 工具',
  dependencies: [{ moduleId: 'agent.tool-meta', optional: false }],

  activate: async () => {
    await import('./tools/retrofit-tools')
    await import('./tools/schema-tools')
    await import('./tools/algo-tools')
  },
}

/**
 * 项目导入导出工具。
 */
const projectToolsModule: ModuleDescriptor = {
  id: 'agent.tools.project',
  name: '项目工具',
  version: '1.0.0',
  priority: 'normal',
  defaultActive: true,
  description: '项目导入导出工具',
  dependencies: [{ moduleId: 'agent.tool-meta', optional: false }],

  activate: async () => {
    await import('./tools/project-io')
  },
}

/* ════════════════════════════════════════
   lazy 模块：延迟加载
   ════════════════════════════════════════ */

/**
 * MCP 协议支持。
 *
 * 初始化 MCPManager，支持外部 MCP 服务器连接。
 * 失败静默（MCP 为可选能力）。
 */
const mcpModule: ModuleDescriptor = {
  id: 'agent.mcp',
  name: 'MCP 协议',
  version: '1.0.0',
  priority: 'lazy',
  requires: ['mcp'],
  defaultActive: true,
  description: 'MCP 协议支持（延迟加载）',

  activate: async () => {
    // MCP 模块按需初始化，此处仅验证可加载
    await import('./mcp/mcp-manager')
    await import('./mcp/mcp-adapter')
  },
}

/**
 * 群聊系统。
 *
 * ProviderPool/FlowController/MessageBus/TurnEngine。
 * 失败静默（群聊为高级功能）。
 */
const groupChatModule: ModuleDescriptor = {
  id: 'agent.group-chat',
  name: '群聊系统',
  version: '1.0.0',
  priority: 'lazy',
  requires: ['llm-provider'],
  defaultActive: true,
  description: '多 Agent 群聊系统（延迟加载）',

  activate: async () => {
    await import('./group-chat/provider-pool')
    await import('./group-chat/flow-control')
    await import('./group-chat/message-bus')
    await import('./group-chat/turn-engine')
  },
}

/* ════════════════════════════════════════
   统一导出
   ════════════════════════════════════════ */

/**
 * 所有 Agent 模块描述符（critical + normal + lazy）。
 *
 * Web 端和 CLI 端共用此列表，通过 requires/hosts 自动过滤：
 * - CLI 端：跳过 requires: ['ui-render'] 或 hosts: ['desktop', 'browser'] 的模块
 * - Web 端：加载所有模块
 */
export const agentModules: ModuleDescriptor[] = [
  // ── critical ──
  toolbusModule,
  internalRegistryModule,
  toolMetaModule,

  // ── normal ──
  skillsModule,
  entityToolsModule,
  relationToolsModule,
  searchToolsModule,
  memoryToolsModule,
  kbToolsModule,
  codingToolsModule,
  outputToolsModule,
  fileToolsModule,
  devToolsModule,
  pluginToolsModule,
  orchestratorToolsModule,
  visionToolsModule,
  planToolsModule,
  personaToolsModule,
  sessionToolsModule,
  nativeToolsModule,
  a2uiToolsModule,
  webCliToolsModule,
  terminalLauncherToolsModule,
  retrofitToolsModule,
  projectToolsModule,

  // ── lazy ──
  mcpModule,
  groupChatModule,
]

/**
 * CLI 端可用的模块子集。
 *
 * 排除需要 ui-render 能力的模块（a2ui/web-cli/terminal-launcher）。
 * 这些模块在 CLI 环境下会被 governor 自动跳过（通过 requires 过滤），
 * 但显式过滤可减少不必要的模块加载。
 */
export const cliAgentModules: ModuleDescriptor[] = agentModules.filter(m =>
  !(m.requires?.includes('ui-render') || (m.hosts && !m.hosts.includes('terminal')))
)

/**
 * Web 端可用的模块子集。
 *
 * 包含所有模块（Web 端有完整能力）。
 */
export const webAgentModules: ModuleDescriptor[] = [...agentModules]
