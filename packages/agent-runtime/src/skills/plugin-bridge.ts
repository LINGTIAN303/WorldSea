/**
 * 插件能力桥接模块（骨架保留，数据退役）
 *
 * 2026-09-21 世界观芽工具整合（批 3）：原「芽能力表」（WORLD_SMITH_PLUGIN_CAPABILITIES——
 * 19 个芽的 agentSkills / capabilities 声明）已退役——其素材已迁入 worldview 工具
 * （tools/worldview/{guides,actions}.ts 为唯一事实源；「芽↔技能」登记漂移随之收敛）。
 * 本模块仅保留函数骨架，供旧工具链（toolbus 的 resolvePluginToolNames）兼容——
 * 注册中心现为空，相关函数按空集工作。
 */

/** 插件能力的单条声明 */
export interface PluginCapabilityDeclaration {
  action: string
  description: string
  params?: string[]
}

/** 插件的完整能力描述 */
export interface PluginCapability {
  pluginId: string
  pluginName: string
  entityTypes: string[]
  agentSkills: string[]
  capabilities: PluginCapabilityDeclaration[]
}

/** 插件能力注册中心（内存级；当前无内置数据——见头注释） */
const capabilityRegistry = new Map<string, PluginCapability>()

/** 注册一个插件的能力信息 */
export function registerPluginCapability(cap: PluginCapability): void {
  capabilityRegistry.set(cap.pluginId, cap)
}

/** 根据插件 ID 查询其能力信息 */
export function getPluginCapability(pluginId: string): PluginCapability | undefined {
  return capabilityRegistry.get(pluginId)
}

/** 获取所有已注册的插件能力 */
export function getAllPluginCapabilities(): PluginCapability[] {
  return Array.from(capabilityRegistry.values())
}

/** 根据激活的 Skill ID 列表，解析出关联的插件能力（技能体系退役后恒为空集） */
export function resolveRelatedPlugins(_skillIds: string[]): PluginCapability[] {
  return []
}

/** 根据激活的 Skill ID 列表，解析出所有关联的插件专属工具名称 */
export function resolvePluginToolNames(_skillIds: string[]): string[] {
  // 芽工具（旧插件表）已退役：插件专属工具面为 worldview 工具的动作表
  return []
}

/** 构建注入系统提示词的能力描述（注册中心为空时返回空串） */
export function buildPluginCapabilityPrompt(_skillIds: string[]): string {
  return ''
}
