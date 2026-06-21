/**
 * governor/adapters.ts — 适配器
 *
 * 将现有的 OFFICIAL_PLUGINS 和 ModuleManifest 转换为统一的 ModuleDescriptor。
 *
 * 适配策略：
 * 1. OFFICIAL_PLUGINS → ModuleDescriptor
 *    - requires/hosts 根据插件特性推断（drawing/tactical-board 需 canvas）
 *    - priority 统一为 'normal'（官方插件）
 *    - defaultActive 从 OfficialPluginEntry.defaultActive 映射
 *    - activate 函数动态 import 插件模块后调用
 *
 * 2. ModuleManifest（自定义模块）→ ModuleDescriptor
 *    - requires 留空（自定义模块不依赖环境能力）
 *    - priority 为 'normal'
 *    - activate 调用现有 moduleRegistry.activateModule 逻辑
 *    - 保留 dependencies 和 semver 检查
 */
import type { ModuleDescriptor, ModuleDependency, GovernorAPI } from './types'
import type { OfficialPluginEntry } from '../plugins/plugin-manifest'
import type { ModuleManifest } from '../modules/types'

/* ════════════════════════════════════════
   OFFICIAL_PLUGINS → ModuleDescriptor
   ════════════════════════════════════════ */

/**
 * 需要特定能力的插件映射表。
 *
 * 根据插件的实际功能推断：
 * - drawing/tactical-board：使用 Canvas 渲染，需 'canvas' 能力
 * - 其他插件：默认无特殊能力要求
 *
 * 后续可逐步补充更精细的能力声明。
 */
const PLUGIN_CAPABILITY_MAP: Record<string, import('./types').CapabilityTag[]> = {
  'official.drawing': ['canvas', 'ui-render'],
  'official.tactical-board': ['canvas', 'ui-render'],
}

/**
 * 限定宿主的插件映射表。
 *
 * 所有官方插件都需要 UI 渲染，因此限定为 desktop/browser。
 * terminal/cloud 环境下不加载这些插件。
 */
const PLUGIN_HOSTS_MAP: Partial<Record<string, import('./types').RuntimeHost[]>> = {}

/**
 * 将单个 OfficialPluginEntry 转换为 ModuleDescriptor。
 *
 * @param entry 官方插件清单条目
 * @returns 模块描述符
 */
export function officialPluginToDescriptor(entry: OfficialPluginEntry): ModuleDescriptor {
  const requires = PLUGIN_CAPABILITY_MAP[entry.id] || ['ui-render']
  const hosts = PLUGIN_HOSTS_MAP[entry.id] || ['desktop', 'browser']

  return {
    id: entry.id,
    name: entry.name || entry.id,
    version: '2.0.0', // 官方插件统一版本，实际版本由插件 manifest 提供
    requires,
    hosts,
    priority: 'normal',
    source: 'builtin',
    defaultActive: entry.defaultActive,
    description: `官方插件: ${entry.name || entry.id}`,

    /**
     * 激活函数：动态 import 插件模块后调用其 activate。
     *
     * 注意：这里使用动态 import 路径，由 Vite 在构建时解析。
     * importPath 来自 OfficialPluginEntry，形如 './characters/index'。
     */
    activate: async (api: GovernorAPI) => {
      const mod = await import(/* @vite-ignore */ `../plugins/official/${entry.importPath}`)
      if (typeof mod.activate === 'function') {
        // 插件的 activate 接收 PluginAPIType，GovernorAPI 兼容（都包含注册方法）
        await mod.activate(api as unknown as import('@worldsmith/entity-core').PluginAPIType)
      } else {
        throw new Error(`插件 "${entry.id}" 未导出 activate 函数`)
      }
    },

    /**
     * 停用函数：调用插件的 deactivate（如有）。
     * 大部分官方插件无 deactivate，由 pluginAPI 的清理机制处理。
     */
    deactivate: async () => {
      try {
        const mod = await import(/* @vite-ignore */ `../plugins/official/${entry.importPath}`)
        if (typeof mod.deactivate === 'function') {
          await mod.deactivate()
        }
      } catch {
        // 停用失败不抛错，避免影响其他模块
      }
    },
  }
}

