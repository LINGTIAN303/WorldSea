/**
 * governor/types.ts — 调控器类型定义
 *
 * 三维度环境模型 + 能力标签 + 模块描述符 + 调控器 API 契约。
 * 调控器统一接管 pluginManager 与 moduleRegistry，按环境能力与依赖拓扑激活模块。
 */

/* ════════════════════════════════════════
   环境维度 1：生命周期阶段
   ════════════════════════════════════════ */

/**
 * 生命周期阶段。
 * - development：开发环境，启用调试工具、详细日志、mock 数据
 * - production：生产环境，禁用调试工具，精简日志
 */
export type LifecyclePhase = 'development' | 'production'

/* ════════════════════════════════════════
   环境维度 2：宿主形态
   ════════════════════════════════════════ */

/**
 * 宿主形态。决定哪些模块可加载。
 * - desktop：Tauri 桌面端（完整能力，含 fs/tauri）
 * - browser：纯 Web 浏览器（无 fs/tauri，有 DOM）
 * - terminal：worldsmith-agent CLI（无 UI 渲染，有 fs）
 * - cloud：云端服务环境（无本地状态，依赖远程 API）
 */
export type RuntimeHost = 'desktop' | 'browser' | 'terminal' | 'cloud'

/* ════════════════════════════════════════
   环境维度 3：能力后端
   ════════════════════════════════════════ */

/**
 * 能力后端。决定算法/存储调用路径。
 * - tauri：Tauri 原生命令
 * - wasm：WASM 模块
 * - js-fallback：纯 JS 降级实现
 */
export type CapabilityBackend = 'tauri' | 'wasm' | 'js-fallback'

/* ════════════════════════════════════════
   能力标签
   ════════════════════════════════════════ */

/**
 * 能力标签。模块通过 requires 声明依赖的能力，调控器检测后决定是否激活。
 */
export type CapabilityTag =
  // ── 基础设施能力 ──
  | 'fs'              // 文件系统访问（Tauri/Node）
  | 'db'              // 持久化数据库（Dexie/SQLite）
  | 'network'         // 网络访问
  | 'worker'          // Web Worker
  | 'gpu'             // GPU/Canvas 渲染
  // ── 后端能力 ──
  | 'tauri'           // Tauri 原生 API
  | 'wasm'            // WASM 可用
  | 'native-algo'     // 原生算法（tauri 或 wasm）
  // ── UI 能力 ──
  | 'ui-render'       // DOM 渲染（browser/desktop 有，terminal 无）
  | 'canvas'          // Canvas 2D 绘图
  // ── Agent 能力 ──
  | 'llm-provider'    // LLM API 访问
  | 'embedding'       // 向量嵌入服务
  | 'mcp'             // MCP 协议支持
  // ── 资源特征 ──
  | 'heavy-cpu'       // CPU 密集（影响是否走 Worker）

/* ════════════════════════════════════════
   环境对象
   ════════════════════════════════════════ */

/**
 * 运行环境快照。启动时一次性检测，运行期不变（静态检测策略）。
 */
export interface Environment {
  /** 生命周期阶段 */
  phase: LifecyclePhase
  /** 宿主形态 */
  host: RuntimeHost
  /** 能力后端 */
  backend: CapabilityBackend
  /** 动态检测的能力集合（只读） */
  capabilities: ReadonlySet<CapabilityTag>
}

/* ════════════════════════════════════════
   模块依赖（保留 semver 兼容性检查）
   ════════════════════════════════════════ */

/**
 * 模块依赖声明。复用现有 moduleRegistry 的 semver 检查逻辑。
 */
export interface ModuleDependency {
  /** 被依赖模块 id */
  moduleId: string
  /** semver 范围，如 ">=1.0.0 <2.0.0"、"^1.2"、"1.x" */
  version?: string
  /** 该模块期望从此依赖中使用的实体类型列表 */
  requiredTypes?: string[]
  /** 如果为 true，缺少此依赖不会阻止模块激活 */
  optional?: boolean
}

/* ════════════════════════════════════════
   模块优先级
   ════════════════════════════════════════ */

