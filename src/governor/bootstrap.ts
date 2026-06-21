/**
 * governor/bootstrap.ts — 调控器启动配置
 *
 * 将 App.vue 的硬编码启动流程改造为声明式模块注册。
 *
 * 模块分层：
 * 1. critical（基础设施）：项目空间、数据库、事件总线、后端检测
 *    - 失败则中止 boot()，显示错误页
 * 2. normal（核心功能）：官方插件、关系初始化、Facet 迁移
 *    - 失败记录但继续
 * 3. lazy（延迟加载）：字体、记忆库、Agent、自动清理
 *    - 空闲时加载，失败静默
 *
 * 启动顺序保证：
 * - critical 全部成功后才进入 normal
 * - normal 全部完成后进入 lazy
 * - 每批内按依赖拓扑排序
 */
import type { ModuleDescriptor } from './types'
import { officialPluginsToDescriptors } from './adapters'
import { OFFICIAL_PLUGINS } from '../plugins/plugin-manifest'

/* ════════════════════════════════════════
   critical 模块：基础设施
   ════════════════════════════════════════ */

/**
 * 项目空间初始化。
 *
 * 原 App.vue 逻辑：
 *   const projectSwitcher = useProjectSwitcher()
 *   projectSwitcher.initialize().then(async () => {
 *     const entityStore = useEntityStore()
 *     entityStore.loadAll()
 *   })
 *
 * 必须在所有其他初始化之前完成。
 */
const projectSpaceModule: ModuleDescriptor = {
  id: 'core.project-space',
  name: '项目空间',
  version: '1.0.0',
  priority: 'critical',
  requires: ['db'],
  defaultActive: true,
  description: '项目空间初始化与实体数据加载',

  activate: async () => {
    const { useProjectSwitcher } = await import('../composables/useProjectSwitcher')
    const projectSwitcher = useProjectSwitcher()
    await projectSwitcher.initialize()

    // 初始化完成后加载实体数据
    const { useEntityStore } = await import('@worldsmith/entity-core')
    const entityStore = useEntityStore()
    await entityStore.loadAll()
  },
}

/**
 * WASM 可用性检测。
 *
 * 原 App.vue 逻辑：
 *   checkWasmAvailability().catch(() => {})
 *
 * 异步检测，不阻塞。作为 critical 模块确保在后端使用前触发检测，
 * 但不 await 结果（WASM 加载可能耗时，不应阻塞启动流程）。
 */
const wasmDetectionModule: ModuleDescriptor = {
  id: 'core.wasm-detection',
  name: 'WASM 检测',
  version: '1.0.0',
  priority: 'critical',
  defaultActive: true,
  description: 'WASM 可用性检测，设置后端类型（异步，不阻塞）',

  activate: async () => {
    const { checkWasmAvailability } = await import('../core/worldsmithCore')
    // 异步检测，不 await 结果，不阻止启动
    // WASM 加载可能耗时，原设计就是不阻塞首屏
    checkWasmAvailability().catch(() => {})
  },
}

/**
 * 插件预注册。
 *
 * 原 App.vue 逻辑：
 *   pluginManager.preRegisterAllEntityTypes()
 *
 * 全局预注册所有实体类型元数据，确保关系查询不断裂。
 */
const pluginPreRegisterModule: ModuleDescriptor = {
  id: 'core.plugin-pre-register',
  name: '插件预注册',
  version: '1.0.0',
  priority: 'critical',
  requires: ['ui-render'],
  defaultActive: true,
  description: '预注册所有官方插件的实体类型元数据',

  activate: async () => {
    const { pluginManager } = await import('../plugins/PluginManager')
    pluginManager.preRegisterAllEntityTypes()

    // 设置视图钩子（原 App.vue 逻辑）
    const { usePluginStore, pluginAPI } = await import('@worldsmith/entity-core')
    const { useUIStore } = await import('../stores/uiStore')
    const pluginStore = usePluginStore()

    pluginManager.setViewHook((viewId: string) => {
      const view = pluginAPI.getViews().find(v => v.id === viewId)
      if (view) {
        pluginStore.registerView(view)
      }
      const uiStore = useUIStore()
      uiStore.ensureViewInOrder(viewId)
    })
  },
}

/* ════════════════════════════════════════
   normal 模块：核心功能
   ════════════════════════════════════════ */

/**
 * 官方插件批量激活。
 *
 * 原 App.vue 逻辑：
 *   const activeIds = settingsStore.getActivePluginIds()
 *   const loadPromises = activeIds.filter(...).map(...)
 *   const loadedPlugins = await Promise.all(loadPromises)
 *   for (const p of loadedPlugins) {
 *     await pluginManager.activate(p.instance)
 *     if (!firstViewSet && pluginStore.views.length > 0) { ... }
 *   }
 *
 * 通过 officialPluginsToDescriptors 转换为 ModuleDescriptor，
 * 由 governor.boot() 按依赖顺序激活。
 */