/**
 * 批量转换 OFFICIAL_PLUGINS 为 ModuleDescriptor 列表。
 */
export function officialPluginsToDescriptors(
  entries: readonly OfficialPluginEntry[],
): ModuleDescriptor[] {
  return entries.map(officialPluginToDescriptor)
}

/* ════════════════════════════════════════
   ModuleManifest（自定义模块）→ ModuleDescriptor
   ════════════════════════════════════════ */

/**
 * 将 ModuleManifest 的 dependencies 转换为 Governor 的 ModuleDependency。
 *
 * 两者的 dependencies 结构基本一致，直接映射。
 */
function mapDependencies(
  deps: ModuleManifest['dependencies'],
): ModuleDependency[] {
  return (deps || []).map(d => ({
    moduleId: d.moduleId,
    version: d.version,
    requiredTypes: d.requiredTypes,
    optional: d.optional,
  }))
}

/**
 * 将自定义模块的 ModuleManifest 转换为 ModuleDescriptor。
 *
 * 自定义模块通过 moduleRegistry.activateModule 注册实体类型/关系/视图，
 * 这里包装为 GovernorAPI 兼容的 activate 函数。
 *
 * @param manifest 模块清单
 * @param active 是否当前激活（来自 moduleStore）
 * @returns 模块描述符
 */
export function customModuleToDescriptor(
  manifest: ModuleManifest,
  active: boolean = false,
): ModuleDescriptor {
  return {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    // 自定义模块不依赖特殊环境能力，但需要 UI 渲染
    requires: ['ui-render'],
    hosts: ['desktop', 'browser'],
    priority: 'normal',
    source: 'local',
    defaultActive: active,
    icon: manifest.icon,
    description: manifest.description,
    dependencies: mapDependencies(manifest.dependencies),

    /**
     * 激活函数：委托现有 moduleRegistry.activateModule 逻辑。
     *
     * 这里通过动态 import 避免循环依赖。
     * activateModule 内部会注册 entityTypes/relationTypes/views 到全局注册表。
     */
    activate: async () => {
      const { moduleRegistry } = await import('../modules/registry')
      // 构造 ModuleInstance 并激活
      const { moduleStore } = await import('../modules/store')
      const allInstances = await moduleStore.getAll()
      const instance = allInstances.find(i => i.id === manifest.id)
      if (instance) {
        // activateModule 是内部函数，通过 moduleRegistry.activateModule 暴露
        await moduleRegistry.activateModule(instance)
      } else {
        throw new Error(`自定义模块 "${manifest.id}" 实例未找到`)
      }
    },

    /**
     * 停用函数：委托现有 moduleRegistry.deactivateModule。
     */
    deactivate: async () => {
      const { moduleRegistry } = await import('../modules/registry')
      await moduleRegistry.deactivateModule(manifest.id)
    },
  }
}

/**
 * 批量转换自定义模块。
 *
 * @param manifests 模块清单列表
 * @param activeIds 当前激活的模块 id 集合
 */
export function customModulesToDescriptors(
  manifests: ModuleManifest[],
  activeIds: Set<string>,
): ModuleDescriptor[] {
  return manifests.map(m => customModuleToDescriptor(m, activeIds.has(m.id)))
}

/* ════════════════════════════════════════
   能力映射扩展点
   ════════════════════════════════════════ */

/**
 * 注册插件的能力要求（用于运行时补充声明）。
 *
 * 在 P5 阶段，各插件可调用此方法补充自己的能力要求，
 * 而无需修改 PLUGIN_CAPABILITY_MAP 常量。
 */
const customCapabilityOverrides = new Map<string, import('./types').CapabilityTag[]>()

export function setPluginCapabilities(
  pluginId: string,
  capabilities: import('./types').CapabilityTag[],
): void {
  customCapabilityOverrides.set(pluginId, capabilities)
}

/**
 * 查询插件的最终能力要求（合并静态映射与运行时覆盖）。
 */
export function getPluginCapabilities(
  pluginId: string,
): import('./types').CapabilityTag[] | undefined {
  return customCapabilityOverrides.get(pluginId) || PLUGIN_CAPABILITY_MAP[pluginId]
}