/**
 * 模块启动优先级。决定 boot() 时的激活批次与失败策略。
 * - critical：基础设施（fs/db/event-bus），失败则中止 boot()
 * - normal：大部分官方插件，失败记录但继续
 * - lazy：非首屏必需（字体/记忆库/agent），空闲时加载，失败静默
 */
export type ModulePriority = 'critical' | 'normal' | 'lazy'

/* ════════════════════════════════════════
   模块描述符（统一插件 + 模块）
   ════════════════════════════════════════ */

/**
 * 模块描述符。统一 OFFICIAL_PLUGINS 与 ModuleManifest 的声明格式。
 *
 * 激活流程：
 * 1. 检查 hosts/phase 是否匹配当前环境
 * 2. 检查 requires 能力是否全部满足
 * 3. 检查 dependencies 是否已激活且版本兼容
 * 4. 调用 activate(api) 执行实际注册
 */
export interface ModuleDescriptor {
  /* ── 标识 ── */
  /** 模块 id，如 'official.characters' | 'custom.xxx' | 'core.fs' */
  id: string
  /** 人类可读名称 */
  name: string
  /** 版本号（semver） */
  version: string

  /* ── 环境约束 ── */
  /** 必须满足的能力，否则跳过 */
  requires?: CapabilityTag[]
  /** 限定的宿主（不填=全平台） */
  hosts?: RuntimeHost[]
  /** 限定的生命周期阶段（不填=全阶段） */
  phase?: LifecyclePhase[]

  /* ── 依赖 ── */
  /** 其他模块依赖（保留 semver 检查） */
  dependencies?: ModuleDependency[]

  /* ── 启动优先级 ── */
  priority: ModulePriority

  /* ── 激活函数 ── */
  /**
   * 激活模块。接收 GovernorAPI，内部调用 registerEntityV2/registerView 等。
   * 抛出异常视为激活失败。
   */
  activate: (api: GovernorAPI) => Promise<void> | void
  /** 停用模块，清理注册的资源。可选。 */
  deactivate?: () => Promise<void> | void

  /* ── 元数据 ── */
  /** 安装来源 */
  source?: 'builtin' | 'local' | 'remote'
  /** 用户未配置时是否默认激活 */
  defaultActive?: boolean
  /** 图标标识（用于 UI 展示） */
  icon?: string
  /** 描述文本 */
  description?: string
}

/* ════════════════════════════════════════
   调控器 API（提供给模块使用）
   ════════════════════════════════════════ */

/**
 * 调控器提供给模块的 API。
 *
 * 包装现有 pluginAPI，附加环境上下文。
 * 模块通过此 API 注册实体类型/视图/关系，并查询环境能力。
 */
export interface GovernorAPI {
  /** 当前模块的描述符 */
  readonly module: { id: string; name: string; version: string }
  /** 当前环境快照 */
  readonly env: Environment
  /** 查询能力是否可用 */
  hasCapability(tag: CapabilityTag): boolean

  // ── 复用现有 pluginAPI 的注册方法（类型从 PluginAPIType 推导） ──
  /** 注册实体类型（V2，基于 Trait） */
  registerEntityV2(params: {
    type: string
    label: string
    icon?: string
    traits: unknown[]
    ownFields: unknown[]
    facets?: string[]
  }): void
  /** 注册 Facet 定义 */
  registerFacet(facet: unknown): void
  /** 注册关系类型（V2） */
  registerRelationV2(schema: unknown): void
  /** 注册视图 */
  registerView(view: unknown): void
  /** 注册节点类型 */
  registerNodeType(nodeType: unknown): void
  /** 注册工作流模板 */
  registerWorkflowTemplate(template: unknown): void
  /** 注册 Hook */
  registerHook(name: string, fn: Function): void
  /** 查询实体 */
  getEntities(type?: string): Promise<unknown[]>
  getEntity(id: string): Promise<unknown>
  getRelations(filter?: { type?: string; sourceId?: string; targetId?: string }): Promise<unknown[]>
}

/* ════════════════════════════════════════
   激活结果与启动报告
   ════════════════════════════════════════ */