const officialPluginsModule: ModuleDescriptor = {
  id: 'core.official-plugins',
  name: '官方插件加载',
  version: '1.0.0',
  priority: 'normal',
  requires: ['ui-render'],
  defaultActive: true,
  description: '加载并激活所有已启用的官方插件',

  activate: async () => {
    const { pluginManager } = await import('../plugins/PluginManager')
    const { useSettingsStore } = await import('../stores/settingsStore')
    const { usePluginStore } = await import('@worldsmith/entity-core')
    const { useUIStore } = await import('../stores/uiStore')

    const settingsStore = useSettingsStore()
    const activeIds = settingsStore.getActivePluginIds()

    // 构建插件加载器
    const pluginLoaders: Record<string, () => Promise<any>> = Object.fromEntries(
      OFFICIAL_PLUGINS.map(entry => [
        entry.id,
        () => import(/* @vite-ignore */ `../plugins/official/${entry.importPath}`),
      ]),
    )

    // 并行加载模块
    const loadPromises = activeIds
      .filter(id => pluginLoaders[id])
      .map(async id => {
        const mod = await pluginLoaders[id]()
        return { id, instance: mod }
      })

    const loadedPlugins = await Promise.all(loadPromises)

    // 顺序激活，尽早设置首屏视图
    const pluginStore = usePluginStore()
    const uiStore = useUIStore()
    let firstViewSet = false

    for (const p of loadedPlugins) {
      await pluginManager.activate(p.instance)
      // 每激活一个插件就检查是否已有视图可显示
      if (!firstViewSet && pluginStore.views.length > 0) {
        uiStore.setView(pluginStore.views[0].id)
        uiStore.viewComponent = pluginStore.views[0].component
        firstViewSet = true
      }
    }

    // 兜底：如果所有插件激活完仍无视图
    if (!firstViewSet && pluginStore.views.length > 0) {
      uiStore.setView(pluginStore.views[0].id)
      uiStore.viewComponent = pluginStore.views[0].component
    }
  },
}

/**
 * 关系初始化。
 *
 * 原 App.vue 逻辑：
 *   import('@worldsmith/entity-core/relations').then(m => {
 *     return import('@worldsmith/entity-core').then(m2 => m2.syncToLegacyRegistry())
 *   })
 */
const relationsInitModule: ModuleDescriptor = {
  id: 'core.relations-init',
  name: '关系初始化',
  version: '1.0.0',
  priority: 'normal',
  requires: ['db'],
  defaultActive: true,
  description: '初始化全局关系定义并同步到旧版注册表',

  activate: async () => {
    await import('@worldsmith/entity-core/relations')
    const m2 = await import('@worldsmith/entity-core')
    await m2.syncToLegacyRegistry()
  },
}

/**
 * Facet 迁移。
 *
 * 原 App.vue 逻辑：
 *   import('./core/FacetMigrator').then(async ({ migrateWeaponApparelToItemFacet }) => {
 *     const report = await migrateWeaponApparelToItemFacet()
 *     if (!report.skipped) console.info('[App] Facet 迁移完成:', report)
 *   })
 */
const facetMigrationModule: ModuleDescriptor = {
  id: 'core.facet-migration',
  name: 'Facet 迁移',
  version: '1.0.0',
  priority: 'normal',
  requires: ['db'],
  defaultActive: true,
  description: '迁移旧版 weapon/apparel 实体到 item facet',

  activate: async () => {
    const { migrateWeaponApparelToItemFacet } = await import('../core/FacetMigrator')
    const report = await migrateWeaponApparelToItemFacet()
    if (!report.skipped) {
      console.info('[Governor] Facet 迁移完成:', report)
    }
  },
}

/**
 * 自定义模块系统初始化。
 *
 * 原 App.vue 逻辑：
 *   Promise.all([
 *     import('./modules/store').then(m => m.moduleStore.migrateFromLocalStorage()),
 *     import('./modules/registry').then(m => m.moduleRegistry.initialize()),
 *   ])
 */
const customModulesModule: ModuleDescriptor = {
  id: 'core.custom-modules',
  name: '自定义模块',
  version: '1.0.0',
  priority: 'normal',
  requires: ['db', 'ui-render'],
  defaultActive: true,
  description: '加载并激活自定义模块系统',

  activate: async () => {
    const { moduleStore } = await import('../modules/store')
    const { moduleRegistry } = await import('../modules/registry')

    await moduleStore.migrateFromLocalStorage()
    await moduleRegistry.initialize()
  },
}

/**
 * 全局导航事件监听。
 *
 * 原 App.vue 逻辑：
 *   window.addEventListener('ws-navigate', ((e: CustomEvent) => { ... }) as EventListener)
 */