/**
 * 单个模块的激活结果。
 */
export interface ActivationResult {
  /** 是否成功 */
  success: boolean
  /** 模块描述符 */
  module: ModuleDescriptor
  /** 失败/跳过时的错误信息 */
  error?: string
  /** 是否因能力不足或环境不匹配而跳过 */
  skipped?: boolean
  /** 跳过/失败原因 */
  reason?: string
}

/**
 * boot() 完成后的启动报告。
 */
export interface BootReport {
  /** 成功激活的模块 id 列表（按激活顺序） */
  activated: string[]
  /** 激活失败的模块（不含跳过的） */
  failed: Array<{ id: string; error: string; priority: ModulePriority }>
  /** 因能力不足/环境不匹配而跳过的模块 */
  skipped: Array<{ id: string; reason: string }>
  /** 启动总耗时（ms） */
  duration: number
  /** 是否有 critical 模块失败（用于决定是否显示错误页） */
  hasCriticalFailure: boolean
}

/* ════════════════════════════════════════
   模块运行时状态
   ════════════════════════════════════════ */

/**
 * 模块运行时信息（查询用）。
 */
export interface ModuleInfo {
  id: string
  name: string
  version: string
  priority: ModulePriority
  source?: 'builtin' | 'local' | 'remote'
  active: boolean
}

/**
 * 模块失败记录。
 */
export interface ModuleFailure {
  id: string
  name: string
  priority: ModulePriority
  error: string
  /** 失败时间戳 */
  timestamp: number
}

/* ════════════════════════════════════════
   调控器核心接口
   ════════════════════════════════════════ */

/**
 * 调控器——统一接管 pluginManager + moduleRegistry。
 *
 * 职责：
 *   - 环境检测与能力查询
 *   - 模块注册与生命周期管理
 *   - 按 priority + 依赖拓扑自动激活
 *   - 分级降级（critical 中止 / normal 记录 / lazy 静默）
 */
export interface Governor {
  /* ── 环境查询 ── */
  /** 获取当前环境快照 */
  getEnvironment(): Environment
  /** 查询能力是否可用 */
  hasCapability(tag: CapabilityTag): boolean

  /* ── 模块生命周期 ── */
  /** 注册单个模块 */
  register(descriptor: ModuleDescriptor): void
  /** 批量注册模块 */
  registerAll(descriptors: ModuleDescriptor[]): void
  /** 手动激活单个模块（通常由 boot() 自动调用） */
  activate(id: string): Promise<ActivationResult>
  /** 手动停用单个模块 */
  deactivate(id: string): Promise<void>
  /** 查询模块是否已激活 */
  isActive(id: string): boolean
  /** 获取模块描述符 */
  getModule(id: string): ModuleDescriptor | undefined
  /** 获取所有已注册模块描述符 */
  getAllModules(): ModuleDescriptor[]

  /* ── 批量启动 ── */
  /**
   * 按 priority + 依赖拓扑自动激活所有可激活模块。
   * 返回启动报告，不抛异常（critical 失败通过 hasCriticalFailure 标识）。
   */
  boot(): Promise<BootReport>

  /* ── 状态查询 ── */
  /** 获取所有已激活模块信息 */
  getActiveModules(): ModuleInfo[]
  /** 获取所有激活失败的模块 */
  getFailedModules(): ModuleFailure[]
  /** 获取所有未激活模块（含跳过和未注册激活的） */
  getInactiveModules(): ModuleInfo[]
}

/* ════════════════════════════════════════
   调控器创建选项
   ════════════════════════════════════════ */

/**
 * 调控器创建选项。
 */
export interface GovernorOptions {
  /** 环境快照。不传则自动调用 detectEnvironment() */
  environment?: Environment
  /**
   * 用户配置的激活模块 id 列表（来自 settingsStore.getActivePluginIds）。
   * 不在此列表且 defaultActive=false 的模块不会被 boot() 激活。
   * 空数组=只激活 defaultActive=true 的模块。
   */
  activeModuleIds?: string[]
  /** 日志开关，默认 development 阶段开启 */
  verbose?: boolean
}