const navigationListenerModule: ModuleDescriptor = {
  id: 'core.navigation-listener',
  name: '导航事件监听',
  version: '1.0.0',
  priority: 'normal',
  requires: ['ui-render'],
  defaultActive: true,
  description: '注册全局 ws-navigate 事件监听器',

  activate: async () => {
    const { usePluginStore } = await import('@worldsmith/entity-core')
    const { useUIStore } = await import('../stores/uiStore')

    window.addEventListener('ws-navigate', ((e: CustomEvent) => {
      const { view: viewId, entityId } = e.detail
      const store = usePluginStore()
      const ui = useUIStore()
      const view = store.getView(viewId)
      if (view) {
        ui.setView(viewId)
        ui.viewComponent = view.component
        if (entityId) {
          ui.selectEntity(entityId)
        }
      }
    }) as EventListener)
  },
}

/* ════════════════════════════════════════
   lazy 模块：延迟加载
   ════════════════════════════════════════ */

/**
 * 字体预设加载。
 *
 * 原 App.vue 逻辑：
 *   const { bootstrap: fontBootstrap } = useFontBootstrap()
 *   if ('requestIdleCallback' in window) {
 *     requestIdleCallback(() => fontBootstrap())
 *   } else {
 *     setTimeout(() => fontBootstrap(), 200)
 *   }
 */
const fontBootstrapModule: ModuleDescriptor = {
  id: 'core.font-bootstrap',
  name: '字体预设',
  version: '1.0.0',
  priority: 'lazy',
  requires: ['ui-render'],
  defaultActive: true,
  description: '字体预设加载（空闲时执行）',

  activate: async () => {
    const { useFontBootstrap } = await import('../composables/useFontBootstrap')
    const { bootstrap: fontBootstrap } = useFontBootstrap()

    // 使用 requestIdleCallback 延迟加载
    if ('requestIdleCallback' in window) {
      requestIdleCallback(() => fontBootstrap())
    } else {
      setTimeout(() => fontBootstrap(), 200)
    }
  },
}

/**
 * 记忆库归档触发器。
 *
 * 注意：useArchiveTriggers 依赖 Vue 的 onUnmounted，必须在组件 setup 上下文中创建。
 * 因此不作为 governor 模块，而是在 App.vue 的 onMounted 中手动启动。
 *
 * 保留此注释作为启动流程文档，实际启动在 App.vue 中。
 */
// const memoryArchiveModule: ModuleDescriptor = { ... }  // 已移至 App.vue

/**
 * 自动清理。
 *
 * 原 App.vue 逻辑：
 *   const { runIfNeeded: runAutoCleanup } = useAutoCleanup()
 *   runAutoCleanup()
 */
const autoCleanupModule: ModuleDescriptor = {
  id: 'core.auto-cleanup',
  name: '自动清理',
  version: '1.0.0',
  priority: 'lazy',
  requires: ['db'],
  defaultActive: true,
  description: '自动清理过期/无效数据',

  activate: async () => {
    const { useAutoCleanup } = await import('@worldsmith/entity-core/composables')
    const { runIfNeeded: runAutoCleanup } = useAutoCleanup()
    await runAutoCleanup()
  },
}

/* ════════════════════════════════════════
   统一导出
   ════════════════════════════════════════ */

/**
 * 所有核心模块描述符（critical + normal + lazy）。
 *
 * 官方插件通过 officialPluginsToDescriptors 单独转换，
 * 在 bootstrap 中作为 normal 批次的一部分注册。
 *
 * 注意：officialPluginsModule 已经内部处理了官方插件的加载逻辑，
 * 因此这里不直接展开 officialPluginsToDescriptors 的结果，
 * 而是将其作为一个聚合模块。
 */
export const coreModules: ModuleDescriptor[] = [
  // ── critical ──
  projectSpaceModule,
  wasmDetectionModule,
  pluginPreRegisterModule,

  // ── normal ──
  officialPluginsModule,
  relationsInitModule,
  facetMigrationModule,
  customModulesModule,
  navigationListenerModule,

  // ── lazy ──
  fontBootstrapModule,
  // memoryArchiveModule 已移至 App.vue（依赖 Vue onUnmounted）
  autoCleanupModule,
]

/**
 * 获取所有模块描述符（核心模块 + 官方插件描述符）。
 *
 * 注意：官方插件的实际加载由 officialPluginsModule 聚合处理，
 * 这里返回的官方插件描述符仅用于注册表展示和未来细粒度控制。
 */
export function getAllModuleDescriptors(): ModuleDescriptor[] {
  const officialDescriptors = officialPluginsToDescriptors(OFFICIAL_PLUGINS)
  return [...coreModules, ...officialDescriptors]
}
